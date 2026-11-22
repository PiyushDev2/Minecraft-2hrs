/**
 * @file Entity.js
 * @description Autonomous voxel mob entity with AABB physics, obstacle step-jumping,
 * AI state machine (idle/wander/chase/flee/ranged/fuse/neutral-provoke/teleport),
 * Sheep shearing, Enderman stare-aggro & teleportation, and textured multi-part Three.js voxel meshes.
 */

import * as THREE from 'three';
import { stepEntityPhysics } from '../physics/Physics.js';
import { AABB } from '../physics/Collision.js';
import { MOB_TYPES, getMobDefinition } from './MobTypes.js';
import { mobSkins, getSharedBoxGeometry } from './MobSkins.js';

let nextEntityId = 1;

export class Entity {
  constructor(world, type, spawnPos) {
    const def = getMobDefinition(type);
    if (!def) {
      throw new Error(`Unknown mob type "${type}"`);
    }

    this.id = nextEntityId++;
    this.world = world;
    this.type = def.type;
    this.def = def;
    this.category = def.category;

    this.position = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.velocity = { x: 0, y: 0, z: 0 };

    this.width = def.width;
    this.height = def.height;
    this.yaw = Math.random() * Math.PI * 2;

    this.grounded = false;
    this.inWater = false;
    this.onLadder = false;
    this.inLava = false;
    this.flyMode = false;

    this.health = def.maxHealth;
    this.maxHealth = def.maxHealth;
    this.dead = false;

    this.aiState = 'idle';
    this.aiTimer = 0.8 + Math.random() * 2.0;
    this.wanderYaw = this.yaw;

    this.attackCooldown = 0;
    this.hurtTimer = 0;
    this.fleeTimer = 0;
    this.sunBurnTimer = 0;
    this.hopCooldown = 0.6;
    this.walkPhase = 0;

    // Neutral mob & special state
    this.provoked = false;
    this.provokeTimer = 0;
    this.teleportCooldown = 2.5;
    this.sheared = false;
    this.woolRegrowTimer = 0;

    // Creeper fuse & Skeleton bow timers
    this.fuseTimer = 0;
    this.isFusing = false;
    this.rangedCooldown = 1.6;
    this.leapCooldown = 1.2;

    // Villager, Wolf & Blaze expansion fields
    const professions = ['farmer', 'blacksmith', 'librarian'];
    this.profession =
      this.type === MOB_TYPES.VILLAGER
        ? professions[this.id % professions.length]
        : null;
    this.tamed = false;
    this.sitting = false;
    /** @type {Entity|null} */
    this.wolfTarget = null;
    this.hoverPhase = Math.random() * Math.PI * 2;

    /** @type {THREE.Group|null} */
    this.mesh = null;
    this._limbs = [];
    this._materials = [];
    this._baseColors = [];
    this._emissiveFlags = [];
    /** @type {THREE.Object3D[]} */
    this._woolParts = [];
    /** @type {THREE.Object3D[]} */
    this._blazeRods = [];
    /** @type {THREE.Object3D|null} */
    this._collarMesh = null;
    /** @type {THREE.Object3D|null} */
    this._tailMesh = null;

    /** Optional callbacks injected by EntityManager */
    this.onPlayerAttacked = null;
    this.onCreeperFuseStart = null;
    this.onCreeperExplode = null;
    this.onShootArrow = null;
    this.onTeleport = null;
  }

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
   * Provokes a neutral mob (Enderman or Zombified Piglin) into chasing the player.
   */
  provoke() {
    if (this.category === 'neutral') {
      this.provoked = true;
      this.provokeTimer = 24;
    }
  }

  /**
   * Shears a Sheep if it currently has wool.
   * @returns {boolean}
   */
  shear() {
    if (this.type !== MOB_TYPES.SHEEP || this.sheared || this.dead) return false;
    this.sheared = true;
    this.woolRegrowTimer = 90;
    for (const part of this._woolParts) {
      part.visible = false;
    }
    return true;
  }

  /**
   * Tames a wild Wolf, upgrading its max HP to 20 and displaying its red collar.
   * @returns {boolean}
   */
  tameWolf() {
    if (this.type !== MOB_TYPES.WOLF || this.tamed || this.dead) return false;
    this.tamed = true;
    this.provoked = false;
    this.sitting = false;
    this.maxHealth = 20;
    this.health = 20;
    if (this._collarMesh) this._collarMesh.visible = true;
    return true;
  }

