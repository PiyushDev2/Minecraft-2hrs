/**
 * @file EntityManager.js
 * @description Manages live world mobs: natural biome/day-night spawning, despawning,
 * entity raycasting for player melee attacks, AI updates, loot drops, and Three.js scene sync.
 */

import { ENGINE_EVENTS } from '../core/EventBus.js';
import { Entity } from './Entity.js';
import { MOB_TYPES } from './MobTypes.js';

/**
 * Coordinates all passive and hostile mob entities in the world.
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
    /** @type {import('three').Scene|null} */
    this.scene = null;
    /** @type {number} */
    this.maxMobs = 14;
    /** @type {number} */
    this._spawnTimer = 1.5;
  }

  /**
   * Attaches or detaches a Three.js Scene for rendering active mobs.
   * @param {import('three').Scene|null} scene
   */
  attachScene(scene) {
    if (this.scene) {
      for (const ent of this.entities) {
        if (ent.mesh) this.scene.remove(ent.mesh);
      }
    }
    this.scene = scene;
    if (this.scene) {
      for (const ent of this.entities) {
        const mesh = ent.buildMesh();
        this.scene.add(mesh);
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
   * @param {number} [count=4]
   */
  spawnStarterMobs(centerX, centerZ, count = 4) {
    const passivePool = [MOB_TYPES.SHEEP, MOB_TYPES.COW];
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
   * Attacks a target entity with damage and knockback, spawning drops on death.
   * @param {Entity} entity
   * @param {number} damage
   * @param {{ x: number, y: number, z: number }} attackerPos
   * @returns {{ hit: boolean, killed: boolean }}
   */
  attackEntity(entity, damage, attackerPos) {
    if (!entity || entity.dead) return { hit: false, killed: false };
    const killed = entity.takeDamage(damage, attackerPos);
    if (killed) {
      this._handleEntityDeath(entity);
    }
    return { hit: true, killed };
  }

  /**
   * @private
   */
  _handleEntityDeath(entity) {
    for (const drop of entity.def.drops) {
      if (Math.random() <= (drop.chance ?? 1)) {
        this.itemDrops.spawnDrop(
          entity.position.x,
          entity.position.y + 0.5,
          entity.position.z,
          drop.itemId,
          drop.count
        );
      }
    }
    this.bus?.emit(ENGINE_EVENTS.ENTITY_KILLED, {
      id: entity.id,
      type: entity.type,
      position: { ...entity.position },
    });
  }

  /**
   * Updates natural spawning, AI ticks, despawning, and cleanup.
   * @param {number} deltaTime
   * @param {import('../physics/Player.js').Player} player
   * @param {import('../survival/SurvivalStats.js').SurvivalStats|null} survival
   * @param {'creative'|'survival'} gameMode
   */
  update(deltaTime, player, survival, gameMode) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.1);
    const pPos = player.getPosition();

    // 1. Periodic ambient spawning around loaded chunks
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = 3.5;
      if (this.entities.length < this.maxMobs) {
        this._tryAmbientSpawn(pPos);
      }
    }

    // 2. Step each entity & remove dead/far entities
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const ent = this.entities[i];
      if (!ent.dead) {
        ent.update(dt, player, survival, gameMode);
      }

      const dist = Math.hypot(ent.position.x - pPos.x, ent.position.z - pPos.z);
      if (ent.dead || dist > 56) {
        if (this.scene && ent.mesh) {
          this.scene.remove(ent.mesh);
        }
        ent.dispose();
        this.entities.splice(i, 1);
      }
    }
  }

  /**
   * @private
   */
  _tryAmbientSpawn(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 18;
    const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);
    const { chunkX, chunkZ } = this.world.chunkManager.worldToChunkCoord(wx, wz);
    if (!this.world.chunkManager.getChunk(chunkX, chunkZ)) return;

    const sy = this.world.getSurfaceY(wx, wz);
    if (sy <= 1 || this.world.isLiquidAt(wx, sy, wz)) return;

    const isNight = this.world.getSkyBrightness() < 0.45;
    const type = isNight
      ? Math.random() < 0.72
        ? MOB_TYPES.ZOMBIE
        : MOB_TYPES.SLIME
      : Math.random() < 0.55
      ? MOB_TYPES.SHEEP
      : MOB_TYPES.COW;

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
   * Clears all active entities from simulation and scene.
   */
  clear() {
    for (const ent of this.entities) {
      if (this.scene && ent.mesh) {
        this.scene.remove(ent.mesh);
      }
      ent.dispose();
    }
    this.entities = [];
  }

  dispose() {
    this.clear();
    this.scene = null;
  }
}
