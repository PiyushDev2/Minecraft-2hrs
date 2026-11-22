/**
 * @file ChunkManager.js
 * @description Manages 16x16 chunk lifecycle: coordinate conversion, loading, unloading,
 * view-distance streaming, neighbor dirtying, and frame-budgeted async generation/meshing.
 */

import { BLOCK_IDS, blockRegistry as defaultBlockRegistry } from '../blocks/BlockRegistry.js';
import { FluidSimulator } from '../fluid/FluidSimulator.js';
import { LightEngine } from '../lighting/LightEngine.js';
import { Chunk, CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH, getChunkKey } from './Chunk.js';
import { MeshWorkerPool } from './MeshWorkerPool.js';
import { VoxelRegion } from './VoxelRegion.js';

/**
 * Coordinates loading, unloading, generating, and meshing chunks around a focus point.
 */
export class ChunkManager {
  /**
   * @param {Object} options
   * @param {import('../terrain/TerrainGenerator.js').TerrainGenerator} options.terrainGenerator
   * @param {import('./ChunkMesher.js').ChunkMesher} options.chunkMesher
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} [options.blockRegistry]
   * @param {LightEngine|null} [options.lightEngine]
   * @param {FluidSimulator|null} [options.fluidSimulator]
   * @param {MeshWorkerPool|null} [options.workerPool]
   * @param {boolean} [options.useWorkers=true]
   * @param {number} [options.viewDistance=5] - Radius in chunks around center.
   * @param {number} [options.maxChunksGeneratedPerFrame=4]
   * @param {number} [options.maxChunksMeshedPerFrame=6]
   */
  constructor({
    terrainGenerator,
    chunkMesher,
    blockRegistry = chunkMesher?.blockRegistry ?? defaultBlockRegistry,
    lightEngine = undefined,
    fluidSimulator = undefined,
    workerPool = undefined,
    useWorkers = true,
    viewDistance = 5,
    maxChunksGeneratedPerFrame = 4,
    maxChunksMeshedPerFrame = 6,
  }) {
    this.terrainGenerator = terrainGenerator;
    this.chunkMesher = chunkMesher;
    this.blockRegistry = blockRegistry;
    this.lightEngine =
      lightEngine === undefined ? new LightEngine(this, this.blockRegistry) : lightEngine;
    this.fluidSimulator =
      fluidSimulator === undefined ? new FluidSimulator(this, this.blockRegistry) : fluidSimulator;
    this.meshWorkerPool =
      workerPool !== undefined
        ? workerPool
        : new MeshWorkerPool({
            blockRegistry: this.blockRegistry,
            textureAtlas: this.chunkMesher.textureAtlas,
            enabled: useWorkers,
          });
    this.viewDistance = viewDistance;
    this.maxChunksGeneratedPerFrame = maxChunksGeneratedPerFrame;
    this.maxChunksMeshedPerFrame = maxChunksMeshedPerFrame;
    this.maxFrameBudgetMs = 4.5;

    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
    /** @type {Map<string, string>} */
    this._inFlightSignatures = new Map();

    /**
     * Pending saved chunk modification deltas keyed by "chunkX,chunkZ".
     * Applied automatically whenever that chunk loads.
     * @type {Map<string, Array<[number, number] | [number, number, number]>>}
     */
    this.pendingModifications = new Map();

    /** @type {Set<(chunk: Chunk) => void>} */
    this._onChunkMeshReady = new Set();
    /** @type {Set<(chunk: Chunk) => void>} */
    this._onChunkUnloaded = new Set();

    /** @type {number} */
    this.totalTriangles = 0;
  }

  /**
   * Converts world X, Z coordinates to chunk grid coordinates.
   * @param {number} wx
   * @param {number} wz
   * @returns {{ chunkX: number, chunkZ: number, lx: number, lz: number }}
   */
  worldToChunkCoord(wx, wz) {
    const ix = Math.floor(wx);
    const iz = Math.floor(wz);
    const chunkX = Math.floor(ix / CHUNK_WIDTH);
    const chunkZ = Math.floor(iz / CHUNK_DEPTH);
    const lx = ((ix % CHUNK_WIDTH) + CHUNK_WIDTH) % CHUNK_WIDTH;
    const lz = ((iz % CHUNK_DEPTH) + CHUNK_DEPTH) % CHUNK_DEPTH;
    return { chunkX, chunkZ, lx, lz };
  }