  /**
   * Toggles a tamed Wolf between sitting and following.
   * @returns {boolean}
   */
  toggleSit() {
    if (this.type !== MOB_TYPES.WOLF || !this.tamed || this.dead) return false;
    this.sitting = !this.sitting;
    if (this.sitting) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    return this.sitting;
  }

  /**
   * Heals a tamed Wolf (e.g. when fed meat).
   * @param {number} amount
   * @returns {boolean}
   */
  healWolf(amount = 4) {
    if (this.type !== MOB_TYPES.WOLF || !this.tamed || this.dead) return false;
    if (this.health >= this.maxHealth) return false;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return true;
  }

  /**
   * Teleports an Enderman 4..10 blocks away to a safe standing spot.
   * @returns {boolean}
   */
  tryTeleport() {
    const oldPos = { ...this.position };
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 4 + Math.random() * 6.5;
      const nx = Math.floor(this.position.x + Math.cos(angle) * dist);
      const nz = Math.floor(this.position.z + Math.sin(angle) * dist);
      const sy = this.world.getSurfaceY(nx, nz);
      if (sy <= 1 || this.world.isLiquidAt(nx, sy, nz)) continue;
      if (
        !this.world.isSolidAt(nx, sy + 1, nz) &&
        !this.world.isSolidAt(nx, sy + 2, nz) &&
        !this.world.isSolidAt(nx, sy + 3, nz)
      ) {
        this.position.x = nx + 0.5;
        this.position.y = sy + 1.05;
        this.position.z = nz + 0.5;
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.velocity.z = 0;
        this.teleportCooldown = 2.8 + Math.random() * 2.2;
        this.onTeleport?.(oldPos, { ...this.position });
        return true;
      }
    }
    return false;
  }

  takeDamage(amount, attackerPos = null) {
    if (this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.3;

    if (attackerPos) {
      const dx = this.position.x - attackerPos.x;
      const dz = this.position.z - attackerPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.velocity.x += (dx / dist) * 5.4;
      this.velocity.z += (dz / dist) * 5.4;
      if (this.grounded) {
        this.velocity.y = 4.6;
      }
      if (this.category === 'passive') {
        this.fleeTimer = 3.5;
        this.aiState = 'flee';
        this.wanderYaw = Math.atan2(-(dx / dist), -(dz / dist));
      } else if (this.category === 'neutral' && !this.tamed) {
        this.provoke();
      }
    }

    if (this.health <= 0) {
      this.dead = true;
      return true;
    }

    // Enderman occasionally blinks away when struck
    if (this.type === MOB_TYPES.ENDERMAN && this.teleportCooldown <= 1.2 && Math.random() < 0.45) {
      this.tryTeleport();
    }
    return false;
  }

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
    return blockedAtFoot && (clearAbove || Boolean(this.def.climbsWalls));
  }

  update(deltaTime, player, survival, gameMode, allEntities = null) {
    if (this.dead) return;
    const dt = Math.min(Math.max(deltaTime, 0), 0.1);

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.fleeTimer = Math.max(0, this.fleeTimer - dt);
    this.rangedCooldown = Math.max(0, this.rangedCooldown - dt);
    this.leapCooldown = Math.max(0, this.leapCooldown - dt);
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
    this.hoverPhase += dt * 2.6;

    if (this.provoked) {
      this.provokeTimer -= dt;
      if (this.provokeTimer <= 0) this.provoked = false;
    }

    if (this.sheared && this.type === MOB_TYPES.SHEEP) {
      this.woolRegrowTimer -= dt;
      if (this.woolRegrowTimer <= 0) {
        this.sheared = false;
        for (const part of this._woolParts) {
          part.visible = true;
        }
      }
    }

    const pPos = player.position;
    const dx = pPos.x - this.position.x;
    const dy = pPos.y - this.position.y;
    const dz = pPos.z - this.position.z;
    const horizDist = Math.hypot(dx, dz);
    const dist3D = Math.hypot(dx, dy, dz);

    // 1. Environmental hazards (Lava, Enderman/Blaze water burn, Sunlight burn for Undead)
    if (this.inLava && !this.def.fireImmune) {
      this.sunBurnTimer += dt;
      if (this.sunBurnTimer >= 0.6) {
        this.sunBurnTimer = 0;
        this.takeDamage(4, null);
        if (this.dead) return;
      }
    } else if ((this.type === MOB_TYPES.ENDERMAN || this.type === MOB_TYPES.BLAZE) && this.inWater) {
      this.sunBurnTimer += dt;
      if (this.sunBurnTimer >= 0.5) {
        this.sunBurnTimer = 0;
        this.takeDamage(2, null);
        if (!this.dead && this.type === MOB_TYPES.ENDERMAN) this.tryTeleport();
        else if (this.dead) return;
      }
    } else if (this.def.burnsInSunlight && this.world.getSkyBrightness() > 0.72 && !this.inWater) {
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

    // 2. AI Intent
    let wishX = 0;
    let wishZ = 0;
    let jump = false;

    const isAggressive =
      !this.tamed &&
      (this.category === 'hostile' || (this.category === 'neutral' && this.provoked));
    const canTargetPlayer =
      isAggressive &&
      gameMode === 'survival' &&
      (!survival || !survival.isDead) &&
      dist3D <= this.def.detectRange;

    // Tamed Wolf companion AI (sit, follow owner, defend against hostiles)
    if (this.type === MOB_TYPES.WOLF && this.tamed) {
      if (this.sitting) {
        this.aiState = 'sit';
        if (horizDist < 6) {
          this.yaw = Math.atan2(-dx, -dz);
        }
      } else {
        // Validate or pick a hostile mob near player/wolf
        if (this.wolfTarget && (this.wolfTarget.dead || this.wolfTarget === this)) {
          this.wolfTarget = null;
        }
        if (!this.wolfTarget && Array.isArray(allEntities)) {
          let best = null;
          let bestDist = 14;
          for (const other of allEntities) {
            if (other === this || other.dead || other.tamed) continue;
            if (other.category !== 'hostile' || other.type === MOB_TYPES.CREEPER) continue;
            const dToPlayer = Math.hypot(
              other.position.x - pPos.x,
              other.position.z - pPos.z
            );
            if (dToPlayer < bestDist) {
              bestDist = dToPlayer;
              best = other;
            }
          }
          this.wolfTarget = best;
        }

        if (this.wolfTarget && !this.wolfTarget.dead) {
          this.aiState = 'chase';
          const tdx = this.wolfTarget.position.x - this.position.x;
          const tdy = this.wolfTarget.position.y - this.position.y;
          const tdz = this.wolfTarget.position.z - this.position.z;
          const tHoriz = Math.hypot(tdx, tdz) || 0.01;
          const tDist = Math.hypot(tdx, tdy, tdz);
          const dirX = tdx / tHoriz;
          const dirZ = tdz / tHoriz;
          const speedScale = this.def.chaseSpeed / 5.4;
          this.yaw = Math.atan2(-dirX, -dirZ);
          if (tHoriz > 0.9) {
            wishX = dirX * speedScale;
            wishZ = dirZ * speedScale;
          }
          if (tDist <= this.def.attackRange && this.attackCooldown <= 0) {
            this.attackCooldown = 0.85;
            this.wolfTarget.takeDamage(4, this.position);
          }
        } else if (horizDist > 20) {
          // Teleport back near owner if far behind
          const tx = Math.floor(pPos.x + (Math.random() - 0.5) * 3);
          const tz = Math.floor(pPos.z + (Math.random() - 0.5) * 3);
          const sy = this.world.getSurfaceY(tx, tz);
          if (sy > 1 && !this.world.isLiquidAt(tx, sy, tz)) {
            this.position.x = tx + 0.5;
            this.position.y = sy + 1.05;
            this.position.z = tz + 0.5;
          }
        } else if (horizDist > 3.2) {
          this.aiState = 'follow';
          const inv = 1 / horizDist;
          const dirX = dx * inv;
          const dirZ = dz * inv;
          const speedScale = (horizDist > 7 ? this.def.chaseSpeed : this.def.walkSpeed * 1.45) / 5.4;
          wishX = dirX * speedScale;
          wishZ = dirZ * speedScale;
          this.yaw = Math.atan2(-dirX, -dirZ);
        } else {
          this.aiState = 'idle';
          this.yaw = Math.atan2(-dx, -dz);
        }
      }
    } else if (canTargetPlayer) {
      this.aiState = 'chase';
      const inv = horizDist > 0.01 ? 1 / horizDist : 0;
      const dirX = dx * inv;
      const dirZ = dz * inv;
      const speedScale = this.def.chaseSpeed / 5.4;
      this.yaw = Math.atan2(-dirX, -dirZ);

      if (this.type === MOB_TYPES.CREEPER) {
        if (dist3D <= this.def.attackRange) {
          if (!this.isFusing) {
            this.isFusing = true;
            this.onCreeperFuseStart?.(this);
          }
          this.fuseTimer += dt;
          if (this.fuseTimer >= 1.45) {
            this.dead = true;
            this.onCreeperExplode?.(this);
            return;
          }
        } else {
          if (dist3D > 5.0) {
            this.isFusing = false;
            this.fuseTimer = Math.max(0, this.fuseTimer - dt * 2);
          } else if (this.isFusing) {
            this.fuseTimer += dt * 0.5;
          }
          wishX = dirX * speedScale;
          wishZ = dirZ * speedScale;
        }
      } else if (this.def.ranged) {
        if (horizDist > 7.5) {
          wishX = dirX * speedScale;
          wishZ = dirZ * speedScale;
        } else if (horizDist < 4.0) {
          wishX = -dirX * speedScale * 0.7;
          wishZ = -dirZ * speedScale * 0.7;
        } else {
          wishX = -dirZ * speedScale * 0.45;
          wishZ = dirX * speedScale * 0.45;
        }
        if (dist3D <= this.def.attackRange && this.rangedCooldown <= 0) {
          this.rangedCooldown = this.type === MOB_TYPES.BLAZE ? 1.85 + Math.random() * 0.6 : 2.1 + Math.random() * 0.6;
          this.onShootArrow?.(
            this,
            { x: pPos.x, y: pPos.y + 1.1, z: pPos.z },
            this.def.attackDamage,
            this.def.projectileType || 'arrow'
          );
        }
      } else {
        if (horizDist > 0.85) {
          wishX = dirX * speedScale;
          wishZ = dirZ * speedScale;
        }
        // Enderman aggressive chase teleport
        if (
          this.type === MOB_TYPES.ENDERMAN &&
          this.teleportCooldown <= 0 &&
          horizDist > 8 &&
          horizDist < 22
        ) {
          this.tryTeleport();
        }
        // Spider lunge leap
        if (
          this.type === MOB_TYPES.SPIDER &&
          this.grounded &&
          this.leapCooldown <= 0 &&
          horizDist > 2.0 &&
          horizDist < 5.5
        ) {
          this.velocity.x = dirX * 7.5;
          this.velocity.z = dirZ * 7.5;
          this.velocity.y = 6.2;
          this.grounded = false;
          this.leapCooldown = 2.4;
        }
        if (dist3D <= this.def.attackRange && this.attackCooldown <= 0 && survival) {
          const hit = survival.damage(this.def.attackDamage, this.type);
          if (hit) {
            this.attackCooldown = 1.1;
            this.onPlayerAttacked?.(this.def.attackDamage, this.type);
          }
        }
      }
    } else {
      if (this.isFusing) {
        this.isFusing = false;
        this.fuseTimer = 0;
      }
      if (this.fleeTimer > 0) {
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
    }

    // 3. Jumping & Chicken slow flutter
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
    if (this.inWater) jump = true;
    if (this.type === MOB_TYPES.CHICKEN && this.velocity.y < -2.4) {
      this.velocity.y = -2.4;
    }

    // Blaze gentle levitation ~1.4..2.4 blocks above terrain
    if (this.type === MOB_TYPES.BLAZE) {
      const groundY = this.world.getSurfaceY(Math.floor(this.position.x), Math.floor(this.position.z));
      const targetY = Math.max(groundY + 1.6, pPos.y + 0.6) + Math.sin(this.hoverPhase) * 0.45;
      const diffY = targetY - this.position.y;
      this.velocity.y = Math.max(-2.5, Math.min(3.5, diffY * 3.0));
      this.flyMode = true;
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
   * Builds a multi-part articulated, pixel-textured Three.js voxel Group using shared geometries
   * and live-swappable MobSkins textures.
   */
  buildMesh() {
    if (this.mesh) return this.mesh;

    const group = new THREE.Group();
    const { primary, secondary, accent } = this.def.palette;
    const faceTex = mobSkins.getFaceTexture(this.type);
    const bodyTex = mobSkins.getBodyTexture(this.type);

    this._limbs = [];
    this._materials = [];
    this._baseColors = [];
    this._emissiveFlags = [];
    this._woolParts = [];
    this._blazeRods = [];
    this._collarMesh = null;
    this._tailMesh = null;

    const trackMat = (mat, baseHex, emissiveHex = 0) => {
      this._materials.push(mat);
      this._baseColors.push(baseHex);
      this._emissiveFlags.push(emissiveHex);
      return mat;
    };

    const makePart = (
      w,
      h,
      d,
      colorHex,
      x,
      y,
      z,
      { transparent = false, opacity = 1, map = null, emissiveHex = 0 } = {}
    ) => {
      const geo = getSharedBoxGeometry(w, h, d);
      const mat = new THREE.MeshLambertMaterial({
        color: map ? 0xffffff : colorHex,
        map,
        transparent,
        opacity,
      });
      if (emissiveHex) {
        mat.emissive.setHex(emissiveHex);
        mat.emissiveIntensity = 0.85;
      }
      trackMat(mat, colorHex, emissiveHex);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    // Textured head cube: -Z face gets the pixel-art face texture, other 5 faces use body/base color
    const makeHead = (w, h, d, sideHex, x, y, z, transparent = false, opacity = 1) => {
      const geo = getSharedBoxGeometry(w, h, d);
      if (!faceTex) {
        return makePart(w, h, d, sideHex, x, y, z, { transparent, opacity });
      }
      const sideMat = trackMat(
        new THREE.MeshLambertMaterial({
          color: bodyTex ? 0xffffff : sideHex,
          map: this.type === MOB_TYPES.SHEEP ? null : bodyTex,
          transparent,
          opacity,
        }),
        sideHex
      );
      if (this.type === MOB_TYPES.SHEEP) sideMat.color.setHex(sideHex);
      const faceMat = trackMat(
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map: faceTex,
          transparent,
          opacity,
        }),
        0xffffff
      );
      // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z (front is -Z)
      const mats = [sideMat, sideMat, sideMat, sideMat, sideMat, faceMat];
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    if (this.type === MOB_TYPES.SHEEP || this.type === MOB_TYPES.COW || this.type === MOB_TYPES.PIG) {
      const isPig = this.type === MOB_TYPES.PIG;
      const isSheep = this.type === MOB_TYPES.SHEEP;
      if (isSheep) {
        // Under-body (visible when sheared)
        makePart(0.54, 0.44, 0.84, secondary, 0, 0.66, 0);
        // Fluffy shearable wool coat
        const coat = makePart(0.72, 0.6, 1.0, primary, 0, 0.68, 0, { map: bodyTex });
        coat.visible = !this.sheared;
        this._woolParts.push(coat);
      } else {
        makePart(0.68, isPig ? 0.48 : 0.56, 0.96, primary, 0, isPig ? 0.56 : 0.68, 0, {
          map: bodyTex,
        });
      }
      makeHead(0.46, 0.44, 0.46, isPig ? primary : secondary, 0, isPig ? 0.68 : 0.88, -0.58);
      if (isPig) {
        makePart(0.24, 0.16, 0.1, secondary, 0, 0.61, -0.84);
      } else if (this.type === MOB_TYPES.COW) {
        makePart(0.08, 0.14, 0.08, accent, -0.22, 1.14, -0.55);
        makePart(0.08, 0.14, 0.08, accent, 0.22, 1.14, -0.55);
      }
      const legH = isPig ? 0.34 : 0.42;
      const legColor = this.type === MOB_TYPES.COW ? accent : isPig ? primary : secondary;
      const fl = makePart(0.18, legH, 0.18, legColor, -0.2, legH * 0.5, -0.32);
      const fr = makePart(0.18, legH, 0.18, legColor, 0.2, legH * 0.5, -0.32);
      const bl = makePart(0.18, legH, 0.18, legColor, -0.2, legH * 0.5, 0.32);
      const br = makePart(0.18, legH, 0.18, legColor, 0.2, legH * 0.5, 0.32);
      this._limbs.push(fl, fr, bl, br);
    } else if (this.type === MOB_TYPES.CHICKEN) {
      makePart(0.38, 0.32, 0.46, primary, 0, 0.38, 0, { map: bodyTex });
      makeHead(0.24, 0.28, 0.24, primary, 0, 0.58, -0.22);
      makePart(0.14, 0.08, 0.14, secondary, 0, 0.54, -0.38);
      makePart(0.08, 0.1, 0.08, accent, 0, 0.46, -0.34);
      const l = makePart(0.07, 0.22, 0.07, secondary, -0.1, 0.11, 0);
      const r = makePart(0.07, 0.22, 0.07, secondary, 0.1, 0.11, 0);
      this._limbs.push(l, r);
    } else if (this.type === MOB_TYPES.CREEPER) {
      makeHead(0.46, 0.46, 0.46, primary, 0, 1.48, 0);
      makePart(0.42, 0.78, 0.28, primary, 0, 0.86, 0, { map: bodyTex });
      const fl = makePart(0.2, 0.46, 0.2, secondary, -0.14, 0.23, -0.16, { map: bodyTex });
      const fr = makePart(0.2, 0.46, 0.2, secondary, 0.14, 0.23, -0.16, { map: bodyTex });
      const bl = makePart(0.2, 0.46, 0.2, secondary, -0.14, 0.23, 0.16, { map: bodyTex });
      const br = makePart(0.2, 0.46, 0.2, secondary, 0.14, 0.23, 0.16, { map: bodyTex });
      this._limbs.push(fl, fr, bl, br);
    } else if (this.type === MOB_TYPES.SKELETON) {
      makeHead(0.42, 0.42, 0.42, primary, 0, 1.56, 0);
      makePart(0.38, 0.66, 0.2, primary, 0, 1.0, 0, { map: bodyTex });
      makePart(0.11, 0.11, 0.56, primary, -0.28, 1.2, -0.22);
      makePart(0.11, 0.11, 0.56, primary, 0.28, 1.2, -0.22);
      makePart(0.07, 0.48, 0.07, 0x8a5b2e, 0.28, 1.22, -0.52);
      const ll = makePart(0.12, 0.66, 0.12, secondary, -0.11, 0.33, 0);
      const rl = makePart(0.12, 0.66, 0.12, secondary, 0.11, 0.33, 0);
      this._limbs.push(ll, rl);
    } else if (this.type === MOB_TYPES.SPIDER) {
      makeHead(0.46, 0.36, 0.42, primary, 0, 0.42, -0.45);
      makePart(0.38, 0.3, 0.38, secondary, 0, 0.4, 0, { map: bodyTex });
      makePart(0.62, 0.46, 0.66, primary, 0, 0.46, 0.48, { map: bodyTex });
      makePart(0.09, 0.07, 0.04, accent, -0.12, 0.47, -0.665, { emissiveHex: 0xdc2626 });
      makePart(0.09, 0.07, 0.04, accent, 0.12, 0.47, -0.665, { emissiveHex: 0xdc2626 });
      const l1 = makePart(0.75, 0.09, 0.09, secondary, -0.48, 0.26, -0.25);
      const r1 = makePart(0.75, 0.09, 0.09, secondary, 0.48, 0.26, -0.25);
      const l2 = makePart(0.75, 0.09, 0.09, secondary, -0.48, 0.26, 0.18);
      const r2 = makePart(0.75, 0.09, 0.09, secondary, 0.48, 0.26, 0.18);
      l1.rotation.z = 0.4;
      r1.rotation.z = -0.4;
      l2.rotation.z = 0.4;
      r2.rotation.z = -0.4;
      this._limbs.push(l1, r1, l2, r2);
    } else if (this.type === MOB_TYPES.ENDERMAN) {
      // Tall slender obsidian silhouette with glowing purple eyes & long limbs
      makeHead(0.46, 0.46, 0.46, primary, 0, 2.5, 0);
      makePart(0.11, 0.06, 0.03, accent, -0.11, 2.51, -0.235, { emissiveHex: 0xe879f9 });
      makePart(0.11, 0.06, 0.03, accent, 0.11, 2.51, -0.235, { emissiveHex: 0xe879f9 });
      makePart(0.46, 0.78, 0.24, primary, 0, 1.88, 0, { map: bodyTex });
      // Extra-long arms
      makePart(0.11, 1.35, 0.11, primary, -0.3, 1.6, -0.05);
      makePart(0.11, 1.35, 0.11, primary, 0.3, 1.6, -0.05);
      // Extra-long legs
      const ll = makePart(0.12, 1.48, 0.12, primary, -0.12, 0.74, 0);
      const rl = makePart(0.12, 1.48, 0.12, primary, 0.12, 0.74, 0);
      this._limbs.push(ll, rl);
    } else if (this.type === MOB_TYPES.ZOMBIFIED_PIGLIN) {
      makeHead(0.44, 0.44, 0.44, primary, 0, 1.56, 0);
      makePart(0.46, 0.68, 0.26, secondary, 0, 1.0, 0, { map: bodyTex });
      makePart(0.18, 0.18, 0.54, primary, -0.33, 1.2, -0.22);
      makePart(0.18, 0.18, 0.54, secondary, 0.33, 1.2, -0.22);
      // Golden sword in right hand
      makePart(0.06, 0.58, 0.09, accent, 0.33, 1.38, -0.52);
      const ll = makePart(0.2, 0.66, 0.22, 0x6b4c35, -0.12, 0.33, 0);
      const rl = makePart(0.2, 0.66, 0.22, 0x6b4c35, 0.12, 0.33, 0);
      this._limbs.push(ll, rl);
    } else if (this.type === MOB_TYPES.BLAZE) {
      // Glowing golden head + smoky core + 8 orbiting golden Blaze Rods
      makeHead(0.46, 0.46, 0.46, primary, 0, 1.46, 0);
      makePart(0.28, 0.82, 0.28, secondary, 0, 0.8, 0, { emissiveHex: 0x78350f });
      for (let r = 0; r < 8; r++) {
        const tier = r < 4 ? 0 : 1;
        const radius = tier === 0 ? 0.56 : 0.42;
        const yOff = tier === 0 ? 1.02 : 0.52;
        const angle = (r % 4) * (Math.PI / 2) + tier * 0.78;
        const rod = makePart(
          0.1,
          0.52,
          0.1,
          accent,
          Math.cos(angle) * radius,
          yOff,
          Math.sin(angle) * radius,
          { emissiveHex: 0xf59e0b }
        );
        rod.userData = { angle, radius, yOff, tier };
        this._blazeRods.push(rod);
      }
    } else if (this.type === MOB_TYPES.VILLAGER) {
      // Classic tall Villager head + prominent nose + crossed arms + profession robe/hat
      const robeColor =
        this.profession === 'blacksmith'
          ? 0x374151
          : this.profession === 'librarian'
          ? 0x991b1b
          : 0x78502c;
      makeHead(0.46, 0.54, 0.46, primary, 0, 1.62, 0);
      // Iconic Villager nose
      makePart(0.14, 0.22, 0.14, 0xa87654, 0, 1.5, -0.29);
      // Profession hat/headband
      if (this.profession === 'farmer') {
        makePart(0.76, 0.08, 0.76, 0xeab308, 0, 1.88, 0);
        makePart(0.5, 0.14, 0.5, 0xca8a04, 0, 1.95, 0);
      } else if (this.profession === 'librarian') {
        makePart(0.52, 0.12, 0.52, 0xb91c1c, 0, 1.92, 0);
        makePart(0.42, 0.08, 0.42, 0xfef3c7, 0, 1.98, 0);
      } else {
        // Blacksmith brow band
        makePart(0.49, 0.08, 0.49, 0x1f2937, 0, 1.82, 0);
      }
      // Robe torso
      makePart(0.48, 0.78, 0.3, robeColor, 0, 0.96, 0, {
        map: this.profession === 'farmer' ? bodyTex : null,
      });
      // Crossed Villager arms
      makePart(0.56, 0.2, 0.22, robeColor, 0, 1.06, -0.22);
      const ll = makePart(0.2, 0.58, 0.22, 0x4b3621, -0.12, 0.29, 0);
      const rl = makePart(0.2, 0.58, 0.22, 0x4b3621, 0.12, 0.29, 0);
      this._limbs.push(ll, rl);
    } else if (this.type === MOB_TYPES.WOLF) {
      // Fluffy mane + sleek body + pointed ears + wagging tail + toggleable red collar
      makePart(0.44, 0.42, 0.36, primary, 0, 0.54, -0.18, { map: bodyTex });
      makePart(0.36, 0.36, 0.54, primary, 0, 0.5, 0.22, { map: bodyTex });
      makeHead(0.34, 0.34, 0.34, primary, 0, 0.6, -0.5);
      // Snout
      makePart(0.18, 0.14, 0.18, 0xe7e5e4, 0, 0.53, -0.74);
      // Pointed ears
      makePart(0.09, 0.12, 0.06, secondary, -0.12, 0.81, -0.45);
      makePart(0.09, 0.12, 0.06, secondary, 0.12, 0.81, -0.45);
      // Red tamed collar (hidden until tamed)
      const collar = makePart(0.4, 0.38, 0.1, accent, 0, 0.57, -0.34);
      collar.visible = this.tamed;
      this._collarMesh = collar;
      // Tail (angle reflects HP!)
      const tail = makePart(0.1, 0.1, 0.4, secondary, 0, 0.58, 0.62);
      this._tailMesh = tail;
      const fl = makePart(0.12, 0.36, 0.12, secondary, -0.12, 0.18, -0.22);
      const fr = makePart(0.12, 0.36, 0.12, secondary, 0.12, 0.18, -0.22);
      const bl = makePart(0.12, 0.36, 0.12, secondary, -0.12, 0.18, 0.34);
      const br = makePart(0.12, 0.36, 0.12, secondary, 0.12, 0.18, 0.34);
      this._limbs.push(fl, fr, bl, br);
    } else if (this.type === MOB_TYPES.ZOMBIE) {
      makeHead(0.44, 0.44, 0.44, primary, 0, 1.56, 0);
      makePart(0.46, 0.68, 0.26, secondary, 0, 1.0, 0, { map: bodyTex });
      makePart(0.18, 0.18, 0.54, primary, -0.33, 1.2, -0.24);
      makePart(0.18, 0.18, 0.54, primary, 0.33, 1.2, -0.24);
      const ll = makePart(0.2, 0.66, 0.22, accent, -0.12, 0.33, 0);
      const rl = makePart(0.2, 0.66, 0.22, accent, 0.12, 0.33, 0);
      this._limbs.push(ll, rl);
    } else {
      // Translucent outer Slime cube + dense core
      makeHead(0.84, 0.84, 0.84, primary, 0, 0.42, 0, true, 0.72);
      makePart(0.52, 0.52, 0.52, secondary, 0, 0.42, 0, { map: bodyTex });
    }

    this.mesh = group;
    this.syncMesh();
    return group;
  }

  syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw;

    if (this.type === MOB_TYPES.CREEPER && this.isFusing) {
      const swell = 1 + (this.fuseTimer / 1.45) * 0.28;
      this.mesh.scale.set(swell, 1 + (swell - 1) * 0.4, swell);
    } else if (this.type === MOB_TYPES.WOLF && this.sitting) {
      this.mesh.scale.set(1, 0.84, 0.94);
    } else {
      this.mesh.scale.set(1, 1, 1);
    }

    // Orbiting Blaze Rods animation
    if (this.type === MOB_TYPES.BLAZE && this._blazeRods.length > 0) {
      for (let i = 0; i < this._blazeRods.length; i++) {
        const rod = this._blazeRods[i];
        const ud = rod.userData;
        const speed = ud.tier === 0 ? 1.4 : -2.1;
        const a = ud.angle + this.hoverPhase * speed;
        rod.position.set(
          Math.cos(a) * ud.radius,
          ud.yOff + Math.sin(this.hoverPhase * 1.5 + i) * 0.12,
          Math.sin(a) * ud.radius
        );
        rod.rotation.y = -a;
      }
    }

    // Wolf collar & health-indicating tail
    if (this.type === MOB_TYPES.WOLF) {
      if (this._collarMesh) this._collarMesh.visible = this.tamed;
      if (this._tailMesh) {
        const hpRatio = Math.max(0, Math.min(1, this.health / Math.max(1, this.maxHealth)));
        this._tailMesh.rotation.x = -0.35 + hpRatio * 0.85;
        this._tailMesh.rotation.y = this.tamed ? Math.sin(this.hoverPhase * 3.5) * 0.28 : 0;
      }
    }

    const swing = this.sitting ? 0 : Math.sin(this.walkPhase) * 0.45;
    if (this._limbs.length === 4) {
      if (this.type === MOB_TYPES.SPIDER) {
        this._limbs[0].rotation.y = swing * 0.7;
        this._limbs[1].rotation.y = -swing * 0.7;
        this._limbs[2].rotation.y = -swing * 0.7;
        this._limbs[3].rotation.y = swing * 0.7;
      } else {
        this._limbs[0].rotation.x = swing;
        this._limbs[1].rotation.x = -swing;
        this._limbs[2].rotation.x = -swing;
        this._limbs[3].rotation.x = swing;
      }
    } else if (this._limbs.length === 2) {
      this._limbs[0].rotation.x = swing;
      this._limbs[1].rotation.x = -swing;
    }

    const isHurt = this.hurtTimer > 0;
    const isFlashWhite =
      this.type === MOB_TYPES.CREEPER &&
      this.isFusing &&
      Math.floor(this.fuseTimer * 12) % 2 === 0;

    for (let i = 0; i < this._materials.length; i++) {
      const mat = this._materials[i];
      if (isFlashWhite) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 0.85;
      } else if (isHurt) {
        mat.emissive.setHex(0xb91c1c);
        mat.emissiveIntensity = 0.65;
      } else if (this._emissiveFlags[i]) {
        mat.emissive.setHex(this._emissiveFlags[i]);
        mat.emissiveIntensity = this.provoked ? 1.2 : 0.85;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  }

  dispose() {
    if (!this.mesh) return;
    // Geometries are shared via getSharedBoxGeometry(); only dispose per-entity materials
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].dispose();
    }
    this.mesh = null;
    this._limbs = [];
    this._materials = [];
    this._baseColors = [];
    this._emissiveFlags = [];
    this._woolParts = [];
    this._blazeRods = [];
    this._collarMesh = null;
    this._tailMesh = null;
  }
}
