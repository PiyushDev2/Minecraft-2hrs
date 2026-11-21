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

    /** @type {Array<[number, number, number]>} */
    this._queue = [];
    /** @type {Set<string>} */
    this._queuedKeys = new Set();
    /** @type {number} */
    this._accumulator = 0;
    /** @type {boolean} */
    this._internalMutation = false;
  }

  /**
   * Clears all pending scheduled fluid updates (e.g. on world reset).
   */
  clear() {
    this._queue.length = 0;
    this._queuedKeys.clear();
    this._accumulator = 0;
  }

  /**
   * Returns count of pending fluid voxel updates.
   * @returns {number}
   */
  getPendingCount() {
    return this._queue.length;
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
    this._queue.push([ix, iy, iz]);
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
   * Reacts to any block mutation in the world by waking nearby water cells.
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

    if (newId === BLOCK_IDS.WATER || prevId === BLOCK_IDS.WATER) {
      this.scheduleNeighbors(ix, iy, iz);
      return;
    }

    // Solid block broken or placed adjacent to existing water: wake bordering water blocks
    for (let i = 0; i < ALL_DIRS.length; i++) {
      const nx = ix + ALL_DIRS[i][0];
      const ny = iy + ALL_DIRS[i][1];
      const nz = iz + ALL_DIRS[i][2];
      if (this.chunkManager.getBlock(nx, ny, nz) === BLOCK_IDS.WATER) {
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
    if (!Number.isFinite(deltaTime) || deltaTime <= 0 || this._queue.length === 0) {
      return 0;
    }
    this._accumulator = Math.min(this._accumulator + deltaTime, this.stepInterval * 3);
    let processed = 0;
    while (this._accumulator >= this.stepInterval && this._queue.length > 0) {
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
    const waveCount = Math.min(this._queue.length, maxUpdates);
    if (waveCount === 0) return 0;

    for (let i = 0; i < waveCount; i++) {
      const [x, y, z] = this._queue.shift();
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
  _setWater(wx, wy, wz, meta) {
    this._internalMutation = true;
    try {
      const currentId = this.chunkManager.getBlock(wx, wy, wz);
      if (currentId !== BLOCK_IDS.WATER) {
        this.chunkManager.setBlock(wx, wy, wz, BLOCK_IDS.WATER, true, meta);
      } else {
        this.chunkManager.setFluidLevel(wx, wy, wz, meta);
      }
    } finally {
      this._internalMutation = false;
    }
  }

  /** @private */
  _clearWater(wx, wy, wz) {
    this._internalMutation = true;
    try {
      this.chunkManager.setBlock(wx, wy, wz, BLOCK_IDS.AIR, true, 0);
    } finally {
      this._internalMutation = false;
    }
  }

  /** @private */
  _processVoxel(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT || !this._hasLoadedChunkAt(x, z)) return;
    if (this.chunkManager.getBlock(x, y, z) !== BLOCK_IDS.WATER) return;

    let meta = this._getFluidMeta(x, y, z);
    const isSource = meta === FLUID_SOURCE;

    // 1. Non-source water must re-verify its feeder or drain away
    if (!isSource) {
      let expectedMeta = -1;
      const aboveIsWater =
        y + 1 < CHUNK_HEIGHT && this.chunkManager.getBlock(x, y + 1, z) === BLOCK_IDS.WATER;

      if (aboveIsWater) {
        expectedMeta = FLUID_FALLING_FLAG;
      } else {
        let minNeighborDist = Infinity;
        let sourceNeighbors = 0;

        for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
          const nx = x + HORIZONTAL_DIRS[i][0];
          const nz = z + HORIZONTAL_DIRS[i][1];
          if (this.chunkManager.getBlock(nx, y, nz) !== BLOCK_IDS.WATER) continue;

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

        if (this.infiniteSources && sourceNeighbors >= 2) {
          const belowId = y > 0 ? this.chunkManager.getBlock(x, y - 1, z) : BLOCK_IDS.BEDROCK;
          const belowSource =
            belowId === BLOCK_IDS.WATER && this._getFluidMeta(x, y - 1, z) === FLUID_SOURCE;
          if (this.blockRegistry.isSolid(belowId) || belowSource) {
            expectedMeta = FLUID_SOURCE;
          }
        }

        if (expectedMeta === -1 && minNeighborDist < this.maxSpread) {
          expectedMeta = minNeighborDist + 1;
        }
      }

      if (expectedMeta === -1) {
        // Unsupported stream -> drain to AIR and wake downstream cells
        this._clearWater(x, y, z);
        this.scheduleNeighbors(x, y, z);
        return;
      }

      if (expectedMeta !== meta) {
        meta = expectedMeta;
        this._setWater(x, y, z, meta);
        this.schedule(x, y - 1, z);
        for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
          this.schedule(x + HORIZONTAL_DIRS[i][0], y, z + HORIZONTAL_DIRS[i][1]);
        }
      }
    }

    // 2. Flow straight downward if possible
    if (y > 0) {
      const belowId = this.chunkManager.getBlock(x, y - 1, z);
      if (this.isFluidReplaceable(belowId)) {
        this._setWater(x, y - 1, z, FLUID_FALLING_FLAG);
        this.schedule(x, y - 1, z);
        return; // Cascade vertically rather than fanning out in mid-air
      }
      if (belowId === BLOCK_IDS.WATER) {
        const belowMeta = this._getFluidMeta(x, y - 1, z);
        if (belowMeta !== FLUID_SOURCE && belowMeta !== FLUID_FALLING_FLAG) {
          this._setWater(x, y - 1, z, FLUID_FALLING_FLAG);
          this.schedule(x, y - 1, z);
        }
        // Flowing onto non-source water keeps falling without fanning out horizontally
        if (belowMeta !== FLUID_SOURCE) {
          return;
        }
      }
    }

    // 3. Spread horizontally onto solid ground or flat water source pool
    const currentDist = meta === FLUID_SOURCE || (meta & FLUID_FALLING_FLAG) !== 0 ? 0 : meta & 0x0f;
    const nextDist = currentDist + 1;
    if (nextDist > this.maxSpread) return;

    for (let i = 0; i < HORIZONTAL_DIRS.length; i++) {
      const nx = x + HORIZONTAL_DIRS[i][0];
      const nz = z + HORIZONTAL_DIRS[i][1];
      if (!this._hasLoadedChunkAt(nx, nz)) continue;

      const nId = this.chunkManager.getBlock(nx, y, nz);
      if (this.isFluidReplaceable(nId)) {
        this._setWater(nx, y, nz, nextDist);
        this.schedule(nx, y, nz);
      } else if (nId === BLOCK_IDS.WATER) {
        const nMeta = this._getFluidMeta(nx, y, nz);
        if (nMeta !== FLUID_SOURCE && (nMeta & FLUID_FALLING_FLAG) === 0 && nMeta > nextDist) {
          this._setWater(nx, y, nz, nextDist);
          this.schedule(nx, y, nz);
        }
      }
    }
  }
}
