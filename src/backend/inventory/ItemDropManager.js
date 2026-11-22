/**
 * @file ItemDropManager.js
 * @description Manages 3D dropped item entities with gravity, ground resting,
 * bobbing/spinning animation, and proximity collection into Player Inventory.
 */

import * as THREE from 'three';

const MAX_INSTANCED_DROPS = 256;

/**
 * Coordinates physical world item drops rendered in a single GPU InstancedMesh draw call.
 */
export class ItemDropManager {
  /**
   * @param {import('../world/World.js').World} world
   * @param {import('./ItemRegistry.js').ItemRegistry} itemRegistry
   * @param {import('./Inventory.js').Inventory} inventory
   */
  constructor(world, itemRegistry, inventory) {
    this.world = world;
    this.itemRegistry = itemRegistry;
    this.inventory = inventory;

    this.drops = [];
    this._nextId = 1;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.BoxGeometry|null} */
    this._sharedGeometry = null;
    /** @type {THREE.MeshLambertMaterial|null} */
    this._sharedMaterial = null;
    /** @type {THREE.InstancedMesh|null} */
    this._instancedMesh = null;

    this._dummy = new THREE.Object3D();
    this._tmpColor = new THREE.Color();
  }

  /**
   * Attaches a Three.js Scene to visualize dropped item cubes via one InstancedMesh.
   * @param {THREE.Scene|null} scene
   */
  attachScene(scene) {
    if (this.scene && this._instancedMesh) {
      this.scene.remove(this._instancedMesh);
    }
    this.scene = scene;
    if (this.scene) {
      this._ensureInstancedMesh();
      if (this._instancedMesh) {
        this.scene.add(this._instancedMesh);
        this._syncInstancedMesh();
      }
    }
  }

  /** @private */
  _ensureInstancedMesh() {
    if (this._instancedMesh) return;
    this._sharedGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this._sharedMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this._instancedMesh = new THREE.InstancedMesh(
      this._sharedGeometry,
      this._sharedMaterial,
      MAX_INSTANCED_DROPS
    );
    this._instancedMesh.name = 'item_drops_instanced';
    this._instancedMesh.count = 0;
    this._instancedMesh.frustumCulled = false;
    this._instancedMesh.castShadow = false;
    this._instancedMesh.receiveShadow = false;
    this._instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_INSTANCED_DROPS * 3).fill(1),
      3
    );
    this._instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * Spawns a physical dropped item stack at world coordinates (wx, wy, wz).
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   * @param {string} itemId
   * @param {number} [count=1]
   * @returns {Object|null}
   */
  spawnDrop(wx, wy, wz, itemId, count = 1) {
    const def = this.itemRegistry.get(itemId);
    if (!def || count <= 0) return null;

    // Cap total drops to prevent runaway counts
    if (this.drops.length >= MAX_INSTANCED_DROPS) {
      this.drops.shift();
    }

    const angle = (this._nextId * 2.39996) % (Math.PI * 2);
    const speed = 1.3;
    const drop = {
      id: this._nextId++,
      itemId,
      count,
      colorHex: def.color ?? 0xffffff,
      position: { x: wx, y: wy, z: wz },
      velocity: {
        x: Math.cos(angle) * speed,
        y: 3.4,
        z: Math.sin(angle) * speed,
      },
      age: 0,
      pickupDelay: 0.25,
      maxAge: 180,
    };

    this.drops.push(drop);
    this._syncInstancedMesh();
    return drop;
  }

  /**
   * Advances drop gravity, ground collision, animation, and proximity collection.
   * @param {number} deltaTime
   * @param {{ x: number, y: number, z: number }} playerPos
   * @returns {Array<{ itemId: string, count: number }>} Items picked up this frame.
   */
  update(deltaTime, playerPos) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0 || this.drops.length === 0) {
      if (this._instancedMesh && this._instancedMesh.count !== 0) {
        this._instancedMesh.count = 0;
      }
      return [];
    }

    const pickedUp = [];
    const dt = Math.min(deltaTime, 0.05);
    const registry = this.world.blockRegistry;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age >= d.maxAge) {
        this.drops.splice(i, 1);
        continue;
      }

      // Gravity + simple voxel terrain collision
      d.velocity.y = Math.max(-16, d.velocity.y - 18 * dt);
      const nextX = d.position.x + d.velocity.x * dt;
      const nextZ = d.position.z + d.velocity.z * dt;
      if (!registry.isSolid(this.world.getBlock(Math.floor(nextX), Math.floor(d.position.y + 0.1), Math.floor(d.position.z)))) {
        d.position.x = nextX;
      } else {
        d.velocity.x *= -0.3;
      }
      if (!registry.isSolid(this.world.getBlock(Math.floor(d.position.x), Math.floor(d.position.y + 0.1), Math.floor(nextZ)))) {
        d.position.z = nextZ;
      } else {
        d.velocity.z *= -0.3;
      }

      const nextY = d.position.y + d.velocity.y * dt;
      const floorBlock = this.world.getBlock(
        Math.floor(d.position.x),
        Math.floor(nextY - 0.18),
        Math.floor(d.position.z)
      );
      if (registry.isSolid(floorBlock) && d.velocity.y < 0) {
        d.position.y = Math.floor(nextY - 0.18) + 1.18;
        d.velocity.y = 0;
        d.velocity.x *= 0.72;
        d.velocity.z *= 0.72;
      } else {
        d.position.y = nextY;
      }

      // Magnetic pickup near player
      if (d.age >= d.pickupDelay && playerPos) {
        const dx = playerPos.x - d.position.x;
        const dy = playerPos.y + 0.85 - d.position.y;
        const dz = playerPos.z - d.position.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist < 2.4 && dist > 0.05) {
          d.position.x += (dx / dist) * 8 * dt;
          d.position.y += (dy / dist) * 8 * dt;
          d.position.z += (dz / dist) * 8 * dt;
        }

        if (dist <= 1.25) {
          const { added, remainder } = this.inventory.addItem(d.itemId, d.count);
          if (added > 0) {
            pickedUp.push({ itemId: d.itemId, count: added });
          }
          if (remainder === 0) {
            this.drops.splice(i, 1);
            continue;
          }
          d.count = remainder;
        }
      }
    }

    this._syncInstancedMesh();
    return pickedUp;
  }

  /** @private */
  _syncInstancedMesh() {
    if (!this._instancedMesh) return;
    const count = Math.min(this.drops.length, MAX_INSTANCED_DROPS);
    this._instancedMesh.count = count;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      const bob = Math.sin(d.age * 3.4 + d.id) * 0.08;
      this._dummy.position.set(d.position.x, d.position.y + bob, d.position.z);
      this._dummy.rotation.set(0, d.age * 1.8 + d.id * 0.5, 0);
      this._dummy.scale.set(1, 1, 1);
      this._dummy.updateMatrix();
      this._instancedMesh.setMatrixAt(i, this._dummy.matrix);
      this._tmpColor.setHex(d.colorHex);
      this._instancedMesh.setColorAt(i, this._tmpColor);
    }

    this._instancedMesh.instanceMatrix.needsUpdate = true;
    if (this._instancedMesh.instanceColor) {
      this._instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Removes all active item drops from world and scene.
   */
  clear() {
    this.drops.length = 0;
    if (this._instancedMesh) {
      this._instancedMesh.count = 0;
    }
  }

  /**
   * Releases shared geometries and instanced mesh.
   */
  dispose() {
    this.clear();
    if (this._instancedMesh && this.scene) {
      this.scene.remove(this._instancedMesh);
    }
    this._instancedMesh?.dispose();
    this._instancedMesh = null;
    this._sharedGeometry?.dispose();
    this._sharedGeometry = null;
    this._sharedMaterial?.dispose();
    this._sharedMaterial = null;
  }
}
