/**
 * @file FluidSimulator.js
 * @description Tick-budgeted cellular automata fluid simulation for dynamic flowing water,
 * waterfalls, cave flooding, draining, and infinite 2-source water spring formation.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_HEIGHT } from '../chunks/Chunk.js';

export const FLUID_SOURCE = 0;
export const FLUID_FALLING_FLAG = 0x10;
export const FLUID_DEFAULT_MAX_SPREAD = 7;

const HORIZONTAL_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const ALL_DIRS = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Simulates water flow, vertical waterfalls, draining, and source replenishment
 * with a strict per-step update budget so large oceans never cause frame spikes.
 */
export class FluidSimulator {
  /**
   * @param {import('../chunks/ChunkManager.js').ChunkManager} chunkManager
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} blockRegistry
   * @param {Object} [options]
   * @param {number} [options.stepInterval=0.2] - Seconds between fluid steps (5 Hz default).
   * @param {number} [options.maxUpdatesPerStep=256]
   * @param {number} [options.maxSpread=7]
   * @param {boolean} [options.infiniteSources=true]
   */
  constructor(
    chunkManager,
    blockRegistry,
    {
      stepInterval = 0.2,
      maxUpdatesPerStep = 256,
      maxSpread = FLUID_DEFAULT_MAX_SPREAD,
      infiniteSources = true,
    } = {}
  ) {
    this.chunkManager = chunkManager;
    this.blockRegistry = blockRegistry;
    this.stepInterval = stepInterval;
    this.maxUpdatesPerStep = maxUpdatesPerStep;
    this.maxSpread = Math.max(1, Math.min(7, maxSpread | 0));
    this.infiniteSources = Boolean(infiniteSources);

    this._ringCap = 4096;
    this._ring = new Int32Array(this._ringCap * 3);
    this._ringHead = 0;
    this._ringTail = 0;
    this._ringCount = 0;
    /** @type {Set<string>} */
    this._queuedKeys = new Set();
    /** @type {number} */
    this._accumulator = 0;
    /** @type {boolean} */
    this._internalMutation = false;
  }

  /** @private */
  _ringPush(x, y, z) {
    if (this._ringCount >= this._ringCap) {
      const nextCap = this._ringCap * 2;
      const nextRing = new Int32Array(nextCap * 3);
      for (let i = 0; i < this._ringCount; i++) {
        const srcIdx = ((this._ringHead + i) % this._ringCap) * 3;
        const dstIdx = i * 3;
        nextRing[dstIdx] = this._ring[srcIdx];
        nextRing[dstIdx + 1] = this._ring[srcIdx + 1];
        nextRing[dstIdx + 2] = this._ring[srcIdx + 2];
      }
      this._ring = nextRing;
      this._ringCap = nextCap;
      this._ringHead = 0;
      this._ringTail = this._ringCount;
    }
    const idx = this._ringTail * 3;
    this._ring[idx] = x;
    this._ring[idx + 1] = y;
    this._ring[idx + 2] = z;
    this._ringTail = (this._ringTail + 1) % this._ringCap;
    this._ringCount++;
  }

  /**
   * Clears all pending scheduled fluid updates (e.g. on world reset).
   */
  clear() {
    this._ringHead = 0;
    this._ringTail = 0;
    this._ringCount = 0;
    this._queuedKeys.clear();
    this._accumulator = 0;
  }

  /**
   * Returns count of pending fluid voxel updates.
   * @returns {number}
   */
  getPendingCount() {
    return this._ringCount;
  }

  /**
   * Returns true if a non-water block can be displaced/washed away by flowing water.
   * @param {number} blockId
   * @returns {boolean}
   */
  isFluidReplaceable(blockId) {
    return blockId === BLOCK_IDS.AIR || this.blockRegistry.isCrossPlant(blockId);
  }

  /**
   * Schedules world voxel (x, y, z) for fluid evaluation if within bounds and loaded.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  schedule(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (iy < 0 || iy >= CHUNK_HEIGHT) return;
    if (!this._hasLoadedChunkAt(ix, iz)) return;

    const key = `${ix},${iy},${iz}`;
    if (this._queuedKeys.has(key)) return;
    this._queuedKeys.add(key);
    this._ringPush(ix, iy, iz);
  }

  /**
   * Schedules a voxel and all 6 cardinal neighbors (used when draining or emptying a block).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  scheduleNeighbors(x, y, z) {
    this.schedule(x, y, z);
    for (let i = 0; i < ALL_DIRS.length; i++) {
      this.schedule(x + ALL_DIRS[i][0], y + ALL_DIRS[i][1], z + ALL_DIRS[i][2]);
    }
  }

  /**
   * Reacts to any block mutation in the world by waking nearby fluid cells.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} prevId
   * @param {number} newId
   */
  onBlockChanged(wx, wy, wz, prevId, newId) {
    if (this._internalMutation) return;

    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);

