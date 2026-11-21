import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLOCK_IDS,
  ChunkManager,
  ChunkMesher,
  CraftingSystem,
  Inventory,
  ItemDropManager,
  MeshWorkerPool,
  TerrainGenerator,
  TextureAtlas,
  World,
  WorldManager,
  WorldSave,
  blockRegistry,
  itemRegistry,
} from '../../src/backend/index.js';

test('World.breakBlock immediately remeshes edited and border chunks without leaving stale visual geometry', () => {
  const world = new World({ seed: 'break-sync-test', viewDistance: 2, useWorkers: false });
  world.generate('break-sync-test', { pregenerateRadius: 1 });

  // Place two adjacent stone blocks straddling chunk boundary x=15 (chunk 0,0) and x=16 (chunk 1,0)
  const y = 70;
  world.setBlock(15, y, 8, BLOCK_IDS.STONE);
  world.setBlock(16, y, 8, BLOCK_IDS.STONE);

  const c0 = world.getChunk(0, 0);
  const c1 = world.getChunk(1, 0);
  assert.equal(c0.dirty, false, 'Edited chunk should remesh immediately');
  assert.equal(c1.dirty, false, 'Border chunk should remesh immediately');

  const prevC0Verts = c0.opaqueMesh.geometry.attributes.position.count;
  const prevC1IdxCount = c1.opaqueMesh.geometry.index.count;

  // Destroy block at x=15 -> c0 loses its block AND c1 exposes its West face at lx=0
  const res = world.breakBlock(15, y, 8);
  assert.equal(res.broken, true);
  assert.equal(world.getBlock(15, y, 8), BLOCK_IDS.AIR);
  assert.equal(c0.dirty, false, 'Chunk (0,0) must synchronously remesh on breakBlock');
  assert.equal(c1.dirty, false, 'Neighbor chunk (1,0) must synchronously remesh exposed border face');
  assert(
    c0.opaqueMesh.geometry.attributes.position.count < prevC0Verts,
    'Destroyed block geometry must be removed from c0 opaqueMesh immediately'
  );
  assert(
    c1.opaqueMesh.geometry.index.count > prevC1IdxCount,
    'Neighbor chunk (1,0) must add the newly exposed West face immediately'
  );

  world.dispose();
});

test('MeshWorkerPool falls back cleanly to synchronous remeshing if workers fail without deadlocking chunks', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const terrain = new TerrainGenerator('worker-error-fallback');
  terrain.generateChunk = (chunk) => {
    chunk.setBlock(4, 1, 4, BLOCK_IDS.STONE, false);
    chunk.generated = true;
    chunk.dirty = true;
  };

  let createdWorker = null;
  const pool = new MeshWorkerPool({
    blockRegistry,
    textureAtlas: atlas,
    poolSize: 1,
    workerFactory: () => {
      createdWorker = {
        onmessage: null,
        onerror: null,
        postMessage(msg) {
          if (msg.type === 'mesh') {
            // Simulate worker crash
            queueMicrotask(() => createdWorker.onerror?.(new Error('Simulated worker failure')));
          }
        },
        terminate() {},
      };
      return createdWorker;
    },
  });

  const cm = new ChunkManager({
    terrainGenerator: terrain,
    chunkMesher: mesher,
    workerPool: pool,
    viewDistance: 2,
  });

  const chunk = cm.loadChunk(0, 0, false);
  const dispatched = cm.remeshChunkAsync(chunk);
  assert.equal(dispatched, true);

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(pool.isReady(), false, 'Broken pool should disable itself after all slots fail');
      assert.equal(chunk.dirty, false, 'ChunkManager must synchronously remesh failed chunk immediately');
      assert(chunk.opaqueMesh, 'Fallback synchronous mesh must attach to chunk');

      cm.dispose();
      mesher.dispose();
      atlas.dispose();
      resolve();
    }, 20);
  });
});

test('Inventory handles stacking, merging, swapping, consumption, and creative vs survival modes', () => {
  const inv = new Inventory({ itemRegistry, creativeMode: false });
  inv.slots.fill(null);

  // Add 70 cobblestone -> fills slot 0 with 64 and slot 1 with 6
  const addRes = inv.addItem('cobblestone', 70);
  assert.deepEqual(addRes, { added: 70, remainder: 0 });
  assert.deepEqual(inv.getSlot(0), { itemId: 'cobblestone', count: 64 });
  assert.deepEqual(inv.getSlot(1), { itemId: 'cobblestone', count: 6 });
  assert.equal(inv.countOf('cobblestone'), 70);

  // Swap and merge
  inv.setSlot(5, { itemId: 'cobblestone', count: 10 });
  inv.moveOrSwap(1, 5);
  assert.deepEqual(inv.getSlot(5), { itemId: 'cobblestone', count: 16 });
  assert.equal(inv.getSlot(1), null);

  // Consume from selected slot in survival mode
  inv.setSelectedSlot(0);
  assert.equal(inv.consumeSelected(4), true);
  assert.equal(inv.getSlot(0)?.count, 60);

  // In creative mode, consumeSelected does not decrement
  inv.creativeMode = true;
  assert.equal(inv.consumeSelected(1), true);
  assert.equal(inv.getSlot(0)?.count, 60);

  // State round-trip
  const state = inv.exportState();
  const inv2 = new Inventory({ itemRegistry, creativeMode: true });
  inv2.importState(state);
  assert.equal(inv2.countOf('cobblestone'), 76);
});

