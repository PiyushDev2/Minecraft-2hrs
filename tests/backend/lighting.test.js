import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_IDS,
  Chunk,
  ChunkManager,
  ChunkMesher,
  TextureAtlas,
  TerrainGenerator,
  World,
  WorldSave,
  blockRegistry,
} from '../../src/backend/index.js';

function createFlatTestManager() {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator(42);
  // Override terrain to deterministic flat bedrock + air for clean lighting tests
  terrain.generateChunk = (chunk) => {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        chunk.setBlock(x, 0, z, BLOCK_IDS.BEDROCK, false);
        chunk.setBlock(x, 1, z, BLOCK_IDS.STONE, false);
      }
    }
    chunk.generated = true;
    chunk.dirty = true;
    return chunk;
  };
  const cm = new ChunkManager({
    terrainGenerator: terrain,
    chunkMesher: mesher,
    viewDistance: 3,
  });
  return { cm, mesher, atlas };
}

test('LightEngine computes open sky light 15, semi-transparent attenuation, and sealed dark rooms', () => {
  const { cm, mesher, atlas } = createFlatTestManager();
  const chunk = cm.loadChunk(0, 0, false);

  // Open sky column
  assert.equal(cm.getLight(4, 20, 4).sky, 15);
  assert.equal(cm.getLight(4, 2, 4).sky, 15);
  assert.equal(cm.getLight(4, 2, 4).block, 0);

  // Build a sealed 3x3x3 stone room (x: 2..6, y: 2..6, z: 2..6) -> interior (4,4,4)
  for (let y = 2; y <= 6; y++) {
    for (let z = 2; z <= 6; z++) {
      for (let x = 2; x <= 6; x++) {
        const isShell = x === 2 || x === 6 || y === 2 || y === 6 || z === 2 || z === 6;
        if (isShell) {
          cm.setBlock(x, y, z, BLOCK_IDS.STONE);
        }
      }
    }
  }

  assert.equal(cm.getLight(4, 4, 4).sky, 0, 'Sealed opaque room interior must have sky light 0');
  assert.equal(cm.getLight(4, 7, 4).sky, 15, 'Block above roof remains at sky light 15');

  // Re-open roof skylight at (4, 6, 4) -> light 15 floods straight down to floor (4, 3, 4)
  cm.setBlock(4, 6, 4, BLOCK_IDS.AIR);
  assert.equal(cm.getLight(4, 5, 4).sky, 15);
  assert.equal(cm.getLight(4, 3, 4).sky, 15);
  assert.equal(cm.getLight(5, 4, 4).sky, 14, 'Adjacent cave voxel receives sky=14');

  // Place semi-transparent OAK_LEAVES (attenuation 2) in skylight opening
  cm.setBlock(4, 6, 4, BLOCK_IDS.OAK_LEAVES);
  assert.equal(
    cm.getLight(4, 6, 4).sky,
    13,
    'Leaves in open sunlight attenuate sky light from 15 to 13'
  );

  // Re-seal roof and verify interior returns to complete darkness (0)
  cm.setBlock(4, 6, 4, BLOCK_IDS.STONE);
  assert.equal(cm.getLight(4, 4, 4).sky, 0);

  chunk.disposeMesh();
  cm.clear();
  mesher.dispose();
  atlas.dispose();
});

