/**
 * @file EntityManager.js
 * @description Manages live world mobs (Sheep, Cow, Pig, Chicken, Zombie, Creeper,
 * Skeleton, Spider, Slime), ballistic Arrow projectiles, Primed TNT entities, radial
 * explosions (respecting block blast resistance), AI updates, loot drops, and Three.js sync.
 */

import * as THREE from 'three';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { ENGINE_EVENTS } from '../core/EventBus.js';
import { Entity } from './Entity.js';
import { MOB_TYPES } from './MobTypes.js';
import { EnderDragonBoss } from './EnderDragon.js';

let nextProjectileId = 1;

/**
 * Coordinates all passive/hostile mobs, arrows, and primed TNT entities in the world.
 */
export class EntityManager {
  /**
   * @param {import('../world/World.js').World} world
   * @param {import('../inventory/ItemRegistry.js').ItemRegistry} itemRegistry
   * @param {import('../inventory/ItemDropManager.js').ItemDropManager} itemDrops
   * @param {import('../core/EventBus.js').EventBus|null} [bus=null]
   */
  constructor(world, itemRegistry, itemDrops, bus = null) {
    this.world = world;
    this.itemRegistry = itemRegistry;
    this.itemDrops = itemDrops;
    this.bus = bus;

    /** @type {Entity[]} */
    this.entities = [];
    /** @type {Array<{ id: number, kind: 'arrow'|'fireball'|'dragon_fireball', position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, owner: 'player'|'mob', damage: number, onFire: boolean, age: number, stuck: boolean, mesh: THREE.Object3D|null }>} */
    this.arrows = [];
    /** @type {Array<{ id: number, position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, fuse: number, radius: number, power: number, mesh: THREE.Mesh|null }>} */
    this.primedTnts = [];
    /** @type {EnderDragonBoss|null} */
    this.dragon = null;
    this.dragonDefeated = false;
    /** @type {(() => void)|null} */
    this.onDragonDefeated = null;

    /** @type {Array<{ id: number, position: {x:number,y:number,z:number}, target: {x:number,z:number}, age: number, duration: number, mesh: THREE.Object3D|null }>} */
    this.thrownEyes = [];

    /** @type {{ id: number, position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, inWater: boolean, waitTimer: number, biting: boolean, biteWindow: number, mesh: THREE.Object3D|null }|null} */
    this.activeBobber = null;

    /** @type {Array<{ id: number, position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number}, yaw: number, occupied: boolean, mesh: THREE.Group|null }>} */
    this.boats = [];

    /** @type {import('three').Scene|null} */
    this.scene = null;
    /** @type {number} */
    this.maxMobs = 18;
    /** @type {number} */
    this._spawnTimer = 1.5;

    /** @type {((wx:number, wy:number, wz:number) => Array<{itemId:string,count:number}>)|null} */
    this.onBlockDestroyedByExplosion = null;
    /** @type {import('../survival/SurvivalStats.js').SurvivalStats|null} */
    this._lastSurvivalRef = null;
    /** @type {import('../physics/Player.js').Player|null} */
    this._lastPlayerRef = null;
    /** @type {'creative'|'survival'} */
    this._lastGameMode = 'survival';
  }

  /**
   * Attaches or detaches a Three.js Scene for rendering active mobs, arrows, TNT, Dragon, eyes, bobber, and boats.
   * @param {import('three').Scene|null} scene
   */
  attachScene(scene) {
    if (this.scene) {
      for (const ent of this.entities) {
        if (ent.mesh) this.scene.remove(ent.mesh);
      }
      for (const arr of this.arrows) {
        if (arr.mesh) this.scene.remove(arr.mesh);
      }
      for (const tnt of this.primedTnts) {
        if (tnt.mesh) this.scene.remove(tnt.mesh);
      }
      if (this.dragon?.group) this.scene.remove(this.dragon.group);
      for (const eye of this.thrownEyes) {
        if (eye.mesh) this.scene.remove(eye.mesh);
      }
      if (this.activeBobber?.mesh) this.scene.remove(this.activeBobber.mesh);
      for (const boat of this.boats) {
        if (boat.mesh) this.scene.remove(boat.mesh);
      }
    }
    this.scene = scene;
    if (this.scene) {
      for (const ent of this.entities) {
        this.scene.add(ent.buildMesh());
      }
      for (const arr of this.arrows) {
        if (!arr.mesh) arr.mesh = this._createProjectileMesh(arr.kind, arr.onFire);
        arr.mesh.position.set(arr.position.x, arr.position.y, arr.position.z);
        this.scene.add(arr.mesh);
      }
      for (const tnt of this.primedTnts) {
        if (!tnt.mesh) tnt.mesh = this._createPrimedTntMesh();
        tnt.mesh.position.set(tnt.position.x, tnt.position.y, tnt.position.z);
        this.scene.add(tnt.mesh);
      }
      if (this.dragon) {
        this.scene.add(this.dragon.buildMesh());
      }
      for (const eye of this.thrownEyes) {
        if (!eye.mesh) eye.mesh = this._createEyeMesh();
        eye.mesh.position.set(eye.position.x, eye.position.y, eye.position.z);
        this.scene.add(eye.mesh);
      }
      if (this.activeBobber) {
        if (!this.activeBobber.mesh) this.activeBobber.mesh = this._createBobberMesh();
        this.activeBobber.mesh.position.set(
          this.activeBobber.position.x,
          this.activeBobber.position.y,
          this.activeBobber.position.z
        );
        this.scene.add(this.activeBobber.mesh);
      }
      for (const boat of this.boats) {
        if (!boat.mesh) boat.mesh = this._createBoatMesh();
        boat.mesh.position.set(boat.position.x, boat.position.y, boat.position.z);
        boat.mesh.rotation.y = boat.yaw;
        this.scene.add(boat.mesh);
      }
    }
  }

