import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BIOMES,
  BLOCK_IDS,
  Chunk,
  ChunkManager,
  ChunkMesher,
  MeshWorkerPool,
  TerrainGenerator,
  TextureAtlas,
  VoxelRegion,
  blockRegistry,
  buildChunkGeometryBuffers,
} from '../../src/backend/index.js';

/**
 * Simulated async Web Worker adapter running MeshingCore on a deferred queue
 * so tests can deterministically interleave block edits or epoch resets before completion.
 */
function createControllableWorkerHarness() {
  const workers = [];
  const factory = () => {
    let blockTable = null;
    let tileRects = null;
    const pendingReplies = [];
    const instance = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage(msg) {
        if (msg.type === 'init') {
          blockTable = msg.blockTable;
          tileRects = msg.tileRects;
          return;
        }
        if (msg.type === 'mesh') {
          const region = new VoxelRegion({
            chunkX: msg.chunkX,
            chunkZ: msg.chunkZ,
            blocks: msg.blocks,
            lightData: msg.lightData,
            centerEditVersion: msg.centerEditVersion,
            versionSignature: msg.versionSignature,
          });
          const built = buildChunkGeometryBuffers({
            getBlockAtLocal: (lx, y, lz) => region.getBlock(lx, y, lz),
            getLightAtLocal: (lx, y, lz) => region.getLight(lx, y, lz),
            blockTable,
            tileRects,
          });
          pendingReplies.push({
            type: 'result',
            jobId: msg.jobId,
            epoch: msg.epoch,
            chunkX: msg.chunkX,
            chunkZ: msg.chunkZ,
            centerEditVersion: msg.centerEditVersion,
            versionSignature: msg.versionSignature,
            opaque: built.opaque,
            water: built.water,
            faceCount: built.faceCount,
            triangleCount: built.triangleCount,
          });
        }
      },
      flushNext() {
        const reply = pendingReplies.shift();
        if (reply && instance.onmessage) {
          instance.onmessage({ data: reply });
        }
        return Boolean(reply);
      },
      terminate() {
        instance.terminated = true;
      },
    };
    workers.push(instance);
    return instance;
  };
  return { workers, factory };
}

test('VoxelRegion captures 18x128x18 padded center, cardinal edges, and diagonal corners', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator(101);
  terrain.generateChunk = (chunk) => {
    chunk.generated = true;
    chunk.dirty = true;
  };
  const cm = new ChunkManager({ terrainGenerator: terrain, chunkMesher: mesher, useWorkers: false });

  const c00 = cm.loadChunk(0, 0, false);
  const cWest = cm.loadChunk(-1, 0, false);
  const cCorner = cm.loadChunk(-1, -1, false);

  c00.setBlock(3, 10, 4, BLOCK_IDS.COAL_ORE);
  cWest.setBlock(15, 10, 4, BLOCK_IDS.IRON_ORE);
  cCorner.setBlock(15, 10, 15, BLOCK_IDS.SNOW_BLOCK);

  const region = VoxelRegion.captureChunkNeighborhood(cm, 0, 0);
  assert(region, 'Region snapshot should be captured');
  assert.equal(region.getBlock(3, 10, 4), BLOCK_IDS.COAL_ORE);
  assert.equal(region.getBlock(-1, 10, 4), BLOCK_IDS.IRON_ORE);
  assert.equal(region.getBlock(-1, 10, -1), BLOCK_IDS.SNOW_BLOCK);
  assert.equal(region.centerEditVersion, c00.editVersion);

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('MeshingCore renders cross-plant flora (Tall Grass, Flower, Torch) with valid CCW outward winding', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const chunk = new Chunk(0, 0);
  chunk.generated = true;

  chunk.setBlock(5, 10, 5, BLOCK_IDS.GRASS);
  chunk.setBlock(5, 11, 5, BLOCK_IDS.TALL_GRASS);
  chunk.setBlock(7, 11, 7, BLOCK_IDS.FLOWER);
  chunk.setBlock(9, 11, 9, BLOCK_IDS.TORCH);

  const res = mesher.buildChunkMesh(chunk, (wx, wy, wz) =>
    wx >= 0 && wx < 16 && wz >= 0 && wz < 16 ? chunk.getBlock(wx, wy, wz) : BLOCK_IDS.AIR
  );
  assert(res.opaqueMesh);
  const geom = res.opaqueMesh.geometry;
  const pos = geom.attributes.position;
  const norm = geom.attributes.normal;
  const idx = geom.index;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < idx.count; i += 3) {
    v0.fromBufferAttribute(pos, idx.getX(i));
    v1.fromBufferAttribute(pos, idx.getX(i + 1));
    v2.fromBufferAttribute(pos, idx.getX(i + 2));
    n.fromBufferAttribute(norm, idx.getX(i));
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    cross.crossVectors(e1, e2);
    assert(cross.dot(n) > 0, `Cross-plant triangle ${i / 3} winding must match normal`);
  }

  chunk.disposeMesh();
  mesher.dispose();
  atlas.dispose();
});