  /**
   * Subscribes to chunk mesh creation/rebuild events so a Three.js scene can attach chunk.meshGroup.
   * @param {(chunk: Chunk) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onChunkMeshReady(callback) {
    this._onChunkMeshReady.add(callback);
    return () => this._onChunkMeshReady.delete(callback);
  }

  /**
   * Subscribes to chunk unload events so a Three.js scene can remove chunk.meshGroup.
   * @param {(chunk: Chunk) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onChunkUnloaded(callback) {
    this._onChunkUnloaded.add(callback);
    return () => this._onChunkUnloaded.delete(callback);
  }

  /**
   * Gets a loaded chunk at (chunkX, chunkZ), or undefined if not loaded.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {Chunk|undefined}
   */
  getChunk(chunkX, chunkZ) {
    return this.chunks.get(getChunkKey(chunkX, chunkZ));
  }

  /**
   * Returns true if the chunk is currently loaded.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {boolean}
   */
  hasChunk(chunkX, chunkZ) {
    return this.chunks.has(getChunkKey(chunkX, chunkZ));
  }

  /**
   * Synchronously loads and generates a chunk if not already loaded.
   * Marks neighboring chunks dirty so boundary faces update cleanly.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @param {boolean} [buildMeshNow=false]
   * @returns {Chunk}
   */
  loadChunk(chunkX, chunkZ, buildMeshNow = false) {
    const key = getChunkKey(chunkX, chunkZ);
    let chunk = this.chunks.get(key);
    if (chunk) {
      chunk.lastAccessedAt = performance.now();
      return chunk;
    }

    chunk = new Chunk(chunkX, chunkZ);
    this.terrainGenerator.generateChunk(chunk);

    // Apply any saved player edits for this chunk
    const savedMods = this.pendingModifications.get(key);
    if (savedMods) {
      chunk.applyModifications(savedMods);
      this.pendingModifications.delete(key);
      if (this.fluidSimulator) {
        for (let i = 0; i < savedMods.length; i++) {
          const [idx, blockId] = savedMods[i];
          if (this.blockRegistry.isLiquid(blockId)) {
            const { lx, y, lz } = Chunk.decodeIndex(idx);
            this.fluidSimulator.scheduleNeighbors(chunk.worldX + lx, y, chunk.worldZ + lz);
          }
        }
      }
    }

    this.chunks.set(key, chunk);
    this._markNeighborsDirty(chunkX, chunkZ);
    this.lightEngine?.computeChunkLight(chunk);

    if (buildMeshNow) {
      this.remeshChunk(chunk);
    }

    return chunk;
  }

