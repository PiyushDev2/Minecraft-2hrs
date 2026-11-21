import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_IDS,
  Chunk,
  ChunkManager,
  ChunkMesher,
  FLUID_FALLING_FLAG,
  FLUID_SOURCE,
  TerrainGenerator,
  TextureAtlas,
  World,
  WorldSave,
  blockRegistry,
} from '../../src/backend/index.js';

/**
 * Helper to create a clean flat stone test world at y = 20 across chunks (-1..1, -1..1).
 */
function createFlatFluidWorld({ floorY = 20, maxUpdatesPerStep = 512 } = {}) {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator('fluid-flat-test');
  terrain.generateChunk = (chunk) => {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        chunk.setBlock(lx, 0, lz, BLOCK_IDS.BEDROCK, false);
        for (let y = 1; y <= floorY; y++) {
          chunk.setBlock(lx, y, lz, BLOCK_IDS.STONE, false);
        }
      }
    }
    chunk.generated = true;
    chunk.dirty = true;
  };

  const cm = new ChunkManager({
    terrainGenerator: terrain,
    chunkMesher: mesher,
    useWorkers: false,
    viewDistance: 2,
  });
  cm.fluidSimulator.maxUpdatesPerStep = maxUpdatesPerStep;

  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      cm.loadChunk(cx, cz, false);
    }
  }

  return { cm, mesher, atlas, terrain };
}

function drainFluidSteps(cm, maxWaves = 40) {
  let waves = 0;
  while (cm.fluidSimulator.getPendingCount() > 0 && waves < maxWaves) {
    cm.fluidSimulator.step();
    waves++;
  }
  return waves;
}

