/**
 * @file ItemDropManager.js
 * @description Manages 3D dropped item entities with gravity, ground resting,
 * bobbing/spinning animation, and proximity collection into Player Inventory.
 */

import * as THREE from 'three';

/**
 * Coordinates physical world item drops and optional Three.js visual meshes.
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

    /**
     * @type {Array<{
     *   id: number,
     *   itemId: string,
     *   count: number,
     *   position: { x: number, y: number, z: number },
     *   velocity: { x: number, y: number, z: number },
     *   age: number,
     *   pickupDelay: number,
     *   maxAge: number,
     *   mesh: THREE.Mesh|null
     * }>}
     */
    this.drops = [];
    this._nextId = 1;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.BoxGeometry|null} */
    this._sharedGeometry = null;
  }

  /**
   * Attaches a Three.js Scene to visualize dropped item cubes.
   * @param {THREE.Scene|null} scene
   */
  attachScene(scene) {
    if (this.scene) {
      for (const drop of this.drops) {
        if (drop.mesh) this.scene.remove(drop.mesh);
      }
    }
    this.scene = scene;
    if (this.scene) {
      for (const drop of this.drops) {
        if (!drop.mesh) drop.mesh = this._createDropMesh(drop.itemId);
        if (drop.mesh) this.scene.add(drop.mesh);
      }
    }
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

    const angle = ((this._nextId * 2.39996) % (Math.PI * 2));
    const speed = 1.3;
    const drop = {
      id: this._nextId++,
      itemId,
      count,
      position: { x: wx, y: wy, z: wz },
      velocity: {
        x: Math.cos(angle) * speed,
        y: 3.4,
        z: Math.sin(angle) * speed,
      },
      age: 0,
      pickupDelay: 0.25,
      maxAge: 180,
      mesh: this.scene ? this._createDropMesh(itemId) : null,
    };

    if (drop.mesh && this.scene) {
      drop.mesh.position.set(wx, wy, wz);
      this.scene.add(drop.mesh);
    }

    this.drops.push(drop);
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
      return [];
    }

    const pickedUp = [];
    const dt = Math.min(deltaTime, 0.05);
    const registry = this.world.blockRegistry;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age >= d.maxAge) {
        this._removeDropAt(i);
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
            this._removeDropAt(i);
            continue;
          }
          d.count = remainder;
        }
      }

      if (d.mesh) {
        const bob = Math.sin(d.age * 3.4) * 0.08;
        d.mesh.position.set(d.position.x, d.position.y + bob, d.position.z);
        d.mesh.rotation.y = d.age * 1.8;
      }
    }

    return pickedUp;
  }

  /**
   * Removes all active item drops from world and scene.
   */
  clear() {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      this._removeDropAt(i);
    }
  }

  /**
   * Releases shared geometries and drops.
   */
  dispose() {
    this.clear();
    this._sharedGeometry?.dispose();
    this._sharedGeometry = null;
  }

  /** @private */
  _removeDropAt(index) {
    const d = this.drops[index];
    if (d.mesh) {
      this.scene?.remove(d.mesh);
      if (Array.isArray(d.mesh.material)) {
        d.mesh.material.forEach((m) => m.dispose());
      } else {
        d.mesh.material?.dispose();
      }
    }
    this.drops.splice(index, 1);
  }

  /** @private */
  _createDropMesh(itemId) {
    const def = this.itemRegistry.get(itemId);
    if (!def) return null;
    if (!this._sharedGeometry) {
      this._sharedGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.72,
      metalness: def.category === 'tool' ? 0.2 : 0.05,
    });
    const mesh = new THREE.Mesh(this._sharedGeometry, mat);
    mesh.castShadow = true;
    return mesh;
  }
}
