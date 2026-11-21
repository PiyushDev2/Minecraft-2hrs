import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EventBus, ENGINE_EVENTS } from '../../src/backend/index.js';

test('EventBus supports on, once, off, emit, listenerCount, and clear', () => {
  const bus = new EventBus();
  const received = [];

  const unsub = bus.on('ping', (val) => received.push(`on:${val}`));
  bus.once('ping', (val) => received.push(`once:${val}`));

  assert.equal(bus.listenerCount('ping'), 2);
  bus.emit('ping', 1);
  assert.deepEqual(received, ['on:1', 'once:1']);
  assert.equal(bus.listenerCount('ping'), 1);

  bus.emit('ping', 2);
  assert.deepEqual(received, ['on:1', 'once:1', 'on:2']);

  unsub();
  assert.equal(bus.listenerCount('ping'), 0);

  bus.on('a', () => {});
  bus.on('b', () => {});
  assert.equal(bus.listenerCount(), 2);
  bus.clear('a');
  assert.equal(bus.listenerCount(), 1);
  bus.clear();
  assert.equal(bus.listenerCount(), 0);
});

test('Engine executes fixed 20 TPS simulation ticks and clamps spiral-of-death deltas', () => {
  const bus = new EventBus();
  const engine = new Engine({ tickRate: 20, maxFrameDt: 0.1, maxTicksPerFrame: 5, bus });

  let ticks = 0;
  let frames = 0;
  engine.onTick((fixedDt) => {
    assert.equal(fixedDt, 0.05);
    ticks++;
  });
  engine.onFrame(() => {
    frames++;
  });

  // 0.025s -> 0 ticks, 0.5 alpha
  const r1 = engine.step(0.025);
  assert.equal(r1.ticksExecuted, 0);
  assert.ok(Math.abs(r1.alpha - 0.5) < 1e-6);

  // +0.025s -> 1 tick total
  const r2 = engine.step(0.025);
  assert.equal(r2.ticksExecuted, 1);
  assert.equal(ticks, 1);

  // Huge 5.0s lag spike -> clamped to 0.1s -> exactly 2 ticks (no runaway)
  const r3 = engine.step(5.0);
  assert.equal(r3.clampedDt, 0.1);
  assert.equal(r3.ticksExecuted, 2);
  assert.equal(ticks, 3);
  assert.equal(frames, 3);

  // Pause prevents advancement
  engine.pause();
  const r4 = engine.step(0.1);
  assert.equal(r4.ticksExecuted, 0);
  assert.equal(ticks, 3);

  engine.resume();
  engine.step(0.05);
  assert.equal(ticks, 4);

  let busTickSeen = false;
  bus.once(ENGINE_EVENTS.ENGINE_TICK, (payload) => {
    busTickSeen = payload.tickCount === 5;
  });
  engine.step(0.05);
  assert.equal(busTickSeen, true);

  engine.dispose();
});
