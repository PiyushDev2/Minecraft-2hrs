import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_IDS,
  CHUNK_WIDTH,
  CHUNK_DEPTH,
  CHUNK_HEIGHT,
  Chunk,
  ChunkManager,
  ChunkMesher,
  TerrainGenerator,
  TextureAtlas,
  blockRegistry,
} from '../../src/backend/index.js';

function createTestChunkManager(seed = 42) {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator(seed);
  const cm = new ChunkManager({
    terrainGenerator: terrain,
    chunkMesher: mesher,
    viewDistance: 3,
  });
  return { cm, atlas, mesher };
}

test('Euclidean worldToChunkCoord handles negative coordinates without off-by-one seams', () => {
  const { cm, atlas, mesher } = createTestChunkManager();

  assert.deepEqual(cm.worldToChunkCoord(0, 0), { chunkX: 0, chunkZ: 0, lx: 0, lz: 0 });
  assert.deepEqual(cm.worldToChunkCoord(15, 15), { chunkX: 0, chunkZ: 0, lx: 15, lz: 15 });
  assert.deepEqual(cm.worldToChunkCoord(-1, -1), { chunkX: -1, chunkZ: -1, lx: 15, lz: 15 });
  assert.deepEqual(cm.worldToChunkCoord(-16, -16), { chunkX: -1, chunkZ: -1, lx: 0, lz: 0 });
  assert.deepEqual(cm.worldToChunkCoord(-17, -17), { chunkX: -2, chunkZ: -2, lx: 15, lz: 15 });
  assert.deepEqual(cm.worldToChunkCoord(-0.2, -15.9), { chunkX: -1, chunkZ: -1, lx: 15, lz: 0 });

  cm.clear();
  mesher.dispose();
  atlas.dispose();
});

test('Chunk storage dimensions, local indexing, and border neighbor dirtying work properly', () => {
  const { cm, atlas, mesher } = createTestChunkManager();

  const c0 = cm.loadChunk(0, 0, true);
  assert.equal(c0.dirty, false);

  const cNeg = cm.loadChunk(-1, 0, true);
  // Loading (-1,0) marks existing neighbor (0,0) dirty so border faces can update
  assert.equal(c0.dirty, true);
  assert.equal(cNeg.dirty, false);

  cm.remeshChunk(c0);
  assert.equal(c0.dirty, false);

  assert.equal(c0.blocks.length, CHUNK_WIDTH * CHUNK_DEPTH * CHUNK_HEIGHT);

  // Editing at lx=0 in chunk (0,0) must dirty chunk (-1,0) as well
  const changed = cm.setBlock(0, 64, 8, BLOCK_IDS.STONE, true);
  assert.equal(changed, true);
  assert.equal(c0.dirty, true);
  assert.equal(cNeg.dirty, true);
  assert.equal(cm.getBlock(0, 64, 8), BLOCK_IDS.STONE);

  // Out-of-bounds Y safely returns AIR and rejects setBlock
  assert.equal(cm.getBlock(0, -1, 0), BLOCK_IDS.AIR);
  assert.equal(cm.getBlock(0, CHUNK_HEIGHT, 0), BLOCK_IDS.AIR);
  assert.equal(cm.setBlock(0, CHUNK_HEIGHT, 0, BLOCK_IDS.STONE), false);

  // Unload preserves modification deltas and restores them on reload
  cm.unloadChunk(0, 0);
  assert.equal(cm.hasChunk(0, 0), false);
  cm.loadChunk(0, 0, false);
  assert.equal(cm.getBlock(0, 64, 8), BLOCK_IDS.STONE);

  // Decode index round-trip
  const idx = Chunk.getIndex(13, 77, 9);
  assert.deepEqual(Chunk.decodeIndex(idx), { lx: 13, y: 77, lz: 9 });

  cm.clear();
  mesher.dispose();
  atlas.dispose();
});

test('ChunkManager supports async chunk loading without crashing in headless Node', async () => {
  const { cm, atlas, mesher } = createTestChunkManager();
  const chunk = await cm.loadChunkAsync(2, -3, true);
  assert.equal(chunk.chunkX, 2);
  assert.equal(chunk.chunkZ, -3);
  assert.equal(chunk.generated, true);
  assert.equal(cm.hasChunk(2, -3), true);

  cm.clear();
  mesher.dispose();
  atlas.dispose();
});
