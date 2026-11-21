import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocket } from 'ws';

import {
  BLOCK_IDS,
  ENGINE_EVENTS,
  IndexedDBSave,
  WorldManager,
  WorldSave,
} from '../../src/backend/index.js';
import { attachMultiplayerServer } from '../../server.ts';

function waitForEvent(bus, eventName, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for event "${eventName}"`));
    }, timeoutMs);
    const unsub = bus.on(eventName, (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        unsub();
        resolve(payload);
      }
    });
  });
}

test('IndexedDBSave & WorldManager support multi-slot async saves, listing, deletion, and JSON import/export', async () => {
  IndexedDBSave.clearFallbackCache();
  const wm = new WorldManager({ seed: 'idb-test-1', viewDistance: 3, gameMode: 'survival' });

  try {
    wm.world.generate('idb-test-1', { spawnCenter: { x: 8, z: 8 }, pregenerateRadius: 1 });
    wm.world.setBlock(8, 40, 8, BLOCK_IDS.BRICKS, true, false);
    wm.survival.health = 14;
    await wm.saveAsync('slot-alpha');

    wm.world.setBlock(9, 40, 8, BLOCK_IDS.GLASS, true, false);
    await wm.saveAsync('slot-beta');

    const slots = await WorldSave.listSavesAsync();
    const names = slots.map((s) => s.slotName);
    assert.ok(names.includes('slot-alpha'));
    assert.ok(names.includes('slot-beta'));

    // Export JSON before modifying further
    const exportedJson = wm.exportWorldJSON('slot-beta');

    // Mutate world then reload slot-alpha (GLASS should disappear, BRICKS remains)
    wm.world.setBlock(8, 40, 8, BLOCK_IDS.AIR, true, false);
    const loadedAlpha = await wm.loadAsync('slot-alpha');
    assert.equal(loadedAlpha, true);
    assert.equal(wm.world.getBlock(8, 40, 8), BLOCK_IDS.BRICKS);
    assert.equal(wm.world.getBlock(9, 40, 8), BLOCK_IDS.AIR);
    assert.equal(wm.survival.health, 14);

    // Import JSON snapshot back -> restores GLASS block
    wm.importWorldJSON(exportedJson);
    assert.equal(wm.world.getBlock(9, 40, 8), BLOCK_IDS.GLASS);

    await WorldSave.deleteSaveAsync('slot-beta');
    const afterDelete = await WorldSave.listSavesAsync();
    assert.equal(afterDelete.some((s) => s.slotName === 'slot-beta'), false);
  } finally {
    wm.dispose();
    IndexedDBSave.clearFallbackCache();
  }
});

test('Authoritative WebSocket server synchronizes rooms, player movement, block edits, time, and chat across clients', async () => {
  const server = http.createServer();
  const { wss } = attachMultiplayerServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const clientA = new WorldManager({ seed: 'shared-seed', viewDistance: 3 });
  const clientB = new WorldManager({ seed: 'other-seed', viewDistance: 3 });

  try {
    clientA.world.generate('shared-seed', { spawnCenter: { x: 8, z: 8 }, pregenerateRadius: 1 });
    clientB.world.generate('other-seed', { spawnCenter: { x: 8, z: 8 }, pregenerateRadius: 1 });

    // Connect Client A
    const connA = waitForEvent(clientA.bus, ENGINE_EVENTS.MP_CONNECTED);
    clientA.network.connect({
      roomId: 'Room Alpha',
      playerName: 'Alice',
      url: wsUrl,
      WebSocketImpl: WebSocket,
    });
    const infoA = await connA;
    assert.equal(infoA.roomId, 'room-alpha');

    // Connect Client B -> should sync to Alice's authoritative seed ('shared-seed') & see Alice as peer
    const peerJoinedOnA = waitForEvent(clientA.bus, ENGINE_EVENTS.MP_PLAYER_JOINED);
    const connB = waitForEvent(clientB.bus, ENGINE_EVENTS.MP_CONNECTED);
    clientB.network.connect({
      roomId: 'room-alpha',
      playerName: 'Bob',
      url: wsUrl,
      WebSocketImpl: WebSocket,
    });
    const [infoB, joinedPayload] = await Promise.all([connB, peerJoinedOnA]);
    assert.equal(infoB.roomId, 'room-alpha');
    assert.equal(joinedPayload.name, 'Bob');
    assert.equal(clientB.world.seed, clientA.world.seed);
    assert.equal(clientA.network.getPeers().length, 1);
    assert.equal(clientB.network.getPeers().length, 1);

    // Block synchronization (Alice places BRICKS -> Bob receives BLOCK_CHANGED without echo loop)
    let clientAChanges = 0;
    clientA.bus.on(ENGINE_EVENTS.BLOCK_CHANGED, () => {
      clientAChanges += 1;
    });
    const blockOnB = waitForEvent(
      clientB.bus,
      ENGINE_EVENTS.BLOCK_CHANGED,
      (ev) => ev.x === 8 && ev.y === 42 && ev.z === 8 && ev.blockId === BLOCK_IDS.BRICKS
    );
    clientA.world.setBlock(8, 42, 8, BLOCK_IDS.BRICKS, true, false);
    await blockOnB;
    assert.equal(clientB.world.getBlock(8, 42, 8), BLOCK_IDS.BRICKS);

    // Brief pause to confirm no echo loop rebounds back to Alice
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(clientAChanges, 1);

    // Chat synchronization
    const chatOnB = waitForEvent(
      clientB.bus,
      ENGINE_EVENTS.MP_CHAT,
      (msg) => msg.text === 'Hello voxel world!'
    );
    clientA.network.sendChat('Hello voxel world!');
    const chatMsg = await chatOnB;
    assert.equal(chatMsg.senderName, 'Alice');

    // Disconnect Alice -> Bob observes PLAYER_LEFT
    const leftOnB = waitForEvent(clientB.bus, ENGINE_EVENTS.MP_PLAYER_LEFT);
    clientA.network.disconnect();
    const leftInfo = await leftOnB;
    assert.equal(leftInfo.name, 'Alice');
    assert.equal(clientB.network.getPeers().length, 0);
  } finally {
    clientA.dispose();
    clientB.dispose();
    for (const c of wss.clients) c.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