  /**
   * Asynchronously loads a chunk on the next microtask/animation yield to keep UI responsive.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @param {boolean} [buildMesh=true]
   * @returns {Promise<Chunk>}
   */
  loadChunkAsync(chunkX, chunkZ, buildMesh = true) {
    return new Promise((resolve) => {
      const run = () => {
        const chunk = this.loadChunk(chunkX, chunkZ, buildMesh);
        resolve(chunk);
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    });
  }

  /**
   * Unloads a chunk, preserving any player modifications in pendingModifications
   * and disposing GPU buffers.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {boolean} True if chunk existed and was unloaded.
   */
  unloadChunk(chunkX, chunkZ) {
    const key = getChunkKey(chunkX, chunkZ);
    const chunk = this.chunks.get(key);
    if (!chunk) return false;

    if (chunk.modifications.size > 0) {
      this.pendingModifications.set(key, chunk.exportModifications());
    }

    for (const cb of this._onChunkUnloaded) {
      cb(chunk);
    }

    chunk.disposeMesh();
    this.chunks.delete(key);
    this._markNeighborsDirty(chunkX, chunkZ);
    return true;
  }

  /**
   * Gets block ID at world coordinates (wx, wy, wz).
   * Returns AIR if above/below world height or in an unloaded chunk.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @returns {number}
   */
  getBlock(wx, wy, wz) {
    const iy = Math.floor(wy);
    if (iy < 0 || iy >= CHUNK_HEIGHT) {
      return BLOCK_IDS.AIR;
    }
    const { chunkX, chunkZ, lx, lz } = this.worldToChunkCoord(wx, wz);
    const chunk = this.getChunk(chunkX, chunkZ);
    if (!chunk) {
      return BLOCK_IDS.AIR;
    }
    return chunk.getBlock(lx, iy, lz);
  }

  /**
   * Returns { sky, block } light levels (0..15) at world coordinates (wx, wy, wz).
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @returns {{ sky: number, block: number }}
   */
  getLight(wx, wy, wz) {
    if (this.lightEngine) {
      return this.lightEngine.getLight(wx, wy, wz);
    }
    return { sky: 15, block: 0 };
  }

  /**
   * Gets fluid metadata byte at world coordinates (wx, wy, wz).
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @returns {number}
   */
  getFluidLevel(wx, wy, wz) {
    const iy = Math.floor(wy);
    if (iy < 0 || iy >= CHUNK_HEIGHT) return 0;
    const { chunkX, chunkZ, lx, lz } = this.worldToChunkCoord(wx, wz);
    const chunk = this.getChunk(chunkX, chunkZ);
    if (!chunk) return 0;
    return chunk.getFluidLevel(lx, iy, lz);
  }

  /**
   * Sets fluid metadata byte at world coordinates (wx, wy, wz) and dirties border chunks.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} meta
   * @returns {boolean}
   */
  setFluidLevel(wx, wy, wz, meta) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    if (iy < 0 || iy >= CHUNK_HEIGHT) return false;
    const { chunkX, chunkZ, lx, lz } = this.worldToChunkCoord(ix, iz);
    const chunk = this.getChunk(chunkX, chunkZ);
    if (!chunk) return false;

    const changed = chunk.setFluidLevel(lx, iy, lz, meta);
    if (!changed) return false;
    this._inFlightSignatures.delete(chunk.key);

    if (lx === 0) this._dirtyIfLoaded(chunkX - 1, chunkZ, iy);
    if (lx === CHUNK_WIDTH - 1) this._dirtyIfLoaded(chunkX + 1, chunkZ, iy);
    if (lz === 0) this._dirtyIfLoaded(chunkX, chunkZ - 1, iy);
    if (lz === CHUNK_DEPTH - 1) this._dirtyIfLoaded(chunkX, chunkZ + 1, iy);
    return true;
  }

  /**
   * Sets block ID at world coordinates (wx, wy, wz) and marks affected chunk(s) dirty.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} blockId
   * @param {boolean} [recordModification=true]
   * @param {number} [fluidMeta]
   * @returns {boolean}
   */
  setBlock(wx, wy, wz, blockId, recordModification = true, fluidMeta = undefined) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    if (iy < 0 || iy >= CHUNK_HEIGHT) {
      return false;
    }
    const { chunkX, chunkZ, lx, lz } = this.worldToChunkCoord(ix, iz);
    const chunk = this.getChunk(chunkX, chunkZ);
    if (!chunk) {
      return false;
    }

    const prevId = chunk.getBlock(lx, iy, lz);
    const changed = chunk.setBlock(lx, iy, lz, blockId, recordModification);
    const fluidChanged =
      fluidMeta !== undefined && this.blockRegistry.isLiquid(blockId)
        ? chunk.setFluidLevel(lx, iy, lz, fluidMeta)
        : false;
    if (!changed && !fluidChanged) return false;
    this._inFlightSignatures.delete(chunk.key);

    if (changed) {
      this.lightEngine?.onBlockChanged(ix, iy, iz, prevId, blockId);
      this.fluidSimulator?.onBlockChanged(ix, iy, iz, prevId, blockId);
    }