test('CraftingSystem matches 2x2 and 3x3 shaped/shapeless recipes at arbitrary offsets', () => {
  const crafting = new CraftingSystem(undefined, itemRegistry);
  const inv = new Inventory({ itemRegistry, creativeMode: false });
  inv.slots.fill(null);
  inv.addItem('oak_log', 2);

  // 1. Shapeless 2x2 Oak Log -> 4 Oak Planks (placed in bottom-right cell)
  const grid2 = [null, null, null, 'oak_log'];
  const plankCraft = crafting.craftFromGrid(grid2, 2, inv);
  assert.equal(plankCraft.crafted, true);
  assert.deepEqual(plankCraft.result, { itemId: 'oak_planks', count: 4 });
  assert.equal(inv.countOf('oak_log'), 1);
  assert.equal(inv.countOf('oak_planks'), 4);

  // 2. Shaped 2x2 vertical sticks shifted to right column
  const stickGrid = [null, 'oak_planks', null, 'oak_planks'];
  const stickCraft = crafting.craftFromGrid(stickGrid, 2, inv);
  assert.equal(stickCraft.crafted, true);
  assert.deepEqual(stickCraft.result, { itemId: 'stick', count: 4 });
  assert.equal(inv.countOf('oak_planks'), 2);

  // 3. Craft missing recipe cleanly fails without consuming ingredients
  const failPick = crafting.craftById('iron_pickaxe', inv);
  assert.equal(failPick.crafted, false);
  assert.equal(inv.countOf('stick'), 4);

  // 4. 3x3 Stone Pickaxe
  inv.addItem('cobblestone', 3);
  const pickGrid = [
    'cobblestone', 'cobblestone', 'cobblestone',
    null, 'stick', null,
    null, 'stick', null,
  ];
  const stonePick = crafting.craftFromGrid(pickGrid, 3, inv);
  assert.equal(stonePick.crafted, true);
  assert.equal(inv.countOf('stone_pickaxe'), 1);
  assert.equal(inv.countOf('cobblestone'), 0);
  assert.equal(inv.countOf('stick'), 2);
});

test('WorldManager Survival mode drops blocks, picks them up into Inventory, and persists via WorldSave', () => {
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

  const scene = new THREE.Scene();
  const manager = new WorldManager({
    seed: 'survival-drops-seed',
    viewDistance: 2,
    gameMode: 'survival',
    scene,
  });
  manager.initWorld('survival-drops-seed', { x: 8, z: 8 });
  manager.inventory.slots.fill(null);

  const pos = manager.player.getPosition();
  const targetX = Math.floor(pos.x) + 1;
  const targetY = Math.floor(pos.y);
  const targetZ = Math.floor(pos.z);

  // Place stone next to player & break it in Survival mode -> spawns cobblestone drop
  manager.world.setBlock(targetX, targetY, targetZ, BLOCK_IDS.STONE);
  const breakRes = manager.interactBreakBlock(targetX, targetY, targetZ);
  assert.equal(breakRes.broken, true);
  assert.equal(manager.itemDrops.drops.length, 1);
  assert.equal(manager.itemDrops.drops[0].itemId, 'cobblestone');

  // Step frames until pickupDelay expires and magnetic attraction collects cobblestone
  for (let i = 0; i < 30; i++) {
    manager.update(0.05, {});
  }
  assert.equal(manager.itemDrops.drops.length, 0, 'Dropped cobblestone should be collected by player');
  assert.equal(manager.inventory.countOf('cobblestone'), 1);

  // Place cobblestone from hotbar slot 0 -> consumes 1 item in Survival mode
  manager.inventory.setSelectedSlot(0);
  const placed = manager.interactPlaceSelectedBlock(targetX, targetY, targetZ);
  assert.equal(placed, true);
  assert.equal(manager.world.getBlock(targetX, targetY, targetZ), BLOCK_IDS.COBBLESTONE);
  assert.equal(manager.inventory.countOf('cobblestone'), 0);

  // Add item, save, modify, and reload -> gameMode & inventory preserved
  manager.inventory.addItem('torch', 12);
  manager.save('surv_slot');
  manager.inventory.slots.fill(null);
  manager.setGameMode('creative');

  assert.equal(manager.load('surv_slot'), true);
  assert.equal(manager.gameMode, 'survival');
  assert.equal(manager.inventory.countOf('torch'), 12);

  manager.dispose();
});
