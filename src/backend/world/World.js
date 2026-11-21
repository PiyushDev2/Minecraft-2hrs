/**
 * @file World.js
 * @description Primary voxel World API coordinating BlockRegistry, TerrainGenerator,
 * ChunkManager, ChunkMesher, and fast 3D DDA voxel raycasting.
 */

import { BLOCK_IDS, blockRegistry } from '../blocks/BlockRegistry.js';
import { CHUNK_HEIGHT } from '../chunks/Chunk.js';
import { ChunkManager } from '../chunks/ChunkManager.js';
import { ChunkMesher } from '../chunks/ChunkMesher.js';
import { TerrainGenerator, SEA_LEVEL } from '../terrain/TerrainGenerator.js';
import { normalizeSeed } from '../terrain/Noise.js';
import { TextureAtlas } from '../textures/TextureAtlas.js';

/**
 * High-level voxel world engine exposing clean block, chunk, raycast, and mesh APIs.
 */
export class World {
  /**
   * @param {Object} [options]
   * @param {number|string} [options.seed=1337]
   * @param {number} [options.viewDistance=5]
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} [options.registry]
   * @param {number} [options.maxChunksGeneratedPerFrame=2]
   * @param {number} [options.maxChunksMeshedPerFrame=3]
   * @param {number} [options.dayLengthSeconds=600]
   * @param {number} [options.initialTimeOfDay=0.25]
   * @param {boolean} [options.useWorkers=true]
   */
  constructor({
    seed = 1337,
    viewDistance = 5,
    registry = blockRegistry,
    maxChunksGeneratedPerFrame = 2,
    maxChunksMeshedPerFrame = 3,
    dayLengthSeconds = 600,
    initialTimeOfDay = 0.25,
    useWorkers = true,
  } = {}) {
    /** @type {import('../blocks/BlockRegistry.js').BlockRegistry} */
    this.blockRegistry = registry;
    /** @type {number} */
    this.seed = normalizeSeed(seed);
    /** @type {number} */
    this.viewDistance = viewDistance;

    /** @type {TextureAtlas} */
    this.textureAtlas = new TextureAtlas();
    /** @type {ChunkMesher} */
    this.chunkMesher = new ChunkMesher(this.blockRegistry, this.textureAtlas);
    /** @type {TerrainGenerator} */
    this.terrainGenerator = new TerrainGenerator(this.seed);
    /** @type {ChunkManager} */
    this.chunkManager = new ChunkManager({
      terrainGenerator: this.terrainGenerator,
      chunkMesher: this.chunkMesher,
      blockRegistry: this.blockRegistry,
      useWorkers,
      viewDistance: this.viewDistance,
      maxChunksGeneratedPerFrame,
      maxChunksMeshedPerFrame,
    });
    /** @type {import('../lighting/LightEngine.js').LightEngine|null} */
    this.lightEngine = this.chunkManager.lightEngine;

    /** @type {Set<(event: { x: number, y: number, z: number, previousId: number, blockId: number }) => void>} */
    this._onBlockChanged = new Set();

    /** @type {number} Elapsed world time in seconds */
    this.worldTime = 0;
    /** @type {number} Duration of a full day/night cycle in seconds (0 disables automatic advance) */
    this.dayLengthSeconds = dayLengthSeconds;
    /** @type {number} Normalized cycle [0..1): 0.0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight */
    this.timeOfDay = 0.25;
    this.setTimeOfDay(initialTimeOfDay);
  }

  /**
   * Generates or regenerates the world with a given seed and preloads spawn chunks.
   * @param {number|string} [seed=this.seed]
   * @param {Object} [options]
   * @param {{ x: number, z: number }} [options.spawnCenter={ x: 8, z: 8 }]
   * @param {number} [options.pregenerateRadius=2]
   * @returns {World}
   */
  generate(seed = this.seed, { spawnCenter = { x: 8, z: 8 }, pregenerateRadius = 2 } = {}) {
    this.chunkManager.clear();
    this.seed = normalizeSeed(seed);
    this.terrainGenerator = new TerrainGenerator(this.seed);
    this.chunkManager.terrainGenerator = this.terrainGenerator;
    this.worldTime = 0;
    this.setTimeOfDay(0.25);

    if (pregenerateRadius >= 0) {
      this.chunkManager.pregenerateAround(spawnCenter.x, spawnCenter.z, pregenerateRadius);
    }
    return this;
  }

  /**
   * Sets normalized time of day [0..1): 0.0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight.
   * Immediately updates the GPU sky brightness uniform without remeshing chunks.
   * @param {number} t
   * @returns {number}
   */
  setTimeOfDay(t) {
    const normalized = (((Number(t) || 0) % 1) + 1) % 1;
    this.timeOfDay = normalized;
    this.chunkMesher.setSkyBrightness(this.getSkyBrightness());
    return this.timeOfDay;
  }

  /**
   * Returns normalized time of day in [0, 1).
   * @returns {number}
   */
  getTimeOfDay() {
    return this.timeOfDay;
  }

