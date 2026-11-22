/**
 * @file MeshWorkerPool.js
 * @description Worker pool managing asynchronous chunk meshing with monotonic epoch & editVersion
 * guards, deduplicated per-chunk job queueing, and graceful fallback when Workers are unavailable.
 */

import { getChunkKey } from './ChunkConstants.js';
import { buildChunkGeometryBuffers } from './MeshingCore.js';

/**
 * Coordinates a pool of Web Workers (or injectable mock workers) for chunk meshing.
 */
export class MeshWorkerPool {
  /**
   * @param {Object} options
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} options.blockRegistry
   * @param {import('../textures/TextureAtlas.js').TextureAtlas} options.textureAtlas
   * @param {number} [options.poolSize]
   * @param {boolean} [options.enabled=true]
   * @param {() => any} [options.workerFactory] - Optional custom Worker factory for tests.
   */
  constructor({
    blockRegistry,
    textureAtlas,
    poolSize,
    enabled = true,
    workerFactory = null,
  }) {
    this.blockRegistry = blockRegistry;
    this.textureAtlas = textureAtlas;
    this.enabled = Boolean(enabled);

    const hwConcurrency =
      typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 2;
    this.poolSize = Math.max(1, Math.min(4, poolSize ?? Math.max(1, hwConcurrency - 1)));

    /** @type {number} */
    this.epoch = 1;
    /** @type {number} */
    this._nextJobId = 0;

    /** @type {Array<{ worker: any, busy: boolean, currentJob: any }>} */
    this._slots = [];
    /** @type {Array<Object>} */
    this._pendingQueue = [];
    /** @type {Map<string, number>} */
    this._latestJobByChunkKey = new Map();
    /** @type {Set<string>} */
    this._inFlightKeys = new Set();

    /** @type {boolean} */
    this.active = false;
    /** @type {boolean} */
    this.disposed = false;
    /** @private */
    this._blockTable = this.blockRegistry.exportMesherTable();
    /** @private */
    this._tileRects = this.textureAtlas.exportTileRects();

    this._initWorkers(workerFactory);
  }

  /**
   * Spawns worker slots if Web Workers are supported (or a custom factory is supplied).
   * @private
   */
  _initWorkers(workerFactory) {
    if (!this.enabled) return;
    const canUseBrowserWorker = typeof Worker !== 'undefined';
    if (!workerFactory && !canUseBrowserWorker) return;

    const blockTable = this._blockTable;
    const tileRects = this._tileRects;

    for (let i = 0; i < this.poolSize; i++) {
      let worker;
      try {
        worker = workerFactory
          ? workerFactory()
          : new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
      } catch {
        // Environment does not allow module workers (e.g., restricted sandbox)
        this.dispose();
        return;
      }

      const slot = { worker, busy: false, failed: false, currentJob: null };
      worker.onmessage = (ev) => this._handleWorkerMessage(slot, ev.data);
      worker.onerror = () => this._handleWorkerError(slot);
      try {
        worker.postMessage({ type: 'init', blockTable, tileRects });
        this._slots.push(slot);
      } catch {
        worker.terminate?.();
      }
    }

    this.active = this._slots.length > 0;
  }

  /**
   * Returns true if workers are ready to accept off-thread meshing jobs.
   * @returns {boolean}
   */
  isReady() {
    return this.active && !this.disposed && this._slots.length > 0;
  }

  /**
   * Returns true if a chunk key currently has a queued or running mesh job.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {boolean}
   */
  hasPendingJob(chunkX, chunkZ) {
    const key = getChunkKey(chunkX, chunkZ);
    if (this._inFlightKeys.has(key)) return true;
    for (let i = 0; i < this._pendingQueue.length; i++) {
      if (this._pendingQueue[i].key === key) return true;
    }
    return false;
  }

  /**
   * Returns total queued + actively running worker jobs.
   * @returns {number}
   */
  getActiveJobCount() {
    return this._pendingQueue.length + this._inFlightKeys.size;
  }

  /**
   * Increments world epoch and drops queued work (used on seed regeneration / clear).
   * Any already-dispatched worker results from old epochs are safely ignored on arrival.
   */
  invalidateEpoch() {
    this.epoch++;
    this._pendingQueue.length = 0;
    this._latestJobByChunkKey.clear();
  }

