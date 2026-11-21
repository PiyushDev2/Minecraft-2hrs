/**
 * @file LightEngine.js
 * @description Dual-bank 4-bit + 4-bit voxel lighting engine (0..15 SkyLight + 0..15 BlockLight).
 * Uses column sunlight casting + cross-chunk BFS add/remove flood-fill queues.
 */

import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from '../chunks/Chunk.js';

const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Computes and incrementally updates packed SkyLight & BlockLight across chunks.
 */
export class LightEngine {
  /**
   * @param {import('../chunks/ChunkManager.js').ChunkManager} chunkManager
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} blockRegistry
   */
  constructor(chunkManager, blockRegistry) {
    this.chunkManager = chunkManager;
    this.blockRegistry = blockRegistry;
  }

  /**
   * Returns { sky, block } light levels (0..15) at world coordinates (wx, wy, wz).
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @returns {{ sky: number, block: number }}
   */
  getLight(wx, wy, wz) {
    const iy = Math.floor(wy);
    if (iy >= CHUNK_HEIGHT) return { sky: 15, block: 0 };
    if (iy < 0) return { sky: 0, block: 0 };

    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(wx, wz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);
    if (!chunk) return { sky: 15, block: 0 };

    const byte = chunk.lightData[(iy << 8) | (lz << 4) | lx];
    return {
      sky: (byte >> 4) & 0x0f,
      block: byte & 0x0f,
    };
  }

  /**
   * @private
   */
  _getSky(wx, wy, wz) {
    if (wy >= CHUNK_HEIGHT) return 15;
    if (wy < 0) return 0;
    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(wx, wz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);
    if (!chunk) return 15;
    return chunk.getSkyLight(lx, wy, lz);
  }