  /**
   * Returns current global sky brightness factor [0.16 midnight .. 1.0 noon].
   * @returns {number}
   */
  getSkyBrightness() {
    const sunElevation = Math.sin(this.timeOfDay * Math.PI * 2);
    const smooth = Math.max(0, Math.min(1, (sunElevation + 0.2) / 0.7));
    return 0.16 + 0.84 * smooth;
  }

  /**
   * Updates view-distance streaming, day/night sky brightness, and remeshing around a world position.
   * @param {{ x: number, y?: number, z: number }} [focusPosition={ x: 8, z: 8 }]
   * @param {number} [deltaTime=0]
   */
  update(focusPosition = { x: 8, z: 8 }, deltaTime = 0) {
    this.worldTime += deltaTime;
    if (this.dayLengthSeconds > 0 && deltaTime > 0) {
      this.setTimeOfDay(this.timeOfDay + deltaTime / this.dayLengthSeconds);
    } else {
      this.chunkMesher.setSkyBrightness(this.getSkyBrightness());
    }
    this.chunkManager.update(focusPosition.x, focusPosition.z);
  }

  /**
   * Gets block ID at world integer coordinates (x, y, z).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  getBlock(x, y, z) {
    return this.chunkManager.getBlock(x, y, z);
  }

  /**
   * Returns dual-bank { sky, block } light levels (0..15) at world coordinates (x, y, z).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{ sky: number, block: number }}
   */
  getLight(x, y, z) {
    return this.chunkManager.getLight(x, y, z);
  }

  /**
   * Sets block ID at world coordinates (x, y, z) and notifies listeners.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockId
   * @param {boolean} [recordModification=true]
   * @returns {boolean}
   */
  setBlock(x, y, z, blockId, recordModification = true) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    if (!this.blockRegistry.has(blockId)) {
      return false;
    }

    const previousId = this.getBlock(ix, iy, iz);
    const changed = this.chunkManager.setBlock(ix, iy, iz, blockId, recordModification);
    if (!changed) return false;

