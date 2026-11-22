/**
 * @file WorldManager.js
 * @description High-level engine coordinator connecting World, Player, BlockEntities (Furnace/Chest),
 * Weather, Crop growth, Progressive Mining, Tool Durability, Armor, Bows/TNT/Doors/Beds,
 * Slash Commands, WorldSave, and Three.js Scene synchronization.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { Engine } from '../core/Engine.js';
import { ENGINE_EVENTS, EventBus } from '../core/EventBus.js';
import { EntityManager } from '../entities/EntityManager.js';
import { MOB_TYPES } from '../entities/MobTypes.js';
import { CraftingSystem } from '../inventory/CraftingSystem.js';
import { Inventory } from '../inventory/Inventory.js';
import { ItemDropManager } from '../inventory/ItemDropManager.js';
import { ITEM_CATEGORIES, itemRegistry as defaultItemRegistry } from '../inventory/ItemRegistry.js';
import { AdvancementsManager } from '../mechanics/AdvancementsManager.js';
import {
  POTION_EFFECTS,
  VILLAGER_TRADES,
  countNearbyBookshelves,
  executeVillagerTrade,
  getEnchantOptions,
  previewAnvil,
} from '../mechanics/MagicSystem.js';
import { RedstoneEngine } from '../mechanics/RedstoneEngine.js';
import { MultiplayerClient } from '../network/MultiplayerClient.js';
import { Player } from '../physics/Player.js';
import { WorldSave } from '../save/WorldSave.js';
import { SurvivalStats } from '../survival/SurvivalStats.js';
import { getStrongholdCoords } from '../terrain/TerrainGenerator.js';
import { BlockEntityManager } from './BlockEntityManager.js';
import { World } from './World.js';

/**
 * Coordinates the complete backend simulation loop (world streaming, player physics,
 * inventory/crafting/drops, block entities, weather, crops, combat, save/load).
 */
export class WorldManager {
  /**
   * @param {Object} [options]
   * @param {number|string} [options.seed=1337]
   * @param {number} [options.viewDistance=5]
   * @param {'creative'|'survival'} [options.gameMode='creative']
   * @param {import('three').Scene|null} [options.scene=null]
   * @param {EventBus} [options.bus]
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
    /** @type {BlockEntityManager} */
    this.blockEntities = new BlockEntityManager(this.world, this.itemRegistry);
    this.blockEntities.onPotionBrewed = (pos, itemId) => {
      this.bus.emit(ENGINE_EVENTS.POTION_BREWED, { pos, itemId });
    };
    /** @type {{ overworld: any, nether: any, end: any }} */
    this._dimensionBlockEntities = { overworld: null, nether: null, end: null };
    /** @type {SurvivalStats} */
    this.survival = new SurvivalStats();
    this.survival.getArmorPoints = () => this.inventory.getArmorPoints();
    this.survival.getProtectionBonus = () => this.inventory.getProtectionBonus();
    this.survival.onArmorAbsorb = (amt) => this.inventory.damageArmor(amt);
    this.survival.onShieldBlock = (source, blocked) => {
      if (this.gameMode === 'survival') this.inventory.damageShield(1);
      this.bus.emit(ENGINE_EVENTS.SHIELD_BLOCKED, { source, blocked });
    };

    /** @type {EntityManager} */
    this.entities = new EntityManager(this.world, this.itemRegistry, this.itemDrops, this.bus);
    this.entities.onBlockDestroyedByExplosion = (wx, wy, wz) =>
      this.blockEntities.removeAndCollectDrops(wx, wy, wz);
    this.entities.onDragonDefeated = () => this._onDragonDefeated();

    /** @type {RedstoneEngine} */
    this.redstone = new RedstoneEngine({
      world: this.world,
      eventBus: this.bus,
      onIgniteTnt: (x, y, z) => this.entities.igniteTnt(x, y, z),
    });

    /** @type {AdvancementsManager} */
    this.advancements = new AdvancementsManager({
      eventBus: this.bus,
      onGrantXp: (xp) => this.awardXp(xp),
    });

    /** @type {MultiplayerClient} */
    this.network = new MultiplayerClient(this);
    /** @type {{ x: number, y: number, z: number }} */
    this.spawnPoint = { x: 8.5, y: 64, z: 8.5 };
    /** @type {'clear'|'rain'|'thunder'} */
    this.weather = 'clear';
    /** @type {number} */
    this._weatherTimer = 210;
    /** @type {number} */
    this._cropTickAccumulator = 0;
    /** @type {number} */
    this._endPortalCooldown = 0;
    /** @type {boolean} */
    this._wasDead = false;
    /** @type {import('three').Scene|null} */
    this.scene = null;

    /** @type {Array<() => void>} */
    this._sceneUnsubscribers = [];
    /** @type {Array<() => void>} */
    this._worldUnsubscribers = [];

    this.world.setStructureChestCallback((wx, wy, wz, kind) => {
      this._populateStructureChest(wx, wy, wz, kind);
    });
    this._bindWorldEvents();

