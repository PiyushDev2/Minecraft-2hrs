/**
 * @file Entity.js
 * @description Autonomous voxel entity with AABB physics, obstacle step-jumping,
 * AI state machine (idle/wander/chase/flee), combat knockback, and Three.js mesh articulation.
 */

import * as THREE from 'three';
import { stepEntityPhysics } from '../physics/Physics.js';
import { AABB } from '../physics/Collision.js';
import { MOB_TYPES, getMobDefinition } from './MobTypes.js';

let nextEntityId = 1;

/**
 * Represents a live mob entity in the voxel world.
 */
export class Entity {
  /**
   * @param {import('../world/World.js').World} world
   * @param {string} type
   * @param {{ x: number, y: number, z: number }} spawnPos
   */
  constructor(world, type, spawnPos) {
    const def = getMobDefinition(type);
    if (!def) {
      throw new Error(`Unknown mob type "${type}"`);
    }

    /** @type {number} */
    this.id = nextEntityId++;
    /** @type {import('../world/World.js').World} */
    this.world = world;
    /** @type {string} */
    this.type = def.type;
    /** @type {import('./MobTypes.js').MobDefinition} */
    this.def = def;
    /** @type {'passive'|'hostile'} */
    this.category = def.category;

    /** @type {{ x: number, y: number, z: number }} */
    this.position = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    /** @type {{ x: number, y: number, z: number }} */
    this.velocity = { x: 0, y: 0, z: 0 };

    /** @type {number} */
    this.width = def.width;
    /** @type {number} */
    this.height = def.height;
    /** @type {number} */
    this.yaw = Math.random() * Math.PI * 2;

    /** @type {boolean} */
    this.grounded = false;
    /** @type {boolean} */
    this.inWater = false;
    /** @type {boolean} */
    this.flyMode = false;

    /** @type {number} */
    this.health = def.maxHealth;
    /** @type {number} */
    this.maxHealth = def.maxHealth;
    /** @type {boolean} */
    this.dead = false;

    /** @type {'idle'|'wander'|'chase'|'flee'} */
    this.aiState = 'idle';
    /** @type {number} */
    this.aiTimer = 0.8 + Math.random() * 2.0;
    /** @type {number} */
    this.wanderYaw = this.yaw;

    /** @type {number} */
    this.attackCooldown = 0;
    /** @type {number} */
    this.hurtTimer = 0;
    /** @type {number} */
    this.fleeTimer = 0;
    /** @type {number} */
    this.sunBurnTimer = 0;
    /** @type {number} */
    this.hopCooldown = 0.6;
    /** @type {number} */
    this.walkPhase = 0;

    /** @type {THREE.Group|null} */
    this.mesh = null;
    /** @type {THREE.Mesh[]} */
    this._limbs = [];
    /** @type {THREE.MeshStandardMaterial[]} */
    this._materials = [];
    /** @type {number[]} */
    this._baseColors = [];
  }

  /**
   * Returns current entity world-space AABB.
   * @returns {AABB}
   */
  getBoundingBox() {
    return AABB.fromEntityPosition(
      this.position.x,
      this.position.y,
      this.position.z,
      this.width,
      this.height
    );
  }

