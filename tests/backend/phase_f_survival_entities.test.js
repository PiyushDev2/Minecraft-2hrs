import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCK_IDS,
  ENGINE_EVENTS,
  MOB_TYPES,
  SurvivalStats,
  WorldManager,
  WorldSave,
} from '../../src/backend/index.js';

function createFlatTestManager(seed = 'phase-f-test') {
  const wm = new WorldManager({ seed, viewDistance: 3, gameMode: 'survival' });
  wm.world.generate(seed, { spawnCenter: { x: 8, z: 8 }, pregenerateRadius: 2 });
  // Build a flat stone platform at y=30 with clear open air above
  for (let x = 2; x <= 14; x++) {
    for (let z = 2; z <= 14; z++) {
      wm.world.setBlock(x, 30, z, BLOCK_IDS.STONE, true, false);
      for (let y = 31; y <= 45; y++) {
        wm.world.setBlock(x, y, z, BLOCK_IDS.AIR, true, false);
      }
    }
  }
  wm.entities.clear();
  wm.itemDrops.clear();
  wm.player.setPosition(8.5, 31, 8.5);
  wm.survival.reset(31);
  return wm;
}

test('SurvivalStats handles fall damage, underwater drowning, eating, and natural regeneration', () => {
  const wm = createFlatTestManager('survival-vitals');
  try {
    // 1. Fall damage: lift player 10 blocks into the air and fall onto y=31
    wm.player.setPosition(8.5, 42, 8.5);
    wm.survival.reset(42);
    for (let i = 0; i < 65; i++) {
      wm.update(1 / 30, {});
      if (wm.player.grounded) break;
    }
    assert.ok(wm.survival.health < 20, `Expected fall damage to reduce HP below 20, got ${wm.survival.health}`);
    assert.equal(wm.survival.lastDamageSource, 'fall');

    // 2. Eating food restores hunger when below maxHunger
    wm.survival.hunger = 12;
    wm.inventory.equipInSelectedSlot('apple', 3);
    const eatRes = wm.consumeSelectedFood();
    assert.equal(eatRes.consumed, true);
    assert.equal(wm.survival.hunger, 16);

    // 3. Natural regeneration heals HP when hunger >= 18
    wm.survival.hunger = 20;
    const hpBeforeRegen = wm.survival.health;
    for (let i = 0; i < 40; i++) {
      wm.survival.update(0.1, wm.player, wm.world, 'survival');
    }
    assert.ok(wm.survival.health > hpBeforeRegen, 'Expected natural regeneration at full hunger');

    // 4. Underwater oxygen depletion and drowning damage
    for (let y = 31; y <= 34; y++) {
      wm.world.setBlock(8, y, 8, BLOCK_IDS.WATER, true, false);
    }
    wm.player.setPosition(8.5, 31.2, 8.5);
    wm.survival.hunger = 12; // Disable natural regen so drowning damage is isolated
    const hpBeforeDrown = wm.survival.health;
    for (let i = 0; i < 150; i++) {
      wm.survival.update(0.1, wm.player, wm.world, 'survival');
    }
    assert.equal(wm.survival.air, 0);
    assert.ok(wm.survival.health < hpBeforeDrown, 'Expected drowning damage after oxygen runs out');
  } finally {
    wm.dispose();
  }
});

test('EntityManager spawns mobs, supports player melee combat with drops, and runs zombie chase AI', () => {
  const wm = createFlatTestManager('mob-combat-ai');
  try {
    // Spawn a Sheep directly in player's aimed line of sight (yaw=0 looks toward -Z, slight downward pitch hits 1.25m torso)
    wm.player.setPosition(8.5, 31, 10.5);
    wm.player.setRotation(0, -0.35);
    const sheep = wm.entities.spawnMob(MOB_TYPES.SHEEP, 8.5, 31, 8.0);
    wm.inventory.equipInSelectedSlot('wooden_sword', 1);

    // First strike deals 5 damage (Sheep has 8 HP -> 3 left, flees)
    const hit1 = wm.interactPrimaryAction();
    assert.equal(hit1.action, 'attack');
    assert.equal(hit1.killed, false);
    assert.equal(sheep.health, 3);

    // Move close and finish Sheep -> triggers death + raw_beef item drop
    sheep.position.x = 8.5;
    sheep.position.y = 31;
    sheep.position.z = 8.2;
    const hit2 = wm.interactPrimaryAction();
    assert.equal(hit2.action, 'attack');
    assert.equal(hit2.killed, true);
    assert.ok(
      wm.itemDrops.drops.some((d) => d.itemId === 'raw_beef'),
      'Expected defeated Sheep to spawn raw_beef drop'
    );

    // Spawn a Zombie nearby in survival mode -> chases & damages player
    wm.survival.reset(31);
    const zombie = wm.entities.spawnMob(MOB_TYPES.ZOMBIE, 8.5, 31, 6.0);
    const initialDist = Math.hypot(
      zombie.position.x - wm.player.position.x,
      zombie.position.z - wm.player.position.z
    );

    let diedEvents = 0;
    wm.bus.on(ENGINE_EVENTS.PLAYER_DIED, () => {
      diedEvents += 1;
    });

    for (let i = 0; i < 60; i++) {
      wm.update(1 / 20, {});
    }
    const finalDist = Math.hypot(
      zombie.position.x - wm.player.position.x,
      zombie.position.z - wm.player.position.z
    );
    assert.equal(zombie.aiState, 'chase');
    assert.ok(finalDist <= initialDist, 'Expected Zombie to close distance toward player');
    assert.ok(wm.survival.health < 20, 'Expected Zombie melee attack to injure survival player');

    // Kill player & test respawn
    wm.survival.damage(100, 'zombie', true);
    wm.update(1 / 20, {});
    assert.equal(wm.survival.isDead, true);
    assert.equal(diedEvents, 1);

    wm.respawnPlayer();
    assert.equal(wm.survival.isDead, false);
    assert.equal(wm.survival.health, 20);
  } finally {
    wm.dispose();
  }
});

test('WorldSave persists and restores SurvivalStats health, hunger, and air', () => {
  const wm = createFlatTestManager('save-survival');
  try {
    wm.survival.health = 11;
    wm.survival.hunger = 14;
    wm.survival.air = 6;
    const json = WorldSave.exportJSON(wm.world, wm.player, 'surv-slot', {
      gameMode: wm.gameMode,
      inventory: wm.inventory.exportState(),
      survival: wm.survival.exportState(),
    });
    const parsed = WorldSave.parseJSON(json);
    assert.equal(parsed.survival?.health, 11);
    assert.equal(parsed.survival?.hunger, 14);
    assert.equal(parsed.survival?.air, 6);

    const restored = new SurvivalStats();
    restored.importState(parsed.survival, 31);
    assert.equal(restored.health, 11);
    assert.equal(restored.hunger, 14);
    assert.equal(restored.air, 6);
    assert.equal(restored.isDead, false);
  } finally {
    wm.dispose();
  }
});