    // If on chunk border, mark neighboring chunk section dirty so adjacent face visibility updates
    if (lx === 0) this._dirtyIfLoaded(chunkX - 1, chunkZ, iy);
    if (lx === CHUNK_WIDTH - 1) this._dirtyIfLoaded(chunkX + 1, chunkZ, iy);
    if (lz === 0) this._dirtyIfLoaded(chunkX, chunkZ - 1, iy);
    if (lz === CHUNK_DEPTH - 1) this._dirtyIfLoaded(chunkX, chunkZ + 1, iy);

    return true;
  }

  /**
   * Immediately remeshes the chunk containing (wx, wz) plus any dirty cardinal neighbors
   * so interactive block breaking/placing has zero frame delay or stale seam faces.
   * @param {number} wx
   * @param {number} wz
   */
  remeshNeighborhoodForBlock(wx, wz) {
    const { chunkX, chunkZ } = this.worldToChunkCoord(wx, wz);
    const candidates = [
      this.getChunk(chunkX, chunkZ),
      this.getChunk(chunkX - 1, chunkZ),
      this.getChunk(chunkX + 1, chunkZ),
      this.getChunk(chunkX, chunkZ - 1),
      this.getChunk(chunkX, chunkZ + 1),
    ];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && c.generated && c.dirty) {
        this.remeshChunk(c);
      }
    }
  }

  /**
   * Synchronously rebuilds the Three.js mesh for a single chunk and notifies listeners.
   * @param {Chunk} chunk
   */
  remeshChunk(chunk) {
    if (!chunk || !chunk.generated) return;
    const getLight = this.lightEngine
      ? (wx, wy, wz) => this.lightEngine.getLight(wx, wy, wz)
      : undefined;
    this.chunkMesher.buildChunkMesh(
      chunk,
      (wx, wy, wz) => this.getBlock(wx, wy, wz),
      getLight,
      (wx, wy, wz) => this.getFluidLevel(wx, wy, wz)
    );
    this._inFlightSignatures.delete(chunk.key);
    for (const cb of this._onChunkMeshReady) {
      cb(chunk);
    }
  }

  /**
   * Captures a padded 3x3 VoxelRegion snapshot and schedules off-thread meshing via MeshWorkerPool.
   * Rejects stale results if chunk or neighbor editVersions change before completion.
   * @param {Chunk} chunk
   * @returns {boolean} True if job was dispatched.
   */
  remeshChunkAsync(chunk) {
    if (!chunk || !chunk.generated) return false;
    if (!this.meshWorkerPool || this.meshWorkerPool.disposed) {
      this.remeshChunk(chunk);
      return true;
    }

    const region = VoxelRegion.captureChunkNeighborhood(this, chunk.chunkX, chunk.chunkZ);
    if (!region) return false;

    if (this._inFlightSignatures.get(chunk.key) === region.versionSignature) {
      return false;
    }
    this._inFlightSignatures.set(chunk.key, region.versionSignature);

    this.meshWorkerPool.enqueue(region, (result) => {
      if (this._inFlightSignatures.get(chunk.key) === result.versionSignature) {
        this._inFlightSignatures.delete(chunk.key);
      }

      const currentChunk = this.getChunk(result.chunkX, result.chunkZ);
      if (!currentChunk || !currentChunk.generated) return;

      if (result.type === 'error') {
        this.remeshChunk(currentChunk);
        return;
      }

      const currentSig = VoxelRegion.computeVersionSignature(
        this,
        result.chunkX,
        result.chunkZ
      );
      // Race guard: discard stale worker geometry if chunk or neighbor was modified in-flight
      if (
        currentChunk.editVersion !== result.centerEditVersion ||
        currentSig !== result.versionSignature
      ) {
        currentChunk.dirty = true;
        return;
      }

      this.chunkMesher.applyMeshBuffers(currentChunk, result);
      for (const cb of this._onChunkMeshReady) {
        cb(currentChunk);
      }
    });

    return true;
  }

  /**
   * Pre-generates and meshes an initial square/circular radius synchronously (e.g. spawn area).
   * @param {number} centerWX
   * @param {number} centerWZ
   * @param {number} [radius=2]
   */
  pregenerateAround(centerWX, centerWZ, radius = 2) {
    const { chunkX: cx, chunkZ: cz } = this.worldToChunkCoord(centerWX, centerWZ);
    const loaded = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= radius * radius + 1) {
          loaded.push(this.loadChunk(cx + dx, cz + dz, false));
        }
      }
    }

    for (let i = 0; i < loaded.length; i++) {
      this.remeshChunk(loaded[i]);
    }
  }

  /**
   * Streams chunks in/out around world position (centerWX, centerWZ) with per-frame budgets.
   * @param {number} centerWX
   * @param {number} centerWZ
   */
  update(centerWX, centerWZ) {
    const { chunkX: centerCX, chunkZ: centerCZ } = this.worldToChunkCoord(centerWX, centerWZ);
    const vd = this.viewDistance;
    const unloadRadiusSq = (vd + 2) * (vd + 2);

    // 1. Unload distant chunks beyond unloadRadius
    for (const chunk of this.chunks.values()) {
      const dx = chunk.chunkX - centerCX;
      const dz = chunk.chunkZ - centerCZ;
      if (dx * dx + dz * dz > unloadRadiusSq) {
        this.unloadChunk(chunk.chunkX, chunk.chunkZ);
      }
    }

    // 2. Collect missing chunks within viewDistance, sorted closest-first
    const missing = [];
    const vdSq = vd * vd + 1;
    for (let dz = -vd; dz <= vd; dz++) {
      for (let dx = -vd; dx <= vd; dx++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > vdSq) continue;
        const cx = centerCX + dx;
        const cz = centerCZ + dz;
        if (!this.hasChunk(cx, cz)) {
          missing.push({ cx, cz, distSq });
        }
      }
    }

    const frameStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const budgetMs = this.maxFrameBudgetMs;

    if (missing.length > 0) {
      missing.sort((a, b) => a.distSq - b.distSq);
      const effectiveGenBudget =
        missing.length > 16
          ? Math.max(this.maxChunksGeneratedPerFrame, 8)
          : this.maxChunksGeneratedPerFrame;
      const genBudget = Math.min(effectiveGenBudget, missing.length);
      for (let i = 0; i < genBudget; i++) {
        this.loadChunk(missing[i].cx, missing[i].cz, false);
        if (i >= 1 && performance.now() - frameStart >= budgetMs) break;
      }
    }

    // 3. Remesh dirty chunks, sorted closest-first
    const dirtyChunks = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) {
        const dx = chunk.chunkX - centerCX;
        const dz = chunk.chunkZ - centerCZ;
        dirtyChunks.push({ chunk, distSq: dx * dx + dz * dz });
      }
    }

    if (dirtyChunks.length > 0) {
      dirtyChunks.sort((a, b) => a.distSq - b.distSq);
      const useAsyncPool = Boolean(this.meshWorkerPool && this.meshWorkerPool.isReady());
      const effectiveMeshBudget =
        dirtyChunks.length > 16
          ? Math.max(this.maxChunksMeshedPerFrame, 10)
          : this.maxChunksMeshedPerFrame;
      const meshBudget = Math.min(effectiveMeshBudget, dirtyChunks.length);
      for (let i = 0; i < meshBudget; i++) {
        const entry = dirtyChunks[i];
        // Remesh chunks immediately around the player synchronously (using fast 16x16x16 dirty section meshing)
        if (!useAsyncPool || entry.distSq <= 2 || entry.chunk.usingSectionMeshes) {
          this.remeshChunk(entry.chunk);
          if (i >= 1 && performance.now() - frameStart >= budgetMs + 1.5) break;
        } else {
          this.remeshChunkAsync(entry.chunk);
        }
      }
    }
  }

  /**
   * Computes streaming progress around (centerWX, centerWZ) for HUD indicators.
   * @param {number} centerWX
   * @param {number} centerWZ
   * @returns {{ loadedInRadius: number, targetChunks: number, dirtyChunks: number }}
   */
  getStreamingProgress(centerWX, centerWZ) {
    const { chunkX: centerCX, chunkZ: centerCZ } = this.worldToChunkCoord(centerWX, centerWZ);
    const vd = this.viewDistance;
    const vdSq = vd * vd + 1;
    let targetChunks = 0;
    let loadedInRadius = 0;
    let dirtyChunks = 0;

    for (let dz = -vd; dz <= vd; dz++) {
      for (let dx = -vd; dx <= vd; dx++) {
        if (dx * dx + dz * dz > vdSq) continue;
        targetChunks++;
        const chunk = this.getChunk(centerCX + dx, centerCZ + dz);
        if (chunk && chunk.generated) {
          loadedInRadius++;
          if (chunk.dirty || !chunk.meshGroup) {
            dirtyChunks++;
          }
        }
      }
    }

    return { loadedInRadius, targetChunks, dirtyChunks };
  }

  /**
   * Returns all loaded chunk mesh groups (useful for Three.js frustum culling or scene sync).
   * @returns {import('three').Group[]}
   */
  getLoadedMeshes() {
    const meshes = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.meshGroup) {
        meshes.push(chunk.meshGroup);
      }
    }
    return meshes;
  }

  /**
   * Filters loaded chunks against a Three.js Frustum for optional manual culling queries.
   * @param {import('three').Frustum} frustum
   * @returns {Chunk[]}
   */
  getChunksInFrustum(frustum) {
    const visible = [];
    for (const chunk of this.chunks.values()) {
      if (frustum.intersectsBox(chunk.boundingBox)) {
        visible.push(chunk);
      }
    }
    return visible;
  }

  /**
   * Exports all player modifications across both loaded and unloaded chunks.
   * @returns {Record<string, Array<[number, number] | [number, number, number]>>}
   */
  exportAllModifications() {
    const result = {};
    for (const [key, entries] of this.pendingModifications.entries()) {
      if (entries.length > 0) {
        result[key] = entries;
      }
    }
    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.modifications.size > 0) {
        result[key] = chunk.exportModifications();
      }
    }
    return result;
  }

  /**
   * Loads saved modification deltas into pendingModifications and applies to any loaded chunks.
   * @param {Record<string, Array<[number, number] | [number, number, number]>>} modMap
   */
  importModifications(modMap) {
    this.pendingModifications.clear();
    if (!modMap || typeof modMap !== 'object') return;

    for (const [key, entries] of Object.entries(modMap)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.applyModifications(entries);
      } else {
        this.pendingModifications.set(key, entries);
      }
    }
  }

  /**
   * Unloads and disposes all chunks and invalidates any in-flight worker mesh jobs.
   */
  clear() {
    this.fluidSimulator?.clear();
    this.meshWorkerPool?.invalidateEpoch();
    this._inFlightSignatures.clear();
    for (const chunk of this.chunks.values()) {
      for (const cb of this._onChunkUnloaded) {
        cb(chunk);
      }
      chunk.disposeMesh();
    }
    this.chunks.clear();
    this.pendingModifications.clear();
  }

  /**
   * Unloads chunks and terminates background meshing workers.
   */
  dispose() {
    this.clear();
    this.meshWorkerPool?.dispose();
  }

  /** @private */
  _dirtyIfLoaded(chunkX, chunkZ, y = undefined) {
    const c = this.getChunk(chunkX, chunkZ);
    if (!c) return;
    c.dirty = true;
    if (y !== undefined) {
      c.markSectionDirty(y);
    } else {
      c.dirtySectionsMask = 0xff;
    }
  }

  /** @private */
  _markNeighborsDirty(chunkX, chunkZ) {
    this._dirtyIfLoaded(chunkX - 1, chunkZ);
    this._dirtyIfLoaded(chunkX + 1, chunkZ);
    this._dirtyIfLoaded(chunkX, chunkZ - 1);
    this._dirtyIfLoaded(chunkX, chunkZ + 1);
  }
}