  /**
   * Enqueues a VoxelRegion snapshot for off-thread meshing.
   * Deduplicates multiple pending requests for the same chunk coordinate.
   * @param {import('./VoxelRegion.js').VoxelRegion} region
   * @param {(result: Object) => void} onResult
   * @returns {number} Assigned jobId.
   */
  enqueue(region, onResult) {
    if (this.disposed) {
      throw new Error('Cannot enqueue onto a disposed MeshWorkerPool.');
    }

    const key = getChunkKey(region.chunkX, region.chunkZ);
    const jobId = ++this._nextJobId;
    this._latestJobByChunkKey.set(key, jobId);

    const job = {
      jobId,
      epoch: this.epoch,
      key,
      region,
      onResult,
    };

    // Replace existing queued job for the same chunk so rapid edits don't pile up
    const existingIdx = this._pendingQueue.findIndex((j) => j.key === key);
    if (existingIdx !== -1) {
      this._pendingQueue[existingIdx] = job;
    } else {
      this._pendingQueue.push(job);
    }

    if (this.isReady()) {
      this._pump();
    } else {
      // Headless / synchronous fallback: process on next microtask while still preserving epoch/version checks
      queueMicrotask(() => {
        if (this.disposed || job.epoch !== this.epoch) return;
        const latest = this._latestJobByChunkKey.get(key);
        if (latest !== job.jobId) return;
        const qIdx = this._pendingQueue.indexOf(job);
        if (qIdx !== -1) this._pendingQueue.splice(qIdx, 1);

        const built = buildChunkGeometryBuffers({
          getBlockAtLocal: (lx, y, lz) => region.getBlock(lx, y, lz),
          getLightAtLocal: (lx, y, lz) => region.getLight(lx, y, lz),
          getFluidLevelAtLocal: (lx, y, lz) => region.getFluidLevel(lx, y, lz),
          blockTable: this._blockTable,
          tileRects: this._tileRects,
        });

        onResult({
          type: 'result',
          jobId: job.jobId,
          epoch: job.epoch,
          chunkX: region.chunkX,
          chunkZ: region.chunkZ,
          centerEditVersion: region.centerEditVersion,
          versionSignature: region.versionSignature,
          opaque: built.opaque,
          water: built.water,
          faceCount: built.faceCount,
          triangleCount: built.triangleCount,
        });
      });
    }

    return jobId;
  }

  /**
   * Dispatches queued jobs onto idle worker slots.
   * @private
   */
  _pump() {
    while (this._pendingQueue.length > 0) {
      const idleSlot = this._slots.find((s) => !s.busy && !s.failed);
      if (!idleSlot) break;

      const job = this._pendingQueue.shift();
      if (!job || job.epoch !== this.epoch) continue;

      idleSlot.busy = true;
      idleSlot.currentJob = job;
      this._inFlightKeys.add(job.key);

      const { region } = job;
      try {
        idleSlot.worker.postMessage(
          {
            type: 'mesh',
            jobId: job.jobId,
            epoch: job.epoch,
            chunkX: region.chunkX,
            chunkZ: region.chunkZ,
            centerEditVersion: region.centerEditVersion,
            versionSignature: region.versionSignature,
            blocks: region.blocks,
            lightData: region.lightData,
            fluidData: region.fluidData,
          },
          [region.blocks.buffer, region.lightData.buffer, region.fluidData.buffer]
        );
      } catch {
        this._handleWorkerError(idleSlot);
      }
    }
  }

  /**
   * Handles worker completion, discarding stale epochs or superseded chunk jobIds.
   * @private
   */
  _handleWorkerMessage(slot, msg) {
    const job = slot.currentJob;
    slot.busy = false;
    slot.currentJob = null;

    if (job) {
      this._inFlightKeys.delete(job.key);
    }

    if (!this.disposed && msg && job) {
      const isCurrentEpoch = msg.epoch === this.epoch;
      const key = getChunkKey(msg.chunkX, msg.chunkZ);
      const isLatestJob = this._latestJobByChunkKey.get(key) === msg.jobId;

      if (msg.type === 'result' && isCurrentEpoch && isLatestJob && typeof job.onResult === 'function') {
        job.onResult(msg);
      } else if (msg.type === 'error' && isCurrentEpoch && typeof job.onResult === 'function') {
        job.onResult(msg);
      }
    }

    if (!this.disposed) {
      this._pump();
    }
  }

  /** @private */
  _handleWorkerError(slot) {
    const job = slot.currentJob;
    slot.busy = false;
    slot.failed = true;
    slot.currentJob = null;
    try {
      slot.worker?.terminate?.();
    } catch {
      // Ignore termination errors
    }

    if (job) {
      this._inFlightKeys.delete(job.key);
      if (!this.disposed && job.epoch === this.epoch && typeof job.onResult === 'function') {
        job.onResult({
          type: 'error',
          jobId: job.jobId,
          epoch: job.epoch,
          chunkX: job.region.chunkX,
          chunkZ: job.region.chunkZ,
          centerEditVersion: job.region.centerEditVersion,
          versionSignature: job.region.versionSignature,
          error: 'Worker slot failed',
        });
      }
    }

    const healthySlots = this._slots.filter((s) => !s.failed);
    if (healthySlots.length === 0) {
      this.active = false;
      // Drain remaining pending jobs synchronously via fallback callback
      while (this._pendingQueue.length > 0) {
        const pending = this._pendingQueue.shift();
        if (pending && pending.epoch === this.epoch && typeof pending.onResult === 'function') {
          pending.onResult({
            type: 'error',
            jobId: pending.jobId,
            epoch: pending.epoch,
            chunkX: pending.region.chunkX,
            chunkZ: pending.region.chunkZ,
            centerEditVersion: pending.region.centerEditVersion,
            versionSignature: pending.region.versionSignature,
            error: 'No healthy worker slots remaining',
          });
        }
      }
    } else if (!this.disposed) {
      this._pump();
    }
  }

  /**
   * Terminates all workers and clears queued jobs.
   */
  dispose() {
    this.disposed = true;
    this.active = false;
    this._pendingQueue.length = 0;
    this._inFlightKeys.clear();
    this._latestJobByChunkKey.clear();
    for (const slot of this._slots) {
      try {
        slot.worker?.terminate?.();
      } catch {
        // Ignore termination errors
      }
    }
    this._slots.length = 0;
  }
}
