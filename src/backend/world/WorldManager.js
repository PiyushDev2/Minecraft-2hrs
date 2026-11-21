/**
 * @file WorldManager.js
 * @description High-level engine coordinator connecting World, Player, WorldSave,
 * and optional Three.js Scene synchronization.
 */

import { Engine } from '../core/Engine.js';
import { ENGINE_EVENTS, EventBus } from '../core/EventBus.js';
import { Player } from '../physics/Player.js';
import { WorldSave } from '../save/WorldSave.js';
import { World } from './World.js';

/**
 * Coordinates the complete backend simulation loop (world streaming, player physics,
 * fixed-tick simulation, Three.js scene mesh syncing, and save/load lifecycle).
 */
export class WorldManager {
  /**
   * @param {Object} [options]
   * @param {number|string} [options.seed=1337]
   * @param {number} [options.viewDistance=5]
   * @param {import('three').Scene|null} [options.scene=null] - Optional Three.js scene for automatic chunk mesh attachment.
   * @param {EventBus} [options.bus] - Optional shared EventBus instance.
   */
  constructor({ seed = 1337, viewDistance = 5, scene = null, bus = new EventBus() } = {}) {
    /** @type {EventBus} */
    this.bus = bus;
    /** @type {Engine} */
    this.engine = new Engine({ tickRate: 20, bus: this.bus });
    /** @type {World} */
    this.world = new World({ seed, viewDistance });
    /** @type {Player} */
    this.player = new Player(this.world);
    /** @type {import('three').Scene|null} */
    this.scene = null;

    /** @type {Array<() => void>} */
    this._sceneUnsubscribers = [];
    /** @type {Array<() => void>} */
    this._worldUnsubscribers = [];

    this._bindWorldEvents();

    if (scene) {
      this.attachScene(scene);
    }
  }

  /**
   * Forwards core World & ChunkManager lifecycle hooks onto the EventBus.
   * @private
   */
  _bindWorldEvents() {
    this._worldUnsubscribers.push(
      this.world.onBlockChanged((ev) => {
        this.bus.emit(ENGINE_EVENTS.BLOCK_CHANGED, ev);
      }),
      this.world.onChunkMeshReady((chunk) => {
        this.bus.emit(ENGINE_EVENTS.CHUNK_READY, chunk);
      }),
      this.world.onChunkUnloaded((chunk) => {
        this.bus.emit(ENGINE_EVENTS.CHUNK_UNLOADED, chunk);
      })
    );
  }

  /**
   * Attaches a Three.js Scene so generated/rebuilt chunk meshes are automatically
   * added and unloaded chunk meshes are automatically removed.
   * @param {import('three').Scene} scene
   */
  attachScene(scene) {
    this.detachScene();
    this.scene = scene;

    // Attach any chunks already loaded
    for (const meshGroup of this.world.getLoadedChunkMeshes()) {
      if (meshGroup.parent !== scene) {
        scene.add(meshGroup);
      }
    }

    const unsubReady = this.world.onChunkMeshReady((chunk) => {
      if (this.scene && chunk.meshGroup && chunk.meshGroup.parent !== this.scene) {
        this.scene.add(chunk.meshGroup);
      }
    });

    const unsubUnload = this.world.onChunkUnloaded((chunk) => {
      if (this.scene && chunk.meshGroup) {
        this.scene.remove(chunk.meshGroup);
      }
    });

    this._sceneUnsubscribers.push(unsubReady, unsubUnload);
  }

  /**
   * Detaches the Three.js Scene and removes chunk mesh listeners.
   */
  detachScene() {
    for (const unsub of this._sceneUnsubscribers) {
      unsub();
    }
    this._sceneUnsubscribers = [];

    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
      this.scene = null;
    }
  }

  /**
   * Initializes a new world with the given seed and spawns the player safely on terrain surface.
   * @param {number|string} [seed=this.world.seed]
   * @param {{ x: number, z: number }} [spawnXZ={ x: 8, z: 8 }]
   * @returns {{ world: World, player: Player }}
   */
  initWorld(seed = this.world.seed, spawnXZ = { x: 8, z: 8 }) {
    // Clear existing scene chunk meshes cleanly
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.engine.resetClock();
    this.world.generate(seed, { spawnCenter: spawnXZ, pregenerateRadius: 2 });
    const surfaceY = this.world.getSurfaceY(spawnXZ.x, spawnXZ.z);
    this.player.setPosition(spawnXZ.x + 0.5, surfaceY + 1.2, spawnXZ.z + 0.5);
    this.player.setRotation(0, -0.18);

    this.bus.emit(ENGINE_EVENTS.WORLD_GENERATED, {
      seed: this.world.seed,
      spawn: this.player.getPosition(),
    });

    return { world: this.world, player: this.player };
  }

  /**
   * Advances physics, fixed-tick simulation, and chunk streaming for one frame.
   * @param {number} deltaTime - Seconds since last frame.
   * @param {Object} [playerInput={}]
   */
  update(deltaTime, playerInput = {}) {
    if (!this.engine.paused) {
      this.player.update(deltaTime, playerInput);
      this.world.update(this.player.getPosition(), deltaTime);
    }
    this.engine.step(deltaTime);
  }

  /**
   * Sets normalized time of day [0..1) and emits TIME_UPDATED.
   * @param {number} timeOfDay
   * @returns {number}
   */
  setTimeOfDay(timeOfDay) {
    const normalized = this.world.setTimeOfDay(timeOfDay);
    this.bus.emit(ENGINE_EVENTS.TIME_UPDATED, {
      timeOfDay: normalized,
      skyBrightness: this.world.getSkyBrightness(),
    });
    return normalized;
  }

  /**
   * Saves current world and player state to localStorage.
   * @param {string} [slotName='default']
   */
  save(slotName = 'default') {
    const saved = WorldSave.saveToStorage(this.world, this.player, slotName);
    this.bus.emit(ENGINE_EVENTS.WORLD_SAVED, {
      slotName,
      seed: saved.seed,
      totalModifiedBlocks: saved.totalModifiedBlocks,
    });
    return saved;
  }

  /**
   * Loads saved world and player state from localStorage.
   * @param {string} [slotName='default']
   * @returns {boolean} True if save existed and was restored.
   */
  load(slotName = 'default') {
    const saveData = WorldSave.loadFromStorage(slotName);
    if (!saveData) return false;

    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.engine.resetClock();
    WorldSave.apply(this.world, this.player, saveData);
    this.bus.emit(ENGINE_EVENTS.WORLD_LOADED, {
      slotName,
      seed: this.world.seed,
      totalModifiedBlocks: saveData.totalModifiedBlocks ?? 0,
    });
    return true;
  }

  /**
   * Cleans up all resources, engine handlers, and scene listeners.
   */
  dispose() {
    for (const unsub of this._worldUnsubscribers) {
      unsub();
    }
    this._worldUnsubscribers = [];
    this.detachScene();
    this.engine.dispose();
    this.world.dispose();
    this.bus.clear();
  }
}