  /**
   * @private
   */
  _setSky(wx, wy, wz, val, dirtyChunks) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(wx, wz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);
    if (!chunk) return false;
    const prev = chunk.getSkyLight(lx, wy, lz);
    if (prev === val) return false;
    chunk.setSkyLight(lx, wy, lz, val);
    chunk.dirty = true;
    dirtyChunks?.add(chunk);
    return true;
  }

  /**
   * @private
   */
  _getBlockLight(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(wx, wz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);
    if (!chunk) return 0;
    return chunk.getBlockLight(lx, wy, lz);
  }

  /**
   * @private
   */
  _setBlockLight(wx, wy, wz, val, dirtyChunks) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(wx, wz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);
    if (!chunk) return false;
    const prev = chunk.getBlockLight(lx, wy, lz);
    if (prev === val) return false;
    chunk.setBlockLight(lx, wy, lz, val);
    chunk.dirty = true;
    dirtyChunks?.add(chunk);
    return true;
  }

  /**
   * @private
   */
  _hasLoadedChunkAt(wx, wz) {
    const { chunkX, chunkZ } = this.chunkManager.worldToChunkCoord(wx, wz);
    return this.chunkManager.hasChunk(chunkX, chunkZ);
  }

  /**
   * Computes initial sunlight columns, artificial emitters, and neighbor-border BFS
   * for a newly generated chunk.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   */
  computeChunkLight(chunk) {
    chunk.lightData.fill(0);

    const skyQueue = [];
    const blockQueue = [];

    // 1. Top-down direct sunlight & emitter scan
    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        let sky = 15;

        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const idx = (y << 8) | (lz << 4) | lx;
          const id = chunk.blocks[idx];
          const emission = this.blockRegistry.getLightEmission(id);
          const atten = this.blockRegistry.getLightAttenuation(id);

          if (sky > 0) {
            if (atten >= 15) {
              sky = 0;
            } else {
              if (atten > 1) {
                sky = Math.max(0, sky - atten);
              }
              if (sky > 0) {
                chunk.setSkyLight(lx, y, lz, sky);
              }
            }
          }

          if (emission > 0) {
            chunk.setBlockLight(lx, y, lz, emission);
            blockQueue.push(wx, y, wz, emission);
          }
        }
      }
    }

    // 2. Seed sky BFS wherever lit air borders darker air (caves/overhangs) or chunk boundaries
    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const sky = chunk.getSkyLight(lx, y, lz);
          if (sky <= 1) continue;

          // Seed if an adjacent horizontal voxel has lower sky light
          let needsSpread = false;
          for (let n = 0; n < 4; n++) {
            const nx = wx + NEIGHBORS[n][0];
            const nz = wz + NEIGHBORS[n][2];
            if (!this._hasLoadedChunkAt(nx, nz)) continue;
            const nId = this.chunkManager.getBlock(nx, y, nz);
            if (this.blockRegistry.getLightAttenuation(nId) < 15) {
              const nSky = this._getSky(nx, y, nz);
              if (nSky < sky - 1) {
                needsSpread = true;
                break;
              }
            }
          }
          if (needsSpread) {
            skyQueue.push(wx, y, wz, sky);
          }
        }
      }
    }

    // Also pull sky & block light across already-loaded neighbor chunk borders
    this._seedFromNeighborBorders(chunk, skyQueue, blockQueue);

    const dirtyChunks = new Set([chunk]);
    this._propagateSkyAdd(skyQueue, dirtyChunks);
    this._propagateBlockAdd(blockQueue, dirtyChunks);

    chunk.lightDirty = false;
  }

  /**
   * Pulls boundary light from already-loaded neighbor chunks into a newly generated chunk.
   * @private
   */
  _seedFromNeighborBorders(chunk, skyQueue, blockQueue) {
    const borders = [
      { dx: -1, dz: 0, startX: chunk.worldX - 1, endX: chunk.worldX - 1, startZ: chunk.worldZ, endZ: chunk.worldZ + CHUNK_DEPTH - 1 },
      { dx: 1, dz: 0, startX: chunk.worldX + CHUNK_WIDTH, endX: chunk.worldX + CHUNK_WIDTH, startZ: chunk.worldZ, endZ: chunk.worldZ + CHUNK_DEPTH - 1 },
      { dx: 0, dz: -1, startX: chunk.worldX, endX: chunk.worldX + CHUNK_WIDTH - 1, startZ: chunk.worldZ - 1, endZ: chunk.worldZ - 1 },
      { dx: 0, dz: 1, startX: chunk.worldX, endX: chunk.worldX + CHUNK_WIDTH - 1, startZ: chunk.worldZ + CHUNK_DEPTH, endZ: chunk.worldZ + CHUNK_DEPTH },
    ];

    for (const b of borders) {
      if (!this._hasLoadedChunkAt(b.startX, b.startZ)) continue;
      for (let wz = b.startZ; wz <= b.endZ; wz++) {
        for (let wx = b.startX; wx <= b.endX; wx++) {
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            const s = this._getSky(wx, y, wz);
            if (s > 1) skyQueue.push(wx, y, wz, s);
            const bl = this._getBlockLight(wx, y, wz);
            if (bl > 1) blockQueue.push(wx, y, wz, bl);
          }
        }
      }
    }
  }

  /**
   * Incrementally updates both SkyLight and BlockLight when a single voxel changes.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} prevId
   * @param {number} newId
   */
  onBlockChanged(wx, wy, wz, prevId, newId) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    if (iy < 0 || iy >= CHUNK_HEIGHT) return;

    const dirtyChunks = new Set();
    const prevEmission = this.blockRegistry.getLightEmission(prevId);
    const newEmission = this.blockRegistry.getLightEmission(newId);
    const prevAtten = this.blockRegistry.getLightAttenuation(prevId);
    const newAtten = this.blockRegistry.getLightAttenuation(newId);

    // --- 1. Artificial BlockLight ---
    const blockAddQueue = [];
    const blockRemoveQueue = [];
    const oldBlockLight = this._getBlockLight(ix, iy, iz);

    if (prevEmission > 0 || (newAtten > prevAtten && oldBlockLight > 0)) {
      if (oldBlockLight > 0) {
        blockRemoveQueue.push(ix, iy, iz, oldBlockLight);
        this._setBlockLight(ix, iy, iz, 0, dirtyChunks);
      }
    }

    if (blockRemoveQueue.length > 0) {
      this._propagateBlockRemove(blockRemoveQueue, blockAddQueue, dirtyChunks);
    }

    if (newEmission > 0) {
      this._setBlockLight(ix, iy, iz, newEmission, dirtyChunks);
      blockAddQueue.push(ix, iy, iz, newEmission);
    } else if (newAtten < prevAtten) {
      // Newly transparent block: pull light from brighter neighbors
      for (let i = 0; i < 6; i++) {
        const nx = ix + NEIGHBORS[i][0];
        const ny = iy + NEIGHBORS[i][1];
        const nz = iz + NEIGHBORS[i][2];
        const nl = this._getBlockLight(nx, ny, nz);
        if (nl > newAtten) {
          blockAddQueue.push(nx, ny, nz, nl);
        }
      }
    }

    if (blockAddQueue.length > 0) {
      this._propagateBlockAdd(blockAddQueue, dirtyChunks);
    }

    // --- 2. SkyLight ---
    const skyAddQueue = [];
    const skyRemoveQueue = [];
    const oldSky = this._getSky(ix, iy, iz);

    if (newAtten > prevAtten && oldSky > 0) {
      skyRemoveQueue.push(ix, iy, iz, oldSky);
      this._setSky(ix, iy, iz, 0, dirtyChunks);

      // If blocking a direct sky=15 column, trace straight down until hitting solid roof
      if (oldSky === 15) {
        for (let y = iy - 1; y >= 0; y--) {
          const belowId = this.chunkManager.getBlock(ix, y, iz);
          if (this.blockRegistry.getLightAttenuation(belowId) >= 15) break;
          const belowSky = this._getSky(ix, y, iz);
          if (belowSky === 15) {
            skyRemoveQueue.push(ix, y, iz, 15);
            this._setSky(ix, y, iz, 0, dirtyChunks);
          } else {
            break;
          }
        }
      }
      this._propagateSkyRemove(skyRemoveQueue, skyAddQueue, dirtyChunks);
    } else if (newAtten < prevAtten) {
      const aboveSky = this._getSky(ix, iy + 1, iz);
      if (aboveSky === 15 && newAtten === 1) {
        // Direct sunlight floods straight down through newly opened air column
        for (let y = iy; y >= 0; y--) {
          const colId = this.chunkManager.getBlock(ix, y, iz);
          const colAtten = this.blockRegistry.getLightAttenuation(colId);
          if (colAtten >= 15) break;
          if (colAtten === 1) {
            this._setSky(ix, y, iz, 15, dirtyChunks);
            skyAddQueue.push(ix, y, iz, 15);
          } else {
            const attenuated = Math.max(0, 15 - colAtten);
            if (attenuated > this._getSky(ix, y, iz)) {
              this._setSky(ix, y, iz, attenuated, dirtyChunks);
              skyAddQueue.push(ix, y, iz, attenuated);
            }
            break;
          }
        }
      } else {
        // Pull sky light from neighbors
        for (let i = 0; i < 6; i++) {
          const nx = ix + NEIGHBORS[i][0];
          const ny = iy + NEIGHBORS[i][1];
          const nz = iz + NEIGHBORS[i][2];
          const ns = this._getSky(nx, ny, nz);
          if (ns > newAtten) {
            skyAddQueue.push(nx, ny, nz, ns);
          }
        }
      }
    }

    // If a semi-transparent block (e.g., leaves/water) replaced air, re-seed attenuated sky light from neighbors
    if (newAtten > prevAtten && newAtten < 15) {
      let bestSky = 0;
      for (let i = 0; i < 6; i++) {
        const nx = ix + NEIGHBORS[i][0];
        const ny = iy + NEIGHBORS[i][1];
        const nz = iz + NEIGHBORS[i][2];
        const ns = this._getSky(nx, ny, nz);
        if (ns > newAtten) {
          bestSky = Math.max(bestSky, ns - newAtten);
        }
      }
      if (bestSky > this._getSky(ix, iy, iz)) {
        this._setSky(ix, iy, iz, bestSky, dirtyChunks);
        skyAddQueue.push(ix, iy, iz, bestSky);
      }
    }

    if (skyAddQueue.length > 0) {
      this._propagateSkyAdd(skyAddQueue, dirtyChunks);
    }
  }

  /** @private */
  _propagateBlockAdd(queue, dirtyChunks) {
    let head = 0;
    while (head < queue.length) {
      const x = queue[head++];
      const y = queue[head++];
      const z = queue[head++];
      const level = queue[head++];

      if (level <= 1 || this._getBlockLight(x, y, z) < level) continue;

      for (let i = 0; i < 6; i++) {
        const nx = x + NEIGHBORS[i][0];
        const ny = y + NEIGHBORS[i][1];
        const nz = z + NEIGHBORS[i][2];
        if (ny < 0 || ny >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(nx, nz)) continue;

        const nId = this.chunkManager.getBlock(nx, ny, nz);
        const atten = this.blockRegistry.getLightAttenuation(nId);
        if (atten >= 15) continue;

        const nextLevel = level - Math.max(1, atten);
        if (nextLevel > this._getBlockLight(nx, ny, nz)) {
          this._setBlockLight(nx, ny, nz, nextLevel, dirtyChunks);
          if (nextLevel > 1) {
            queue.push(nx, ny, nz, nextLevel);
          }
        }
      }
    }
  }

  /** @private */
  _propagateBlockRemove(removeQueue, addQueue, dirtyChunks) {
    let head = 0;
    while (head < removeQueue.length) {
      const x = removeQueue[head++];
      const y = removeQueue[head++];
      const z = removeQueue[head++];
      const oldLevel = removeQueue[head++];

      for (let i = 0; i < 6; i++) {
        const nx = x + NEIGHBORS[i][0];
        const ny = y + NEIGHBORS[i][1];
        const nz = z + NEIGHBORS[i][2];
        if (ny < 0 || ny >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(nx, nz)) continue;

        const neighborLevel = this._getBlockLight(nx, ny, nz);
        if (neighborLevel === 0) continue;

        const nId = this.chunkManager.getBlock(nx, ny, nz);
        const nEmission = this.blockRegistry.getLightEmission(nId);

        if (nEmission > 0) {
          addQueue.push(nx, ny, nz, nEmission);
        }

        if (neighborLevel < oldLevel) {
          this._setBlockLight(nx, ny, nz, 0, dirtyChunks);
          removeQueue.push(nx, ny, nz, neighborLevel);
        } else if (neighborLevel >= oldLevel) {
          addQueue.push(nx, ny, nz, neighborLevel);
        }
      }
    }
  }

  /** @private */
  _propagateSkyAdd(queue, dirtyChunks) {
    let head = 0;
    while (head < queue.length) {
      const x = queue[head++];
      const y = queue[head++];
      const z = queue[head++];
      const level = queue[head++];

      if (level <= 1 || this._getSky(x, y, z) < level) continue;

      for (let i = 0; i < 6; i++) {
        const dx = NEIGHBORS[i][0];
        const dy = NEIGHBORS[i][1];
        const dz = NEIGHBORS[i][2];
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (ny < 0 || ny >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(nx, nz)) continue;

        const nId = this.chunkManager.getBlock(nx, ny, nz);
        const atten = this.blockRegistry.getLightAttenuation(nId);
        if (atten >= 15) continue;

        // Direct downward sky=15 in attenuation=1 stays 15
        const nextLevel =
          dy === -1 && level === 15 && atten === 1
            ? 15
            : level - Math.max(1, atten);

        if (nextLevel > this._getSky(nx, ny, nz)) {
          this._setSky(nx, ny, nz, nextLevel, dirtyChunks);
          if (nextLevel > 1) {
            queue.push(nx, ny, nz, nextLevel);
          }
        }
      }
    }
  }

  /** @private */
  _propagateSkyRemove(removeQueue, addQueue, dirtyChunks) {
    let head = 0;
    while (head < removeQueue.length) {
      const x = removeQueue[head++];
      const y = removeQueue[head++];
      const z = removeQueue[head++];
      const oldLevel = removeQueue[head++];

      for (let i = 0; i < 6; i++) {
        const dy = NEIGHBORS[i][1];
        const nx = x + NEIGHBORS[i][0];
        const ny = y + dy;
        const nz = z + NEIGHBORS[i][2];
        if (ny < 0 || ny >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(nx, nz)) continue;

        const neighborLevel = this._getSky(nx, ny, nz);
        if (neighborLevel === 0) continue;

        if (neighborLevel < oldLevel || (dy === -1 && oldLevel === 15 && neighborLevel === 15)) {
          // Wait: if neighbor directly below is 15 because of us, only clear if it has no open sky above it
          if (dy === -1 && neighborLevel === 15) {
            this._setSky(nx, ny, nz, 0, dirtyChunks);
            removeQueue.push(nx, ny, nz, 15);
          } else {
            this._setSky(nx, ny, nz, 0, dirtyChunks);
            removeQueue.push(nx, ny, nz, neighborLevel);
          }
        } else if (neighborLevel >= oldLevel) {
          addQueue.push(nx, ny, nz, neighborLevel);
        }
      }
    }
  }
}
