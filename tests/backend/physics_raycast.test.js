import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_IDS, Player, World } from '../../src/backend/index.js';

function createFlatTestWorld() {
  const world = new World({ seed: 101, viewDistance: 2 });
  const c = world.loadChunk(0, 0, false);
  c.blocks.fill(BLOCK_IDS.AIR);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      c.setBlock(x, 0, z, BLOCK_IDS.BEDROCK);
      c.setBlock(x, 10, z, BLOCK_IDS.STONE);
    }
  }
  return world;
}

test('3D DDA raycast hits blocks along positive and negative axes and ignores water', () => {
  const world = createFlatTestWorld();

  world.setBlock(10, 12, 8, BLOCK_IDS.STONE);
  world.setBlock(8, 12, 8, BLOCK_IDS.WATER); // Water must be transparent to raycast

  // Positive X raycast passing through water to stone at x=10
  const hitPos = world.raycast({ x: 5.5, y: 12.5, z: 8.5 }, { x: 1, y: 0, z: 0 }, 8);
  assert.equal(hitPos.hit, true);
  assert.deepEqual(hitPos.position, { x: 10, y: 12, z: 8 });
  assert.deepEqual(hitPos.normal, { x: -1, y: 0, z: 0 });
  assert.deepEqual(hitPos.adjacent, { x: 9, y: 12, z: 8 });

  // Negative X raycast hitting opposite face
  const hitNeg = world.raycast({ x: 13.5, y: 12.5, z: 8.5 }, { x: -1, y: 0, z: 0 }, 8);
  assert.equal(hitNeg.hit, true);
  assert.deepEqual(hitNeg.position, { x: 10, y: 12, z: 8 });
  assert.deepEqual(hitNeg.normal, { x: 1, y: 0, z: 0 });

  // Miss when out of reach
  const miss = world.raycast({ x: 1.5, y: 12.5, z: 8.5 }, { x: 1, y: 0, z: 0 }, 4);
  assert.equal(miss.hit, false);

  world.dispose();
});

test('Player AABB physics resolves gravity, ground detection, wall collision, and water buoyancy', () => {
  const world = createFlatTestWorld();
  const player = new Player(world, { x: 5.5, y: 15, z: 5.5 });

  // Fall onto y=10 stone floor (top at y=11)
  for (let i = 0; i < 120; i++) {
    player.update(1 / 60, {});
  }
  assert.equal(player.isGrounded(), true);
  assert.ok(Math.abs(player.getPosition().y - 11) < 1e-4, 'Player feet rest cleanly at y=11');

  // Build 2-block high wall in front of player (facing -Z when yaw=0) at z=3
  world.setBlock(5, 11, 3, BLOCK_IDS.STONE);
  world.setBlock(5, 12, 3, BLOCK_IDS.STONE);

  player.setRotation(0, 0);
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, { forward: true });
  }
  // Player radius is 0.3, wall back face is z=4 -> player center Z must stay >= 4.3
  assert.ok(player.getPosition().z >= 4.3 - 1e-3, `Wall stopped player at z=${player.getPosition().z}`);

  // Prevent placing block inside player's own AABB
  const px = Math.floor(player.getPosition().x);
  const py = Math.floor(player.getPosition().y);
  const pz = Math.floor(player.getPosition().z);
  assert.equal(
    world.placeBlock(px, py, pz, BLOCK_IDS.DIRT, (x, y, z) => player.wouldBlockCollide(x, y, z)),
    false
  );

  // Water detection & swimming
  world.setBlock(12, 11, 12, BLOCK_IDS.WATER);
  world.setBlock(12, 12, 12, BLOCK_IDS.WATER);
  player.setPosition(12.5, 11.2, 12.5);
  player.update(1 / 60, { jump: true });
  assert.equal(player.isInWater(), true);
  assert.ok(player.getVelocity().y > 0, 'Swimming upward applies positive velocity');

  world.dispose();
});
