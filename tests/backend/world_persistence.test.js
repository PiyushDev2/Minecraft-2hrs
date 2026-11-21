import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLOCK_IDS,
  ENGINE_EVENTS,
  WorldManager,
  WorldSave,
} from '../../src/backend/index.js';

function installMockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

test('WorldManager emits EventBus lifecycle events and syncs Three.js Scene cleanly', () => {
  installMockLocalStorage();
  const scene = new THREE.Scene();
  const manager = new WorldManager({ seed: 'phase-a-seed', viewDistance: 3, scene });

  const events = [];
  manager.bus.on(ENGINE_EVENTS.WORLD_GENERATED, (e) => events.push(['gen', e.seed]));
  manager.bus.on(ENGINE_EVENTS.BLOCK_CHANGED, (e) => events.push(['block', e.blockId]));
  manager.bus.on(ENGINE_EVENTS.WORLD_SAVED, (e) => events.push(['save', e.slotName]));
  manager.bus.on(ENGINE_EVENTS.WORLD_LOADED, (e) => events.push(['load', e.slotName]));

  const { world, player } = manager.initWorld('phase-a-seed', { x: 8, z: 8 });
  assert(scene.children.length > 0, 'Scene receives chunk groups');

  const y = world.getSurfaceY(8, 8) + 1;
  world.placeBlock(8, y, 8, BLOCK_IDS.OAK_LOG);
  manager.save('slot_a');

  // Verify localStorage overwrite + restore
  world.breakBlock(8, y, 8);
  assert.equal(world.getBlock(8, y, 8), BLOCK_IDS.AIR);

  const ok = manager.load('slot_a');
  assert.equal(ok, true);
  assert.equal(world.getBlock(8, y, 8), BLOCK_IDS.OAK_LOG);

  // Verify JSON export/import round-trip preserves player pose & seed
  player.setPosition(10.5, y + 3, 12.5);
  const rawJson = WorldSave.exportJSON(world, player, 'portable');
  const parsed = WorldSave.parseJSON(rawJson);
  assert.equal(parsed.player.position.x, 10.5);
  assert.equal(parsed.seed, world.seed);

  assert.equal(events[0][0], 'gen');
  assert.ok(events.some((e) => e[0] === 'block' && e[1] === BLOCK_IDS.OAK_LOG));
  assert.ok(events.some((e) => e[0] === 'save' && e[1] === 'slot_a'));
  assert.ok(events.some((e) => e[0] === 'load' && e[1] === 'slot_a'));

  manager.dispose();
  assert.equal(scene.children.length, 0, 'Dispose detaches all Three.js chunk groups');
});

test('Terrain generation is deterministic for identical seeds and varies across distinct seeds', () => {
  const m1 = new WorldManager({ seed: 'alpha-1', viewDistance: 2 });
  const m2 = new WorldManager({ seed: 'alpha-1', viewDistance: 2 });
  const m3 = new WorldManager({ seed: 'beta-999', viewDistance: 2 });

  m1.initWorld('alpha-1', { x: 0, z: 0 });
  m2.initWorld('alpha-1', { x: 0, z: 0 });
  m3.initWorld('beta-999', { x: 0, z: 0 });

  assert.equal(m1.world.getSurfaceY(4, 4), m2.world.getSurfaceY(4, 4));
  let diffFound = false;
  for (let x = -16; x <= 16; x += 4) {
    if (m1.world.getSurfaceY(x, x) !== m3.world.getSurfaceY(x, x)) {
      diffFound = true;
      break;
    }
  }
  assert.equal(diffFound, true, 'Different seeds must produce different terrain');

  m1.dispose();
  m2.dispose();
  m3.dispose();
});