  /**
   * Spawns a mob entity at explicit world coordinates.
   * @param {string} type
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {Entity}
   */
  spawnMob(type, x, y, z) {
    const ent = new Entity(this.world, type, { x, y, z });
    ent.onPlayerAttacked = (amount, source) => {
      this.bus?.emit(ENGINE_EVENTS.PLAYER_DAMAGED, { amount, source });
    };
    ent.onCreeperFuseStart = (e) => {
      this.bus?.emit(ENGINE_EVENTS.CREEPER_FUSE, {
        id: e.id,
        position: { ...e.position },
      });
    };
    ent.onCreeperExplode = (e) => {
      this.explode(
        e.position.x,
        e.position.y + 0.7,
        e.position.z,
        3.2,
        18,
        this._lastPlayerRef,
        this._lastSurvivalRef,
        this._lastGameMode,
        'creeper'
      );
    };
    ent.onTeleport = (fromPos, toPos) => {
      this.bus?.emit(ENGINE_EVENTS.ENDERMAN_TELEPORT, {
        id: ent.id,
        from: fromPos,
        to: toPos,
      });
    };
    ent.onShootArrow = (shooterOrOrigin, targetOrVelocity, explicitDamage, projectileKind = 'arrow') => {
      if (shooterOrOrigin && shooterOrOrigin.position && targetOrVelocity) {
        const origin = {
          x: shooterOrOrigin.position.x,
          y: shooterOrOrigin.position.y + shooterOrOrigin.height * 0.78,
          z: shooterOrOrigin.position.z,
        };
        const dx = targetOrVelocity.x - origin.x;
        const dy = targetOrVelocity.y - origin.y;
        const dz = targetOrVelocity.z - origin.z;
        const horiz = Math.hypot(dx, dz) || 1;
        const isFireball = projectileKind === 'fireball' || projectileKind === 'dragon_fireball';
        const speed = isFireball ? 15 : 18;
        const flightTime = horiz / speed;
        const leadY = isFireball ? dy : dy + 0.5 * 18 * flightTime * flightTime * 0.45;
        const norm = Math.hypot(dx, leadY, dz) || 1;
        const spread = isFireball ? 0.04 : 0.05;
        const velocity = {
          x: (dx / norm + (Math.random() - 0.5) * spread) * speed,
          y: (leadY / norm + (Math.random() - 0.5) * spread) * speed,
          z: (dz / norm + (Math.random() - 0.5) * spread) * speed,
        };
        const dmg = explicitDamage ?? shooterOrOrigin.def?.attackDamage ?? 3;
        this.spawnArrow(origin, velocity, 'mob', dmg, { kind: projectileKind });
      } else if (
        shooterOrOrigin &&
        Number.isFinite(shooterOrOrigin.x) &&
        targetOrVelocity &&
        Number.isFinite(targetOrVelocity.x)
      ) {
        this.spawnArrow(shooterOrOrigin, targetOrVelocity, 'mob', explicitDamage ?? 3, {
          kind: projectileKind,
        });
      }
    };

    this.entities.push(ent);

    if (this.scene) {
      this.scene.add(ent.buildMesh());
    }

    this.bus?.emit(ENGINE_EVENTS.ENTITY_SPAWNED, {
      id: ent.id,
      type: ent.type,
      position: { ...ent.position },
    });
    return ent;
  }