test('LightEngine propagates and removes artificial torch/glowstone light across chunk boundaries', () => {
  const { cm, mesher, atlas } = createFlatTestManager();
  cm.loadChunk(0, 0, false);
  cm.loadChunk(1, 0, false);

  // Build sealed dark corridor spanning chunk boundary x = 11..20, y = 2..6, z = 4..8
  for (let y = 2; y <= 6; y++) {
    for (let z = 4; z <= 8; z++) {
      for (let x = 11; x <= 20; x++) {
        const isShell = x === 11 || x === 20 || y === 2 || y === 6 || z === 4 || z === 8;
        if (isShell) {
          cm.setBlock(x, y, z, BLOCK_IDS.STONE);
        }
      }
    }
  }

  assert.equal(cm.getLight(15, 4, 6).sky, 0);
  assert.equal(cm.getLight(16, 4, 6).sky, 0);

  // Place Torch (emission 14) at border voxel x=15 (chunk 0, lx=15)
  cm.setBlock(15, 4, 6, BLOCK_IDS.TORCH);
  assert.equal(cm.getLight(15, 4, 6).block, 14);
  assert.equal(cm.getLight(16, 4, 6).block, 13, 'Torch light must cross chunk border to chunk (1,0)');
  assert.equal(cm.getLight(18, 4, 6).block, 11, 'Manhattan decay 14 -> 13 -> 12 -> 11');

  // Place second overlapping Glowstone (emission 15) at x=19
  cm.setBlock(19, 4, 6, BLOCK_IDS.GLOWSTONE);
  assert.equal(cm.getLight(19, 4, 6).block, 15);
  assert.equal(cm.getLight(18, 4, 6).block, 14);

  // Break the Torch at x=15 -> Glowstone at x=19 should keep lighting x=15 at (15 - 4 = 11)
  cm.setBlock(15, 4, 6, BLOCK_IDS.AIR);
  assert.equal(
    cm.getLight(15, 4, 6).block,
    11,
    'Overlapping glowstone must re-fill region after torch removal'
  );

  // Break the Glowstone too -> dark corridor returns to block light 0
  cm.setBlock(19, 4, 6, BLOCK_IDS.AIR);
  assert.equal(cm.getLight(15, 4, 6).block, 0);
  assert.equal(cm.getLight(19, 4, 6).block, 0);

  cm.clear();
  mesher.dispose();
  atlas.dispose();
});

test('ChunkMesher attaches aLight attribute and splits greedy quads on light differences', () => {
  const { cm, mesher, atlas } = createFlatTestManager();
  const chunk = cm.loadChunk(0, 0, false);

  // Uniform flat stone at y=1 -> all exposed top faces have sky=15, block=0 -> 1 top quad
  cm.remeshChunk(chunk);
  assert(chunk.opaqueMesh, 'Opaque mesh should be built');
  const aLightAttr = chunk.opaqueMesh.geometry.attributes.aLight;
  assert(aLightAttr, 'Geometry must include aLight attribute');
  assert.equal(aLightAttr.itemSize, 2);

  // Place a torch on top of stone at (8, 2, 8) -> nearby floor gets varying blockLight -> splits greedy top quad
  const prevTriangles = chunk.opaqueMesh.geometry.index.count / 3;
  cm.setBlock(8, 2, 8, BLOCK_IDS.TORCH);
  cm.remeshChunk(chunk);
  const litTriangles = chunk.opaqueMesh.geometry.index.count / 3;
  assert(
    litTriangles > prevTriangles,
    `Torch light gradient should split uniform floor mesh (${litTriangles} > ${prevTriangles})`
  );

  cm.clear();
  mesher.dispose();
  atlas.dispose();
});

test('World day/night cycle updates sky brightness uniform and persists across WorldSave', () => {
  const world = new World({ seed: 777, viewDistance: 2, dayLengthSeconds: 100 });
  world.generate(777, { pregenerateRadius: 0 });

  // Default starts at noon (0.25)
  assert.equal(world.getTimeOfDay(), 0.25);
  assert(Math.abs(world.getSkyBrightness() - 1.0) < 1e-6);
  assert(Math.abs(world.chunkMesher.skyBrightnessUniform.value - 1.0) < 1e-6);

  // Advance by 50 seconds -> 0.75 (midnight)
  world.update({ x: 8, z: 8 }, 50);
  assert(Math.abs(world.getTimeOfDay() - 0.75) < 1e-6);
  assert(Math.abs(world.getSkyBrightness() - 0.16) < 1e-6);
  assert(Math.abs(world.chunkMesher.skyBrightnessUniform.value - 0.16) < 1e-6);

  // Save & restore preserves timeOfDay
  const json = WorldSave.exportJSON(world, null, 'night_test');
  const world2 = new World({ seed: 1, viewDistance: 2 });
  WorldSave.apply(world2, null, WorldSave.parseJSON(json));
  assert(Math.abs(world2.getTimeOfDay() - 0.75) < 1e-6);
  assert(Math.abs(world2.chunkMesher.skyBrightnessUniform.value - 0.16) < 1e-6);

  world.dispose();
  world2.dispose();
});
