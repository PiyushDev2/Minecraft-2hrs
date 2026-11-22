/**
 * @file ParticleSystem.ts
 * @description Zero-GC pooled InstancedMesh voxel particle system for block mining/break debris,
 * melee combat sparks, and TNT/Creeper explosion bursts.
 */

import * as THREE from 'three';

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  color: THREE.Color;
}

export class ParticleSystem {
  public readonly mesh: THREE.InstancedMesh;
  private readonly slots: ParticleSlot[];
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;
  public activeCount = 0;
  private densityScale = 1.0;

  public setDensity(mode: 'all' | 'decreased' | 'minimal'): void {
    this.densityScale = mode === 'minimal' ? 0.25 : mode === 'decreased' ? 0.55 : 1.0;
  }

  private scaleCount(count: number): number {
    return Math.max(1, Math.round(count * this.densityScale));
  }

  constructor(maxParticles = 280) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxParticles);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.slots = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      this.slots[i] = {
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.5,
        size: 0.12,
        gravity: 16,
        color: new THREE.Color(0xffffff),
      };
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.slots[i].color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private emitOne(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    hexColor: number,
    size: number,
    life: number,
    gravity = 16
  ): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.age = 0;
    slot.life = life;
    slot.size = size;
    slot.gravity = gravity;
    slot.color.setHex(hexColor);
    this.mesh.setColorAt(this.cursor === 0 ? this.slots.length - 1 : this.cursor - 1, slot.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public spawnBlockBreak(wx: number, wy: number, wz: number, hexColor: number, count = 16): void {
    const n = this.scaleCount(count);
    for (let i = 0; i < n; i++) {
      const ox = wx + 0.15 + Math.random() * 0.7;
      const oy = wy + 0.15 + Math.random() * 0.7;
      const oz = wz + 0.15 + Math.random() * 0.7;
      const vx = (Math.random() - 0.5) * 4.4;
      const vy = 1.6 + Math.random() * 3.4;
      const vz = (Math.random() - 0.5) * 4.4;
      this.emitOne(ox, oy, oz, vx, vy, vz, hexColor, 0.1 + Math.random() * 0.08, 0.42 + Math.random() * 0.28, 17);
    }
  }

  public spawnHitSparks(x: number, y: number, z: number, hexColor = 0xffd54f, count = 10): void {
    const n = this.scaleCount(count);
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * 5.2;
      const vy = 1.8 + Math.random() * 3.6;
      const vz = (Math.random() - 0.5) * 5.2;
      this.emitOne(x, y, z, vx, vy, vz, hexColor, 0.09 + Math.random() * 0.06, 0.3 + Math.random() * 0.22, 14);
    }
  }

  public spawnFoodCrumbs(x: number, y: number, z: number, hexColor = 0xd99152, count = 5): void {
    const n = this.scaleCount(count);
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * 1.9;
      const vy = 0.6 + Math.random() * 1.4;
      const vz = (Math.random() - 0.5) * 1.9;
      this.emitOne(x, y, z, vx, vy, vz, hexColor, 0.055 + Math.random() * 0.035, 0.25 + Math.random() * 0.15, 13);
    }
  }

  public spawnPortalParticles(x: number, y: number, z: number, count = 14): void {
    const palette = [0xa855f7, 0xc084fc, 0x7e22ce, 0xe879f9];
    const n = this.scaleCount(count);
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * 2.2;
      const vy = 0.4 + Math.random() * 2.2;
      const vz = (Math.random() - 0.5) * 2.2;
      this.emitOne(
        x + (Math.random() - 0.5) * 1.1,
        y + (Math.random() - 0.5) * 1.6,
        z + (Math.random() - 0.5) * 1.1,
        vx,
        vy,
        vz,
        palette[i % palette.length],
        0.08 + Math.random() * 0.06,
        0.5 + Math.random() * 0.4,
        -1.5
      );
    }
  }

  public spawnEndermanParticles(x: number, y: number, z: number, count = 18): void {
    this.spawnPortalParticles(x, y + 1.1, z, count);
  }

  public spawnExplosion(x: number, y: number, z: number): void {
    const palette = [0xff6d00, 0xffc400, 0xeeeeee, 0x757575, 0x424242];
    const n = this.scaleCount(48);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 3 + Math.random() * 9.5;
      const vx = Math.sin(phi) * Math.cos(theta) * speed;
      const vy = Math.abs(Math.cos(phi)) * speed * 0.85 + 2.0;
      const vz = Math.sin(phi) * Math.sin(theta) * speed;
      const color = palette[i % palette.length];
      this.emitOne(
        x + (Math.random() - 0.5) * 0.9,
        y + (Math.random() - 0.5) * 0.9,
        z + (Math.random() - 0.5) * 0.9,
        vx,
        vy,
        vz,
        color,
        0.24 + Math.random() * 0.26,
        0.55 + Math.random() * 0.45,
        8.5
      );
    }
  }

  public update(dt: number): void {
    let alive = 0;
    let dirty = false;

    for (let i = 0; i < this.slots.length; i++) {
      const p = this.slots[i];
      if (!p.active) continue;
      dirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      alive++;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.97;
      p.vz *= 0.97;

      const scale = p.size * (1 - p.age / p.life * 0.55);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.age * 4, p.age * 3, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.activeCount = alive;
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