  /**
   * Spawns a starter herd of passive mobs around spawn so the world feels alive immediately.
   * @param {number} centerX
   * @param {number} centerZ
   * @param {number} [count=5]
   */
  spawnStarterMobs(centerX, centerZ, count = 5) {
    const passivePool = [MOB_TYPES.SHEEP, MOB_TYPES.COW, MOB_TYPES.PIG, MOB_TYPES.CHICKEN];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + 0.4;
      const dist = 7 + (i % 2) * 5;
      const wx = Math.floor(centerX + Math.cos(angle) * dist);
      const wz = Math.floor(centerZ + Math.sin(angle) * dist);
      const sy = this.world.getSurfaceY(wx, wz);
      if (sy > 1 && !this.world.isLiquidAt(wx, sy, wz)) {
        const type = passivePool[i % passivePool.length];
        this.spawnMob(type, wx + 0.5, sy + 1.05, wz + 0.5);
      }
    }
  }

  /**
   * Spawns a ballistic arrow or fireball projectile from player, Skeleton, Blaze, or Ender Dragon.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, y: number, z: number }} velocity
   * @param {'player'|'mob'} [owner='player']
   * @param {number} [damage=5]
   * @param {{ kind?: 'arrow'|'fireball'|'dragon_fireball', onFire?: boolean }} [opts]
   */
  spawnArrow(origin, velocity, owner = 'player', damage = 5, opts = {}) {
    const kind = opts.kind || 'arrow';
    const onFire = Boolean(opts.onFire);
    const arrow = {
      id: nextProjectileId++,
      kind,
      position: { x: origin.x, y: origin.y, z: origin.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      owner,
      damage,
      onFire,
      age: 0,
      stuck: false,
      mesh: this.scene ? this._createProjectileMesh(kind, onFire) : null,
    };
    if (arrow.mesh && this.scene) {
      arrow.mesh.position.set(origin.x, origin.y, origin.z);
      this._orientArrowMesh(arrow);
      this.scene.add(arrow.mesh);
    }
    this.arrows.push(arrow);
    this.bus?.emit(ENGINE_EVENTS.ARROW_FIRED, {
      id: arrow.id,
      owner,
      kind,
      position: { ...origin },
    });
    return arrow;
  }

  /**
   * Ensures the Ender Dragon boss & 8 End Crystals are spawned when entering The End.
   */
  ensureEndDragon() {
    if (this.world.dimension !== 'end' || this.dragonDefeated) return this.dragon;
    if (this.dragon && !this.dragon.dead) return this.dragon;

    const boss = new EnderDragonBoss();
    boss.onFireball = (origin, target) => {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dz = target.z - origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = 16;
      this.spawnArrow(
        origin,
        { x: (dx / len) * speed, y: (dy / len) * speed, z: (dz / len) * speed },
        'mob',
        6,
        { kind: 'dragon_fireball' }
      );
    };
    boss.onPlayerDamaged = (amount) => {
      this.bus?.emit(ENGINE_EVENTS.PLAYER_DAMAGED, { amount, source: 'ender_dragon' });
    };
    boss.onCrystalDestroyed = (crystal) => {
      this.bus?.emit(ENGINE_EVENTS.END_CRYSTAL_DESTROYED, { crystal });
      this.explode(
        crystal.x,
        crystal.y,
        crystal.z,
        2.4,
        12,
        this._lastPlayerRef,
        this._lastSurvivalRef,
        this._lastGameMode,
        'end_crystal'
      );
    };
    this.dragon = boss;
    if (this.scene) {
      this.scene.add(boss.buildMesh());
    }
    return boss;
  }

  /**
   * Returns current Boss Health Bar state (or null if not fighting the Dragon).
   */
  getBossBarState() {
    if (!this.dragon || this.dragon.dead || this.world.dimension !== 'end') return null;
    return this.dragon.getBossBarState();
  }

  /**
   * Attacks the Ender Dragon boss directly (melee or arrow).
   */
  attackDragon(damage) {
    if (!this.dragon || this.dragon.dead) return { hit: false, defeated: false };
    const defeated = this.dragon.takeDamage(damage);
    if (defeated) {
      this.dragonDefeated = true;
      this.bus?.emit(ENGINE_EVENTS.DRAGON_DEFEATED, {
        xpValue: 120,
        position: { ...this.dragon.position },
      });
      this.onDragonDefeated?.();
    }
    return { hit: true, defeated };
  }

  /**
   * Raycasts against Ender Dragon & End Crystals when in The End.
   */
  raycastBoss(origin, direction, maxDistance = 6.5) {
    if (!this.dragon || this.world.dimension !== 'end') {
      return { hit: false, target: null, distance: maxDistance };
    }
    return this.dragon.raycast(origin, direction, maxDistance);
  }

  /**
   * Launches a homing 3D Eye of Ender toward the world's Stronghold coordinates.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, z: number }} targetCoords
   */
  throwEyeOfEnder(origin, targetCoords) {
    const eye = {
      id: nextProjectileId++,
      position: { x: origin.x, y: origin.y, z: origin.z },
      target: { x: targetCoords.x, z: targetCoords.z },
      age: 0,
      duration: 2.0,
      mesh: this.scene ? this._createEyeMesh() : null,
    };
    if (eye.mesh && this.scene) {
      eye.mesh.position.set(origin.x, origin.y, origin.z);
      this.scene.add(eye.mesh);
    }
    this.thrownEyes.push(eye);
    this.bus?.emit(ENGINE_EVENTS.EYE_THROWN, {
      origin: { ...origin },
      target: { ...targetCoords },
    });
    return eye;
  }

  /**
   * Casts or reels in the player's Fishing Rod bobber.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, y: number, z: number }} dir
   * @returns {{ action: 'cast'|'reel', caught?: { itemId: string, count: number, enchants?: Record<string,number>, xp: number }|null }}
   */
  toggleFishingRod(origin, dir) {
    if (this.activeBobber) {
      const bobber = this.activeBobber;
      let caught = null;
      if (bobber.biting) {
        const r = Math.random();
        if (r < 0.5) {
          caught = { itemId: 'raw_cod', count: 1, xp: 3 };
        } else if (r < 0.8) {
          caught = { itemId: 'raw_salmon', count: 1, xp: 3 };
        } else if (r < 0.9) {
          caught = { itemId: 'emerald', count: 1, xp: 5 };
        } else if (r < 0.95) {
          caught = { itemId: 'leather_boots', count: 1, xp: 4 };
        } else {
          const bookPool = [
            { sharpness: 2 },
            { efficiency: 2 },
            { fortune: 1 },
            { protection: 2 },
            { power: 2 },
          ];
          const ench = bookPool[Math.floor(Math.random() * bookPool.length)];
          caught = { itemId: 'enchanted_book', count: 1, enchants: ench, xp: 7 };
        }
        this.bus?.emit(ENGINE_EVENTS.FISH_CAUGHT, caught);
      }
      this._clearBobber();
      return { action: 'reel', caught };
    }

    const bobber = {
      id: nextProjectileId++,
      position: { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6 },
      velocity: { x: dir.x * 11.5, y: dir.y * 11.5 + 2.2, z: dir.z * 11.5 },
      inWater: false,
      waitTimer: 3.0 + Math.random() * 4.0,
      biting: false,
      biteWindow: 0,
      mesh: this.scene ? this._createBobberMesh() : null,
    };
    if (bobber.mesh && this.scene) {
      bobber.mesh.position.set(bobber.position.x, bobber.position.y, bobber.position.z);
      this.scene.add(bobber.mesh);
    }
    this.activeBobber = bobber;
    return { action: 'cast', caught: null };
  }

  /**
   * Returns current fishing bobber state for HUD bite prompt & 3D fishing line rendering.
   */
  getFishingState() {
    if (!this.activeBobber) return null;
    return {
      position: { ...this.activeBobber.position },
      inWater: this.activeBobber.inWater,
      biting: this.activeBobber.biting,
    };
  }

  /**
   * Places a ridable Oak Boat in the world.
   */
  spawnBoat(x, y, z, yaw = 0) {
    const boat = {
      id: nextProjectileId++,
      position: { x, y, z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw,
      occupied: false,
      mesh: this.scene ? this._createBoatMesh() : null,
    };
    if (boat.mesh && this.scene) {
      boat.mesh.position.set(x, y, z);
      boat.mesh.rotation.y = yaw;
      this.scene.add(boat.mesh);
    }
    this.boats.push(boat);
    return boat;
  }

  /**
   * Raycasts against placed Oak Boats.
   */
  raycastBoat(origin, direction, maxDistance = 4.8) {
    let bestBoat = null;
    let bestDist = maxDistance;
    for (const boat of this.boats) {
      const box = {
        minX: boat.position.x - 0.72,
        maxX: boat.position.x + 0.72,
        minY: boat.position.y,
        maxY: boat.position.y + 0.65,
        minZ: boat.position.z - 0.72,
        maxZ: boat.position.z + 0.72,
      };
      const t = this._intersectRayAABB(origin, direction, box, bestDist);
      if (t !== null && t < bestDist) {
        bestDist = t;
        bestBoat = boat;
      }
    }
    return { hit: bestBoat !== null, boat: bestBoat, distance: bestDist };
  }

  getMountedBoat() {
    return this.boats.find((b) => b.occupied) || null;
  }

  boardBoat(boat, player) {
    if (!boat) return false;
    for (const b of this.boats) b.occupied = false;
    boat.occupied = true;
    player.position.x = boat.position.x;
    player.position.y = boat.position.y + 0.35;
    player.position.z = boat.position.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    this.bus?.emit(ENGINE_EVENTS.BOAT_MOUNTED, { id: boat.id, mounted: true });
    return true;
  }

  dismountBoat(player) {
    const boat = this.getMountedBoat();
    if (!boat) return false;
    boat.occupied = false;
    player.position.y = boat.position.y + 0.9;
    this.bus?.emit(ENGINE_EVENTS.BOAT_MOUNTED, { id: boat.id, mounted: false });
    return true;
  }

  pickupBoat(boat) {
    const idx = this.boats.indexOf(boat);
    if (idx === -1) return false;
    if (boat.mesh) {
      if (this.scene) this.scene.remove(boat.mesh);
      boat.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.boats.splice(idx, 1);
    this.itemDrops.spawnDrop(boat.position.x, boat.position.y + 0.4, boat.position.z, 'oak_boat', 1);
    return true;
  }

  /**
   * Ignites a TNT block at (wx, wy, wz), converting it into a bouncing primed TNT entity.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {number} [fuseSeconds=3.2]
   */
  igniteTnt(wx, wy, wz, fuseSeconds = 3.2) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    if (this.world.getBlock(ix, iy, iz) === BLOCK_IDS.TNT) {
      this.world.setBlock(ix, iy, iz, BLOCK_IDS.AIR, true, true);
    }
    const angle = Math.random() * Math.PI * 2;
    const tnt = {
      id: nextProjectileId++,
      position: { x: ix + 0.5, y: iy + 0.5, z: iz + 0.5 },
      velocity: { x: Math.cos(angle) * 1.4, y: 4.2, z: Math.sin(angle) * 1.4 },
      fuse: fuseSeconds,
      radius: 4.0,
      power: 24,
      mesh: this.scene ? this._createPrimedTntMesh() : null,
    };
    if (tnt.mesh && this.scene) {
      tnt.mesh.position.set(tnt.position.x, tnt.position.y, tnt.position.z);
      this.scene.add(tnt.mesh);
    }
    this.primedTnts.push(tnt);
    this.bus?.emit(ENGINE_EVENTS.TNT_PRIMED, {
      id: tnt.id,
      position: { ...tnt.position },
    });
    return tnt;
  }

  /**
   * Executes a radial voxel explosion respecting block blastResistance (protects Bedrock & Obsidian),
   * chains nearby TNT, spawns block drops, and deals distance-attenuated damage to mobs & player.
   * @param {number} cx
   * @param {number} cy
   * @param {number} cz
   * @param {number} [radius=3.8]
   * @param {number} [power=22]
   * @param {import('../physics/Player.js').Player|null} [player=null]
   * @param {import('../survival/SurvivalStats.js').SurvivalStats|null} [survival=null]
   * @param {'creative'|'survival'} [gameMode='survival']
   * @param {string} [source='explosion']
   * @returns {{ destroyedBlocks: number }}
   */
  explode(
    cx,
    cy,
    cz,
    radius = 3.8,
    power = 22,
    player = this._lastPlayerRef,
    survival = this._lastSurvivalRef,
    gameMode = this._lastGameMode,
    source = 'explosion'
  ) {
    const rInt = Math.ceil(radius);
    const ix0 = Math.floor(cx);
    const iy0 = Math.floor(cy);
    const iz0 = Math.floor(cz);
    let destroyedBlocks = 0;
    const touchedChunks = new Set();

    for (let dx = -rInt; dx <= rInt; dx++) {
      for (let dy = -rInt; dy <= rInt; dy++) {
        for (let dz = -rInt; dz <= rInt; dz++) {
          const dist = Math.hypot(dx, dy, dz);
          if (dist > radius) continue;
          const wx = ix0 + dx;
          const wy = iy0 + dy;
          const wz = iz0 + dz;
          if (wy <= 0) continue;

          const id = this.world.getBlock(wx, wy, wz);
          if (id === BLOCK_IDS.AIR) continue;

          // Chain-ignite nearby TNT instead of destroying it immediately
          if (id === BLOCK_IDS.TNT) {
            this.igniteTnt(wx, wy, wz, 0.55 + Math.random() * 0.45);
            continue;
          }

          const resistance = this.world.blockRegistry.getBlastResistance(id);
          const localPower = power * (1 - (dist / (radius + 0.5)) * 0.65);
          if (resistance >= localPower || !this.world.blockRegistry.isBreakable(id)) {
            continue;
          }

          // Collect block-entity contents if any (Chest/Furnace)
          const extraDrops = this.onBlockDestroyedByExplosion?.(wx, wy, wz) ?? [];
          for (const ed of extraDrops) {
            this.itemDrops.spawnDrop(wx + 0.5, wy + 0.5, wz + 0.5, ed.itemId, ed.count);
          }

          // Use batch setBlock without immediate remesh, then remesh chunks once after loop
          if (this.world.setBlock(wx, wy, wz, BLOCK_IDS.AIR, true, false)) {
            destroyedBlocks++;
            const cc = this.world.chunkManager.worldToChunkCoord(wx, wz);
            touchedChunks.add(`${cc.chunkX},${cc.chunkZ}`);
            if (Math.random() < 0.35) {
              const drops = this.itemRegistry.getDropsForBlock(id);
              for (const d of drops) {
                this.itemDrops.spawnDrop(wx + 0.5, wy + 0.5, wz + 0.5, d.itemId, d.count);
              }
            }
          }
        }
      }
    }

    // Remesh all affected chunks + their neighbors cleanly in one pass
    for (const key of touchedChunks) {
      const [chunkX, chunkZ] = key.split(',').map(Number);
      this.world.chunkManager.remeshNeighborhoodForBlock(chunkX * 16 + 8, chunkZ * 16 + 8);
      this.world.chunkManager.remeshNeighborhoodForBlock(chunkX * 16, chunkZ * 16);
      this.world.chunkManager.remeshNeighborhoodForBlock(chunkX * 16 + 15, chunkZ * 16 + 15);
    }

    // Damage & knockback nearby entities
    const blastReach = radius * 1.8;
    for (const ent of this.entities) {
      if (ent.dead) continue;
      const dist = Math.hypot(ent.position.x - cx, ent.position.y - cy, ent.position.z - cz);
      if (dist < blastReach) {
        const factor = 1 - dist / blastReach;
        const dmg = Math.max(2, Math.round(factor * 18));
        this.attackEntity(ent, dmg, { x: cx, y: cy, z: cz });
      }
    }

    // Damage & knockback player in Survival
    if (player && survival && gameMode === 'survival' && !survival.isDead) {
      const pPos = player.getPosition();
      const dist = Math.hypot(pPos.x - cx, pPos.y + 0.9 - cy, pPos.z - cz);
      if (dist < blastReach) {
        const factor = 1 - dist / blastReach;
        const dmg = Math.max(2, Math.round(factor * 14));
        const dealt = survival.applyDamage(dmg, source);
        const dx = pPos.x - cx;
        const dz = pPos.z - cz;
        const len = Math.hypot(dx, dz) || 1;
        player.velocity.x += (dx / len) * (8 * factor);
        player.velocity.y = Math.max(player.velocity.y, 6.5 * factor);
        player.velocity.z += (dz / len) * (8 * factor);
        if (dealt > 0) {
          this.bus?.emit(ENGINE_EVENTS.PLAYER_DAMAGED, { amount: dealt, source });
        }
      }
    }

    this.bus?.emit(ENGINE_EVENTS.EXPLOSION, {
      position: { x: cx, y: cy, z: cz },
      radius,
      destroyedBlocks,
      source,
    });
    return { destroyedBlocks };
  }

  /**
   * Raycasts against all live mob AABBs to support player melee attacks.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, y: number, z: number }} direction
   * @param {number} [maxDistance=4.5]
   * @returns {{ hit: boolean, entity: Entity|null, distance: number }}
   */
  raycastEntity(origin, direction, maxDistance = 4.5) {
    let bestEntity = null;
    let bestDist = maxDistance;

    for (let i = 0; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (ent.dead) continue;
      const box = ent.getBoundingBox();
      const t = this._intersectRayAABB(origin, direction, box, bestDist);
      if (t !== null && t < bestDist) {
        bestDist = t;
        bestEntity = ent;
      }
    }

    return {
      hit: bestEntity !== null,
      entity: bestEntity,
      distance: bestDist,
    };
  }

  /**
   * Attacks a target entity with damage and knockback, spawning drops on death (with Looting support)
   * and signaling nearby tamed Wolves to assist.
   * @param {Entity} entity
   * @param {number} damage
   * @param {{ x: number, y: number, z: number }} attackerPos
   * @param {number} [lootingLevel=0]
   * @returns {{ hit: boolean, killed: boolean }}
   */
  attackEntity(entity, damage, attackerPos, lootingLevel = 0) {
    if (!entity || entity.dead) return { hit: false, killed: false };
    const killed = entity.takeDamage(damage, attackerPos);
    if (!killed && !entity.tamed) {
      this.onPlayerAttackedMob(entity);
    }
    if (killed) {
      this._handleEntityDeath(entity, lootingLevel);
    }
    return { hit: true, killed };
  }

  /**
   * Directs all standing tamed Wolves within 18 blocks to attack the player's target.
   * @param {Entity} targetMob
   */
  onPlayerAttackedMob(targetMob) {
    if (!targetMob || targetMob.dead || targetMob.tamed) return;
    for (const ent of this.entities) {
      if (ent.dead || ent.type !== MOB_TYPES.WOLF || !ent.tamed || ent.sitting) continue;
      if (ent === targetMob) continue;
      const d = Math.hypot(
        ent.position.x - targetMob.position.x,
        ent.position.z - targetMob.position.z
      );
      if (d <= 20) {
        ent.wolfTarget = targetMob;
      }
    }
  }

  /**
   * Handles right-clicking a Wolf: Bone tames it, meat heals it, empty/other hand toggles Sit/Stand.
   * @param {Entity} entity
   * @param {string|null} heldItemId
   * @returns {{ action: 'tamed'|'tame_failed'|'healed'|'sit'|'stand'|'none', consumeItem: boolean }}
   */
  interactWolf(entity, heldItemId) {
    if (!entity || entity.dead || entity.type !== MOB_TYPES.WOLF) {
      return { action: 'none', consumeItem: false };
    }
    if (!entity.tamed) {
      if (heldItemId === 'bone') {
        if (Math.random() < 0.65) {
          entity.tameWolf();
          this.bus?.emit(ENGINE_EVENTS.WOLF_TAMED, { id: entity.id, position: { ...entity.position } });
          return { action: 'tamed', consumeItem: true };
        }
        return { action: 'tame_failed', consumeItem: true };
      }
      return { action: 'none', consumeItem: false };
    }

    const meatItems = new Set([
      'raw_beef',
      'cooked_beef',
      'raw_porkchop',
      'cooked_porkchop',
      'raw_chicken',
      'cooked_chicken',
      'raw_cod',
      'cooked_cod',
      'raw_salmon',
      'cooked_salmon',
    ]);
    if (heldItemId && meatItems.has(heldItemId) && entity.healWolf(5)) {
      return { action: 'healed', consumeItem: true };
    }

    const sitting = entity.toggleSit();
    return { action: sitting ? 'sit' : 'stand', consumeItem: false };
  }

  /**
   * Shears a targeted Sheep entity, spawning 1-3 white_wool drops.
   * @param {Entity} entity
   * @returns {{ sheared: boolean, count: number }}
   */
  shearSheep(entity) {
    if (!entity || entity.dead || entity.type !== MOB_TYPES.SHEEP) {
      return { sheared: false, count: 0 };
    }
    if (!entity.shear()) {
      return { sheared: false, count: 0 };
    }
    const count = 1 + Math.floor(Math.random() * 3);
    this.itemDrops.spawnDrop(
      entity.position.x,
      entity.position.y + 0.7,
      entity.position.z,
      'white_wool',
      count
    );
    this.bus?.emit(ENGINE_EVENTS.SHEEP_SHEARED, {
      id: entity.id,
      position: { ...entity.position },
      count,
    });
    return { sheared: true, count };
  }

  /**
   * Checks if the player's crosshair is staring directly at any unprovoked Enderman's head.
   * @param {{ x: number, y: number, z: number }} eyePos
   * @param {{ x: number, y: number, z: number }} forwardVec
   * @returns {boolean}
   */
  checkEndermanStare(eyePos, forwardVec) {
    let provokedAny = false;
    for (let i = 0; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (ent.dead || ent.type !== MOB_TYPES.ENDERMAN || ent.provoked) continue;
      const hx = ent.position.x - eyePos.x;
      const hy = ent.position.y + 2.45 - eyePos.y;
      const hz = ent.position.z - eyePos.z;
      const dist = Math.hypot(hx, hy, hz);
      if (dist > 24 || dist < 1.2) continue;
      const dot = (hx * forwardVec.x + hy * forwardVec.y + hz * forwardVec.z) / dist;
      if (dot > 0.985) {
        ent.provoke();
        provokedAny = true;
      }
    }
    return provokedAny;
  }

  /** @private */
  _handleEntityDeath(entity, lootingLevel = 0) {
    for (const drop of entity.def.drops) {
      const chance = Math.min(1, (drop.chance ?? 1) + lootingLevel * 0.12);
      if (Math.random() <= chance) {
        const extra = lootingLevel > 0 ? Math.floor(Math.random() * (lootingLevel + 1)) : 0;
        this.itemDrops.spawnDrop(
          entity.position.x,
          entity.position.y + 0.5,
          entity.position.z,
          drop.itemId,
          drop.count + extra
        );
      }
    }
    this.bus?.emit(ENGINE_EVENTS.ENTITY_KILLED, {
      id: entity.id,
      type: entity.type,
      position: { ...entity.position },
      xpValue: entity.def.xpValue ?? 2,
    });
  }

  /**
   * Updates natural spawning, AI ticks, arrows/fireballs, primed TNT, Ender Dragon, Eyes of Ender,
   * Fishing Bobber, and Oak Boats.
   * @param {number} deltaTime
   * @param {import('../physics/Player.js').Player} player
   * @param {import('../survival/SurvivalStats.js').SurvivalStats|null} survival
   * @param {'creative'|'survival'} gameMode
   */
  update(deltaTime, player, survival, gameMode) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.1);
    this._lastPlayerRef = player;
    this._lastSurvivalRef = survival;
    this._lastGameMode = gameMode;

    const pPos = player.getPosition();

    // 1. Periodic ambient spawning around loaded chunks
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = 3.5;
      if (this.entities.length < this.maxMobs) {
        this._tryAmbientSpawn(pPos);
      }
    }

    // 2. Step each mob entity & remove dead/far entities
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const ent = this.entities[i];
      if (!ent.dead) {
        ent.update(dt, player, survival, gameMode, this.entities);
      }

      const dist = Math.hypot(ent.position.x - pPos.x, ent.position.z - pPos.z);
      // Never despawn tamed wolves or villagers while reasonably near
      const maxDespawnDist = ent.tamed ? 140 : ent.type === MOB_TYPES.VILLAGER ? 84 : 56;
      if (ent.dead || dist > maxDespawnDist) {
        if (ent.dead && !ent._deathHandled) {
          ent._deathHandled = true;
          this._handleEntityDeath(ent, 0);
        }
        if (this.scene && ent.mesh) {
          this.scene.remove(ent.mesh);
        }
        ent.dispose();
        this.entities.splice(i, 1);
      }
    }

    // 3. Step arrows & fireballs
    this._updateArrows(dt, player, survival, gameMode);

    // 4. Step primed TNT
    this._updatePrimedTnts(dt, player, survival, gameMode);

    // 5. Step Ender Dragon & End Crystals
    if (this.dragon && this.world.dimension === 'end') {
      this.dragon.update(dt, player, survival, gameMode);
    }

    // 6. Step Thrown Eyes of Ender
    this._updateThrownEyes(dt);

    // 7. Step Fishing Bobber
    this._updateFishingBobber(dt, pPos);

    // 8. Step Oak Boats buoyancy & water physics
    this._updateBoats(dt, player);
  }

  /** @private */
  _updateArrows(dt, player, survival, gameMode) {
    const pPos = player.getPosition();
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      if (a.age > 12) {
        this._disposeArrow(a);
        this.arrows.splice(i, 1);
        continue;
      }

      if (!a.stuck) {
        const isFireball = a.kind === 'fireball' || a.kind === 'dragon_fireball';
        if (!isFireball) {
          a.velocity.y -= 18 * dt;
        }
        const nx = a.position.x + a.velocity.x * dt;
        const ny = a.position.y + a.velocity.y * dt;
        const nz = a.position.z + a.velocity.z * dt;

        // Check block collision
        if (this.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
          if (isFireball) {
            this._disposeArrow(a);
            this.arrows.splice(i, 1);
            continue;
          }
          a.stuck = true;
          a.velocity.x = 0;
          a.velocity.y = 0;
          a.velocity.z = 0;
          a.age = Math.max(a.age, 7);
          continue;
        }

        a.position.x = nx;
        a.position.y = ny;
        a.position.z = nz;

        let consumed = false;
        if (a.owner === 'player') {
          // Check End Crystals & Ender Dragon first in The End
          if (this.dragon && this.world.dimension === 'end') {
            const hitCrystal = this.dragon.checkPointHitCrystal(nx, ny, nz, 1.25);
            if (hitCrystal) {
              this.dragon.destroyCrystal(hitCrystal.id);
              consumed = true;
            } else if (!this.dragon.dead && this.dragon.checkPointHitDragon(nx, ny, nz, 0.7)) {
              const totalDmg = a.damage + (a.onFire ? 3 : 0);
              this.attackDragon(totalDmg);
              consumed = true;
            }
          }

          if (!consumed) {
            for (const ent of this.entities) {
              if (ent.dead) continue;
              const box = ent.getBoundingBox();
              if (
                nx >= box.minX - 0.12 &&
                nx <= box.maxX + 0.12 &&
                ny >= box.minY - 0.12 &&
                ny <= box.maxY + 0.12 &&
                nz >= box.minZ - 0.12 &&
                nz <= box.maxZ + 0.12
              ) {
                const totalDmg = a.damage + (a.onFire ? 3 : 0);
                this.attackEntity(ent, totalDmg, {
                  x: nx - a.velocity.x * 0.1,
                  y: ny,
                  z: nz - a.velocity.z * 0.1,
                });
                consumed = true;
                break;
              }
            }
          }
        } else if (survival && gameMode === 'survival' && !survival.isDead) {
          // Mob arrows & fireballs hit player
          const hitPad = isFireball ? 0.65 : 0.45;
          if (
            Math.abs(nx - pPos.x) < hitPad &&
            ny >= pPos.y &&
            ny <= pPos.y + 1.85 &&
            Math.abs(nz - pPos.z) < hitPad
          ) {
            const dmgSource =
              a.kind === 'dragon_fireball'
                ? 'dragon_fireball'
                : a.kind === 'fireball'
                ? 'fireball'
                : 'skeleton';
            const dealt = survival.applyDamage(a.damage, dmgSource);
            if (dealt > 0) {
              this.bus?.emit(ENGINE_EVENTS.PLAYER_DAMAGED, { amount: dealt, source: dmgSource });
            }
            consumed = true;
          }
        }

        if (consumed) {
          this._disposeArrow(a);
          this.arrows.splice(i, 1);
          continue;
        }

        if (a.mesh) {
          a.mesh.position.set(a.position.x, a.position.y, a.position.z);
          if (isFireball) {
            a.mesh.rotation.x += dt * 5;
            a.mesh.rotation.y += dt * 6;
          } else {
            this._orientArrowMesh(a);
          }
        }
      }
    }
  }

  /** @private */
  _updateThrownEyes(dt) {
    for (let i = this.thrownEyes.length - 1; i >= 0; i--) {
      const eye = this.thrownEyes[i];
      eye.age += dt;
      const dx = eye.target.x - eye.position.x;
      const dz = eye.target.z - eye.position.z;
      const hDist = Math.hypot(dx, dz) || 1;
      const moveSpeed = Math.min(8.5, hDist * 1.2);
      eye.position.x += (dx / hDist) * moveSpeed * dt;
      eye.position.z += (dz / hDist) * moveSpeed * dt;
      // Rise gently first 1.2s, then hover
      eye.position.y += (eye.age < 1.2 ? 2.4 : 0.15) * dt;

      if (eye.mesh) {
        eye.mesh.position.set(eye.position.x, eye.position.y, eye.position.z);
        eye.mesh.rotation.y += dt * 5.0;
        eye.mesh.rotation.x += dt * 2.5;
      }

      if (eye.age >= eye.duration) {
        if (Math.random() < 0.8) {
          this.itemDrops.spawnDrop(eye.position.x, eye.position.y, eye.position.z, 'eye_of_ender', 1);
        }
        if (eye.mesh) {
          if (this.scene) this.scene.remove(eye.mesh);
          eye.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
          });
        }
        this.thrownEyes.splice(i, 1);
      }
    }
  }

  /** @private */
  _updateFishingBobber(dt, playerPos) {
    const b = this.activeBobber;
    if (!b) return;

    // Auto-reel if player walks > 26 blocks away
    const dist = Math.hypot(b.position.x - playerPos.x, b.position.z - playerPos.z);
    if (dist > 26) {
      this._clearBobber();
      return;
    }

    const bx = Math.floor(b.position.x);
    const by = Math.floor(b.position.y);
    const bz = Math.floor(b.position.z);
    const inLiquid = this.world.isLiquidAt(bx, by, bz);

    if (inLiquid) {
      b.inWater = true;
      b.velocity.x *= 0.82;
      b.velocity.z *= 0.82;
      // Float on water surface
      const surfaceY = by + 0.86;
      b.position.y += (surfaceY - b.position.y) * Math.min(1, dt * 8);
      b.velocity.y = 0;

      if (!b.biting) {
        b.waitTimer -= dt;
        if (b.waitTimer <= 0) {
          b.biting = true;
          b.biteWindow = 2.4;
        }
      } else {
        b.biteWindow -= dt;
        // Bobber dips down visibly while fish is biting!
        b.position.y = surfaceY - 0.34 + Math.sin(b.biteWindow * 24) * 0.08;
        if (b.biteWindow <= 0) {
          b.biting = false;
          b.waitTimer = 3.0 + Math.random() * 4.0;
        }
      }
    } else {
      b.inWater = false;
      b.biting = false;
      b.velocity.y -= 18 * dt;
      const nx = b.position.x + b.velocity.x * dt;
      const ny = b.position.y + b.velocity.y * dt;
      const nz = b.position.z + b.velocity.z * dt;
      if (this.world.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        b.velocity.x = 0;
        b.velocity.y = 0;
        b.velocity.z = 0;
      } else {
        b.position.x = nx;
        b.position.y = ny;
        b.position.z = nz;
      }
    }

    if (b.mesh) {
      b.mesh.position.set(b.position.x, b.position.y, b.position.z);
    }
  }

  /** @private */
  _clearBobber() {
    if (!this.activeBobber) return;
    if (this.activeBobber.mesh) {
      if (this.scene) this.scene.remove(this.activeBobber.mesh);
      this.activeBobber.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.activeBobber = null;
  }

  /** @private */
  _updateBoats(dt, player) {
    for (const boat of this.boats) {
      const bx = Math.floor(boat.position.x);
      const by = Math.floor(boat.position.y);
      const bz = Math.floor(boat.position.z);
      const inWater = this.world.isLiquidAt(bx, by, bz) || this.world.isLiquidAt(bx, by - 1, bz);

      if (boat.occupied) {
        // Steering & propulsion driven by player inputs
        const input = player.inputState;
        const turnRate = 2.4;
        if (input?.left) boat.yaw += turnRate * dt;
        if (input?.right) boat.yaw -= turnRate * dt;

        const thrust = (input?.forward ? 1 : 0) - (input?.backward ? 0.5 : 0);
        const speed = inWater ? 9.4 : 2.6;
        if (Math.abs(thrust) > 0.01) {
          const fx = -Math.sin(boat.yaw);
          const fz = -Math.cos(boat.yaw);
          boat.velocity.x += fx * thrust * speed * 4.5 * dt;
          boat.velocity.z += fz * thrust * speed * 4.5 * dt;
        }
      }

      // Water drag & speed cap
      const drag = inWater ? 0.92 : 0.84;
      boat.velocity.x *= Math.pow(drag, dt * 60);
      boat.velocity.z *= Math.pow(drag, dt * 60);
      const hSpeed = Math.hypot(boat.velocity.x, boat.velocity.z);
      const maxSpeed = inWater ? 9.6 : 2.8;
      if (hSpeed > maxSpeed) {
        boat.velocity.x = (boat.velocity.x / hSpeed) * maxSpeed;
        boat.velocity.z = (boat.velocity.z / hSpeed) * maxSpeed;
      }

      const nx = boat.position.x + boat.velocity.x * dt;
      const nz = boat.position.z + boat.velocity.z * dt;
      if (!this.world.isSolidAt(Math.floor(nx), Math.floor(boat.position.y + 0.35), Math.floor(boat.position.z))) {
        boat.position.x = nx;
      } else {
        boat.velocity.x = 0;
      }
      if (!this.world.isSolidAt(Math.floor(boat.position.x), Math.floor(boat.position.y + 0.35), Math.floor(nz))) {
        boat.position.z = nz;
      } else {
        boat.velocity.z = 0;
      }

      // Buoyancy vs gravity
      if (this.world.isLiquidAt(Math.floor(boat.position.x), Math.floor(boat.position.y), Math.floor(boat.position.z))) {
        const targetY = Math.floor(boat.position.y) + 0.72;
        boat.position.y += (targetY - boat.position.y) * Math.min(1, dt * 8);
        boat.velocity.y = 0;
      } else {
        boat.velocity.y -= 20 * dt;
        const ny = boat.position.y + boat.velocity.y * dt;
        if (!this.world.isSolidAt(Math.floor(boat.position.x), Math.floor(ny), Math.floor(boat.position.z))) {
          boat.position.y = ny;
        } else {
          boat.position.y = Math.floor(ny) + 1.0;
          boat.velocity.y = 0;
        }
      }

      if (boat.occupied) {
        player.position.x = boat.position.x;
        player.position.y = boat.position.y + 0.32;
        player.position.z = boat.position.z;
        player.velocity.x = boat.velocity.x;
        player.velocity.y = 0;
        player.velocity.z = boat.velocity.z;
        player.grounded = true;
      }

      if (boat.mesh) {
        boat.mesh.position.set(boat.position.x, boat.position.y, boat.position.z);
        boat.mesh.rotation.y = boat.yaw;
      }
    }
  }

  /** @private */
  _updatePrimedTnts(dt, player, survival, gameMode) {
    for (let i = this.primedTnts.length - 1; i >= 0; i--) {
      const t = this.primedTnts[i];
      t.fuse -= dt;

      t.velocity.y -= 24 * dt;
      const nx = t.position.x + t.velocity.x * dt;
      const ny = t.position.y + t.velocity.y * dt;
      const nz = t.position.z + t.velocity.z * dt;

      if (!this.world.isSolidAt(Math.floor(nx), Math.floor(t.position.y), Math.floor(t.position.z))) {
        t.position.x = nx;
      } else {
        t.velocity.x *= -0.25;
      }
      if (!this.world.isSolidAt(Math.floor(t.position.x), Math.floor(t.position.y), Math.floor(nz))) {
        t.position.z = nz;
      } else {
        t.velocity.z *= -0.25;
      }
      if (!this.world.isSolidAt(Math.floor(t.position.x), Math.floor(ny - 0.48), Math.floor(t.position.z))) {
        t.position.y = ny;
      } else {
        t.velocity.y = 0;
        t.velocity.x *= 0.72;
        t.velocity.z *= 0.72;
      }

      if (t.mesh) {
        t.mesh.position.set(t.position.x, t.position.y, t.position.z);
        const blink = Math.floor(t.fuse * 10) % 2 === 0;
        const mat = /** @type {THREE.MeshLambertMaterial} */ (t.mesh.material);
        mat.color.setHex(blink ? 0xffffff : 0xc62828);
        const swell = t.fuse < 0.45 ? 1 + (0.45 - t.fuse) * 0.45 : 1;
        t.mesh.scale.setScalar(swell);
      }

      if (t.fuse <= 0) {
        if (this.scene && t.mesh) this.scene.remove(t.mesh);
        t.mesh?.geometry.dispose();
        if (t.mesh?.material && !Array.isArray(t.mesh.material)) t.mesh.material.dispose();
        const pos = { ...t.position };
        const rad = t.radius;
        const pow = t.power;
        this.primedTnts.splice(i, 1);
        this.explode(pos.x, pos.y, pos.z, rad, pow, player, survival, gameMode, 'tnt');
      }
    }
  }

  /** @private */
  _createProjectileMesh(kind = 'arrow', onFire = false) {
    if (kind === 'fireball' || kind === 'dragon_fireball') {
      const isDragon = kind === 'dragon_fireball';
      return new THREE.Mesh(
        new THREE.OctahedronGeometry(isDragon ? 0.34 : 0.24, 0),
        new THREE.MeshLambertMaterial({
          color: isDragon ? 0xe879f9 : 0xf97316,
          emissive: isDragon ? 0xa21caf : 0xea580c,
          emissiveIntensity: 1.2,
        })
      );
    }
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.68),
      new THREE.MeshLambertMaterial({ color: 0x8d6e4c })
    );
    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.14),
      new THREE.MeshLambertMaterial({
        color: onFire ? 0xf97316 : 0xcfd8dc,
        emissive: onFire ? 0xea580c : 0x000000,
        emissiveIntensity: onFire ? 1.1 : 0,
      })
    );
    tip.position.z = 0.36;
    const fletch = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 0.14),
      new THREE.MeshLambertMaterial({ color: 0xf5f5f5 })
    );
    fletch.position.z = -0.3;
    group.add(shaft, tip, fletch);
    return group;
  }

  /** @private */
  _createEyeMesh() {
    const group = new THREE.Group();
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 1),
      new THREE.MeshLambertMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.9,
      })
    );
    const pupil = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.28, 0.36),
      new THREE.MeshLambertMaterial({
        color: 0x0f172a,
        emissive: 0x34d399,
        emissiveIntensity: 0.3,
      })
    );
    group.add(orb, pupil);
    return group;
  }

  /** @private */
  _createBobberMesh() {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.12, 0.16),
      new THREE.MeshLambertMaterial({ color: 0xef4444 })
    );
    top.position.y = 0.06;
    const bottom = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.12, 0.16),
      new THREE.MeshLambertMaterial({ color: 0xf8fafc })
    );
    bottom.position.y = -0.06;
    group.add(top, bottom);
    return group;
  }

  /** @private */
  _createBoatMesh() {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x9c7244 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x70502c });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.14, 1.56), woodMat);
    floor.position.y = 0.07;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 1.56), trimMat);
    leftWall.position.set(-0.56, 0.28, 0);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 1.56), trimMat);
    rightWall.position.set(0.56, 0.28, 0);
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.42, 0.16), trimMat);
    frontWall.position.set(0, 0.28, -0.74);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.42, 0.16), trimMat);
    backWall.position.set(0, 0.28, 0.74);

    // Paddles mounted on sides
    const leftOar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.12), woodMat);
    leftOar.position.set(-0.78, 0.42, 0.08);
    const rightOar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.12), woodMat);
    rightOar.position.set(0.78, 0.42, 0.08);

    group.add(floor, leftWall, rightWall, frontWall, backWall, leftOar, rightOar);
    return group;
  }

  /** @private */
  _orientArrowMesh(arrow) {
    if (!arrow.mesh) return;
    const vx = arrow.velocity.x;
    const vy = arrow.velocity.y;
    const vz = arrow.velocity.z;
    const horiz = Math.hypot(vx, vz);
    if (horiz + Math.abs(vy) > 0.01) {
      arrow.mesh.rotation.order = 'YXZ';
      arrow.mesh.rotation.y = Math.atan2(vx, vz);
      arrow.mesh.rotation.x = -Math.atan2(vy, horiz);
    }
  }

  /** @private */
  _disposeArrow(arrow) {
    if (!arrow.mesh) return;
    if (this.scene) this.scene.remove(arrow.mesh);
    arrow.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    arrow.mesh = null;
  }

  /** @private */
  _createPrimedTntMesh() {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.98, 0.98),
      new THREE.MeshLambertMaterial({ color: 0xc62828 })
    );
  }

  /** @private */
  _tryAmbientSpawn(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 18;
    const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);
    const { chunkX, chunkZ } = this.world.chunkManager.worldToChunkCoord(wx, wz);
    if (!this.world.chunkManager.getChunk(chunkX, chunkZ)) return;

    const sy = this.world.getSurfaceY(wx, wz);
    if (sy <= 1 || this.world.isLiquidAt(wx, sy, wz)) return;

    let type;
    if (this.world.dimension === 'end') {
      type = MOB_TYPES.ENDERMAN;
    } else if (this.world.dimension === 'nether') {
      const r = Math.random();
      if (r < 0.5) type = MOB_TYPES.ZOMBIFIED_PIGLIN;
      else if (r < 0.78) type = MOB_TYPES.BLAZE;
      else if (r < 0.92) type = MOB_TYPES.ENDERMAN;
      else type = MOB_TYPES.SKELETON;
    } else {
      const isNight = this.world.getSkyBrightness() < 0.45;
      if (isNight) {
        const r = Math.random();
        if (r < 0.26) type = MOB_TYPES.ZOMBIE;
        else if (r < 0.48) type = MOB_TYPES.CREEPER;
        else if (r < 0.68) type = MOB_TYPES.SKELETON;
        else if (r < 0.84) type = MOB_TYPES.SPIDER;
        else if (r < 0.93) type = MOB_TYPES.SLIME;
        else type = MOB_TYPES.ENDERMAN;
      } else {
        const r = Math.random();
        if (r < 0.22) type = MOB_TYPES.SHEEP;
        else if (r < 0.44) type = MOB_TYPES.COW;
        else if (r < 0.64) type = MOB_TYPES.PIG;
        else if (r < 0.78) type = MOB_TYPES.CHICKEN;
        else if (r < 0.9) type = MOB_TYPES.WOLF;
        else type = MOB_TYPES.VILLAGER;
      }
    }

    this.spawnMob(type, wx + 0.5, sy + 1.05, wz + 0.5);
  }

  /**
   * Slab method ray-AABB intersection returning hit distance t >= 0 or null.
   * @private
   */
  _intersectRayAABB(origin, dir, box, maxDist) {
    let tmin = 0;
    let tmax = maxDist;

    const axes = [
      [origin.x, dir.x, box.minX, box.maxX],
      [origin.y, dir.y, box.minY, box.maxY],
      [origin.z, dir.z, box.minZ, box.maxZ],
    ];

    for (let i = 0; i < 3; i++) {
      const [o, d, minB, maxB] = axes[i];
      if (Math.abs(d) < 1e-7) {
        if (o < minB || o > maxB) return null;
      } else {
        let t1 = (minB - o) / d;
        let t2 = (maxB - o) / d;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }

    return tmin >= 0 && tmin <= maxDist ? tmin : null;
  }

  /**
   * Clears all active entities, arrows, and primed TNT from simulation and scene.
   */
  clear() {
    for (const ent of this.entities) {
      if (this.scene && ent.mesh) {
        this.scene.remove(ent.mesh);
      }
      ent.dispose();
    }
    this.entities = [];

    for (const arr of this.arrows) {
      this._disposeArrow(arr);
    }
    this.arrows = [];

    for (const tnt of this.primedTnts) {
      if (this.scene && tnt.mesh) this.scene.remove(tnt.mesh);
      tnt.mesh?.geometry.dispose();
      if (tnt.mesh?.material && !Array.isArray(tnt.mesh.material)) tnt.mesh.material.dispose();
    }
    this.primedTnts = [];

    if (this.dragon) {
      if (this.scene && this.dragon.group) this.scene.remove(this.dragon.group);
      this.dragon.dispose();
      this.dragon = null;
    }

    for (const eye of this.thrownEyes) {
      if (eye.mesh) {
        if (this.scene) this.scene.remove(eye.mesh);
        eye.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
      }
    }
    this.thrownEyes = [];
    this._clearBobber();

    for (const boat of this.boats) {
      if (boat.mesh) {
        if (this.scene) this.scene.remove(boat.mesh);
        boat.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
      }
    }
    this.boats = [];
  }

  dispose() {
    this.clear();
    this.scene = null;
  }
}