  /**
   * Applies damage and directional knockback.
   * @param {number} amount
   * @param {{ x: number, y: number, z: number }|null} [attackerPos=null]
   * @returns {boolean} True if hit killed the entity.
   */
  takeDamage(amount, attackerPos = null) {
    if (this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.3;

    if (attackerPos) {
      const dx = this.position.x - attackerPos.x;
      const dz = this.position.z - attackerPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.velocity.x += (dx / dist) * 5.2;
      this.velocity.z += (dz / dist) * 5.2;
      if (this.grounded) {
        this.velocity.y = 4.5;
      }
      if (this.category === 'passive') {
        this.fleeTimer = 3.5;
        this.aiState = 'flee';
        this.wanderYaw = Math.atan2(-(dx / dist), -(dz / dist));
      }
    }

    if (this.health <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  /**
   * Checks if there is a 1-block step ahead that the entity can hop over.
   * @param {number} dirX
   * @param {number} dirZ
   * @returns {boolean}
   */
  _shouldAutoJump(dirX, dirZ) {
    if (!this.grounded && !this.inWater) return false;
    const probeDist = this.width * 0.65 + 0.35;
    const bx = Math.floor(this.position.x + dirX * probeDist);
    const bz = Math.floor(this.position.z + dirZ * probeDist);
    const footY = Math.floor(this.position.y + 0.1);
    const blockedAtFoot = this.world.isSolidAt(bx, footY, bz);
    const clearAbove =
      !this.world.isSolidAt(bx, footY + 1, bz) &&
      !this.world.isSolidAt(bx, footY + 2, bz);
    return blockedAtFoot && clearAbove;
  }

  /**
   * Steps AI decision-making, physics, sunlight burn, and attack attempts.
   * @param {number} deltaTime
   * @param {{ position: { x: number, y: number, z: number } }} player
   * @param {import('../survival/SurvivalStats.js').SurvivalStats|null} survival
   * @param {'creative'|'survival'} gameMode
   */
  update(deltaTime, player, survival, gameMode) {
    if (this.dead) return;
    const dt = Math.min(Math.max(deltaTime, 0), 0.1);

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.fleeTimer = Math.max(0, this.fleeTimer - dt);

    const pPos = player.position;
    const dx = pPos.x - this.position.x;
    const dy = pPos.y - this.position.y;
    const dz = pPos.z - this.position.z;
    const horizDist = Math.hypot(dx, dz);
    const dist3D = Math.hypot(dx, dy, dz);

    // 1. Sunlight burn for undead mobs during bright daylight
    if (this.def.burnsInSunlight && this.world.getSkyBrightness() > 0.72 && !this.inWater) {
      const light = this.world.getLight(
        Math.floor(this.position.x),
        Math.floor(this.position.y + this.height * 0.9),
        Math.floor(this.position.z)
      );
      if (light.sky >= 13) {
        this.sunBurnTimer += dt;
        if (this.sunBurnTimer >= 1.5) {
          this.sunBurnTimer -= 1.5;
          this.takeDamage(2, null);
          if (this.dead) return;
        }
      }
    }

    // 2. Choose AI intent
    let wishX = 0;
    let wishZ = 0;
    let jump = false;

    const canTargetPlayer =
      this.category === 'hostile' &&
      gameMode === 'survival' &&
      (!survival || !survival.isDead) &&
      dist3D <= this.def.detectRange;

    if (canTargetPlayer) {
      this.aiState = 'chase';
      const inv = horizDist > 0.01 ? 1 / horizDist : 0;
      const dirX = dx * inv;
      const dirZ = dz * inv;
      const speedScale = this.def.chaseSpeed / 5.4; // Scaled relative to WALK_SPEED (5.4)

      if (horizDist > 0.85) {
        wishX = dirX * speedScale;
        wishZ = dirZ * speedScale;
      }
      this.yaw = Math.atan2(-dirX, -dirZ);

      // Melee attack if in range
      if (dist3D <= this.def.attackRange && this.attackCooldown <= 0 && survival) {
        const hit = survival.damage(this.def.attackDamage, this.type);
        if (hit) {
          this.attackCooldown = 1.1;
          this.onPlayerAttacked?.(this.def.attackDamage, this.type);
        }
      }
    } else if (this.fleeTimer > 0) {
      this.aiState = 'flee';
      const dirX = -Math.sin(this.wanderYaw);
      const dirZ = -Math.cos(this.wanderYaw);
      const speedScale = this.def.chaseSpeed / 5.4;
      wishX = dirX * speedScale;
      wishZ = dirZ * speedScale;
      this.yaw = this.wanderYaw;
    } else {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        if (this.aiState === 'idle') {
          this.aiState = 'wander';
          this.wanderYaw = Math.random() * Math.PI * 2;
          this.aiTimer = 1.8 + Math.random() * 2.5;
        } else {
          this.aiState = 'idle';
          this.aiTimer = 1.4 + Math.random() * 2.4;
        }
      }

      if (this.aiState === 'wander') {
        const dirX = -Math.sin(this.wanderYaw);
        const dirZ = -Math.cos(this.wanderYaw);
        const speedScale = this.def.walkSpeed / 5.4;
        wishX = dirX * speedScale;
        wishZ = dirZ * speedScale;
        this.yaw = this.wanderYaw;
      }
    }

    // 3. Jumping (slimes hop continuously while moving, all mobs auto-step up 1-block ledges)
    const wishMag = Math.hypot(wishX, wishZ);
    if (wishMag > 0.05) {
      const normX = wishX / wishMag;
      const normZ = wishZ / wishMag;
      if (this._shouldAutoJump(normX, normZ)) {
        jump = true;
      } else if (this.type === MOB_TYPES.SLIME) {
        this.hopCooldown -= dt;
        if (this.hopCooldown <= 0 && this.grounded) {
          jump = true;
          this.hopCooldown = 0.65 + Math.random() * 0.35;
        }
      }
    }
    if (this.inWater) {
      jump = true; // Keep mobs buoyant when swimming
    }

    const prevX = this.position.x;
    const prevZ = this.position.z;

    stepEntityPhysics(this, this.world, dt, {
      wishX,
      wishZ,
      jump,
      sprint: false,
      sneak: false,
    });

    // If wandering into a steep wall without auto-jump, turn around
    const movedHoriz = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    if (this.aiState === 'wander' && wishMag > 0.05 && movedHoriz < 0.01 * dt * 60) {
      this.wanderYaw += Math.PI * (0.55 + Math.random() * 0.6);
    }

    if (movedHoriz > 0.002) {
      this.walkPhase += movedHoriz * 5.2;
    }

    if (this.mesh) {
      this.syncMesh();
    }
  }

  /**
   * Builds a clean articulated voxel Three.js Group for this mob.
   * @returns {THREE.Group}
   */
  buildMesh() {
    if (this.mesh) return this.mesh;

    const group = new THREE.Group();
    const { primary, secondary, accent } = this.def.palette;
    this._limbs = [];
    this._materials = [];
    this._baseColors = [];

    const makePart = (w, h, d, colorHex, x, y, z, transparent = false, opacity = 1) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.85,
        metalness: 0.05,
        transparent,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this._materials.push(mat);
      this._baseColors.push(colorHex);
      group.add(mesh);
      return mesh;
    };

    if (this.type === MOB_TYPES.SHEEP || this.type === MOB_TYPES.COW) {
      // Quadruped body
      makePart(0.68, 0.56, 0.96, primary, 0, 0.68, 0);
      // Head at front (-Z when yaw=0)
      makePart(0.46, 0.44, 0.46, secondary, 0, 0.88, -0.58);
      // Eyes
      makePart(0.08, 0.08, 0.05, accent, -0.13, 0.94, -0.81);
      makePart(0.08, 0.08, 0.05, accent, 0.13, 0.94, -0.81);
      if (this.type === MOB_TYPES.COW) {
        // Cow horns + dark spot
        makePart(0.08, 0.14, 0.08, accent, -0.22, 1.14, -0.55);
        makePart(0.08, 0.14, 0.08, accent, 0.22, 1.14, -0.55);
        makePart(0.32, 0.28, 0.4, secondary, 0.19, 0.72, 0.08);
      }
      // Four legs
      const legColor = this.type === MOB_TYPES.COW ? accent : secondary;
      const fl = makePart(0.18, 0.42, 0.18, legColor, -0.2, 0.21, -0.32);
      const fr = makePart(0.18, 0.42, 0.18, legColor, 0.2, 0.21, -0.32);
      const bl = makePart(0.18, 0.42, 0.18, legColor, -0.2, 0.21, 0.32);
      const br = makePart(0.18, 0.42, 0.18, legColor, 0.2, 0.21, 0.32);
      this._limbs.push(fl, fr, bl, br);
    } else if (this.type === MOB_TYPES.ZOMBIE) {
      // Biped Zombie
      makePart(0.44, 0.44, 0.44, primary, 0, 1.56, 0); // Head
      makePart(0.08, 0.07, 0.04, 0x172515, -0.1, 1.6, -0.22); // Left Eye
      makePart(0.08, 0.07, 0.04, 0x172515, 0.1, 1.6, -0.22); // Right Eye
      makePart(0.46, 0.68, 0.26, secondary, 0, 1.0, 0); // Torso
      // Outstretched zombie arms
      makePart(0.18, 0.18, 0.54, primary, -0.33, 1.2, -0.24);
      makePart(0.18, 0.18, 0.54, primary, 0.33, 1.2, -0.24);
      // Legs
      const ll = makePart(0.2, 0.66, 0.22, accent, -0.12, 0.33, 0);
      const rl = makePart(0.2, 0.66, 0.22, accent, 0.12, 0.33, 0);
      this._limbs.push(ll, rl);
    } else {
      // Translucent outer Slime cube + dense core + eyes
      makePart(0.84, 0.84, 0.84, primary, 0, 0.42, 0, true, 0.72);
      makePart(0.52, 0.52, 0.52, secondary, 0, 0.42, 0);
      makePart(0.1, 0.1, 0.06, accent, -0.15, 0.5, -0.42);
      makePart(0.1, 0.1, 0.06, accent, 0.15, 0.5, -0.42);
    }

    this.mesh = group;
    this.syncMesh();
    return group;
  }

  /**
   * Synchronizes Three.js mesh transform, limb gait animation, and red hurt tint.
   */
  syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw;

    const swing = Math.sin(this.walkPhase) * 0.45;
    if (this._limbs.length === 4) {
      this._limbs[0].rotation.x = swing;
      this._limbs[1].rotation.x = -swing;
      this._limbs[2].rotation.x = -swing;
      this._limbs[3].rotation.x = swing;
    } else if (this._limbs.length === 2) {
      this._limbs[0].rotation.x = swing;
      this._limbs[1].rotation.x = -swing;
    }

    const isHurt = this.hurtTimer > 0;
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].emissive.setHex(isHurt ? 0xb91c1c : 0x000000);
      this._materials[i].emissiveIntensity = isHurt ? 0.65 : 0;
    }
  }

  /**
   * Disposes all geometries and materials owned by this entity.
   */
  dispose() {
    if (!this.mesh) return;
    this.mesh.traverse((child) => {
      if (/** @type {any} */ (child).geometry) {
        /** @type {any} */ (child).geometry.dispose();
      }
      if (/** @type {any} */ (child).material) {
        /** @type {any} */ (child).material.dispose();
      }
    });
    this.mesh = null;
    this._limbs = [];
    this._materials = [];
  }
}