    if (scene) {
      this.attachScene(scene);
    }
  }

  /** @private */
  _bindWorldEvents() {
    this._worldUnsubscribers.push(
      this.world.onBlockChanged((ev) => {
        this.redstone.onBlockChanged(ev.x, ev.y, ev.z, ev.blockId);
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

  attachScene(scene) {
    this.detachScene();
    this.scene = scene;

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
   */
  initWorld(seed = this.world.seed, spawnXZ = { x: 8, z: 8 }) {
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.engine.resetClock();
    this.itemDrops.clear();
    this.entities.clear();
    this.entities.dragonDefeated = false;
    this.blockEntities.clear();
    this.redstone.clear();
    this.advancements.reset();
    this._dimensionBlockEntities = { overworld: null, nether: null, end: null };
    this.weather = 'clear';
    this._weatherTimer = 210;

    this.world.generate(seed, {
      spawnCenter: spawnXZ,
      pregenerateRadius: Math.min(this.world.viewDistance, 3),
      dimension: 'overworld',
    });
    const surfaceY = this.world.getSurfaceY(spawnXZ.x, spawnXZ.z);
    this.spawnPoint = { x: spawnXZ.x + 0.5, y: surfaceY + 1.2, z: spawnXZ.z + 0.5 };
    this.player.setPosition(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
    this.player.setRotation(0, -0.18);
    this.survival.reset(this.spawnPoint.y);
    this._wasDead = false;
    this.entities.spawnStarterMobs(spawnXZ.x, spawnXZ.z, 5);

    this.bus.emit(ENGINE_EVENTS.WORLD_GENERATED, {
      seed: this.world.seed,
      spawn: this.player.getPosition(),
      dimension: this.world.dimension,
    });

    return { world: this.world, player: this.player };
  }

  /**
   * Populates a newly generated cottage, mossy dungeon, or Nether ruin chest with deterministic loot.
   * @private
   */
  _populateStructureChest(wx, wy, wz, kind) {
    if (this.blockEntities.getChest(wx, wy, wz)) return;
    const chest = this.blockEntities.getOrCreateChest(wx, wy, wz);
    const seed = Math.abs((wx * 73856093) ^ (wy * 19349663) ^ (wz * 83492791)) >>> 0;
    let rng = seed || 1;
    const nextRand = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 4294967296;
    };

    const pools = {
      cottage: [
        { itemId: 'bread', min: 2, max: 5 },
        { itemId: 'apple', min: 2, max: 4 },
        { itemId: 'oak_log', min: 4, max: 10 },
        { itemId: 'coal', min: 3, max: 8 },
        { itemId: 'iron_ingot', min: 1, max: 3 },
        { itemId: 'torch', min: 4, max: 10 },
        { itemId: 'wheat_seeds', min: 2, max: 6 },
      ],
      dungeon: [
        { itemId: 'iron_ingot', min: 2, max: 6 },
        { itemId: 'gold_ingot', min: 2, max: 5 },
        { itemId: 'diamond', min: 1, max: 2 },
        { itemId: 'bread', min: 2, max: 5 },
        { itemId: 'arrow', min: 6, max: 14 },
        { itemId: 'obsidian', min: 2, max: 5 },
        { itemId: 'flint_and_steel', min: 1, max: 1 },
        { itemId: 'gunpowder', min: 2, max: 6 },
      ],
      nether_ruin: [
        { itemId: 'gold_ingot', min: 3, max: 8 },
        { itemId: 'diamond', min: 1, max: 3 },
        { itemId: 'obsidian', min: 3, max: 6 },
        { itemId: 'quartz', min: 4, max: 10 },
        { itemId: 'ender_pearl', min: 1, max: 2 },
        { itemId: 'blaze_rod', min: 1, max: 3 },
        { itemId: 'nether_wart', min: 2, max: 6 },
        { itemId: 'flint_and_steel', min: 1, max: 1 },
      ],
      stronghold: [
        { itemId: 'diamond', min: 2, max: 4 },
        { itemId: 'emerald', min: 2, max: 6 },
        { itemId: 'ender_pearl', min: 2, max: 4 },
        { itemId: 'lapis_lazuli', min: 4, max: 10 },
        { itemId: 'iron_ingot', min: 4, max: 9 },
        { itemId: 'book', min: 2, max: 5 },
        { itemId: 'bread', min: 3, max: 6 },
      ],
    };

    const table = pools[kind] || pools.dungeon;
    const itemCount = 3 + Math.floor(nextRand() * 4);
    for (let i = 0; i < itemCount; i++) {
      const entry = table[Math.floor(nextRand() * table.length)];
      const count = entry.min + Math.floor(nextRand() * (entry.max - entry.min + 1));
      const slotIdx = Math.floor(nextRand() * chest.slots.length);
      if (!chest.slots[slotIdx]) {
        const def = this.itemRegistry.get(entry.itemId);
        chest.slots[slotIdx] = {
          itemId: entry.itemId,
          count,
          ...(def?.maxDurability ? { durability: def.maxDurability, maxDurability: def.maxDurability } : {}),
        };
      }
    }
  }

  /**
   * Awards XP to the player and emits XP_CHANGED.
   * @param {number} amount
   */
  awardXp(amount) {
    const res = this.survival.addXp(amount);
    this.bus.emit(ENGINE_EVENTS.XP_CHANGED, res);
    return res;
  }

  /**
   * Switches between Overworld, Nether (1:8 scale), and The End, preserving all dimensions'
   * block edits & containers, ensuring safe portals/platforms, and spawning the Ender Dragon in The End.
   * @param {'overworld'|'nether'|'end'} targetDim
   */
  switchDimension(targetDim) {
    const nextDim =
      targetDim === 'end' ? 'end' : targetDim === 'nether' ? 'nether' : 'overworld';
    if (nextDim === this.world.dimension) {
      return { switched: false, dimension: this.world.dimension };
    }

    const fromDim = this.world.dimension;
    const curPos = this.player.getPosition();
    let destX = Math.floor(curPos.x);
    let destZ = Math.floor(curPos.z);

    if (nextDim === 'end') {
      destX = 12;
      destZ = 0;
    } else if (fromDim === 'end' && nextDim === 'overworld') {
      destX = Math.floor(this.spawnPoint.x);
      destZ = Math.floor(this.spawnPoint.z);
    } else {
      const scale = nextDim === 'nether' ? 1 / 8 : 8;
      destX = Math.floor(curPos.x * scale);
      destZ = Math.floor(curPos.z * scale);
    }

    // Archive current dimension block entities & remove scene meshes
    this._dimensionBlockEntities[fromDim] = this.blockEntities.exportState();
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.itemDrops.clear();
    this.entities.clear();
    this.blockEntities.clear();
    this.redstone.clear();

    this.world.setDimension(nextDim, { x: destX, z: destZ }, Math.min(this.world.viewDistance, 2));

    const restoredBE = this._dimensionBlockEntities[nextDim];
    if (restoredBE) {
      this.blockEntities.importState(restoredBE);
    }

    // Attach newly generated chunks to scene
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        if (meshGroup.parent !== this.scene) {
          this.scene.add(meshGroup);
        }
      }
    }

    this._endPortalCooldown = 3.0;
    if (nextDim === 'end') {
      this.player.setPosition(12.5, 61.2, 0.5);
      this.player.setRotation(Math.PI * 0.5, -0.05);
      this.entities.ensureEndDragon();
      if (this.entities.dragonDefeated) {
        this._activateEndExitPortal();
      }
    } else if (fromDim === 'end' && nextDim === 'overworld') {
      const sy = this.world.getSurfaceY(destX, destZ);
      this.player.setPosition(destX + 0.5, Math.max(this.spawnPoint.y, sy + 1.2), destZ + 0.5);
    } else {
      // Build or ensure a safe obsidian return portal & dry landing platform
      const portalBaseY = this._ensureReturnPortal(destX, destZ);
      this.player.setPosition(destX + 0.5, portalBaseY + 1.15, destZ + 2.2);
    }

    this.player.velocity.x = 0;
    this.player.velocity.y = 0;
    this.player.velocity.z = 0;

    this.bus.emit(ENGINE_EVENTS.DIMENSION_CHANGED, {
      from: fromDim,
      dimension: nextDim,
      position: this.player.getPosition(),
    });
    return { switched: true, dimension: nextDim };
  }

  /**
   * Called when the Ender Dragon is defeated: awards 120 XP, places Dragon Egg, and opens Exit Portal.
   * @private
   */
  _onDragonDefeated() {
    this.awardXp(120);
    this._activateEndExitPortal();
  }

  /** @private */
  _activateEndExitPortal() {
    if (this.world.dimension !== 'end') return;
    // Place Dragon Egg atop central fountain pillar (0, 60, 0)
    this.world.setBlock(0, 60, 0, BLOCK_IDS.DRAGON_EGG, true, false);
    // Fill 3x3 ring around pillar at y = 56 with shimmering END_PORTAL blocks
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        this.world.setBlock(dx, 56, dz, BLOCK_IDS.END_PORTAL, true, false);
      }
    }
    this.world.chunkManager.remeshNeighborhoodForBlock(0, 0, 56);
    this.world.chunkManager.remeshNeighborhoodForBlock(0, 0, 60);
  }

  /**
   * Checks whether placing an Eye of Ender in a Stronghold End Portal Frame completes all 12 frames.
   * @private
   */
  _tryActivateEndPortal(fx, fy, fz) {
    for (let cx = fx - 2; cx <= fx + 2; cx++) {
      for (let cz = fz - 2; cz <= fz + 2; cz++) {
        let filledCount = 0;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const onEdge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
            if (!onEdge || isCorner) continue;
            if (this.world.getBlock(cx + dx, fy, cz + dz) === BLOCK_IDS.END_PORTAL_FRAME_FILLED) {
              filledCount++;
            }
          }
        }
        if (filledCount === 12) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              this.world.setBlock(cx + dx, fy, cz + dz, BLOCK_IDS.END_PORTAL, true, false);
            }
          }
          this.world.chunkManager.remeshNeighborhoodForBlock(cx, cz, fy);
          this.bus.emit(ENGINE_EVENTS.PORTAL_LIT, { x: cx, y: fy, z: cz, portalType: 'end' });
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Ensures a safe 4x5 lit Nether Portal + solid obsidian platform exists at (cx, cz).
   * @private
   */
  _ensureReturnPortal(cx, cz) {
    let baseY = this.world.getSurfaceY(cx, cz);
    if (this.world.dimension === 'nether') {
      baseY = Math.max(28, Math.min(62, baseY));
    } else {
      baseY = Math.max(33, Math.min(80, baseY));
    }

    // Build 5x5 obsidian platform & clear 5 blocks headroom
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 3; dz++) {
        this.world.setBlock(cx + dx, baseY, cz + dz, BLOCK_IDS.OBSIDIAN, true, false);
        for (let dy = 1; dy <= 5; dy++) {
          this.world.setBlock(cx + dx, baseY + dy, cz + dz, BLOCK_IDS.AIR, true, false);
        }
      }
    }

    // Stamp 4x5 Obsidian frame centered along X at z = cz
    for (let dx = -1; dx <= 2; dx++) {
      this.world.setBlock(cx + dx, baseY, cz, BLOCK_IDS.OBSIDIAN, true, false);
      this.world.setBlock(cx + dx, baseY + 4, cz, BLOCK_IDS.OBSIDIAN, true, false);
    }
    for (let dy = 1; dy <= 3; dy++) {
      this.world.setBlock(cx - 1, baseY + dy, cz, BLOCK_IDS.OBSIDIAN, true, false);
      this.world.setBlock(cx + 2, baseY + dy, cz, BLOCK_IDS.OBSIDIAN, true, false);
      this.world.setBlock(cx, baseY + dy, cz, BLOCK_IDS.NETHER_PORTAL, true, false);
      this.world.setBlock(cx + 1, baseY + dy, cz, BLOCK_IDS.NETHER_PORTAL, true, false);
    }

    // Remesh portal area cleanly
    this.world.chunkManager.remeshNeighborhoodForBlock(cx, cz, baseY + 2);
    this.world.chunkManager.remeshNeighborhoodForBlock(cx + 2, cz + 2, baseY + 2);
    this.world.chunkManager.remeshNeighborhoodForBlock(cx - 2, cz - 2, baseY + 2);
    return baseY;
  }

  /**
   * Checks if an obsidian rectangular frame (width >= 4, height >= 5) encloses an empty interior
   * adjacent to (sx, sy, sz) and lights it with NETHER_PORTAL blocks.
   * @private
   */
  _tryLightNetherPortal(sx, sy, sz) {
    // Check both X-oriented (dz=0) and Z-oriented (dx=0) vertical planes
    const orientations = [
      { axis: 'x', dx: 1, dz: 0 },
      { axis: 'z', dx: 0, dz: 1 },
    ];

    for (const ori of orientations) {
      // Find bottom obsidian floor below (sx, sy, sz)
      let bottomY = sy;
      while (bottomY > 1 && this.world.getBlock(sx, bottomY, sz) !== BLOCK_IDS.OBSIDIAN) {
        if (sy - bottomY > 10) break;
        bottomY--;
      }
      if (this.world.getBlock(sx, bottomY, sz) !== BLOCK_IDS.OBSIDIAN) continue;

      const interiorY = bottomY + 1;
      if (
        this.world.getBlock(sx, interiorY, sz) !== BLOCK_IDS.AIR &&
        this.world.getBlock(sx, interiorY, sz) !== BLOCK_IDS.NETHER_PORTAL
      ) {
        continue;
      }

      // Scan left/right along axis to find obsidian side pillars
      let minU = 0;
      while (minU > -8) {
        const bx = sx + ori.dx * (minU - 1);
        const bz = sz + ori.dz * (minU - 1);
        if (this.world.getBlock(bx, interiorY, bz) === BLOCK_IDS.OBSIDIAN) break;
        minU--;
      }
      let maxU = 0;
      while (maxU < 8) {
        const bx = sx + ori.dx * (maxU + 1);
        const bz = sz + ori.dz * (maxU + 1);
        if (this.world.getBlock(bx, interiorY, bz) === BLOCK_IDS.OBSIDIAN) break;
        maxU++;
      }

      const innerW = maxU - minU + 1;
      if (innerW < 2 || innerW > 8) continue;

      // Scan up to find top obsidian lintel
      let innerH = 0;
      while (innerH < 10) {
        const by = interiorY + innerH;
        if (this.world.getBlock(sx, by, sz) === BLOCK_IDS.OBSIDIAN) break;
        innerH++;
      }
      if (innerH < 3 || innerH > 10) continue;

      // Validate entire perimeter is OBSIDIAN and entire interior is AIR/NETHER_PORTAL
      let valid = true;
      for (let u = minU; u <= maxU && valid; u++) {
        const bx = sx + ori.dx * u;
        const bz = sz + ori.dz * u;
        if (this.world.getBlock(bx, bottomY, bz) !== BLOCK_IDS.OBSIDIAN) valid = false;
        if (this.world.getBlock(bx, interiorY + innerH, bz) !== BLOCK_IDS.OBSIDIAN) valid = false;
      }
      for (let h = 0; h < innerH && valid; h++) {
        const by = interiorY + h;
        const lx = sx + ori.dx * (minU - 1);
        const lz = sz + ori.dz * (minU - 1);
        const rx = sx + ori.dx * (maxU + 1);
        const rz = sz + ori.dz * (maxU + 1);
        if (this.world.getBlock(lx, by, lz) !== BLOCK_IDS.OBSIDIAN) valid = false;
        if (this.world.getBlock(rx, by, rz) !== BLOCK_IDS.OBSIDIAN) valid = false;
        for (let u = minU; u <= maxU && valid; u++) {
          const ix = sx + ori.dx * u;
          const iz = sz + ori.dz * u;
          const cur = this.world.getBlock(ix, by, iz);
          if (cur !== BLOCK_IDS.AIR && cur !== BLOCK_IDS.NETHER_PORTAL) valid = false;
        }
      }

      if (!valid) continue;

      // Fill interior with shimmering NETHER_PORTAL blocks
      for (let h = 0; h < innerH; h++) {
        for (let u = minU; u <= maxU; u++) {
          const ix = sx + ori.dx * u;
          const iz = sz + ori.dz * u;
          this.world.setBlock(ix, interiorY + h, iz, BLOCK_IDS.NETHER_PORTAL, true, false);
        }
      }
      this.world.chunkManager.remeshNeighborhoodForBlock(sx, sz, interiorY + 1);
      this.bus.emit(ENGINE_EVENTS.PORTAL_LIT, { x: sx, y: interiorY, z: sz });
      return true;
    }
    return false;
  }

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
   * Sets active world weather ('clear', 'rain', or 'thunder').
   * @param {'clear'|'rain'|'thunder'} mode
   */
  setWeather(mode) {
    const normalized = mode === 'thunder' ? 'thunder' : mode === 'rain' ? 'rain' : 'clear';
    this.weather = normalized;
    this._weatherTimer = normalized === 'clear' ? 240 : 110;
    this.bus.emit(ENGINE_EVENTS.WEATHER_CHANGED, { weather: normalized });
    return normalized;
  }

  /**
   * Computes realistic progressive break duration (in seconds) for a block using held tool.
   * Returns 0 for Creative mode or instant-break blocks (flowers, grass, torches, TNT).
   * Returns Infinity for unbreakable blocks (Bedrock).
   * @param {number} blockId
   * @param {string|null} [toolItemId=null]
   * @returns {number}
   */
  getBreakDuration(blockId, toolItemId = undefined) {
    const block = this.world.blockRegistry.getById(blockId);
    if (!block || !block.breakable || block.hardness < 0) return Infinity;
    if (this.gameMode === 'creative') return 0;
    if (block.hardness <= 0.05) return 0;

    const selected = this.inventory.getSelectedStack();
    let itemId = toolItemId;
    if (itemId === undefined) {
      itemId = selected?.itemId ?? null;
    }
    const toolDef = itemId ? this.itemRegistry.get(itemId) : null;
    const matchesTool = Boolean(toolDef && block.toolType && toolDef.toolType === block.toolType);
    const hasMinTier = !block.minToolTier || (matchesTool && (toolDef?.toolTier ?? 0) >= block.minToolTier);

    let speed = 1.0;
    if (matchesTool && toolDef?.miningSpeed) {
      speed = toolDef.miningSpeed;
      const effLevel = selected?.enchants?.efficiency || 0;
      if (effLevel > 0) {
        speed += effLevel * effLevel + 1;
      }
    }
    const penalty = hasMinTier ? 1.5 : 4.2;
    return Math.max(0.06, (block.hardness * penalty) / speed);
  }

  /**
   * Primary left-click action: attacks Ender Dragon/End Crystals, hits Oak Boat to pick up,
   * attacks an aimed mob within reach (with Sharpness/Strength/Looting), or breaks the targeted block.
   */
  interactPrimaryAction() {
    if (this.gameMode === 'survival' && this.survival.isDead) {
      return { action: 'none' };
    }
    const eye = this.player.getEyePosition();
    const forward = this.player.getForwardVector();
    const selected = this.inventory.getSelectedStack();
    const heldDef = selected ? this.itemRegistry.get(selected.itemId) : null;
    const sharpLvl = selected?.enchants?.sharpness || 0;
    const lootingLvl = selected?.enchants?.looting || 0;
    const strengthBonus = this.survival.getEffectLevel('strength') * 3;
    const meleeDamage = Math.round((heldDef?.attackDamage ?? 2) + sharpLvl * 1.5 + strengthBonus);

    // 0. Check Ender Dragon & End Crystals in The End
    if (this.world.dimension === 'end') {
      const bossHit = this.entities.raycastBoss(eye, forward, 6.5);
      if (bossHit.hit) {
        if (bossHit.target === 'crystal' && bossHit.crystalId) {
          this.entities.dragon?.destroyCrystal(bossHit.crystalId);
          return { action: 'attack', mobType: 'end_crystal', killed: true };
        }
        if (bossHit.target === 'dragon') {
          const res = this.entities.attackDragon(meleeDamage);
          if (this.gameMode === 'survival' && heldDef?.maxDurability) {
            this.inventory.damageSelectedTool(1);
          }
          return { action: 'attack', mobType: 'ender_dragon', killed: res.defeated };
        }
      }
    }

    // 0b. Check Oak Boat pickup on left-click
    const boatHit = this.entities.raycastBoat(eye, forward, 4.5);
    if (boatHit.hit && boatHit.boat && !boatHit.boat.occupied) {
      this.entities.pickupBoat(boatHit.boat);
      return { action: 'pickup_boat' };
    }

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
      const res = this.entities.attackEntity(
        entityHit.entity,
        meleeDamage,
        this.player.getPosition(),
        lootingLvl
      );
      if (this.gameMode === 'survival') {
        this.survival.addExhaustion(0.15);
        if (heldDef?.maxDurability) {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) {
            this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
          }
        }
      }
      return {
        action: 'attack',
        killed: res.killed,
        mobType: entityHit.entity.type,
        position: { ...entityHit.entity.position },
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
        position: { ...blockHit.position },
      };
    }

    return { action: 'none' };
  }

  /**
   * Eats the currently selected food item if hungry (or restores hunger).
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
   * Interacts (right-click) with an interactive block in the world:
   * Crafting Table, Furnace, Chest, Enchanting Table, Anvil, Brewing Stand, Sign,
   * Lever, Stone Button, End Portal Frame, Campfire, Bed, Oak Door, or TNT.
   */
  interactUseBlock(wx, wy, wz) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    const id = this.world.getBlock(ix, iy, iz);

    if (id === BLOCK_IDS.CRAFTING_TABLE) {
      return { type: 'crafting_table', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.FURNACE || id === BLOCK_IDS.FURNACE_LIT) {
      this.blockEntities.getOrCreateFurnace(ix, iy, iz);
      return { type: 'furnace', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.CHEST) {
      this.blockEntities.getOrCreateChest(ix, iy, iz);
      return { type: 'chest', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.ENCHANTING_TABLE) {
      return {
        type: 'enchanting_table',
        x: ix,
        y: iy,
        z: iz,
        bookshelves: countNearbyBookshelves(this.world, ix, iy, iz),
      };
    }
    if (id === BLOCK_IDS.ANVIL) {
      return { type: 'anvil', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.BREWING_STAND) {
      this.blockEntities.getOrCreateBrewingStand(ix, iy, iz);
      return { type: 'brewing_stand', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.OAK_SIGN) {
      this.blockEntities.getOrCreateSign(ix, iy, iz);
      return { type: 'sign', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.LEVER || id === BLOCK_IDS.LEVER_ON) {
      const nextOn = this.redstone.toggleLever(ix, iy, iz);
      return { type: 'lever', x: ix, y: iy, z: iz, message: nextOn ? 'Lever switched ON' : 'Lever switched OFF' };
    }
    if (id === BLOCK_IDS.STONE_BUTTON) {
      this.redstone.pressButton(ix, iy, iz);
      return { type: 'button', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.END_PORTAL_FRAME) {
      const selected = this.inventory.getSelectedStack();
      if (selected?.itemId === 'eye_of_ender') {
        this.world.setBlock(ix, iy, iz, BLOCK_IDS.END_PORTAL_FRAME_FILLED, true, true);
        if (this.gameMode === 'survival') this.inventory.consumeSelected(1);
        const lit = this._tryActivateEndPortal(ix, iy, iz);
        return {
          type: 'end_portal_frame',
          x: ix,
          y: iy,
          z: iz,
          message: lit ? 'End Portal Activated! Jump in to face the Ender Dragon!' : 'Placed Eye of Ender into Portal Frame.',
        };
      }
      return { type: 'end_portal_frame', x: ix, y: iy, z: iz, message: 'Hold an Eye of Ender to fill this frame.' };
    }
    if (id === BLOCK_IDS.CAMPFIRE) {
      const selected = this.inventory.getSelectedStack();
      const cookMap = {
        raw_beef: 'cooked_beef',
        raw_porkchop: 'cooked_porkchop',
        raw_chicken: 'cooked_chicken',
        raw_cod: 'cooked_cod',
        raw_salmon: 'cooked_salmon',
      };
      if (selected && cookMap[selected.itemId]) {
        const cookedId = cookMap[selected.itemId];
        if (this.gameMode === 'survival') this.inventory.consumeSelected(1);
        this.inventory.addItem(cookedId, 1);
        this.awardXp(1);
        const cookedDef = this.itemRegistry.get(cookedId);
        return { type: 'campfire', x: ix, y: iy, z: iz, message: `Roasted ${cookedDef?.name || cookedId} on Campfire!` };
      }
      return { type: 'campfire', x: ix, y: iy, z: iz, message: 'Hold raw meat or fish to roast on Campfire.' };
    }
    if (id === BLOCK_IDS.BED) {
      if (this.world.dimension === 'nether' || this.world.dimension === 'end') {
        return { type: 'bed', x: ix, y: iy, z: iz, message: 'You cannot sleep in this dimension!' };
      }
      this.spawnPoint = { x: ix + 0.5, y: iy + 1.1, z: iz + 0.5 };
      const isNight = this.world.getSkyBrightness() < 0.52;
      if (isNight) {
        this.setTimeOfDay(0.05);
        this.setWeather('clear');
        this.bus.emit(ENGINE_EVENTS.PLAYER_SLEPT, { spawnPoint: { ...this.spawnPoint } });
        return { type: 'bed', x: ix, y: iy, z: iz, message: 'Slept through the night! Respawn point set.' };
      }
      return { type: 'bed', x: ix, y: iy, z: iz, message: 'Respawn point set. You can only sleep at night.' };
    }
    if (id === BLOCK_IDS.OAK_DOOR_CLOSED || id === BLOCK_IDS.OAK_DOOR_OPEN) {
      const next = id === BLOCK_IDS.OAK_DOOR_CLOSED ? BLOCK_IDS.OAK_DOOR_OPEN : BLOCK_IDS.OAK_DOOR_CLOSED;
      this.world.setBlock(ix, iy, iz, next, true, true);
      this.bus.emit(ENGINE_EVENTS.DOOR_TOGGLED, { x: ix, y: iy, z: iz, open: next === BLOCK_IDS.OAK_DOOR_OPEN });
      return { type: 'door', x: ix, y: iy, z: iz };
    }
    if (id === BLOCK_IDS.TNT) {
      this.entities.igniteTnt(ix, iy, iz);
      return { type: 'tnt', x: ix, y: iy, z: iz, message: 'TNT ignited!' };
    }
    return { type: 'none' };
  }

  /**
   * Interacts (right-click) with aimed world entities: Villager Trading, Wolf Tame/Sit/Heal,
   * Sheep Shearing, or boarding an Oak Boat.
   */
  interactUseEntity() {
    if (this.gameMode === 'survival' && this.survival.isDead) return { handled: false };
    const eye = this.player.getEyePosition();
    const fwd = this.player.getForwardVector();
    const selected = this.inventory.getSelectedStack();
    const heldId = selected?.itemId ?? null;

    // 1. Oak Boat boarding
    const boatHit = this.entities.raycastBoat(eye, fwd, 4.5);
    if (boatHit.hit && boatHit.boat) {
      if (this.entities.getMountedBoat() === boatHit.boat) {
        this.entities.dismountBoat(this.player);
        return { handled: true, action: 'boat_dismount', message: 'Dismounted Oak Boat' };
      }
      this.entities.boardBoat(boatHit.boat, this.player);
      return { handled: true, action: 'boat_board', message: 'Sailing Oak Boat (Shift to dismount)' };
    }

    // 2. Mobs: Villager, Wolf, Sheep
    const entHit = this.entities.raycastEntity(eye, fwd, 4.5);
    if (!entHit.hit || !entHit.entity) return { handled: false };
    const ent = entHit.entity;

    if (ent.type === MOB_TYPES.VILLAGER) {
      return {
        handled: true,
        action: 'villager_trade',
        entityId: ent.id,
        profession: ent.profession || 'farmer',
      };
    }

    if (ent.type === MOB_TYPES.WOLF) {
      const res = this.entities.interactWolf(ent, heldId);
      if (res.action !== 'none') {
        if (res.consumeItem && this.gameMode === 'survival') {
          this.inventory.consumeSelected(1);
        }
        const msgMap = {
          tamed: 'Wolf tamed! It will follow and protect you.',
          tame_failed: 'The wolf wants another bone...',
          healed: 'Healed your tamed Wolf!',
          sit: 'Wolf is now sitting.',
          stand: 'Wolf is following you.',
        };
        return { handled: true, action: `wolf_${res.action}`, message: msgMap[res.action] };
      }
    }

    if (ent.type === MOB_TYPES.SHEEP && heldId === 'shears') {
      const res = this.entities.shearSheep(ent);
      if (res.sheared) {
        if (this.gameMode === 'survival') {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
        }
        return { handled: true, action: 'shear', message: `Sheared ${res.count}x White Wool` };
      }
    }

    return { handled: false };
  }

  // ==================== MAGIC, WORKSTATIONS, POTIONS & SHIELD ====================

  getEnchantTableState(wx, wy, wz, itemSlotIndex) {
    const bookshelves = countNearbyBookshelves(this.world, wx, wy, wz);
    const stack = itemSlotIndex >= 0 ? this.inventory.getSlot(itemSlotIndex) : null;
    const options = getEnchantOptions(stack, this.itemRegistry, bookshelves, wx * 31 + wy * 17 + wz * 13);
    return { bookshelves, options };
  }

  applyEnchantment(wx, wy, wz, itemSlotIndex, optionIndex, lapisSlotIndex = -1) {
    const stack = this.inventory.getSlot(itemSlotIndex);
    if (!stack) return { ok: false, message: 'Place a tool, weapon, or armor piece to enchant.' };
    const { options } = this.getEnchantTableState(wx, wy, wz, itemSlotIndex);
    const opt = options[optionIndex];
    if (!opt) return { ok: false, message: 'Invalid enchantment tier.' };

    if (this.gameMode === 'survival') {
      if (this.survival.xpLevel < opt.xpReq) {
        return { ok: false, message: `Requires XP Level ${opt.xpReq}.` };
      }
      const lapisAvailable =
        lapisSlotIndex >= 0 && this.inventory.getSlot(lapisSlotIndex)?.itemId === 'lapis_lazuli'
          ? this.inventory.getSlot(lapisSlotIndex).count
          : this.inventory.countItem('lapis_lazuli');
      if (lapisAvailable < opt.lapisCost) {
        return { ok: false, message: `Requires ${opt.lapisCost} Lapis Lazuli.` };
      }
      this.survival.spendXpLevels(opt.xpCost);
      this.bus.emit(ENGINE_EVENTS.XP_CHANGED, {
        leveledUp: false,
        level: this.survival.xpLevel,
        xpProgress: this.survival.xpProgress,
        xpTotal: this.survival.xpTotal,
      });
      if (lapisSlotIndex >= 0 && this.inventory.getSlot(lapisSlotIndex)?.itemId === 'lapis_lazuli') {
        const lStack = this.inventory.getSlot(lapisSlotIndex);
        if (lStack.count <= opt.lapisCost) this.inventory.setSlot(lapisSlotIndex, null);
        else this.inventory.setSlot(lapisSlotIndex, { ...lStack, count: lStack.count - opt.lapisCost });
      } else {
        this.inventory.removeItem('lapis_lazuli', opt.lapisCost);
      }
    }

    const nextEnchants = { ...(stack.enchants || {}), ...opt.enchants };
    if (stack.itemId === 'book') {
      if (stack.count > 1) {
        this.inventory.setSlot(itemSlotIndex, { ...stack, count: stack.count - 1 });
        this.inventory.addItem('enchanted_book', 1, undefined, nextEnchants);
      } else {
        this.inventory.setSlot(itemSlotIndex, { itemId: 'enchanted_book', count: 1, enchants: nextEnchants });
      }
    } else {
      this.inventory.setSlot(itemSlotIndex, { ...stack, enchants: nextEnchants });
    }
    this.bus.emit(ENGINE_EVENTS.ENCHANT_APPLIED, {
      itemId: stack.itemId === 'book' ? 'enchanted_book' : stack.itemId,
      enchants: nextEnchants,
    });
    return { ok: true, enchants: nextEnchants, message: `Enchanted with ${opt.clue}!` };
  }

  previewAnvilAction(leftSlotIndex, rightSlotIndex, customName = '') {
    const left = leftSlotIndex >= 0 ? this.inventory.getSlot(leftSlotIndex) : null;
    const right = rightSlotIndex >= 0 ? this.inventory.getSlot(rightSlotIndex) : null;
    return previewAnvil(left, right, customName, this.itemRegistry);
  }

  applyAnvilAction(leftSlotIndex, rightSlotIndex, customName = '') {
    const preview = this.previewAnvilAction(leftSlotIndex, rightSlotIndex, customName);
    if (!preview || !preview.output) return { ok: false, message: 'Nothing to forge or rename.' };
    if (this.gameMode === 'survival' && this.survival.xpLevel < preview.xpCost) {
      return { ok: false, message: `Requires ${preview.xpCost} XP levels.` };
    }
    if (this.gameMode === 'survival') {
      this.survival.spendXpLevels(preview.xpCost);
      this.bus.emit(ENGINE_EVENTS.XP_CHANGED, {
        leveledUp: false,
        level: this.survival.xpLevel,
        xpProgress: this.survival.xpProgress,
        xpTotal: this.survival.xpTotal,
      });
    }
    this.inventory.setSlot(leftSlotIndex, preview.output);
    if (rightSlotIndex >= 0 && rightSlotIndex !== leftSlotIndex) {
      const rStack = this.inventory.getSlot(rightSlotIndex);
      if (rStack) {
        if (rStack.count <= 1) this.inventory.setSlot(rightSlotIndex, null);
        else this.inventory.setSlot(rightSlotIndex, { ...rStack, count: rStack.count - 1 });
      }
    }
    this.bus.emit(ENGINE_EVENTS.ENCHANT_APPLIED, {
      itemId: preview.output.itemId,
      enchants: preview.output.enchants || {},
      customName: preview.output.customName || null,
    });
    return { ok: true, result: preview.output, message: 'Forged item on Anvil!' };
  }

  getVillagerTrades(entityId) {
    const ent = this.entities.entities.find((e) => e.id === entityId && !e.dead);
    const profession = ent?.profession || 'farmer';
    const table = VILLAGER_TRADES[profession] || VILLAGER_TRADES.farmer;
    return {
      profession,
      title: table.title,
      offers: table.offers,
      emeralds: this.inventory.countItem('emerald'),
    };
  }

  tradeWithVillager(entityId, offerIndex) {
    const { profession, offers } = this.getVillagerTrades(entityId);
    const offer = offers[offerIndex];
    if (!offer) return { ok: false, message: 'Invalid trade offer.' };
    const res = executeVillagerTrade(offer, this.inventory, this.survival);
    if (res.ok) {
      this.bus.emit(ENGINE_EVENTS.XP_CHANGED, {
        leveledUp: false,
        level: this.survival.xpLevel,
        xpProgress: this.survival.xpProgress,
        xpTotal: this.survival.xpTotal,
      });
      this.bus.emit(ENGINE_EVENTS.VILLAGER_TRADED, { profession, offer });
      return { ok: true, offer, message: 'Trade completed!' };
    }
    return { ok: false, message: res.reason || 'Not enough items for this trade.' };
  }

  setSignLines(wx, wy, wz, lines) {
    const sign = this.blockEntities.setSignLines(wx, wy, wz, lines);
    this.bus.emit(ENGINE_EVENTS.SIGN_UPDATED, { x: Math.floor(wx), y: Math.floor(wy), z: Math.floor(wz), lines: sign.lines });
    return sign;
  }

  setShieldBlocking(active) {
    this.survival.shieldBlocking = Boolean(active && this.inventory.hasShield());
    return this.survival.shieldBlocking;
  }

  drinkSelectedPotion() {
    if (this.survival.isDead) return { drunk: false };
    const stack = this.inventory.getSelectedStack();
    if (!stack) return { drunk: false };
    const effect = POTION_EFFECTS[stack.itemId];
    if (!effect) return { drunk: false };

    if (effect.instantHeal) {
      this.survival.heal(effect.instantHeal);
    }
    if (effect.effectId && effect.duration > 0) {
      this.survival.addEffect(effect.effectId, effect.duration, effect.level || 1);
    }
    if (this.gameMode === 'survival') {
      this.inventory.consumeSelected(1);
      this.inventory.addItem('glass_bottle', 1);
    }
    this.bus.emit(ENGINE_EVENTS.POTION_DRUNK, { itemId: stack.itemId, effect });
    return { drunk: true, itemId: stack.itemId, label: effect.label };
  }

  /**
   * Uses the currently selected special item on right-click:
   * Armor quick-equip, Potion drinking, Food, Fishing Rod, Eye of Ender, Oak Boat,
   * Glass Bottle water fill, Flint & Steel, Hoe tilling, Wheat Seeds planting, Buckets.
   * @param {any} [hit] - Optional raycast hit from world.raycast()
   * @returns {{ used: boolean, action?: string, message?: string }}
   */
  useSelectedToolOrItem(hit = null) {
    if (this.gameMode === 'survival' && this.survival.isDead) return { used: false };
    const stack = this.inventory.getSelectedStack();
    if (!stack) return { used: false };
    const def = this.itemRegistry.get(stack.itemId);
    if (!def) return { used: false };

    // 1. Quick-equip Armor
    if (def.category === ITEM_CATEGORIES.ARMOR && def.armorSlot) {
      if (this.inventory.equipArmorFromSlot(this.inventory.selectedSlot)) {
        return { used: true, action: 'equip_armor', message: `Equipped ${def.name}` };
      }
    }

    // 1b. Drink Potion
    if (def.category === ITEM_CATEGORIES.POTION && POTION_EFFECTS[def.id]) {
      const drank = this.drinkSelectedPotion();
      if (drank.drunk) {
        return { used: true, action: 'drink_potion', message: `Drank ${def.name} (${drank.label})` };
      }
    }

    // 1c. Fishing Rod cast / reel
    if (def.id === 'fishing_rod') {
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      const res = this.entities.toggleFishingRod(eye, fwd);
      if (res.action === 'reel' && res.caught) {
        this.inventory.addItem(res.caught.itemId, res.caught.count);
        if (res.caught.enchants) {
          // Attach enchants to newly added enchanted_book
          for (let s = 0; s < this.inventory.slots.length; s++) {
            const st = this.inventory.slots[s];
            if (st && st.itemId === res.caught.itemId && !st.enchants) {
              this.inventory.setSlot(s, { ...st, enchants: { ...res.caught.enchants } });
              break;
            }
          }
        }
        this.awardXp(res.caught.xp || 3);
        if (this.gameMode === 'survival') this.inventory.damageSelectedTool(1);
        const caughtName = this.itemRegistry.get(res.caught.itemId)?.name || res.caught.itemId;
        return { used: true, action: 'fish_caught', message: `Caught ${caughtName}! (+${res.caught.xp} XP)` };
      }
      return {
        used: true,
        action: res.action === 'cast' ? 'fish_cast' : 'fish_reel',
        message: res.action === 'cast' ? 'Cast fishing line into water...' : 'Reeled in fishing line.',
      };
    }

    // 1d. Eye of Ender: throw toward Stronghold coordinates!
    if (def.id === 'eye_of_ender') {
      if (this.world.dimension !== 'overworld') {
        return { used: true, action: 'eye_noop', message: 'Eyes of Ender only guide you in the Overworld.' };
      }
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      const stronghold = getStrongholdCoords(this.world.seed);
      this.entities.throwEyeOfEnder(
        { x: eye.x + fwd.x * 0.9, y: eye.y + 0.1, z: eye.z + fwd.z * 0.9 },
        stronghold
      );
      if (this.gameMode === 'survival') this.inventory.consumeSelected(1);
      const dist = Math.round(Math.hypot(stronghold.x - eye.x, stronghold.z - eye.z));
      return {
        used: true,
        action: 'eye_thrown',
        message: dist < 24 ? 'The Eye of Ender dives downward — Stronghold right below!' : `Eye of Ender floats toward Stronghold (~${dist}m away)!`,
      };
    }

    // 1e. Oak Boat placement on water or ground
    if (def.id === 'oak_boat') {
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      let placePos = null;
      for (let d = 1.0; d <= 5.0; d += 0.3) {
        const bx = Math.floor(eye.x + fwd.x * d);
        const by = Math.floor(eye.y + fwd.y * d);
        const bz = Math.floor(eye.z + fwd.z * d);
        if (this.world.isLiquidAt(bx, by, bz)) {
          placePos = { x: bx + 0.5, y: by + 0.72, z: bz + 0.5 };
          break;
        }
        if (this.world.isSolidAt(bx, by, bz)) {
          placePos = { x: bx + 0.5, y: by + 1.05, z: bz + 0.5 };
          break;
        }
      }
      if (placePos) {
        this.entities.spawnBoat(placePos.x, placePos.y, placePos.z, this.player.yaw);
        if (this.gameMode === 'survival') this.inventory.consumeSelected(1);
        return { used: true, action: 'place_boat', message: 'Placed Oak Boat! Right-click to board.' };
      }
    }

    // 1f. Glass Bottle: fill from Water -> Water Bottle
    if (def.id === 'glass_bottle') {
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      for (let d = 0.6; d <= 5.0; d += 0.25) {
        const bx = Math.floor(eye.x + fwd.x * d);
        const by = Math.floor(eye.y + fwd.y * d);
        const bz = Math.floor(eye.z + fwd.z * d);
        if (this.world.getBlock(bx, by, bz) === BLOCK_IDS.WATER) {
          if (this.gameMode === 'survival') this.inventory.consumeSelected(1);
          this.inventory.addItem('water_bottle', 1);
          return { used: true, action: 'fill_bottle', message: 'Filled Water Bottle' };
        }
        if (this.world.isSolidAt(bx, by, bz)) break;
      }
    }

    // 2. Eat Food
    if (def.category === ITEM_CATEGORIES.FOOD) {
      const ate = this.consumeSelectedFood();
      if (ate.consumed) return { used: true, action: 'eat' };
    }

    // 2c. Flint & Steel: ignite TNT or light an Obsidian Nether Portal frame
    if (def.id === 'flint_and_steel' && hit?.hit && hit.position) {
      const { x, y, z } = hit.position;
      const targetId = this.world.getBlock(x, y, z);
      if (targetId === BLOCK_IDS.TNT) {
        this.entities.igniteTnt(x, y, z);
        if (this.gameMode === 'survival') {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
        }
        return { used: true, action: 'ignite_tnt', message: 'TNT ignited!' };
      }
      const probe = hit.adjacent || { x, y: y + 1, z };
      if (this._tryLightNetherPortal(probe.x, probe.y, probe.z) || this._tryLightNetherPortal(x, y + 1, z)) {
        if (this.gameMode === 'survival') {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
        }
        return { used: true, action: 'light_portal', message: 'Nether Portal ignited!' };
      }
    }

    // 3. Hoe: till Grass/Dirt into Farmland
    if (def.toolType === 'hoe' && hit?.hit && hit.position) {
      const { x, y, z } = hit.position;
      const targetId = this.world.getBlock(x, y, z);
      const aboveId = this.world.getBlock(x, y + 1, z);
      if ((targetId === BLOCK_IDS.GRASS || targetId === BLOCK_IDS.DIRT) && aboveId === BLOCK_IDS.AIR) {
        const nearWater = this._isWaterNearby(x, y, z, 4);
        this.world.setBlock(x, y, z, nearWater ? BLOCK_IDS.FARMLAND_WET : BLOCK_IDS.FARMLAND, true, true);
        if (this.gameMode === 'survival') {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
        }
        return { used: true, action: 'till' };
      }
    }

    // 4. Wheat Seeds: plant on Farmland
    if (def.id === 'wheat_seeds' && hit?.hit && hit.position) {
      const { x, y, z } = hit.position;
      const targetId = this.world.getBlock(x, y, z);
      const aboveId = this.world.getBlock(x, y + 1, z);
      if ((targetId === BLOCK_IDS.FARMLAND || targetId === BLOCK_IDS.FARMLAND_WET) && aboveId === BLOCK_IDS.AIR) {
        this.world.setBlock(x, y + 1, z, BLOCK_IDS.WHEAT_0, true, true);
        if (this.gameMode === 'survival') {
          this.inventory.consumeSelected(1);
        }
        return { used: true, action: 'plant' };
      }
    }

    // 5. Empty Bucket: scoop Water or Lava
    if (def.id === 'bucket') {
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      for (let d = 0.6; d <= 5.5; d += 0.25) {
        const bx = Math.floor(eye.x + fwd.x * d);
        const by = Math.floor(eye.y + fwd.y * d);
        const bz = Math.floor(eye.z + fwd.z * d);
        const id = this.world.getBlock(bx, by, bz);
        if (id === BLOCK_IDS.WATER || id === BLOCK_IDS.LAVA) {
          this.world.setBlock(bx, by, bz, BLOCK_IDS.AIR, true, true);
          const filledId = id === BLOCK_IDS.WATER ? 'water_bucket' : 'lava_bucket';
          if (this.gameMode === 'survival') {
            this.inventory.setSlot(this.inventory.selectedSlot, { itemId: filledId, count: 1 });
          } else {
            this.inventory.addItem(filledId, 1);
          }
          return { used: true, action: 'scoop_fluid' };
        }
        if (this.world.isSolidAt(bx, by, bz)) break;
      }
    }

    // 6. Water / Lava Bucket: pour fluid
    if ((def.id === 'water_bucket' || def.id === 'lava_bucket') && hit?.hit && hit.adjacent) {
      const { x, y, z } = hit.adjacent;
      const fluidId = def.id === 'water_bucket' ? BLOCK_IDS.WATER : BLOCK_IDS.LAVA;
      if (this.world.setBlock(x, y, z, fluidId, true, true)) {
        if (this.gameMode === 'survival') {
          this.inventory.setSlot(this.inventory.selectedSlot, { itemId: 'bucket', count: 1 });
        }
        return { used: true, action: 'pour_fluid' };
      }
    }

    return { used: false };
  }

  /**
   * Fires an arrow from the player's Bow with normalized charge [0..1], honoring Power & Flame enchants.
   * @param {number} [charge01=1]
   * @returns {{ fired: boolean, reason?: string }}
   */
  firePlayerBow(charge01 = 1) {
    if (this.gameMode === 'survival' && this.survival.isDead) return { fired: false };
    const stack = this.inventory.getSelectedStack();
    if (!stack || stack.itemId !== 'bow') return { fired: false };

    const powerLvl = stack.enchants?.power || 0;
    const flameLvl = stack.enchants?.flame || 0;

    if (this.gameMode === 'survival') {
      if (this.inventory.countItem('arrow') <= 0) {
        return { fired: false, reason: 'No arrows in inventory!' };
      }
      this.inventory.removeItem('arrow', 1);
      const wear = this.inventory.damageSelectedTool(1);
      if (wear.broken) this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
    }

    const clamped = Math.max(0.18, Math.min(1, charge01));
    const eye = this.player.getEyePosition();
    const fwd = this.player.getForwardVector();
    const speed = 13 + clamped * 23;
    const damage = Math.max(2, Math.round(2 + clamped * 7 + powerLvl * 2));

    this.entities.spawnArrow(
      { x: eye.x + fwd.x * 0.55, y: eye.y - 0.1 + fwd.y * 0.55, z: eye.z + fwd.z * 0.55 },
      { x: fwd.x * speed, y: fwd.y * speed + 1.2, z: fwd.z * speed },
      'player',
      damage,
      { kind: 'arrow', onFire: flameLvl > 0 }
    );
    this.bus.emit(ENGINE_EVENTS.BOW_SHOT, { charge: clamped, flame: flameLvl > 0 });
    return { fired: true };
  }

  /**
   * Drops 1 item from the currently selected hotbar slot into the world in front of the player (Q key).
   * @returns {boolean}
   */
  dropSelectedItem() {
    const stack = this.inventory.getSelectedStack();
    if (!stack) return false;
    const eye = this.player.getEyePosition();
    const fwd = this.player.getForwardVector();
    this.itemDrops.spawnDrop(
      eye.x + fwd.x * 1.4,
      eye.y - 0.25,
      eye.z + fwd.z * 1.4,
      stack.itemId,
      1
    );
    if (this.gameMode === 'survival') {
      this.inventory.consumeSelected(1);
    }
    return true;
  }

  /**
   * Executes a classic Minecraft slash command from the chat box.
   * Supported: /time, /weather, /gamemode, /tp, /give, /spawn, /seed, /help
   * @param {string} rawCmd
   * @returns {{ ok: boolean, message: string }}
   */
  executeSlashCommand(rawCmd) {
    const trimmed = String(rawCmd || '').trim();
    if (!trimmed.startsWith('/')) {
      return { ok: false, message: trimmed };
    }
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();

    if (cmd === 'help') {
      return {
        ok: true,
        message: 'Commands: /time set <day|noon|sunset|night>, /weather <clear|rain|thunder>, /gamemode <survival|creative>, /give <item> [count], /spawn <mob>, /tp <x> <y> <z>, /xp add <n>, /dimension <overworld|nether>, /kill, /seed',
      };
    }
    if (cmd === 'seed') {
      return { ok: true, message: `World Seed: ${this.world.seed} (${this.world.dimension})` };
    }
    if (cmd === 'time') {
      const val = (parts[2] ?? parts[1] ?? '').toLowerCase();
      const presets = { day: 0.08, dawn: 0.02, noon: 0.25, sunset: 0.5, dusk: 0.5, night: 0.72, midnight: 0.75 };
      if (val in presets) {
        this.setTimeOfDay(presets[val]);
        return { ok: true, message: `Set time to ${val}.` };
      }
      const num = Number(val);
      if (Number.isFinite(num)) {
        this.setTimeOfDay(num > 1 ? (num % 24000) / 24000 : num);
        return { ok: true, message: `Set time to ${this.world.timeOfDay.toFixed(2)}.` };
      }
      return { ok: false, message: 'Usage: /time set <day|noon|sunset|night>' };
    }
    if (cmd === 'weather') {
      const w = (parts[1] || '').toLowerCase();
      if (w === 'clear' || w === 'rain' || w === 'thunder' || w === 'snow') {
        this.setWeather(w === 'clear' ? 'clear' : w === 'thunder' ? 'thunder' : 'rain');
        return { ok: true, message: `Weather set to ${w}.` };
      }
      return { ok: false, message: 'Usage: /weather <clear|rain|thunder>' };
    }
    if (cmd === 'gamemode' || cmd === 'gm') {
      const m = (parts[1] || '').toLowerCase();
      if (m === 'creative' || m === 'c' || m === '1') {
        this.setGameMode('creative');
        return { ok: true, message: 'Game mode set to Creative.' };
      }
      if (m === 'survival' || m === 's' || m === '0') {
        this.setGameMode('survival');
        return { ok: true, message: 'Game mode set to Survival.' };
      }
      return { ok: false, message: 'Usage: /gamemode <survival|creative>' };
    }
    if (cmd === 'tp') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        this.player.setPosition(x, y, z);
        return { ok: true, message: `Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}.` };
      }
      return { ok: false, message: 'Usage: /tp <x> <y> <z>' };
    }
    if (cmd === 'give') {
      const itemId = (parts[1] || '').toLowerCase();
      const count = Math.max(1, Math.min(64, Number(parts[2]) || 1));
      if (!this.itemRegistry.get(itemId)) {
        return { ok: false, message: `Unknown item "${itemId}".` };
      }
      this.inventory.addItem(itemId, count);
      return { ok: true, message: `Gave ${count}x ${this.itemRegistry.get(itemId).name}.` };
    }
    if (cmd === 'spawn') {
      const mobType = (parts[1] || '').toLowerCase();
      const validTypes = Object.values(MOB_TYPES);
      if (!validTypes.includes(mobType)) {
        return { ok: false, message: `Unknown mob. Try: ${validTypes.join(', ')}` };
      }
      const p = this.player.getPosition();
      const fwd = this.player.getForwardVector();
      const sx = p.x + fwd.x * 4;
      const sz = p.z + fwd.z * 4;
      const sy = this.world.getSurfaceY(Math.floor(sx), Math.floor(sz)) + 1.1;
      this.entities.spawnMob(mobType, sx, Math.max(p.y, sy), sz);
      return { ok: true, message: `Spawned ${mobType}.` };
    }
    if (cmd === 'xp') {
      const action = (parts[1] || 'add').toLowerCase();
      const rawVal = parts[2] ?? parts[1] ?? '10';
      const isLevels = /l$/i.test(rawVal);
      const amount = Number(rawVal.replace(/l$/i, ''));
      if (!Number.isFinite(amount)) {
        return { ok: false, message: 'Usage: /xp add <amount> or /xp set <level>L' };
      }
      if (action === 'set') {
        this.survival.setXpLevel(amount);
        this.bus.emit(ENGINE_EVENTS.XP_CHANGED, {
          leveledUp: false,
          level: this.survival.xpLevel,
          xpProgress: this.survival.xpProgress,
          xpTotal: this.survival.xpTotal,
        });
        return { ok: true, message: `Set experience level to ${this.survival.xpLevel}.` };
      }
      if (isLevels) {
        this.survival.setXpLevel(this.survival.xpLevel + amount);
        this.bus.emit(ENGINE_EVENTS.XP_CHANGED, {
          leveledUp: amount > 0,
          level: this.survival.xpLevel,
          xpProgress: this.survival.xpProgress,
          xpTotal: this.survival.xpTotal,
        });
        return { ok: true, message: `Added ${amount} XP levels (now Level ${this.survival.xpLevel}).` };
      }
      const res = this.awardXp(amount);
      return { ok: true, message: `Added ${Math.round(amount)} XP (Level ${res.level}).` };
    }
    if (cmd === 'dimension' || cmd === 'dim') {
      const target = (parts[1] || '').toLowerCase();
      if (target !== 'overworld' && target !== 'nether' && target !== 'end') {
        return { ok: false, message: 'Usage: /dimension <overworld|nether|end>' };
      }
      const res = this.switchDimension(target);
      const label = target === 'end' ? 'The End' : target === 'nether' ? 'The Nether' : 'The Overworld';
      return {
        ok: true,
        message: res.switched ? `Entered ${label}.` : `Already in ${label}.`,
      };
    }
    if (cmd === 'locate') {
      const what = (parts[1] || 'stronghold').toLowerCase();
      if (what === 'stronghold') {
        const sh = getStrongholdCoords(this.world.seed);
        return {
          ok: true,
          message: `Stronghold Portal Room is located at X:${sh.x}, Y:${sh.y}, Z:${sh.z} (Overworld).`,
        };
      }
      return { ok: false, message: 'Usage: /locate stronghold' };
    }
    if (cmd === 'enchant') {
      const enchId = (parts[1] || '').toLowerCase();
      const lvl = Math.max(1, Math.min(5, Number(parts[2]) || 1));
      const stack = this.inventory.getSelectedStack();
      if (!stack) return { ok: false, message: 'Hold an item to enchant.' };
      const next = { ...stack, enchants: { ...(stack.enchants || {}), [enchId]: lvl } };
      this.inventory.setSlot(this.inventory.selectedSlot, next);
      this.bus.emit(ENGINE_EVENTS.ENCHANT_APPLIED, { itemId: stack.itemId, enchants: next.enchants });
      return { ok: true, message: `Enchanted held item with ${enchId} ${lvl}.` };
    }
    if (cmd === 'effect') {
      const effId = (parts[1] || '').toLowerCase();
      if (effId === 'clear') {
        this.survival.clearEffects();
        return { ok: true, message: 'Cleared all active potion effects.' };
      }
      const dur = Math.max(5, Math.min(600, Number(parts[2]) || 90));
      const lvl = Math.max(1, Math.min(3, Number(parts[3]) || 1));
      this.survival.addEffect(effId, dur, lvl);
      return { ok: true, message: `Applied ${effId} (Lvl ${lvl}) for ${dur}s.` };
    }
    if (cmd === 'kill') {
      const target = (parts[1] || '').toLowerCase();
      if (target === '@e' || target === 'mobs') {
        const count = this.entities.entities.length;
        this.entities.clear();
        return { ok: true, message: `Removed ${count} mobs.` };
      }
      this.survival.damage(999, 'command', true);
      return { ok: true, message: 'Ouch! Killed player.' };
    }
    return { ok: false, message: `Unknown command "/${cmd}". Type /help.` };
  }

  respawnPlayer() {
    if (this.world.dimension !== 'overworld') {
      this.switchDimension('overworld');
    }
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
   * Breaks a block with immediate visual mesh update, block-entity drop collection,
   * tool durability wear, and Survival drop spawning.
   */
  interactBreakBlock(wx, wy, wz, { enforceToolTier = false } = {}) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    const prevBlock = this.world.blockRegistry.getById(this.world.getBlock(ix, iy, iz));
    const res = this.world.breakBlock(ix, iy, iz);
    if (res.broken) {
      // Drop any contents stored inside a broken Chest or Furnace
      const containerDrops = this.blockEntities.removeAndCollectDrops(ix, iy, iz);
      for (const cd of containerDrops) {
        this.itemDrops.spawnDrop(ix + 0.5, iy + 0.5, iz + 0.5, cd.itemId, cd.count);
      }

      if (this.gameMode === 'survival') {
        const selected = this.inventory.getSelectedStack();
        const heldDef = selected ? this.itemRegistry.get(selected.itemId) : null;
        const drops = this.itemRegistry.getDropsForBlock(
          res.previousId,
          Math.random(),
          heldDef,
          enforceToolTier,
          {
            fortune: selected?.enchants?.fortune || 0,
            silkTouch: (selected?.enchants?.silk_touch || 0) > 0,
          }
        );
        for (let i = 0; i < drops.length; i++) {
          this.itemDrops.spawnDrop(
            ix + 0.5,
            iy + 0.45,
            iz + 0.5,
            drops[i].itemId,
            drops[i].count
          );
        }
        if (heldDef?.maxDurability && (prevBlock?.hardness ?? 0) > 0.05) {
          const wear = this.inventory.damageSelectedTool(1);
          if (wear.broken) {
            this.bus.emit(ENGINE_EVENTS.TOOL_BROKEN, { itemId: wear.itemId });
          }
        }
      }

      const oreXpMap = {
        [BLOCK_IDS.COAL_ORE]: 1,
        [BLOCK_IDS.REDSTONE_ORE]: 2,
        [BLOCK_IDS.LAPIS_ORE]: 3,
        [BLOCK_IDS.NETHER_QUARTZ_ORE]: 3,
        [BLOCK_IDS.DIAMOND_ORE]: 5,
      };
      const xpDrop = oreXpMap[res.previousId] || 0;

      this.bus.emit(ENGINE_EVENTS.BLOCK_BROKEN, {
        x: ix,
        y: iy,
        z: iz,
        blockId: res.previousId,
        soundGroup: prevBlock?.soundGroup ?? 'stone',
        xpDrop,
      });
    }
    return res;
  }

  /**
   * Places the currently selected hotbar block (or explicit blockId) with collision & Survival consumption.
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
    if (placed) {
      if (blockId === BLOCK_IDS.FURNACE) {
        this.blockEntities.getOrCreateFurnace(wx, wy, wz);
      } else if (blockId === BLOCK_IDS.CHEST) {
        this.blockEntities.getOrCreateChest(wx, wy, wz);
      } else if (blockId === BLOCK_IDS.BREWING_STAND) {
        this.blockEntities.getOrCreateBrewingStand(wx, wy, wz);
      } else if (blockId === BLOCK_IDS.OAK_SIGN) {
        this.blockEntities.getOrCreateSign(wx, wy, wz);
      }
      if (explicitBlockId === undefined && this.gameMode === 'survival') {
        this.inventory.consumeSelected(1);
      }
      const placedDef = this.world.blockRegistry.getById(blockId);
      this.bus.emit(ENGINE_EVENTS.BLOCK_PLACED, {
        x: Math.floor(wx),
        y: Math.floor(wy),
        z: Math.floor(wz),
        blockId,
        soundGroup: placedDef?.soundGroup ?? 'stone',
      });
    }
    return placed;
  }

  /** @private */
  _isWaterNearby(wx, wy, wz, radius = 4) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          if (this.world.getBlock(wx + dx, wy + dy, wz + dz) === BLOCK_IDS.WATER) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Budgeted random block ticks near the player for Farmland hydration and Wheat crop growth.
   * @private
   */
  _stepCropAndFarmlandTicks(dt) {
    this._cropTickAccumulator += dt;
    if (this._cropTickAccumulator < 0.75) return;
    this._cropTickAccumulator = 0;

    const p = this.player.getPosition();
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);

    for (let sample = 0; sample < 24; sample++) {
      const wx = px + Math.floor((Math.random() - 0.5) * 28);
      const wy = Math.max(1, Math.min(124, py + Math.floor((Math.random() - 0.5) * 10)));
      const wz = pz + Math.floor((Math.random() - 0.5) * 28);
      const id = this.world.getBlock(wx, wy, wz);

      if (id === BLOCK_IDS.FARMLAND) {
        if (this.weather === 'rain' || this._isWaterNearby(wx, wy, wz, 4)) {
          this.world.setBlock(wx, wy, wz, BLOCK_IDS.FARMLAND_WET, true, true);
        }
      } else if (id === BLOCK_IDS.WHEAT_0 || id === BLOCK_IDS.WHEAT_1 || id === BLOCK_IDS.WHEAT_2) {
        const below = this.world.getBlock(wx, wy - 1, wz);
        const growthChance = below === BLOCK_IDS.FARMLAND_WET ? 0.55 : 0.22;
        if (Math.random() < growthChance) {
          this.world.setBlock(wx, wy, wz, id + 1, true, true);
        }
      }
    }
  }

  /**
   * Advances physics, fixed-tick simulation, block entities, crops, weather, mobs, survival stats, and chunks.
   */
  update(deltaTime, playerInput = {}) {
    if (!this.engine.paused) {
      const playerAlive = this.gameMode !== 'survival' || !this.survival.isDead;
      const mountedBoat = this.entities.getMountedBoat();
      if (playerAlive) {
        if (mountedBoat) {
          this.player.setInput(playerInput);
          if (playerInput.sneak) {
            this.entities.dismountBoat(this.player);
          }
        } else {
          // Apply Swiftness potion speed bonus cleanly
          const speedLvl = this.survival.getEffectLevel('speed');
          const effDt = speedLvl > 0 ? deltaTime * (1 + speedLvl * 0.22) : deltaTime;
          this.player.update(effDt, playerInput);
        }
      }
      this.world.update(this.player.getPosition(), deltaTime);
      this.blockEntities.update(deltaTime);
      this.redstone.update(deltaTime, this.player, this.entities.entities);
      this._stepCropAndFarmlandTicks(deltaTime);

      // Step into END_PORTAL transitions Overworld <-> The End
      this._endPortalCooldown = Math.max(0, this._endPortalCooldown - deltaTime);
      if (this._endPortalCooldown <= 0) {
        const p = this.player.getPosition();
        const footBlock = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
        const belowBlock = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.3), Math.floor(p.z));
        if (footBlock === BLOCK_IDS.END_PORTAL || belowBlock === BLOCK_IDS.END_PORTAL) {
          this.switchDimension(this.world.dimension === 'end' ? 'overworld' : 'end');
        }
      }

      // Dynamic ambient weather transitions
      this._weatherTimer -= deltaTime;
      if (this._weatherTimer <= 0) {
        this.setWeather(this.weather === 'clear' ? 'rain' : 'clear');
      }

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

  setTimeOfDay(timeOfDay) {
    const normalized = this.world.setTimeOfDay(timeOfDay);
    this.bus.emit(ENGINE_EVENTS.TIME_UPDATED, {
      timeOfDay: normalized,
      skyBrightness: this.world.getSkyBrightness(),
    });
    return normalized;
  }

  /** @private */
  _collectSaveExtra() {
    this._dimensionBlockEntities[this.world.dimension] = this.blockEntities.exportState();
    return {
      dimension: this.world.dimension,
      gameMode: this.gameMode,
      inventory: this.inventory.exportState(),
      survival: this.survival.exportState(),
      blockEntities: this.blockEntities.exportState(),
      overworldBlockEntities: this._dimensionBlockEntities.overworld,
      netherBlockEntities: this._dimensionBlockEntities.nether,
      endBlockEntities: this._dimensionBlockEntities.end,
      advancements: this.advancements.exportState(),
      dragonDefeated: this.entities.dragonDefeated,
      spawnPoint: { ...this.spawnPoint },
      weather: this.weather,
    };
  }

  save(slotName = 'default') {
    const saved = WorldSave.saveToStorage(this.world, this.player, slotName, this._collectSaveExtra());
    this.bus.emit(ENGINE_EVENTS.WORLD_SAVED, {
      slotName,
      seed: saved.seed,
      totalModifiedBlocks: saved.totalModifiedBlocks,
    });
    return saved;
  }

  load(slotName = 'default') {
    const saveData = WorldSave.loadFromStorage(slotName);
    if (!saveData) return false;
    return this.applySaveData(saveData, slotName);
  }

  async saveAsync(slotName = 'default') {
    const meta = await WorldSave.saveAsync(this.world, this.player, slotName, this._collectSaveExtra());
    this.bus.emit(ENGINE_EVENTS.WORLD_SAVED, {
      slotName: meta.slotName,
      seed: meta.seed,
      totalModifiedBlocks: meta.totalModifiedBlocks,
    });
    return meta;
  }

  async loadAsync(slotName = 'default') {
    const saveData = await WorldSave.loadAsync(slotName);
    if (!saveData) return false;
    return this.applySaveData(saveData, slotName);
  }

  applySaveData(saveData, slotName = 'default') {
    if (this.scene) {
      for (const meshGroup of this.world.getLoadedChunkMeshes()) {
        this.scene.remove(meshGroup);
      }
    }

    this.engine.resetClock();
    this.itemDrops.clear();
    this.entities.clear();
    this.blockEntities.clear();
    this.redstone.clear();
    this.entities.dragonDefeated = Boolean(saveData.dragonDefeated);
    this.advancements.importState(saveData.advancements || null);
    this._dimensionBlockEntities = {
      overworld: saveData.overworldBlockEntities ?? null,
      nether: saveData.netherBlockEntities ?? null,
      end: saveData.endBlockEntities ?? null,
    };
    WorldSave.apply(this.world, this.player, saveData);

    const activeBE =
      this.world.dimension === 'end'
        ? saveData.endBlockEntities ?? saveData.blockEntities
        : this.world.dimension === 'nether'
        ? saveData.netherBlockEntities ?? saveData.blockEntities
        : saveData.overworldBlockEntities ?? saveData.blockEntities;
    if (activeBE) {
      this.blockEntities.importState(activeBE);
    }
    if (this.world.dimension === 'end' && !this.entities.dragonDefeated) {
      this.entities.ensureEndDragon();
    }
    if (saveData.spawnPoint && Number.isFinite(saveData.spawnPoint.x)) {
      this.spawnPoint = { ...saveData.spawnPoint };
    } else {
      const p = this.player.getPosition();
      this.spawnPoint = { x: p.x, y: p.y, z: p.z };
    }
    this.weather =
      saveData.weather === 'thunder'
        ? 'thunder'
        : saveData.weather === 'rain'
        ? 'rain'
        : 'clear';

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
      dimension: this.world.dimension,
      totalModifiedBlocks: saveData.totalModifiedBlocks ?? 0,
    });
    return true;
  }

  exportWorldJSON(slotName = 'default') {
    return WorldSave.exportJSON(this.world, this.player, slotName, this._collectSaveExtra());
  }

  importWorldJSON(jsonString) {
    const parsed = WorldSave.parseJSON(jsonString);
    return this.applySaveData(parsed, parsed.name || 'imported');
  }

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
