/**
 * @file index.js
 * @description Public barrel entrypoint for the Minecraft-style voxel backend engine.
 */

export { Engine } from './core/Engine.js';
export { EventBus, ENGINE_EVENTS } from './core/EventBus.js';

export { Block, BlockFace } from './blocks/Block.js';
export {
  BLOCK_IDS,
  BlockRegistry,
  createDefaultBlockRegistry,
  blockRegistry,
} from './blocks/BlockRegistry.js';

export {
  Chunk,
  CHUNK_WIDTH,
  CHUNK_DEPTH,
  CHUNK_HEIGHT,
  CHUNK_VOLUME,
  getChunkKey,
} from './chunks/Chunk.js';
export { ChunkManager } from './chunks/ChunkManager.js';
export { ChunkMesher } from './chunks/ChunkMesher.js';
export { MeshWorkerPool } from './chunks/MeshWorkerPool.js';
export { buildChunkGeometryBuffers } from './chunks/MeshingCore.js';
export { VoxelRegion } from './chunks/VoxelRegion.js';
export { LightEngine } from './lighting/LightEngine.js';
export { TextureAtlas } from './textures/TextureAtlas.js';

export { Noise, normalizeSeed, createPRNG, hash2D, hash3D } from './terrain/Noise.js';
export { BiomeGenerator, BIOMES, BIOME_PROFILES } from './terrain/BiomeGenerator.js';
export { TerrainGenerator, SEA_LEVEL } from './terrain/TerrainGenerator.js';

export { AABB, isBoxCollidingWithWorld, isBoxInLiquid, moveBoxWithCollision } from './physics/Collision.js';
export { PHYSICS_CONSTANTS, stepEntityPhysics } from './physics/Physics.js';
export { Player } from './physics/Player.js';

export { World } from './world/World.js';
export { WorldManager } from './world/WorldManager.js';
export { WorldSave } from './save/WorldSave.js';

import { WorldManager } from './world/WorldManager.js';

/**
 * Convenience factory creating a fully wired backend WorldManager instance.
 * @param {Object} [options]
 * @returns {WorldManager}
 */
export function createVoxelEngine(options = {}) {
  return new WorldManager(options);
}
