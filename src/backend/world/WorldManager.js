/**
 * @file WorldManager.js
 * @description High-level engine coordinator connecting World, Player, WorldSave,
 * and optional Three.js Scene synchronization.
 */

import { Engine } from '../core/Engine.js';
import { ENGINE_EVENTS, EventBus } from '../core/EventBus.js';
import { EntityManager } from '../entities/EntityManager.js';
import { CraftingSystem } from '../inventory/CraftingSystem.js';
import { Inventory } from '../inventory/Inventory.js';
import { ItemDropManager } from '../inventory/ItemDropManager.js';
import { ITEM_CATEGORIES, itemRegistry as defaultItemRegistry } from '../inventory/ItemRegistry.js';
import { MultiplayerClient } from '../network/MultiplayerClient.js';
import { Player } from '../physics/Player.js';
import { WorldSave } from '../save/WorldSave.js';
import { SurvivalStats } from '../survival/SurvivalStats.js';
import { World } from './World.js';

/**
 * Coordinates the complete backend simulation loop (world streaming, player physics,
 * inventory/crafting/drops, fixed-tick simulation, Three.js scene mesh syncing, and save/load).
 */
export class WorldManager {
  /**
   * @param {Object} [options]
   * @param {number|string} [options.seed=1337]
   * @param {number} [options.viewDistance=5]
   * @param {'creative'|'survival'} [options.gameMode='creative']
   * @param {import('three').Scene|null} [options.scene=null] - Optional Three.js scene for automatic chunk mesh attachment.
   * @param {EventBus} [options.bus] - Optional shared EventBus instance.
   */
  constructor({
    seed = 1337,
    viewDistance = 5,
    gameMode = 'creative',
    scene = null,
    bus = new EventBus(),
  } = {}) {
    /** @type {EventBus} */
    this.bus = bus;
    /** @type {Engine} */
    this.engine = new Engine({ tickRate: 20, bus: this.bus });
    /** @type {World} */
    this.world = new World({ seed, viewDistance });
    /** @type {Player} */
    this.player = new Player(this.world);
    /** @type {import('../inventory/ItemRegistry.js').ItemRegistry} */
    this.itemRegistry = defaultItemRegistry;
    /** @type {'creative'|'survival'} */
    this.gameMode = gameMode === 'survival' ? 'survival' : 'creative';
    /** @type {Inventory} */
    this.inventory = new Inventory({
      itemRegistry: this.itemRegistry,
      creativeMode: this.gameMode === 'creative',
    });
    /** @type {CraftingSystem} */
    this.crafting = new CraftingSystem(undefined, this.itemRegistry);
    /** @type {ItemDropManager} */
    this.itemDrops = new ItemDropManager(this.world, this.itemRegistry, this.inventory);
    /** @type {SurvivalStats} */
    this.survival = new SurvivalStats();
    /** @type {EntityManager} */
    this.entities = new EntityManager(this.world, this.itemRegistry, this.itemDrops, this.bus);
    /** @type {MultiplayerClient} */
    this.network = new MultiplayerClient(this);
    /** @type {{ x: number, y: number, z: number }} */
    this.spawnPoint = { x: 8.5, y: 64, z: 8.5 };
    /** @type {boolean} */
    this._wasDead = false;
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
      }),
      this.inventory.onChange(() => {
        this.bus.emit(ENGINE_EVENTS.INVENTORY_CHANGED, this.inventory.exportState());
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
    this.itemDrops.attachScene(scene);
    this.entities.attachScene(scene);
    this.network.attachScene(scene);
  }

  /**
   * Detaches the Three.js Scene and removes chunk mesh listeners.
   */
  detachScene() {
    for (const unsub of this._sceneUnsubscribers) {
      unsub();
    }
    this._sceneUnsubscribers = [];
    this.itemDrops?.attachScene(null);
    this.entities?.attachScene(null);
    this.network?.attachScene(null);

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
    this.itemDrops.clear();
    this.entities.clear();
    this.world.generate(seed, {
      spawnCenter: spawnXZ,
      pregenerateRadius: Math.min(this.world.viewDistance, 3),
    });
    const surfaceY = this.world.getSurfaceY(spawnXZ.x, spawnXZ.z);
    this.spawnPoint = { x: spawnXZ.x + 0.5, y: surfaceY + 1.2, z: spawnXZ.z + 0.5 };
    this.player.setPosition(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
    this.player.setRotation(0, -0.18);
    this.survival.reset(this.spawnPoint.y);
    this._wasDead = false;
    this.entities.spawnStarterMobs(spawnXZ.x, spawnXZ.z, 4);

    this.bus.emit(ENGINE_EVENTS.WORLD_GENERATED, {
      seed: this.world.seed,
      spawn: this.player.getPosition(),
    });

    return { world: this.world, player: this.player };
  }

  /**
   * Switches between 'creative' (infinite placement) and 'survival' (drops + resource consumption).
   * @param {'creative'|'survival'} mode
   */
  setGameMode(mode) {
    const normalized = mode === 'survival' ? 'survival' : 'creative';
    this.gameMode = normalized;
    this.inventory.creativeMode = normalized === 'creative';
    if (normalized === 'survival' && this.player.flyMode) {
      this.player.setFlyMode(false);
    }
    if (normalized === 'creative' && this.survival.isDead) {
      this.survival.reset(this.player.getPosition().y);
      this._wasDead = false;
    }
    this.bus.emit(ENGINE_EVENTS.GAME_MODE_CHANGED, { gameMode: normalized });
  }

  /**
   * Primary left-click action: attacks an aimed mob within reach, or breaks the targeted block.
   * @returns {{ action: 'attack'|'break'|'none', killed?: boolean, mobType?: string, broken?: boolean, previousId?: number }}
   */
  interactPrimaryAction() {
    if (this.gameMode === 'survival' && this.survival.isDead) {
      return { action: 'none' };
    }
    const eye = this.player.getEyePosition();
    const forward = this.player.getForwardVector();
    const entityHit = this.entities.raycastEntity(eye, forward, 4.5);
    const blockHit = this.world.raycast(eye, forward, 6);

    const entityDist = entityHit.hit ? entityHit.distance : Infinity;
    const blockDist =
      blockHit.hit && blockHit.position
        ? Math.hypot(
            blockHit.position.x + 0.5 - eye.x,
            blockHit.position.y + 0.5 - eye.y,
            blockHit.position.z + 0.5 - eye.z
          )
        : Infinity;

    if (entityHit.hit && entityHit.entity && entityDist <= blockDist) {
      const selected = this.inventory.getSelectedStack();
      const heldDef = selected ? this.itemRegistry.get(selected.itemId) : null;
      const damage = heldDef?.attackDamage ?? 2;
      const res = this.entities.attackEntity(entityHit.entity, damage, this.player.getPosition());
      if (this.gameMode === 'survival') {
        this.survival.addExhaustion(0.15);
      }
      return {
        action: 'attack',
        killed: res.killed,
        mobType: entityHit.entity.type,
      };
    }

    if (blockHit.hit && blockHit.position) {
      const res = this.interactBreakBlock(
        blockHit.position.x,
        blockHit.position.y,
        blockHit.position.z
      );
      if (res.broken && this.gameMode === 'survival') {
        this.survival.addExhaustion(0.05);
      }
      return {
        action: 'break',
        broken: res.broken,
        previousId: res.previousId,
      };
    }

    return { action: 'none' };
  }

  /**
   * Eats the currently selected food item if hungry (or restores hunger).
   * @returns {{ consumed: boolean, itemId?: string, hunger?: number }}
   */
  consumeSelectedFood() {
    if (this.survival.isDead) return { consumed: false };
    const stack = this.inventory.getSelectedStack();
    if (!stack) return { consumed: false };
    const def = this.itemRegistry.get(stack.itemId);
    if (!def || def.category !== ITEM_CATEGORIES.FOOD) return { consumed: false };
    const ate = this.survival.eat(def.foodValue, def.saturationValue);
    if (!ate) return { consumed: false };
    if (this.gameMode === 'survival') {
      this.inventory.consumeSelected(1);
    }
    return { consumed: true, itemId: def.id, hunger: this.survival.hunger };
  }

  /**
   * Respawns a defeated player safely on terrain surface with full vitals.
   */
  respawnPlayer() {
    const sy = this.world.getSurfaceY(
      Math.floor(this.spawnPoint.x),
      Math.floor(this.spawnPoint.z)
    );
    const y = Math.max(this.spawnPoint.y, sy + 1.2);
    this.player.setPosition(this.spawnPoint.x, y, this.spawnPoint.z);
    this.survival.reset(y);
    this._wasDead = false;
    this.bus.emit(ENGINE_EVENTS.PLAYER_RESPAWNED, {
      position: this.player.getPosition(),
    });
  }

  /**
   * Breaks a block with immediate visual mesh update and Survival drop spawning.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @returns {{ broken: boolean, previousId: number }}
   */
  interactBreakBlock(wx, wy, wz) {
    const res = this.world.breakBlock(wx, wy, wz);
    if (res.broken && this.gameMode === 'survival') {
      const drops = this.itemRegistry.getDropsForBlock(res.previousId);
      for (let i = 0; i < drops.length; i++) {
        this.itemDrops.spawnDrop(
          Math.floor(wx) + 0.5,
          Math.floor(wy) + 0.45,
          Math.floor(wz) + 0.5,
          drops[i].itemId,
          drops[i].count
        );
      }
    }
    return res;
  }

  /**
   * Places the currently selected hotbar block (or an explicit blockId override) with
   * collision checks and Survival inventory consumption.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} [explicitBlockId]
   * @returns {boolean}
   */
  interactPlaceSelectedBlock(wx, wy, wz, explicitBlockId = undefined) {
    if (this.gameMode === 'survival' && this.survival.isDead) return false;
    let blockId = explicitBlockId;
    if (blockId === undefined) {
      const stack = this.inventory.getSelectedStack();
      if (!stack) return false;
      const def = this.itemRegistry.get(stack.itemId);
      if (!def || def.blockId === null) return false;
      blockId = def.blockId;
    }

    const placed = this.world.placeBlock(
      wx,
      wy,
      wz,
      blockId,
      (bx, by, bz) => this.player.wouldBlockCollide(bx, by, bz)
    );
    if (placed && explicitBlockId === undefined && this.gameMode === 'survival') {
      this.inventory.consumeSelected(1);
    }
    return placed;
  }

  /**
   * Advances physics, fixed-tick simulation, mobs, survival stats, item drops, and chunk streaming for one frame.
   * @param {number} deltaTime - Seconds since last frame.
   * @param {Object} [playerInput={}]
   */
  update(deltaTime, playerInput = {}) {
    if (!this.engine.paused) {
      const playerAlive = this.gameMode !== 'survival' || !this.survival.isDead;
      if (playerAlive) {
        this.player.update(deltaTime, playerInput);
      }
      this.world.update(this.player.getPosition(), deltaTime);

      const picked = this.itemDrops.update(deltaTime, this.player.getPosition());
      if (picked.length > 0) {
        this.bus.emit(ENGINE_EVENTS.ITEM_PICKED_UP, picked);
      }

      const survStep = this.survival.update(deltaTime, this.player, this.world, this.gameMode);
      if (survStep.damaged > 0) {
        this.bus.emit(ENGINE_EVENTS.PLAYER_DAMAGED, {
          amount: survStep.damaged,
          source: survStep.damageSource,
        });
      }

      this.entities.update(deltaTime, this.player, this.survival, this.gameMode);

      if (this.survival.isDead && !this._wasDead) {
        this._wasDead = true;
        this.bus.emit(ENGINE_EVENTS.PLAYER_DIED, {
          source: this.survival.lastDamageSource,
        });
      }
    }
    this.network.update(deltaTime);
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
   * Saves current world, inventory, and player state to localStorage.
   * @param {string} [slotName='default']
   */
  save(slotName = 'default') {
    const saved = WorldSave.saveToStorage(this.world, this.player, slotName, {
      gameMode: this.gameMode,
      inventory: this.inventory.exportState(),
      survival: this.survival.exportState(),
    });
    this.bus.emit(ENGINE_EVENTS.WORLD_SAVED, {
      slotName,
      seed: saved.seed,
      totalModifiedBlocks: saved.totalModifiedBlocks,
    });
    return saved;
  }

  /**
   * Loads saved world, inventory, survival vitals, and player state from localStorage.
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
    this.itemDrops.clear();
    this.entities.clear();
    WorldSave.apply(this.world, this.player, saveData);
    if (saveData.inventory) {
      this.inventory.importState(saveData.inventory);
    }
    if (saveData.survival) {
      this.survival.importState(saveData.survival, this.player.getPosition().y);
      this._wasDead = this.survival.isDead;
    } else {
      this.survival.reset(this.player.getPosition().y);
      this._wasDead = false;
    }
    if (saveData.gameMode === 'survival' || saveData.gameMode === 'creative') {
      this.setGameMode(saveData.gameMode);
    }
    this.bus.emit(ENGINE_EVENTS.WORLD_LOADED, {
      slotName,
      seed: this.world.seed,
      totalModifiedBlocks: saveData.totalModifiedBlocks ?? 0,
    });
    return true;
  }

  /**
   * Saves world state asynchronously into IndexedDB (supports large worlds & multiple named slots).
   * @param {string} [slotName='default']
   */
  async saveAsync(slotName = 'default') {
    const meta = await WorldSave.saveAsync(this.world, this.player, slotName, {
      gameMode: this.gameMode,
      inventory: this.inventory.exportState(),
      survival: this.survival.exportState(),
    });
    this.bus.emit(ENGINE_EVENTS.WORLD_SAVED, {
      slotName: meta.slotName,
      seed: meta.seed,
      totalModifiedBlocks: meta.totalModifiedBlocks,
    });
    return meta;
  }

  /**
   * Loads world state asynchronously from IndexedDB (with localStorage fallback).
   * @param {string} [slotName='default']
   * @returns {Promise<boolean>}
   */
  async loadAsync(slotName = 'default') {
    const saveData = await WorldSave.loadAsync(slotName);
    if (!saveData) return false;
    return this.applySaveData(saveData, slotName);
  }

  /**
   * Applies a parsed save data object directly onto the live engine.
   * @param {any} saveData
   * @param {string} [slotName='default']
   * @returns {boolean}
   */
  applySaveData(saveData, slotName = 'default') {
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.engine.resetClock();
    this.itemDrops.clear();
    this.entities.clear();
    WorldSave.apply(this.world, this.player, saveData);
    if (saveData.inventory) {
      this.inventory.importState(saveData.inventory);
    }
    if (saveData.survival) {
      this.survival.importState(saveData.survival, this.player.getPosition().y);
      this._wasDead = this.survival.isDead;
    } else {
      this.survival.reset(this.player.getPosition().y);
      this._wasDead = false;
    }
    if (saveData.gameMode === 'survival' || saveData.gameMode === 'creative') {
      this.setGameMode(saveData.gameMode);
    }
    this.bus.emit(ENGINE_EVENTS.WORLD_LOADED, {
      slotName,
      seed: this.world.seed,
      totalModifiedBlocks: saveData.totalModifiedBlocks ?? 0,
    });
    return true;
  }

  /**
   * Exports current world, player, inventory, and survival state as a portable JSON string.
   * @param {string} [slotName='default']
   * @returns {string}
   */
  exportWorldJSON(slotName = 'default') {
    return WorldSave.exportJSON(this.world, this.player, slotName, {
      gameMode: this.gameMode,
      inventory: this.inventory.exportState(),
      survival: this.survival.exportState(),
    });
  }

  /**
   * Imports and applies a JSON-exported world string onto the live engine.
   * @param {string} jsonString
   * @returns {boolean}
   */
  importWorldJSON(jsonString) {
    const parsed = WorldSave.parseJSON(jsonString);
    return this.applySaveData(parsed, parsed.name || 'imported');
  }

  /**
   * Cleans up all resources, engine handlers, network socket, and scene listeners.
   */
  dispose() {
    for (const unsub of this._worldUnsubscribers) {
      unsub();
    }
    this._worldUnsubscribers = [];
    this.network?.dispose();
    this.itemDrops?.dispose();
    this.entities?.dispose();
    this.detachScene();
    this.engine.dispose();
    this.world.dispose();
    this.bus.clear();
  }
}
