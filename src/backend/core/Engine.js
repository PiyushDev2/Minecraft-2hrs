/**
 * @file Engine.js
 * @description Fixed-timestep (20 TPS) simulation scheduler + per-frame update coordinator
 * with spiral-of-death clamping and EventBus telemetry.
 */

import { ENGINE_EVENTS, EventBus } from './EventBus.js';

/**
 * Coordinates fixed-rate simulation ticks (fluids, AI, survival) alongside
 * smooth variable-rate frame callbacks (player physics, chunk streaming).
 */
export class Engine {
  /**
   * @param {Object} [options]
   * @param {number} [options.tickRate=20] - Fixed simulation ticks per second.
   * @param {number} [options.maxFrameDt=0.1] - Maximum clamped frame deltaTime in seconds.
   * @param {number} [options.maxTicksPerFrame=5] - Guard against spiral-of-death catchup stalls.
   * @param {EventBus} [options.bus] - Shared EventBus instance.
   */
  constructor({
    tickRate = 20,
    maxFrameDt = 0.1,
    maxTicksPerFrame = 5,
    bus = new EventBus(),
  } = {}) {
    if (tickRate <= 0) {
      throw new Error(`Engine tickRate must be positive. Received: ${tickRate}`);
    }
    /** @type {number} */
    this.tickRate = tickRate;
    /** @type {number} */
    this.fixedDelta = 1 / tickRate;
    /** @type {number} */
    this.maxFrameDt = maxFrameDt;
    /** @type {number} */
    this.maxTicksPerFrame = maxTicksPerFrame;
    /** @type {EventBus} */
    this.bus = bus;

    /** @type {boolean} */
    this.paused = false;
    /** @type {number} */
    this.accumulator = 0;
    /** @type {number} */
    this.tickCount = 0;
    /** @type {number} */
    this.elapsedTime = 0;

    /** @type {Set<(fixedDt: number, tickCount: number) => void>} */
    this._tickHandlers = new Set();
    /** @type {Set<(dt: number, alpha: number) => void>} */
    this._frameHandlers = new Set();
  }

  /**
   * Registers a callback invoked on every fixed simulation tick (default 20 Hz).
   * @param {(fixedDt: number, tickCount: number) => void} handler
   * @returns {() => void}
   */
  onTick(handler) {
    this._tickHandlers.add(handler);
    return () => this._tickHandlers.delete(handler);
  }

  /**
   * Registers a callback invoked once per rendered frame.
   * @param {(dt: number, alpha: number) => void} handler
   * @returns {() => void}
   */
  onFrame(handler) {
    this._frameHandlers.add(handler);
    return () => this._frameHandlers.delete(handler);
  }

  /**
   * Pauses simulation stepping without discarding registered handlers.
   */
  pause() {
    this.paused = true;
  }

  /**
   * Resumes simulation stepping.
   */
  resume() {
    this.paused = false;
  }

  /**
   * Resets accumulator and counters (e.g. when loading a fresh world).
   */
  resetClock() {
    this.accumulator = 0;
    this.tickCount = 0;
    this.elapsedTime = 0;
  }

  /**
   * Advances simulation deterministically by elapsed frame deltaTime (seconds).
   * @param {number} deltaTime
   * @returns {{ ticksExecuted: number, alpha: number, clampedDt: number }}
   */
  step(deltaTime) {
    if (this.paused || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return {
        ticksExecuted: 0,
        alpha: this.accumulator / this.fixedDelta,
        clampedDt: 0,
      };
    }

    const clampedDt = Math.min(deltaTime, this.maxFrameDt);
    this.elapsedTime += clampedDt;
    this.accumulator += clampedDt;

    let ticksExecuted = 0;
    while (this.accumulator >= this.fixedDelta && ticksExecuted < this.maxTicksPerFrame) {
      this.accumulator -= this.fixedDelta;
      this.tickCount++;
      ticksExecuted++;

      for (const handler of this._tickHandlers) {
        handler(this.fixedDelta, this.tickCount);
      }
      this.bus.emit(ENGINE_EVENTS.ENGINE_TICK, {
        fixedDelta: this.fixedDelta,
        tickCount: this.tickCount,
      });
    }

    // Discard excess backlog if maxTicksPerFrame cap was hit
    if (this.accumulator >= this.fixedDelta) {
      this.accumulator %= this.fixedDelta;
    }

    const alpha = this.accumulator / this.fixedDelta;

    for (const handler of this._frameHandlers) {
      handler(clampedDt, alpha);
    }
    this.bus.emit(ENGINE_EVENTS.ENGINE_FRAME, { deltaTime: clampedDt, alpha });

    return { ticksExecuted, alpha, clampedDt };
  }

  /**
   * Returns current engine clock metrics.
   * @returns {{ tickRate: number, tickCount: number, elapsedTime: number, paused: boolean }}
   */
  getStats() {
    return {
      tickRate: this.tickRate,
      tickCount: this.tickCount,
      elapsedTime: this.elapsedTime,
      paused: this.paused,
    };
  }

  /**
   * Clears all tick and frame handlers.
   */
  dispose() {
    this._tickHandlers.clear();
    this._frameHandlers.clear();
  }
}
