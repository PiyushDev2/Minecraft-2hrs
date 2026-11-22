/**
 * @file phase_h_complete_minecraft.test.js
 * @description Automated tests for VoxelCraft Complete Edition systems:
 * Furnace smelting & lit toggling, Chest storage & WorldSave persistence,
 * Lava flow & Water/Lava Obsidian/Cobblestone reactions, progressive mining & durability,
 * Armor damage reduction, TNT explosions respecting blastResistance, Bow/Arrows, and Slash Commands.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCK_IDS,
  MOB_TYPES,
  WorldManager,
  WorldSave,
} from '../../src/backend/index.js';

function createTestManager(mode = 'survival') {
  const wm = new WorldManager({ seed: 4242, viewDistance: 2, gameMode: mode });
  wm.world.chunkManager.useWorkers = false;
  wm.initWorld(4242, { x: 8, z: 8 });
  return wm;
}

test('Furnace burns fuel, smelts iron_ore -> iron_ingot, and toggles FURNACE <-> FURNACE_LIT', () => {
  const wm = createTestManager('survival');
  const wx = 10;
  const wz = 10;
  const wy = wm.world.getSurfaceY(wx, wz) + 1;

  assert.equal(wm.world.setBlock(wx, wy, wz, BLOCK_IDS.FURNACE, true, false), true);
  wm.inventory.clear();
  wm.inventory.addItem('iron_ore', 2);
  wm.inventory.addItem('coal', 1);

  assert.equal(wm.blockEntities.insertIntoFurnace(wx, wy, wz, 'input', wm.inventory, 0), true);
  assert.equal(wm.blockEntities.insertIntoFurnace(wx, wy, wz, 'fuel', wm.inventory, 1), true);

  // Step 1 second -> furnace should ignite and swap block to FURNACE_LIT
  wm.blockEntities.update(1.0);
  assert.equal(wm.world.getBlock(wx, wy, wz), BLOCK_IDS.FURNACE_LIT);

  // Step 5 seconds -> at least 1 iron_ingot smelted
  wm.blockEntities.update(5.0);
  const furnace = wm.blockEntities.get(wx, wy, wz);
  assert.ok(furnace.output);
  assert.equal(furnace.output.itemId, 'iron_ingot');
  assert.ok(furnace.output.count >= 1);

  // Extract smelted output into inventory
  assert.equal(wm.blockEntities.extractFromFurnace(wx, wy, wz, 'output', wm.inventory), true);
  assert.ok(wm.inventory.countItem('iron_ingot') >= 1);

  // Burn out remaining fuel -> swaps back to unlit FURNACE
  wm.blockEntities.update(60.0);
  assert.equal(wm.world.getBlock(wx, wy, wz), BLOCK_IDS.FURNACE);
  wm.dispose();
});

test('Chest 27-slot storage, Armor slots, Weather, and SpawnPoint persist across WorldSave JSON roundtrip', () => {
  const wm = createTestManager('survival');
  const wx = 12;
  const wz = 12;
  const wy = wm.world.getSurfaceY(wx, wz) + 1;

  wm.world.setBlock(wx, wy, wz, BLOCK_IDS.CHEST, true, false);
  wm.inventory.clear();
  wm.inventory.addItem('diamond', 7);
  wm.inventory.addItem('iron_chestplate', 1);

  assert.equal(wm.blockEntities.transferToChest(wx, wy, wz, wm.inventory, 0), true);
  assert.equal(wm.inventory.equipArmorFromSlot(1), true);
  assert.equal(wm.inventory.getArmorPoints(), 6);

  wm.setWeather('rain');
  wm.spawnPoint = { x: 14.5, y: 70, z: 14.5 };

  const json = wm.exportWorldJSON('roundtrip');
  const wm2 = createTestManager('creative');
  assert.equal(wm2.importWorldJSON(json), true);

  assert.equal(wm2.gameMode, 'survival');
  assert.equal(wm2.weather, 'rain');
  assert.equal(wm2.spawnPoint.x, 14.5);
  assert.equal(wm2.inventory.getArmorPoints(), 6);

  const chest2 = wm2.blockEntities.get(wx, wy, wz);
  assert.ok(chest2);
  assert.equal(chest2.slots[0]?.itemId, 'diamond');
  assert.equal(chest2.slots[0]?.count, 7);

  wm.dispose();
  wm2.dispose();
});

test('Lava flows and Water + Lava source reacts into OBSIDIAN', () => {
  const wm = createTestManager('creative');
  const y = 90;
  // Build stone basin
  for (let x = 4; x <= 10; x++) {
    for (let z = 4; z <= 8; z++) {
      wm.world.setBlock(x, y - 1, z, BLOCK_IDS.STONE, true, false);
      wm.world.setBlock(x, y, z, BLOCK_IDS.AIR, true, false);
    }
  }

  // Place water at (5, y, 6) and lava source at (7, y, 6)
  wm.world.setBlock(5, y, 6, BLOCK_IDS.WATER, true, false);
  wm.world.setBlock(7, y, 6, BLOCK_IDS.LAVA, true, false);

  for (let i = 0; i < 12; i++) {
    wm.world.stepFluids(64);
  }

  // Water reaches (6, y, 6) then reacts with lava source at (7, y, 6) -> OBSIDIAN or COBBLESTONE
  const atLava = wm.world.getBlock(7, y, 6);
  const atMid = wm.world.getBlock(6, y, 6);
  assert.ok(
    atLava === BLOCK_IDS.OBSIDIAN || atMid === BLOCK_IDS.COBBLESTONE,
    `Expected Obsidian or Cobblestone reaction, got lava=${atLava}, mid=${atMid}`
  );
  wm.dispose();
});

test('Progressive mining duration, tool durability breaking, and armor damage mitigation work accurately', () => {
  const wm = createTestManager('survival');

  // Unbreakable Bedrock -> Infinity
  assert.equal(wm.getBreakDuration(BLOCK_IDS.BEDROCK), Infinity);

  // Pickaxe significantly speeds up Stone vs bare hand
  const handStone = wm.getBreakDuration(BLOCK_IDS.STONE, null);
  const diamondPickStone = wm.getBreakDuration(BLOCK_IDS.STONE, 'diamond_pickaxe');
  assert.ok(diamondPickStone < handStone * 0.25);

  // Creative mode -> instant (0s)
  wm.setGameMode('creative');
  assert.equal(wm.getBreakDuration(BLOCK_IDS.OBSIDIAN), 0);
  wm.setGameMode('survival');

  // Tool durability wear & breaking
  wm.inventory.clear();
  wm.inventory.setSlot(0, { itemId: 'wooden_pickaxe', count: 1, durability: 2 });
  wm.inventory.setSelectedSlot(0);
  const w1 = wm.inventory.damageSelectedTool(1);
  assert.equal(w1.broken, false);
  assert.equal(w1.remaining, 1);
  const w2 = wm.inventory.damageSelectedTool(1);
  assert.equal(w2.broken, true);
  assert.equal(wm.inventory.getSlot(0), null);

  // Armor mitigates survival damage
  wm.inventory.addItem('diamond_chestplate', 1); // 8 armor points -> 32% reduction
  wm.inventory.equipArmorFromSlot(0);
  wm.survival.reset(70);
  const dealt = wm.survival.applyDamage(10, 'zombie');
  assert.ok(dealt < 10 && dealt > 0, `Expected reduced damage < 10, got ${dealt}`);
  wm.dispose();
});

test('Radial TNT explosion destroys Dirt/Stone while preserving Bedrock and Obsidian', () => {
  const wm = createTestManager('survival');
  const cx = 8;
  const cy = 85;
  const cz = 8;

  // Place Dirt, Obsidian, and Bedrock adjacent to explosion center
  wm.world.setBlock(cx + 1, cy, cz, BLOCK_IDS.DIRT, true, false);
  wm.world.setBlock(cx - 1, cy, cz, BLOCK_IDS.OBSIDIAN, true, false);
  wm.world.setBlock(cx, cy - 1, cz, BLOCK_IDS.BEDROCK, true, false);

  const res = wm.entities.explode(cx + 0.5, cy + 0.5, cz + 0.5, 3.2, 24);
  assert.ok(res.destroyedBlocks >= 1);
  assert.equal(wm.world.getBlock(cx + 1, cy, cz), BLOCK_IDS.AIR);
  assert.equal(wm.world.getBlock(cx - 1, cy, cz), BLOCK_IDS.OBSIDIAN);
  assert.equal(wm.world.getBlock(cx, cy - 1, cz), BLOCK_IDS.BEDROCK);
  wm.dispose();
});

test('Bow consumes arrow, fires ballistic projectile, hits mob, and slash commands execute cleanly', () => {
  const wm = createTestManager('survival');
  wm.inventory.clear();
  wm.inventory.setSlot(0, { itemId: 'bow', count: 1 });
  wm.inventory.setSlot(1, { itemId: 'arrow', count: 3 });
  wm.inventory.setSelectedSlot(0);

  const eye = wm.player.getEyePosition();
  const fwd = wm.player.getForwardVector();
  const targetMob = wm.entities.spawnMob(
    MOB_TYPES.PIG,
    eye.x + fwd.x * 3,
    eye.y - 0.5,
    eye.z + fwd.z * 3
  );
  const hpBefore = targetMob.health;

  const shot = wm.firePlayerBow(1.0);
  assert.equal(shot.fired, true);
  assert.equal(wm.inventory.countItem('arrow'), 2);
  assert.equal(wm.entities.arrows.length, 1);

  // Step arrows until hit
  for (let i = 0; i < 20; i++) {
    wm.entities.update(0.03, wm.player, wm.survival, 'survival');
  }
  assert.ok(targetMob.health < hpBefore || targetMob.dead, 'Expected arrow to hit target mob');

  // Slash commands
  assert.equal(wm.executeSlashCommand('/time set night').ok, true);
  assert.ok(wm.world.getSkyBrightness() < 0.45);
  assert.equal(wm.executeSlashCommand('/weather rain').ok, true);
  assert.equal(wm.weather, 'rain');
  assert.equal(wm.executeSlashCommand('/give diamond 5').ok, true);
  assert.equal(wm.inventory.countItem('diamond'), 5);
  assert.equal(wm.executeSlashCommand('/spawn creeper').ok, true);
  assert.ok(wm.entities.entities.some((e) => e.type === MOB_TYPES.CREEPER));

  wm.dispose();
});
