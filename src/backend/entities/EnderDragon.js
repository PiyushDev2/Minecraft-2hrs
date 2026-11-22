/**
 * @file EnderDragon.js
 * @description Articulated Three.js Ender Dragon boss + 8 Obsidian Pillar End Crystals,
 * healing beams, circling/swooping/perching AI, Dragon Fireball barrages, raycast hitboxes,
 * and victory state triggering Dragon Egg + End Exit Portal activation.
 */

import * as THREE from 'three';
import { getEndPillarPositions } from '../terrain/TerrainGenerator.js';
import { getSharedBoxGeometry } from './MobSkins.js';

export class EnderDragonBoss {
  constructor() {
    this.name = 'Ender Dragon';
    this.maxHealth = 200;
    this.health = 200;
    this.dead = false;
    this.hurtTimer = 0;

    this.position = { x: 0, y: 74, z: -20 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;

    // AI state machine: 'circle' | 'swoop' | 'perch'
    this.phase = 'circle';
    this.phaseTimer = 7.5;
    this.orbitAngle = 0;
    this.orbitRadius = 22;
    this.wingPhase = 0;
    this.fireballCooldown = 3.5;
    this.meleeCooldown = 0;

    /**
     * 8 spinning End Crystals sitting atop the Obsidian Pillars.
     * @type {Array<{ id: number, x: number, y: number, z: number, alive: boolean, mesh: THREE.Group|null }>}
     */
    this.crystals = getEndPillarPositions().map((p, idx) => ({
      id: idx + 1,
      x: p.x + 0.5,
      y: p.topY + 1.4,
      z: p.z + 0.5,
      alive: true,
      mesh: null,
    }));

    /** @type {number|null} */
    this.healingCrystalId = null;

    /** @type {THREE.Group|null} */
    this.group = null;
    /** @type {THREE.Group|null} */
    this.dragonMesh = null;
    /** @type {THREE.Group|null} */
    this._leftWing = null;
    /** @type {THREE.Group|null} */
    this._rightWing = null;
    /** @type {THREE.Object3D[]} */
    this._tailSegments = [];
    /** @type {THREE.Object3D|null} */
    this._jaw = null;
    /** @type {THREE.MeshLambertMaterial[]} */
    this._dragonMats = [];
    /** @type {THREE.Line|null} */
    this._healBeam = null;

    /** @type {((origin:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}) => void)|null} */
    this.onFireball = null;
    /** @type {((crystal:{id:number,x:number,y:number,z:number}) => void)|null} */
    this.onCrystalDestroyed = null;
  }

  /**
   * Builds the Three.js container holding the articulated Dragon, 8 End Crystals, and healing beam.
   * @returns {THREE.Group}
   */
  buildMesh() {
    if (this.group) return this.group;

    const root = new THREE.Group();
    const dragon = new THREE.Group();
    this._dragonMats = [];
    this._tailSegments = [];

    const makeMat = (hex, emissiveHex = 0, emissiveIntensity = 0) => {
      const m = new THREE.MeshLambertMaterial({ color: hex });
      if (emissiveHex) {
        m.emissive.setHex(emissiveHex);
        m.emissiveIntensity = emissiveIntensity;
      }
      this._dragonMats.push(m);
      return m;
    };

    const obsidianMat = makeMat(0x14131a);
    const scaleMat = makeMat(0x272430);
    const wingMembraneMat = makeMat(0x1c1926);
    const eyeMat = makeMat(0xf0abfc, 0xd946ef, 1.3);

    const addPart = (parent, w, h, d, mat, x, y, z) => {
      const mesh = new THREE.Mesh(getSharedBoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Main Torso + Dorsal Spines
    addPart(dragon, 1.9, 1.5, 4.4, obsidianMat, 0, 0, 0);
    addPart(dragon, 0.25, 0.55, 0.7, scaleMat, 0, 0.95, -1.2);
    addPart(dragon, 0.25, 0.65, 0.7, scaleMat, 0, 1.0, 0.0);
    addPart(dragon, 0.25, 0.55, 0.7, scaleMat, 0, 0.95, 1.2);

    // Long Articulated Neck & Dragon Head (facing -Z)
    addPart(dragon, 0.85, 0.85, 1.4, obsidianMat, 0, 0.2, -2.7);
    addPart(dragon, 0.75, 0.75, 1.2, obsidianMat, 0, 0.45, -3.9);
    // Head Skull
    addPart(dragon, 1.35, 1.15, 1.55, obsidianMat, 0, 0.6, -5.0);
    // Snout & Jaw
    addPart(dragon, 0.9, 0.48, 1.15, obsidianMat, 0, 0.55, -6.2);
    this._jaw = addPart(dragon, 0.82, 0.26, 1.05, scaleMat, 0, 0.14, -6.05);
    // Glowing Magenta Eyes
    addPart(dragon, 0.22, 0.18, 0.14, eyeMat, -0.45, 0.76, -5.75);
    addPart(dragon, 0.22, 0.18, 0.14, eyeMat, 0.45, 0.76, -5.75);
    // Horns
    addPart(dragon, 0.18, 0.42, 0.45, scaleMat, -0.42, 1.32, -4.65);
    addPart(dragon, 0.18, 0.42, 0.45, scaleMat, 0.42, 1.32, -4.65);

    // Huge Articulated Left & Right Wings
    const leftWing = new THREE.Group();
    leftWing.position.set(-0.95, 0.45, -0.4);
    addPart(leftWing, 3.8, 0.24, 0.36, scaleMat, -1.9, 0, -0.4);
    addPart(leftWing, 4.6, 0.14, 2.7, wingMembraneMat, -2.3, -0.04, 0.85);
    addPart(leftWing, 3.2, 0.12, 2.1, wingMembraneMat, -5.6, -0.06, 0.95);
    dragon.add(leftWing);
    this._leftWing = leftWing;

    const rightWing = new THREE.Group();
    rightWing.position.set(0.95, 0.45, -0.4);
    addPart(rightWing, 3.8, 0.24, 0.36, scaleMat, 1.9, 0, -0.4);
    addPart(rightWing, 4.6, 0.14, 2.7, wingMembraneMat, 2.3, -0.04, 0.85);
    addPart(rightWing, 3.2, 0.12, 2.1, wingMembraneMat, 5.6, -0.06, 0.95);
    dragon.add(rightWing);
    this._rightWing = rightWing;

    // Legs (tucked while flying)
    addPart(dragon, 0.45, 1.2, 0.45, obsidianMat, -0.95, -0.95, -1.1);
    addPart(dragon, 0.45, 1.2, 0.45, obsidianMat, 0.95, -0.95, -1.1);
    addPart(dragon, 0.52, 1.3, 0.52, obsidianMat, -0.95, -1.0, 1.4);
    addPart(dragon, 0.52, 1.3, 0.52, obsidianMat, 0.95, -1.0, 1.4);

    // 5-segment Undulating Tail
    for (let s = 0; s < 5; s++) {
      const size = Math.max(0.32, 0.92 - s * 0.14);
      const seg = addPart(dragon, size, size, 1.15, s % 2 === 0 ? obsidianMat : scaleMat, 0, 0.05, 2.7 + s * 1.15);
      this._tailSegments.push(seg);
    }

    this.dragonMesh = dragon;
    root.add(dragon);

    // 8 Spinning End Crystals
    for (const c of this.crystals) {
      if (!c.alive) continue;
      const cg = new THREE.Group();
      cg.position.set(c.x, c.y, c.z);

      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62, 0),
        new THREE.MeshLambertMaterial({
          color: 0xf0abfc,
          emissive: 0xd946ef,
          emissiveIntensity: 1.1,
        })
      );
      const cage = new THREE.Mesh(
        new THREE.BoxGeometry(1.12, 1.12, 1.12),
        new THREE.MeshBasicMaterial({
          color: 0xe879f9,
          wireframe: true,
          transparent: true,
          opacity: 0.72,
        })
      );
      cg.add(core, cage);
      cg.userData = { core, cage };
      c.mesh = cg;
      root.add(cg);
    }

    // Crystal -> Dragon Healing Beam
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 70, 0),
      new THREE.Vector3(0, 74, 0),
    ]);
    const beamMat = new THREE.LineBasicMaterial({ color: 0xf472b6, linewidth: 2 });
    this._healBeam = new THREE.Line(beamGeo, beamMat);
    this._healBeam.visible = false;
    root.add(this._healBeam);

    this.group = root;
    this.syncMesh();
    return root;
  }

  /**
   * Returns living End Crystals count.
   */
  getAliveCrystalCount() {
    let count = 0;
    for (const c of this.crystals) {
      if (c.alive) count++;
    }
    return count;
  }

  /**
   * Destroys an End Crystal by ID, dealing 10 bonus damage if the Dragon was healing from it.
   * @param {number} crystalId
   * @returns {{ destroyed: boolean, crystal: {id:number,x:number,y:number,z:number}|null, bonusDragonDamage: boolean }}
   */
  destroyCrystal(crystalId) {
    const c = this.crystals.find((cr) => cr.id === crystalId);
    if (!c || !c.alive) return { destroyed: false, crystal: null, bonusDragonDamage: false };

    c.alive = false;
    if (c.mesh) {
      if (this.group) this.group.remove(c.mesh);
      c.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      c.mesh = null;
    }

    const wasHealing = this.healingCrystalId === crystalId;
    if (wasHealing) {
      this.healingCrystalId = null;
      this.takeDamage(10);
    }
    this.onCrystalDestroyed?.({ id: c.id, x: c.x, y: c.y, z: c.z });
    return {
      destroyed: true,
      crystal: { id: c.id, x: c.x, y: c.y, z: c.z },
      bonusDragonDamage: wasHealing,
    };
  }

  /**
   * Checks if a world point (e.g. arrow position) hits any live End Crystal.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [radius=1.15]
   */
  checkPointHitCrystal(x, y, z, radius = 1.15) {
    for (const c of this.crystals) {
      if (!c.alive) continue;
      if (Math.hypot(x - c.x, y - c.y, z - c.z) <= radius) {
        return c;
      }
    }
    return null;
  }

  /**
   * Checks if a world point (e.g. arrow) hits the Ender Dragon body/head spheres.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [pad=0.6]
   */
  checkPointHitDragon(x, y, z, pad = 0.6) {
    if (this.dead) return false;
    const spheres = this.getHitSpheres();
    for (const s of spheres) {
      if (Math.hypot(x - s.x, y - s.y, z - s.z) <= s.r + pad) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns world-space hit spheres (head, torso, tail) for accurate raycast & projectile checks.
   */
  getHitSpheres() {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    return [
      { x: this.position.x, y: this.position.y, z: this.position.z, r: 2.35 },
      { x: this.position.x + fx * 4.5, y: this.position.y + 0.5, z: this.position.z + fz * 4.5, r: 1.65 },
      { x: this.position.x - fx * 3.6, y: this.position.y, z: this.position.z - fz * 3.6, r: 1.45 },
    ];
  }

  /**
   * Raycasts player melee/interact beam against live End Crystals and the Ender Dragon.
   * @param {{ x: number, y: number, z: number }} origin
   * @param {{ x: number, y: number, z: number }} dir
   * @param {number} [maxDist=6.5]
   * @returns {{ hit: boolean, target: 'crystal'|'dragon'|null, crystalId?: number, distance: number }}
   */
  raycast(origin, dir, maxDist = 6.5) {
    let bestT = maxDist;
    let result = { hit: false, target: null, distance: maxDist };

    const raySphere = (cx, cy, cz, r) => {
      const ocx = origin.x - cx;
      const ocy = origin.y - cy;
      const ocz = origin.z - cz;
      const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
      const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      const disc = b * b - c;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t <= bestT) return t;
      return null;
    };

    for (const c of this.crystals) {
      if (!c.alive) continue;
      const t = raySphere(c.x, c.y, c.z, 1.15);
      if (t !== null && t < bestT) {
        bestT = t;
        result = { hit: true, target: 'crystal', crystalId: c.id, distance: t };
      }
    }

    if (!this.dead) {
      for (const s of this.getHitSpheres()) {
        const t = raySphere(s.x, s.y, s.z, s.r);
        if (t !== null && t < bestT) {
          bestT = t;
          result = { hit: true, target: 'dragon', distance: t };
        }
      }
    }

    return result;
  }

  /**
   * Applies damage to the Ender Dragon. Returns true on the fatal blow.
   * @param {number} amount
   * @returns {boolean}
   */
  takeDamage(amount) {
    if (this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.3;
    if (this.health <= 0) {
      this.dead = true;
      if (this.dragonMesh) this.dragonMesh.visible = false;
      if (this._healBeam) this._healBeam.visible = false;
      return true;
    }
    return false;
  }

  /**
   * Advances dragon flight AI, crystal healing, swoop melee knockback, and fireball attacks.
   * @param {number} dt
   * @param {import('../physics/Player.js').Player} player
   * @param {import('../survival/SurvivalStats.js').SurvivalStats|null} survival
   * @param {'creative'|'survival'} gameMode
   */
  update(dt, player, survival, gameMode) {
    this.wingPhase += dt * 4.4;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.fireballCooldown = Math.max(0, this.fireballCooldown - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

    // Animate living End Crystals regardless of dragon state
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      if (!c.alive || !c.mesh) continue;
      const ud = c.mesh.userData;
      c.mesh.position.y = c.y + Math.sin(this.wingPhase * 0.7 + i) * 0.26;
      if (ud.core) {
        ud.core.rotation.y += dt * 2.2;
        ud.core.rotation.x += dt * 1.4;
      }
      if (ud.cage) {
        ud.cage.rotation.y -= dt * 1.1;
        ud.cage.rotation.z += dt * 0.8;
      }
    }

    if (this.dead) return;

    const pPos = player.getPosition();

    // Heal from nearest living End Crystal within 26 blocks
    let nearestCrystal = null;
    let nearestDist = 26;
    for (const c of this.crystals) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - this.position.x, c.y - this.position.y, c.z - this.position.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCrystal = c;
      }
    }
    if (nearestCrystal) {
      this.healingCrystalId = nearestCrystal.id;
      this.health = Math.min(this.maxHealth, this.health + 3.0 * dt);
    } else {
      this.healingCrystalId = null;
    }

    // Phase transitions: circle -> swoop -> perch -> circle
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      if (this.phase === 'circle') {
        this.phase = Math.random() < 0.65 ? 'swoop' : 'perch';
        this.phaseTimer = this.phase === 'swoop' ? 4.8 : 5.5;
      } else if (this.phase === 'swoop') {
        this.phase = 'circle';
        this.phaseTimer = 6.5 + Math.random() * 3.0;
      } else {
        this.phase = 'circle';
        this.phaseTimer = 7.0 + Math.random() * 2.5;
      }
    }

    let targetX = 0;
    let targetY = 72;
    let targetZ = 0;
    let speed = 13.5;

    if (this.phase === 'circle') {
      this.orbitAngle += dt * 0.55;
      targetX = Math.cos(this.orbitAngle) * this.orbitRadius;
      targetZ = Math.sin(this.orbitAngle) * this.orbitRadius;
      targetY = 70 + Math.sin(this.orbitAngle * 2.0) * 5.5;
      speed = 13.5;

      // Launch purple Dragon Fireball at player during orbit
      if (
        gameMode === 'survival' &&
        (!survival || !survival.isDead) &&
        this.fireballCooldown <= 0
      ) {
        this.fireballCooldown = 4.2 + Math.random() * 2.0;
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        this.onFireball?.(
          { x: this.position.x + fx * 5.2, y: this.position.y + 0.4, z: this.position.z + fz * 5.2 },
          { x: pPos.x, y: pPos.y + 1.1, z: pPos.z }
        );
      }
    } else if (this.phase === 'swoop') {
      targetX = pPos.x;
      targetY = Math.max(58.5, pPos.y + 2.2);
      targetZ = pPos.z;
      speed = 16.5;
    } else {
      // Perch low over center fountain (0, 61.5, 0) so melee players can strike!
      targetX = 0;
      targetY = 61.5;
      targetZ = 0;
      speed = 10.5;
    }

    const dx = targetX - this.position.x;
    const dy = targetY - this.position.y;
    const dz = targetZ - this.position.z;
    const dist = Math.hypot(dx, dy, dz) || 0.001;

    if (dist > 0.6) {
      const step = Math.min(dist, speed * dt);
      this.velocity.x = (dx / dist) * speed;
      this.velocity.y = (dy / dist) * speed;
      this.velocity.z = (dz / dist) * speed;
      this.position.x += (dx / dist) * step;
      this.position.y += (dy / dist) * step;
      this.position.z += (dz / dist) * step;

      const desiredYaw = Math.atan2(-dx, -dz);
      let diffYaw = desiredYaw - this.yaw;
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
      this.yaw += diffYaw * Math.min(1, dt * 4.2);
      this.pitch = Math.max(-0.45, Math.min(0.45, Math.atan2(dy, Math.hypot(dx, dz) || 1)));
    }

    // Swoop / close-range melee knockback on player
    if (gameMode === 'survival' && survival && !survival.isDead && this.meleeCooldown <= 0) {
      const pd = Math.hypot(
        pPos.x - this.position.x,
        pPos.y + 1 - this.position.y,
        pPos.z - this.position.z
      );
      if (pd < 4.2) {
        this.meleeCooldown = 1.4;
        const dealt = survival.applyDamage(6, 'ender_dragon');
        const kx = pPos.x - this.position.x;
        const kz = pPos.z - this.position.z;
        const kl = Math.hypot(kx, kz) || 1;
        player.velocity.x += (kx / kl) * 9.5;
        player.velocity.y = Math.max(player.velocity.y, 7.2);
        player.velocity.z += (kz / kl) * 9.5;
        if (dealt > 0) {
          this.onPlayerDamaged?.(dealt);
        }
      }
    }

    this.syncMesh(nearestCrystal);
  }

  /**
   * Syncs Three.js transforms, wing flap, jaw snap, tail wave, hurt flash, and crystal healing beam.
   */
  syncMesh(healingCrystal = null) {
    if (!this.dragonMesh) return;
    this.dragonMesh.visible = !this.dead;
    this.dragonMesh.position.set(this.position.x, this.position.y, this.position.z);
    this.dragonMesh.rotation.order = 'YXZ';
    this.dragonMesh.rotation.y = this.yaw;
    this.dragonMesh.rotation.x = this.pitch;

    const flap = Math.sin(this.wingPhase) * 0.58;
    if (this._leftWing) this._leftWing.rotation.z = flap;
    if (this._rightWing) this._rightWing.rotation.z = -flap;
    if (this._jaw) {
      this._jaw.rotation.x = this.phase === 'swoop' ? 0.35 + Math.sin(this.wingPhase * 2) * 0.15 : 0.08;
    }
    for (let s = 0; s < this._tailSegments.length; s++) {
      const seg = this._tailSegments[s];
      seg.position.y = 0.05 + Math.sin(this.wingPhase - s * 0.55) * (0.14 + s * 0.06);
      seg.position.x = Math.cos(this.wingPhase * 0.5 - s * 0.45) * (0.08 + s * 0.05);
    }

    // Hurt flash
    for (let i = 0; i < this._dragonMats.length; i++) {
      const m = this._dragonMats[i];
      if (i === 3) continue; // Keep magenta eyes glowing
      if (this.hurtTimer > 0) {
        m.emissive.setHex(0xb91c1c);
        m.emissiveIntensity = 0.7;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }

    // Healing beam line
    if (this._healBeam) {
      if (healingCrystal && !this.dead) {
        this._healBeam.visible = true;
        const posAttr = this._healBeam.geometry.getAttribute('position');
        posAttr.setXYZ(0, healingCrystal.x, healingCrystal.y, healingCrystal.z);
        posAttr.setXYZ(1, this.position.x, this.position.y, this.position.z);
        posAttr.needsUpdate = true;
      } else {
        this._healBeam.visible = false;
      }
    }
  }

  getBossBarState() {
    if (this.dead) return null;
    return {
      name: this.name,
      health: Math.ceil(this.health),
      maxHealth: this.maxHealth,
      crystalsRemaining: this.getAliveCrystalCount(),
    };
  }

  dispose() {
    for (const m of this._dragonMats) m.dispose();
    this._dragonMats = [];
    for (const c of this.crystals) {
      if (c.mesh) {
        c.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((mm) => mm.dispose());
            else child.material.dispose();
          }
        });
        c.mesh = null;
      }
    }
    if (this._healBeam) {
      this._healBeam.geometry.dispose();
      this._healBeam.material.dispose();
      this._healBeam = null;
    }
    this.group = null;
    this.dragonMesh = null;
  }
}