    const isFluid = (id) => id === BLOCK_IDS.WATER || id === BLOCK_IDS.LAVA;
    if (isFluid(newId) || isFluid(prevId)) {
      this.scheduleNeighbors(ix, iy, iz);
      return;
    }

    // Solid block broken or placed adjacent to existing fluid: wake bordering fluid blocks
    for (let i = 0; i < ALL_DIRS.length; i++) {
      const nx = ix + ALL_DIRS[i][0];
      const ny = iy + ALL_DIRS[i][1];
      const nz = iz + ALL_DIRS[i][2];
      if (isFluid(this.chunkManager.getBlock(nx, ny, nz))) {
        this.schedule(nx, ny, nz);
      }
    }
  }

  /**
   * Accumulates frame deltaTime and advances fluid simulation at fixed stepInterval.
   * @param {number} deltaTime
   * @returns {number} Total fluid cell updates processed.
   */
  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0 || this._ringCount === 0) {
      return 0;
    }
    this._accumulator = Math.min(this._accumulator + deltaTime, this.stepInterval * 3);
    let processed = 0;
    while (this._accumulator >= this.stepInterval && this._ringCount > 0) {
      this._accumulator -= this.stepInterval;
      processed += this.step(this.maxUpdatesPerStep);
    }
    return processed;
  }

  /**
   * Executes one fluid simulation wave up to maxUpdates voxels.
   * @param {number} [maxUpdates=this.maxUpdatesPerStep]
   * @returns {number} Number of voxels evaluated in this step.
   */
  step(maxUpdates = this.maxUpdatesPerStep) {
    const waveCount = Math.min(this._ringCount, maxUpdates);
    if (waveCount === 0) return 0;

    for (let i = 0; i < waveCount; i++) {
      const idx = this._ringHead * 3;
      const x = this._ring[idx];
      const y = this._ring[idx + 1];
      const z = this._ring[idx + 2];
      this._ringHead = (this._ringHead + 1) % this._ringCap;
      this._ringCount--;
      this._queuedKeys.delete(`${x},${y},${z}`);
      this._processVoxel(x, y, z);
    }

    return waveCount;
  }

  /** @private */
  _hasLoadedChunkAt(wx, wz) {
    const { chunkX, chunkZ } = this.chunkManager.worldToChunkCoord(wx, wz);
    return this.chunkManager.hasChunk(chunkX, chunkZ);
  }

  /** @private */
  _getFluidMeta(wx, wy, wz) {
    return this.chunkManager.getFluidLevel(wx, wy, wz);
  }

  /** @private */
  _setFluid(wx, wy, wz, fluidId, meta) {
    this._internalMutation = true;
    try {
      const currentId = this.chunkManager.getBlock(wx, wy, wz);
      if (currentId !== fluidId) {
        this.chunkManager.setBlock(wx, wy, wz, fluidId, true, meta);
      } else {
        this.chunkManager.setFluidLevel(wx, wy, wz, meta);
      }
    } finally {
      this._internalMutation = false;
    }
  }

  /** @private */
  _setSolidReaction(wx, wy, wz, solidId) {
    this._internalMutation = true;
    try {
      this.chunkManager.setBlock(wx, wy, wz, solidId, true, 0);
    } finally {
      this._internalMutation = false;
    }
  }

  /** @private */
  _clearFluid(wx, wy, wz) {
    this._internalMutation = true;
    try {
      this.chunkManager.setBlock(wx, wy, wz, BLOCK_IDS.AIR, true, 0);
    } finally {
      this._internalMutation = false;
    }
  }

  /**
   * Resolves water + lava contact -> Obsidian (lava source) or Cobblestone (flowing lava / lava into water).
   * @private
   */
  _tryFluidReaction(fluidId, tx, ty, tz) {
    const targetId = this.chunkManager.getBlock(tx, ty, tz);
    if (fluidId === BLOCK_IDS.WATER && targetId === BLOCK_IDS.LAVA) {
      const lavaMeta = this._getFluidMeta(tx, ty, tz);
      const resultBlock = lavaMeta === FLUID_SOURCE ? BLOCK_IDS.OBSIDIAN : BLOCK_IDS.COBBLESTONE;
      this._setSolidReaction(tx, ty, tz, resultBlock);
      this.scheduleNeighbors(tx, ty, tz);
      return true;
    }
    if (fluidId === BLOCK_IDS.LAVA && targetId === BLOCK_IDS.WATER) {
      this._setSolidReaction(tx, ty, tz, BLOCK_IDS.COBBLESTONE);
      this.scheduleNeighbors(tx, ty, tz);
      return true;
    }
    return false;
  }

  /** @private */
  _processVoxel(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(x, z)) return;
    const fluidId = this.chunkManager.getBlock(x, y, z);
    if (fluidId !== BLOCK_IDS.WATER && fluidId !== BLOCK_IDS.LAVA) return;

    const isLava = fluidId === BLOCK_IDS.LAVA;
    const maxSpread = isLava ? 3 : this.maxSpread;
    const allowInfinite = !isLava && this.infiniteSources;

    // 0. Check immediate cardinal contact between Water and Lava
    for (let i = 0; i < ALL_DIRS.length; i++) {
      const nx = x + ALL_DIRS[i][0];
      const ny = y + ALL_DIRS[i][1];
      const nz = z + ALL_DIRS[i][2];
      if (ny < 0 || ny >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(nx, nz)) continue;
      if (this._tryFluidReaction(fluidId, nx, ny, nz)) {
        if (this.chunkManager.getBlock(x, y, z) !== fluidId) return;
      }
    }

    let meta = this._getFluidMeta(x, y, z);
    const isSource = meta === FLUID_SOURCE;

    // 1. Non-source fluid must re-verify its feeder or drain away
    if (!isSource) {
      let expectedMeta = -1;
      const aboveIsSame =
        y + 1 < CHUNK_HEIGHT && this.chunkManager.getBlock(x, y + 1, z) === fluidId;

      if (aboveIsSame) {
        expectedMeta = FLUID_FALLING_FLAG;
      } else {
        let minNeighborDist = Infinity;
        let sourceNeighbors = 0;

        for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
          const nx = x + HORIZONTAL_DIRS[i][0];
          const nz = z + HORIZONTAL_DIRS[i][1];
          if (this.chunkManager.getBlock(nx, y, nz) !== fluidId) continue;

          const nMeta = this._getFluidMeta(nx, y, nz);
          if (nMeta === FLUID_SOURCE) {
            sourceNeighbors++;
            minNeighborDist = 0;
          } else if ((nMeta & FLUID_FALLING_FLAG) !== 0) {
            minNeighborDist = 0;
          } else {
            const dist = nMeta & 0x0f;
            if (dist < minNeighborDist) {
              minNeighborDist = dist;
            }
          }
        }

        if (allowInfinite && sourceNeighbors >= 2) {
          const belowId = y > 0 ? this.chunkManager.getBlock(x, y - 1, z) : BLOCK_IDS.BEDROCK;
          const belowSource =
            belowId === fluidId && this._getFluidMeta(x, y - 1, z) === FLUID_SOURCE;
          if (this.blockRegistry.isSolid(belowId) || belowSource) {
            expectedMeta = FLUID_SOURCE;
          }
        }

        if (expectedMeta === -1 && minNeighborDist < maxSpread) {
          expectedMeta = minNeighborDist + 1;
        }
      }

      if (expectedMeta === -1) {
        this._clearFluid(x, y, z);
        this.scheduleNeighbors(x, y, z);
        return;
      }

      if (expectedMeta !== meta) {
        meta = expectedMeta;
        this._setFluid(x, y, z, fluidId, meta);
        this.schedule(x, y - 1, z);
        for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
          this.schedule(x + HORIZONTAL_DIRS[i][0], y, z + HORIZONTAL_DIRS[i][1]);
        }
      }
    }

    // 2. Flow straight downward if possible
    if (y > 0) {
      if (this._tryFluidReaction(fluidId, x, y - 1, z)) {
        return;
      }
      const belowId = this.chunkManager.getBlock(x, y - 1, z);
      if (this.isFluidReplaceable(belowId)) {
        this._setFluid(x, y - 1, z, fluidId, FLUID_FALLING_FLAG);
        this.schedule(x, y - 1, z);
        return;
      }
      if (belowId === fluidId) {
        const belowMeta = this._getFluidMeta(x, y - 1, z);
        if (belowMeta !== FLUID_SOURCE && belowMeta !== FLUID_FALLING_FLAG) {
          this._setFluid(x, y - 1, z, fluidId, FLUID_FALLING_FLAG);
          this.schedule(x, y - 1, z);
        }
        if (belowMeta !== FLUID_SOURCE) {
          return;
        }
      }
    }

    // 3. Spread horizontally onto solid ground or flat source pool
    const currentDist = meta === FLUID_SOURCE || (meta & FLUID_FALLING_FLAG) !== 0 ? 0 : meta & 0x0f;
    const nextDist = currentDist + 1;
    if (nextDist > maxSpread) return;

    for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
      const nx = x + HORIZONTAL_DIRS[i][0];
      const nz = z + HORIZONTAL_DIRS[i][1];
      if (!this._hasLoadedChunkAt(nx, nz)) continue;

      if (this._tryFluidReaction(fluidId, nx, y, nz)) continue;

      const nId = this.chunkManager.getBlock(nx, y, nz);
      if (this.isFluidReplaceable(nId)) {
        this._setFluid(nx, y, nz, fluidId, nextDist);
        this.schedule(nx, y, nz);
      } else if (nId === fluidId) {
        const nMeta = this._getFluidMeta(nx, y, nz);
        if (nMeta !== FLUID_SOURCE && (nMeta & FLUID_FALLING_FLAG) === 0 && nMeta > nextDist) {
          this._setFluid(nx, y, nz, fluidId, nextDist);
          this.schedule(nx, y, nz);
        }
      }
    }
  }
}
