/**
 * @file XpOrbManager.ts
 * @description Pooled GPU InstancedMesh experience orb simulation (1 draw call for up to 180 orbs)
 * with gravity, voxel ground bounce, magnetic player attraction, and glowing emerald-gold pulse.
 */

import * as THREE from 'three';

const MAX_ORBS = 180;

interface XpOrb {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  value: number;
  age: number;
  phase: number;
}

export class XpOrbManager {
  private orbs: XpOrb[] = [];
  private scene: THREE.Scene | null = null;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private readonly _dummy = new THREE.Object3D();
  private readonly _color = new THREE.Color();
  private elapsed = 0;

  attachScene(scene: THREE.Scene | null): void {
    if (this.scene && this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
    }
    this.scene = scene;
    if (this.scene) {
      if (!this.instancedMesh) {
        const geo = new THREE.OctahedronGeometry(0.14, 0);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.92,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, MAX_ORBS);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(MAX_ORBS * 3).fill(1),
          3
        );
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh = mesh;
      }
      this.scene.add(this.instancedMesh);
    }
  }

  /**
   * Splits an XP award into 1..4 tactile bouncing orbs at world (x, y, z).
   */
  spawnXp(x: number, y: number, z: number, totalXp: number): void {
    let remaining = Math.max(1, Math.round(totalXp));
    const maxSplit = Math.min(4, remaining);
    for (let i = 0; i < maxSplit && remaining > 0; i++) {
      if (this.orbs.length >= MAX_ORBS) {
        this.orbs.shift();
      }
      const chunk = i === maxSplit - 1 ? remaining : Math.max(1, Math.floor(remaining / (maxSplit - i)));
      remaining -= chunk;
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.2 + Math.random() * 1.6;
      this.orbs.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * spd,
        vy: 2.8 + Math.random() * 1.8,
        vz: Math.sin(angle) * spd,
        value: chunk,
        age: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * Steps orb physics, attracts nearby orbs to the player, and returns total picked-up XP this tick.
   */
  update(
    dt: number,
    playerPos: { x: number; y: number; z: number },
    isSolidAt: (x: number, y: number, z: number) => boolean
  ): number {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += step;
    let collectedXp = 0;

    const targetY = playerPos.y + 0.9;

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += step;
      if (o.age > 90) {
        this.orbs.splice(i, 1);
        continue;
      }

      const dx = playerPos.x - o.x;
      const dy = targetY - o.y;
      const dz = playerPos.z - o.z;
      const dist = Math.hypot(dx, dy, dz);

      if (o.age > 0.25 && dist < 1.15) {
        collectedXp += o.value;
        this.orbs.splice(i, 1);
        continue;
      }

      if (o.age > 0.2 && dist < 5.2 && dist > 0.01) {
        const pull = (1 - dist / 5.2) * 16.5;
        o.vx += (dx / dist) * pull * step;
        o.vy += (dy / dist) * pull * step;
        o.vz += (dz / dist) * pull * step;
      }

      o.vy -= 14 * step;
      o.vx *= Math.pow(0.86, step * 20);
      o.vz *= Math.pow(0.86, step * 20);

      const nx = o.x + o.vx * step;
      const ny = o.y + o.vy * step;
      const nz = o.z + o.vz * step;

      if (!isSolidAt(Math.floor(nx), Math.floor(o.y), Math.floor(o.z))) {
        o.x = nx;
      } else {
        o.vx *= -0.3;
      }

      if (!isSolidAt(Math.floor(o.x), Math.floor(o.y), Math.floor(nz))) {
        o.z = nz;
      } else {
        o.vz *= -0.3;
      }

      if (!isSolidAt(Math.floor(o.x), Math.floor(ny - 0.16), Math.floor(o.z))) {
        o.y = ny;
      } else {
        o.vy = Math.abs(o.vy) > 1.5 ? -o.vy * 0.28 : 0;
        o.vx *= 0.72;
        o.vz *= 0.72;
      }
    }

    this._syncInstances();
    return collectedXp;
  }

  private _syncInstances(): void {
    if (!this.instancedMesh) return;
    const count = Math.min(this.orbs.length, MAX_ORBS);
    this.instancedMesh.count = count;

    for (let i = 0; i < count; i++) {
      const o = this.orbs[i];
      const pulse = 0.85 + Math.sin(this.elapsed * 6.5 + o.phase) * 0.22;
      const size = (0.72 + Math.min(0.45, o.value * 0.08)) * pulse;
      this._dummy.position.set(o.x, o.y + 0.14 + Math.sin(this.elapsed * 4 + o.phase) * 0.05, o.z);
      this._dummy.rotation.set(this.elapsed * 1.4 + o.phase, this.elapsed * 2.2 + o.phase, 0);
      this._dummy.scale.setScalar(size);
      this._dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this._dummy.matrix);

      // Classic emerald-lime to golden-yellow shimmer
      const t = 0.5 + 0.5 * Math.sin(this.elapsed * 5.2 + o.phase);
      this._color.setRGB(0.45 + 0.5 * t, 0.96, 0.18 + 0.12 * (1 - t));
      this.instancedMesh.setColorAt(i, this._color);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.orbs = [];
    if (this.instancedMesh) {
      this.instancedMesh.count = 0;
    }
  }

  dispose(): void {
    this.clear();
    if (this.scene && this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
    }
    this.instancedMesh?.geometry.dispose();
    if (this.instancedMesh?.material) {
      (this.instancedMesh.material as THREE.Material).dispose();
    }
    this.instancedMesh = null;
    this.scene = null;
  }
}