test('MeshWorkerPool rejects stale editVersion and invalidated epoch worker results without tearing', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator(555);
  terrain.generateChunk = (chunk) => {
    chunk.setBlock(4, 1, 4, BLOCK_IDS.STONE, false);
    chunk.generated = true;
    chunk.dirty = true;
  };

  const harness = createControllableWorkerHarness();
  const pool = new MeshWorkerPool({
    blockRegistry,
    textureAtlas: atlas,
    poolSize: 1,
    workerFactory: harness.factory,
  });

  const cm = new ChunkManager({
    terrainGenerator: terrain,
    chunkMesher: mesher,
    workerPool: pool,
    viewDistance: 2,
  });

  let readyCount = 0;
  cm.onChunkMeshReady(() => {
    readyCount++;
  });

  // 1. Dispatch worker job for (0,0) at initial editVersion
  const chunk = cm.loadChunk(0, 0, false);
  const dispatched = cm.remeshChunkAsync(chunk);
  assert.equal(dispatched, true);

  // 2. Edit block BEFORE worker replies -> editVersion increments
  cm.setBlock(4, 2, 4, BLOCK_IDS.COAL_ORE);
  assert.equal(chunk.dirty, true);

  // 3. Flush stale worker reply -> must be discarded and chunk remains dirty
  harness.workers[0].flushNext();
  assert.equal(readyCount, 0, 'Stale editVersion worker result must be discarded');
  assert.equal(chunk.dirty, true);

  // 4. Re-dispatch at latest editVersion and flush -> accepted and meshed!
  cm.remeshChunkAsync(chunk);
  harness.workers[0].flushNext();
  assert.equal(readyCount, 1);
  assert.equal(chunk.dirty, false);
  assert(chunk.opaqueMesh, 'Accepted worker geometry attaches opaqueMesh');

  // 5. Epoch invalidation test: queue job then clear() before flush
  cm.setBlock(4, 3, 4, BLOCK_IDS.IRON_ORE);
  cm.remeshChunkAsync(chunk);
  cm.clear();
  harness.workers[0].flushNext();
  assert.equal(readyCount, 1, 'Invalidated epoch worker result must be ignored');

  cm.dispose();
  assert.equal(harness.workers[0].terminated, true);
  mesher.dispose();
  atlas.dispose();
});

test('Enriched TerrainGenerator produces ores, flora, snow, and full TextureAtlas tile rects', () => {
  const atlas = new TextureAtlas();
  const rects = atlas.exportTileRects();
  for (const key of [
    'coal_ore',
    'iron_ore',
    'snow',
    'cactus_top',
    'cactus_side',
    'tall_grass',
    'flower',
    'spruce_log_side',
    'spruce_leaves',
  ]) {
    assert(rects[key], `TextureAtlas must contain tile rect for ${key}`);
    assert(rects[key].uSize > 0 && rects[key].vSize > 0);
  }

  const terrain = new TerrainGenerator('phase-c-ores-biomes');
  let coalCount = 0;
  let ironCount = 0;
  let surfaceFeatureCount = 0;

  // Sample several spaced chunks to encounter ores and biome features deterministically
  const coords = [
    [0, 0],
    [1, 0],
    [4, 4],
    [12, -8],
    [-10, 14],
  ];

  for (const [cx, cz] of coords) {
    const chunk = new Chunk(cx, cz);
    terrain.generateChunk(chunk);
    for (let i = 0; i < chunk.blocks.length; i++) {
      const id = chunk.blocks[i];
      if (id === BLOCK_IDS.COAL_ORE) coalCount++;
      else if (id === BLOCK_IDS.IRON_ORE) ironCount++;
      else if (
        id === BLOCK_IDS.TALL_GRASS ||
        id === BLOCK_IDS.FLOWER ||
        id === BLOCK_IDS.CACTUS ||
        id === BLOCK_IDS.SNOW_BLOCK ||
        id === BLOCK_IDS.SPRUCE_LOG
      ) {
        surfaceFeatureCount++;
      }
    }
  }

  assert(coalCount > 0, 'Underground coal ore veins must generate');
  assert(ironCount > 0, 'Underground iron ore veins must generate');
  assert(surfaceFeatureCount > 0, 'Surface flora/snow/spruce/cacti features must generate');
  assert(BIOMES.SNOWY_TAIGA, 'SNOWY_TAIGA biome enum must exist');

  atlas.dispose();
});