test('Water spreads horizontally up to 7 blocks on flat ground and stabilizes', () => {
  const { cm, mesher, atlas } = createFlatFluidWorld({ floorY: 20 });
  const y = 21;

  cm.setBlock(0, y, 0, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  const waves = drainFluidSteps(cm, 30);

  assert(waves < 30, 'Fluid queue should stabilize cleanly without infinite loops');
  assert.equal(cm.fluidSimulator.getPendingCount(), 0);

  // Along +X axis: source at x=0 (dist=0), flowing at x=1..7, AIR at x=8
  assert.equal(cm.getBlock(0, y, 0), BLOCK_IDS.WATER);
  assert.equal(cm.getFluidLevel(0, y, 0), FLUID_SOURCE);
  for (let d = 1; d <= 7; d++) {
    assert.equal(cm.getBlock(d, y, 0), BLOCK_IDS.WATER, `Expected water at distance ${d}`);
    assert.equal(cm.getFluidLevel(d, y, 0), d, `Expected fluid distance ${d}`);
  }
  assert.equal(cm.getBlock(8, y, 0), BLOCK_IDS.AIR, 'Water must stop at maxSpread = 7');

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('Waterfall drops vertically without mid-air horizontal spreading then splashes on floor', () => {
  const { cm, mesher, atlas } = createFlatFluidWorld({ floorY: 10 });

  // Build an elevated stone ledge at y=16 at (4, 16, 4) with a drop to y=10 stone floor
  cm.setBlock(4, 16, 4, BLOCK_IDS.STONE);
  cm.setBlock(4, 17, 4, BLOCK_IDS.WATER, true, FLUID_SOURCE);

  drainFluidSteps(cm, 40);

  // Water drops down off the 1x1 pillar at x=5,z=4 cleanly from y=17 -> y=11 (floor is y=10)
  for (let wy = 16; wy >= 11; wy--) {
    assert.equal(cm.getBlock(5, wy, 4), BLOCK_IDS.WATER, `Waterfall column missing at y=${wy}`);
    assert.notEqual(
      cm.getFluidLevel(5, wy, 4) & FLUID_FALLING_FLAG,
      0,
      `Waterfall voxel at y=${wy} must have FLUID_FALLING_FLAG`
    );
    if (wy > 11) {
      // Mid-air falling blocks must not fan out sideways at wy=15..12
      assert.equal(
        cm.getBlock(6, wy, 4),
        BLOCK_IDS.AIR,
        `Mid-air waterfall should not fan out sideways at y=${wy}`
      );
    }
  }

  // Once hitting the floor (y=10), water at y=11 splashes horizontally onto (6, 11, 4)
  assert.equal(cm.getBlock(6, 11, 4), BLOCK_IDS.WATER, 'Waterfall must spread out on solid floor');
  assert.equal(cm.getFluidLevel(6, 11, 4), 1);

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('Flowing water washes away cross-plant flora and torches while clearing torch blockLight', () => {
  const { cm, mesher, atlas } = createFlatFluidWorld({ floorY: 20 });
  const y = 21;

  cm.setBlock(1, y, 0, BLOCK_IDS.TALL_GRASS);
  cm.setBlock(2, y, 0, BLOCK_IDS.FLOWER);
  cm.setBlock(3, y, 0, BLOCK_IDS.TORCH);
  assert(cm.getLight(3, y, 0).block > 0, 'Torch should emit block light before wash-away');

  cm.setBlock(0, y, 0, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  drainFluidSteps(cm, 30);

  assert.equal(cm.getBlock(1, y, 0), BLOCK_IDS.WATER);
  assert.equal(cm.getBlock(2, y, 0), BLOCK_IDS.WATER);
  assert.equal(cm.getBlock(3, y, 0), BLOCK_IDS.WATER);
  assert.equal(cm.getLight(3, y, 0).block, 0, 'Washed-away torch must extinguish its blockLight');

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('Removing water source drains downstream horizontal stream and waterfall back to AIR', () => {
  const { cm, mesher, atlas } = createFlatFluidWorld({ floorY: 10 });

  // Place elevated source on ledge at y=14 that waterfalls down to floor y=10
  cm.setBlock(2, 13, 2, BLOCK_IDS.STONE);
  cm.setBlock(2, 14, 2, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  drainFluidSteps(cm, 40);

  assert.equal(cm.getBlock(3, 11, 2), BLOCK_IDS.WATER);
  assert.equal(cm.getBlock(4, 11, 2), BLOCK_IDS.WATER);

  // Remove the source block
  cm.setBlock(2, 14, 2, BLOCK_IDS.AIR);
  const waves = drainFluidSteps(cm, 60);

  assert(waves < 60, 'Draining should converge quickly without lingering loops');
  assert.equal(cm.getBlock(3, 14, 2), BLOCK_IDS.AIR);
  assert.equal(cm.getBlock(3, 12, 2), BLOCK_IDS.AIR);
  assert.equal(cm.getBlock(3, 11, 2), BLOCK_IDS.AIR);
  assert.equal(cm.getBlock(4, 11, 2), BLOCK_IDS.AIR);

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('Two adjacent source blocks over solid ground convert intermediate water into an infinite source', () => {
  const { cm, mesher, atlas } = createFlatFluidWorld({ floorY: 20 });
  const y = 21;

  // Dig a 3x1 stone-walled basin at (0..2, 21, 0)
  cm.setBlock(-1, y, 0, BLOCK_IDS.STONE);
  cm.setBlock(3, y, 0, BLOCK_IDS.STONE);
  cm.setBlock(0, y, -1, BLOCK_IDS.STONE);
  cm.setBlock(1, y, -1, BLOCK_IDS.STONE);
  cm.setBlock(2, y, -1, BLOCK_IDS.STONE);
  cm.setBlock(0, y, 1, BLOCK_IDS.STONE);
  cm.setBlock(1, y, 1, BLOCK_IDS.STONE);
  cm.setBlock(2, y, 1, BLOCK_IDS.STONE);

  cm.setBlock(0, y, 0, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  cm.setBlock(2, y, 0, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  drainFluidSteps(cm, 20);

  assert.equal(cm.getBlock(1, y, 0), BLOCK_IDS.WATER);
  assert.equal(
    cm.getFluidLevel(1, y, 0),
    FLUID_SOURCE,
    'Middle block between two sources must become an infinite FLUID_SOURCE'
  );

  // Removing one side leaves the center self-sustaining as a real source
  cm.setBlock(0, y, 0, BLOCK_IDS.AIR);
  drainFluidSteps(cm, 20);
  assert.equal(cm.getBlock(1, y, 0), BLOCK_IDS.WATER);
  assert.equal(cm.getFluidLevel(1, y, 0), FLUID_SOURCE);

  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});

test('Cross-chunk water flow, stepped water meshing heights, and WorldSave persistence work cleanly', () => {
  const { cm, mesher, atlas, terrain } = createFlatFluidWorld({ floorY: 20 });
  const y = 21;

  // Place source near east edge of chunk (0, 0) at wx=14 so it flows into chunk (1, 0) at wx=16..21
  cm.setBlock(14, y, 5, BLOCK_IDS.WATER, true, FLUID_SOURCE);
  drainFluidSteps(cm, 30);

  assert.equal(cm.getBlock(16, y, 5), BLOCK_IDS.WATER);
  assert.equal(cm.getFluidLevel(16, y, 5), 2);
  assert.equal(cm.getBlock(21, y, 5), BLOCK_IDS.WATER);
  assert.equal(cm.getFluidLevel(21, y, 5), 7);

  // Remesh chunk (1, 0) and inspect stepped water Y heights
  const chunkEast = cm.getChunk(1, 0);
  const built = mesher.buildChunkMesh(
    chunkEast,
    (wx, wy, wz) => cm.getBlock(wx, wy, wz),
    (wx, wy, wz) => cm.getLight(wx, wy, wz),
    (wx, wy, wz) => cm.getFluidLevel(wx, wy, wz)
  );
  assert(built.waterMesh, 'Water mesh should be generated for flowing water in east chunk');

  const pos = built.waterMesh.geometry.attributes.position;
  const maxVertexYByX = new Map();
  for (let i = 0; i < pos.count; i++) {
    const vx = Math.floor(pos.getX(i) - 1e-4);
    const vy = pos.getY(i);
    const localX = Math.max(0, Math.min(15, Math.floor(pos.getX(i))));
    const prevMax = maxVertexYByX.get(localX) ?? 0;
    if (vy > prevMax) maxVertexYByX.set(localX, vy);
    void vx;
  }

  // Flowing water surface height at dist=2 (lx=0 -> y + ~0.67) must be noticeably lower than y+1 and higher than dist=6 (lx=4 -> y + ~0.25)
  const hDist2 = maxVertexYByX.get(0);
  const hDist6 = maxVertexYByX.get(4);
  assert(hDist2 < y + 0.88 && hDist2 > y + 0.5, `Expected stepped water height at dist=2, got ${hDist2}`);
  assert(hDist6 < hDist2 && hDist6 > y, `Expected lower height at dist=6 (${hDist6}) than dist=2 (${hDist2})`);

  // Verify WorldSave round-trip preserves placed water + fluid level metadata
  const world = new World({ seed: 'fluid-save', terrainGenerator: terrain, viewDistance: 2 });
  world.generate('fluid-save', { pregenerateRadius: 1 });
  const sy = world.getSurfaceY(4, 4) + 1;
  world.setBlock(4, sy, 4, BLOCK_IDS.WATER);
  world.stepFluids(20);
  const savedJson = WorldSave.exportJSON(world, null, 'fluid-test');
  const parsed = WorldSave.parseJSON(savedJson);

  const world2 = new World({ seed: 'fluid-save', viewDistance: 2 });
  WorldSave.apply(world2, null, parsed);
  assert.equal(world2.getBlock(4, sy, 4), BLOCK_IDS.WATER);
  assert.equal(world2.getBlock(5, sy, 4), BLOCK_IDS.WATER);
  assert(world2.getFluidLevel(5, sy, 4) > 0, 'Saved flowing water distance must survive WorldSave round-trip');

  world.dispose();
  world2.dispose();
  cm.dispose();
  mesher.dispose();
  atlas.dispose();
});