    for (const cb of this._onBlockChanged) {
      cb({ x: ix, y: iy, z: iz, previousId, blockId });
    }
    return true;
  }

  /**
   * Breaks a block at (x, y, z) if it exists and is breakable (e.g. Bedrock returns false).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{ broken: boolean, previousId: number }}
   */
  breakBlock(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const currentId = this.getBlock(ix, iy, iz);

    if (currentId === BLOCK_IDS.AIR || !this.blockRegistry.isBreakable(currentId)) {
      return { broken: false, previousId: currentId };
    }

    const ok = this.setBlock(ix, iy, iz, BLOCK_IDS.AIR, true);
    return { broken: ok, previousId: currentId };
  }

  /**
   * Places a block at (x, y, z) if space is Air or Liquid and doesn't overlap an entity check.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockId
   * @param {(bx: number, by: number, bz: number) => boolean} [overlapCheck]
   * @returns {boolean}
   */
  placeBlock(x, y, z, blockId, overlapCheck = null) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    if (iy < 0 || iy >= CHUNK_HEIGHT) return false;
    if (blockId === BLOCK_IDS.AIR || !this.blockRegistry.has(blockId)) return false;

    const existing = this.getBlock(ix, iy, iz);
    if (existing !== BLOCK_IDS.AIR && !this.blockRegistry.isLiquid(existing)) {
      return false;
    }

    if (overlapCheck && this.blockRegistry.isSolid(blockId) && overlapCheck(ix, iy, iz)) {
      return false;
    }

    return this.setBlock(ix, iy, iz, blockId, true);
  }

  /**
   * Gets a loaded chunk by chunk grid coordinates (chunkX, chunkZ).
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {import('../chunks/Chunk.js').Chunk|undefined}
   */
  getChunk(chunkX, chunkZ) {
    return this.chunkManager.getChunk(chunkX, chunkZ);
  }

  /**
   * Loads (and optionally immediately meshes) a chunk at (chunkX, chunkZ).
   * @param {number} chunkX
   * @param {number} chunkZ
   * @param {boolean} [buildMeshNow=true]
   * @returns {import('../chunks/Chunk.js').Chunk}
   */
  loadChunk(chunkX, chunkZ, buildMeshNow = true) {
    return this.chunkManager.loadChunk(chunkX, chunkZ, buildMeshNow);
  }

  /**
   * Unloads a chunk at (chunkX, chunkZ) and disposes its GPU buffers.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {boolean}
   */
  unloadChunk(chunkX, chunkZ) {
    return this.chunkManager.unloadChunk(chunkX, chunkZ);
  }

  /**
   * Changes active chunk view distance radius.
   * @param {number} radius
   */
  setViewDistance(radius) {
    const clamped = Math.max(2, Math.min(12, Math.round(radius)));
    this.viewDistance = clamped;
    this.chunkManager.viewDistance = clamped;
  }

  /**
   * Returns procedural surface Y coordinate (highest solid block or sea level) at (wx, wz).
   * Uses loaded chunk data if available, otherwise queries TerrainGenerator directly.
   * @param {number} wx
   * @param {number} wz
   * @returns {number}
   */
  getSurfaceY(wx, wz) {
    const ix = Math.floor(wx);
    const iz = Math.floor(wz);
    const { chunkX, chunkZ, lx, lz } = this.chunkManager.worldToChunkCoord(ix, iz);
    const chunk = this.chunkManager.getChunk(chunkX, chunkZ);

    if (chunk && chunk.generated) {
      const top = chunk.getHighestY(lx, lz, (id) => this.blockRegistry.isSolid(id));
      if (top >= 0) return Math.max(top, SEA_LEVEL);
    }
    return Math.max(this.terrainGenerator.getHeightAt(ix, iz), SEA_LEVEL);
  }

  /**
   * Returns biome profile at world (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {{ id: string, name: string, baseHeight: number, heightAmplitude: number, ridgeStrength: number, surfaceBlock: number, subsurfaceBlock: number, treeChance: number, grassColor: number }}
   */
  getBiomeAt(x, z) {
    return this.terrainGenerator.getBiomeAt(Math.floor(x), Math.floor(z));
  }

  /**
   * Fast 3D DDA Voxel Raycast (Amanatides & Woo) returning hit block, face normal, and adjacent placement coords.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, y: number, z: number }} direction - Should be normalized.
   * @param {number} [maxDistance=6]
   * @returns {{ hit: boolean, blockId?: number, position?: { x: number, y: number, z: number }, normal?: { x: number, y: number, z: number }, adjacent?: { x: number, y: number, z: number }, distance?: number }}
   */
  raycast(origin, direction, maxDistance = 6) {
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len < 1e-6) return { hit: false };

    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

    let tMaxX =
      stepX > 0
        ? (x + 1 - origin.x) * tDeltaX
        : stepX < 0
        ? (origin.x - x) * tDeltaX
        : Infinity;
    let tMaxY =
      stepY > 0
        ? (y + 1 - origin.y) * tDeltaY
        : stepY < 0
        ? (origin.y - y) * tDeltaY
        : Infinity;
    let tMaxZ =
      stepZ > 0
        ? (z + 1 - origin.z) * tDeltaZ
        : stepZ < 0
        ? (origin.z - z) * tDeltaZ
        : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let dist = 0;

    while (dist <= maxDistance) {
      const id = this.getBlock(x, y, z);
      if (id !== BLOCK_IDS.AIR && !this.blockRegistry.isLiquid(id)) {
        return {
          hit: true,
          blockId: id,
          position: { x, y, z },
          normal: { x: nx, y: ny, z: nz },
          adjacent: { x: x + nx, y: y + ny, z: z + nz },
          distance: dist,
        };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          dist = tMaxX;
          x += stepX;
          tMaxX += tDeltaX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          dist = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          dist = tMaxY;
          y += stepY;
          tMaxY += tDeltaY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          dist = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
    }

    return { hit: false };
  }

  /**
   * Subscribes to chunk mesh ready events for Three.js Scene integration.
   * @param {(chunk: import('../chunks/Chunk.js').Chunk) => void} callback
   * @returns {() => void}
   */
  onChunkMeshReady(callback) {
    return this.chunkManager.onChunkMeshReady(callback);
  }

  /**
   * Subscribes to chunk unload events for Three.js Scene cleanup.
   * @param {(chunk: import('../chunks/Chunk.js').Chunk) => void} callback
   * @returns {() => void}
   */
  onChunkUnloaded(callback) {
    return this.chunkManager.onChunkUnloaded(callback);
  }

  /**
   * Subscribes to block edit events.
   * @param {(event: { x: number, y: number, z: number, previousId: number, blockId: number }) => void} callback
   * @returns {() => void}
   */
  onBlockChanged(callback) {
    this._onBlockChanged.add(callback);
    return () => this._onBlockChanged.delete(callback);
  }

  /**
   * Returns all currently loaded Three.js chunk mesh groups.
   * @returns {import('three').Group[]}
   */
  getLoadedChunkMeshes() {
    return this.chunkManager.getLoadedMeshes();
  }

  /**
   * Returns live engine diagnostics for debugging/HUD inspection.
   */
  getStats() {
    return {
      seed: this.seed,
      loadedChunks: this.chunkManager.chunks.size,
      viewDistance: this.viewDistance,
      modifiedChunks: Object.keys(this.chunkManager.exportAllModifications()).length,
      worldTime: this.worldTime,
      timeOfDay: this.timeOfDay,
      skyBrightness: this.getSkyBrightness(),
    };
  }

  /**
   * Disposes all chunk meshes, shared materials, and atlas textures.
   */
  dispose() {
    this.chunkManager.dispose();
    this.chunkMesher.dispose();
    this.textureAtlas.dispose();
    this._onBlockChanged.clear();
  }
}
