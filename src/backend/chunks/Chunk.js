/**
 * @file Chunk.js
 * @description Represents a 16x128x16 voxel chunk column in the world.
 * Uses a flat Uint8Array for cache-friendly, low-memory block storage and tracks
 * player modifications separately for compact persistence.
 */

import * as THREE from 'three';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';

export const CHUNK_WIDTH = 16;
export const CHUNK_DEPTH = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_DEPTH;

/**
 * Generates a canonical map key for chunk coordinates.
 * @param {number} chunkX
 * @param {number} chunkZ
 * @returns {string}
 */
export function getChunkKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

/**
 * A single 16x128x16 chunk of voxel data and its associated Three.js mesh group.
 */
export class Chunk {
  /**
   * @param {number} chunkX - Chunk grid X coordinate.
   * @param {number} chunkZ - Chunk grid Z coordinate.
   */
  constructor(chunkX, chunkZ) {
    /** @type {number} */
    this.chunkX = chunkX | 0;
    /** @type {number} */
    this.chunkZ = chunkZ | 0;
    /** @type {string} */
    this.key = getChunkKey(this.chunkX, this.chunkZ);

    /** @type {number} */
    this.worldX = this.chunkX * CHUNK_WIDTH;
    /** @type {number} */
    this.worldZ = this.chunkZ * CHUNK_DEPTH;

    /**
     * Voxel ID storage: index = (y << 8) | (z << 4) | x.
     * @type {Uint8Array}
     */
    this.blocks = new Uint8Array(CHUNK_VOLUME);

    /**
     * Packed 4-bit + 4-bit lighting per voxel:
     * high nibble (>> 4) = skyLight (0..15), low nibble (& 0x0f) = blockLight (0..15).
     * @type {Uint8Array}
     */
    this.lightData = new Uint8Array(CHUNK_VOLUME);

    /**
     * Sparse map of local voxel index -> blockId for player edits (for compact saving).
     * @type {Map<number, number>}
     */
    this.modifications = new Map();

    /** @type {boolean} */
    this.generated = false;
    /** @type {boolean} */
    this.lightDirty = true;
    /** @type {boolean} */
    this.dirty = false;
    /** @type {number} Monotonic counter incremented on block or light mutations to reject stale worker meshes. */
    this.editVersion = 0;

    /** @type {THREE.Group|null} */
    this.meshGroup = null;
    /** @type {THREE.Mesh|null} */
    this.opaqueMesh = null;
    /** @type {THREE.Mesh|null} */
    this.waterMesh = null;

    /**
     * World-space bounding box of this chunk for frustum culling and queries.
     * @type {THREE.Box3}
     */
    this.boundingBox = new THREE.Box3(
      new THREE.Vector3(this.worldX, 0, this.worldZ),
      new THREE.Vector3(this.worldX + CHUNK_WIDTH, CHUNK_HEIGHT, this.worldZ + CHUNK_DEPTH)
    );

    /** @type {number} */
    this.lastAccessedAt = performance.now();
  }

  /**
   * Computes local linear array index from chunk-local coordinates.
   * @param {number} lx - 0..15
   * @param {number} y  - 0..127
   * @param {number} lz - 0..15
   * @returns {number}
   */
  static getIndex(lx, y, lz) {
    return (y << 8) | (lz << 4) | lx;
  }

  /**
   * Decodes local linear index back into (lx, y, lz).
   * @param {number} index
   * @returns {{ lx: number, y: number, lz: number }}
   */
  static decodeIndex(index) {
    return {
      lx: index & 15,
      lz: (index >> 4) & 15,
      y: index >> 8,
    };
  }

  /**
   * Checks whether local coordinates are within chunk bounds.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {boolean}
   */
  isInBounds(lx, y, lz) {
    return (
      lx >= 0 &&
      lx < CHUNK_WIDTH &&
      lz >= 0 &&
      lz < CHUNK_DEPTH &&
      y >= 0 &&
      y < CHUNK_HEIGHT
    );
  }

  /**
   * Gets block ID at local chunk coordinates. Returns AIR if out of Y bounds.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getBlock(lx, y, lz) {
    if (!this.isInBounds(lx, y, lz)) {
      return BLOCK_IDS.AIR;
    }
    return this.blocks[(y << 8) | (lz << 4) | lx];
  }

  /**
   * Sets block ID at local chunk coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @param {number} blockId
   * @param {boolean} [recordModification=false] - True for player edits so saves preserve them.
   * @returns {boolean} True if block changed.
   */
  setBlock(lx, y, lz, blockId, recordModification = false) {
    if (!this.isInBounds(lx, y, lz)) {
      return false;
    }
    const idx = (y << 8) | (lz << 4) | lx;
    const prev = this.blocks[idx];
    if (prev === blockId && !recordModification) {
      return false;
    }
    this.blocks[idx] = blockId;
    if (recordModification) {
      this.modifications.set(idx, blockId);
    }
    if (prev !== blockId) {
      this.dirty = true;
      this.lightDirty = true;
      this.editVersion++;
    }
    return prev !== blockId;
  }

  /**
   * Gets packed sky light (0..15) at local chunk coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getSkyLight(lx, y, lz) {
    if (y >= CHUNK_HEIGHT) return 15;
    if (!this.isInBounds(lx, y, lz)) return 0;
    return (this.lightData[(y << 8) | (lz << 4) | lx] >> 4) & 0x0f;
  }

  /**
   * Sets packed sky light (0..15) at local chunk coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @param {number} level
   */
  setSkyLight(lx, y, lz, level) {
    if (!this.isInBounds(lx, y, lz)) return;
    const idx = (y << 8) | (lz << 4) | lx;
    const clamped = Math.max(0, Math.min(15, level | 0));
    const prevByte = this.lightData[idx];
    const nextByte = (prevByte & 0x0f) | (clamped << 4);
    if (prevByte !== nextByte) {
      this.lightData[idx] = nextByte;
      this.editVersion++;
    }
  }

  /**
   * Gets packed artificial block light (0..15) at local chunk coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getBlockLight(lx, y, lz) {
    if (!this.isInBounds(lx, y, lz)) return 0;
    return this.lightData[(y << 8) | (lz << 4) | lx] & 0x0f;
  }

  /**
   * Sets packed artificial block light (0..15) at local chunk coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @param {number} level
   */
  setBlockLight(lx, y, lz, level) {
    if (!this.isInBounds(lx, y, lz)) return;
    const idx = (y << 8) | (lz << 4) | lx;
    const clamped = Math.max(0, Math.min(15, level | 0));
    const prevByte = this.lightData[idx];
    const nextByte = (prevByte & 0xf0) | clamped;
    if (prevByte !== nextByte) {
      this.lightData[idx] = nextByte;
      this.editVersion++;
    }
  }

  /**
   * Applies saved player modification entries after procedural generation.
   * @param {Array<[number, number]>} entries
   */
  applyModifications(entries) {
    if (!Array.isArray(entries)) return;
    for (let i = 0; i < entries.length; i++) {
      const [idx, blockId] = entries[i];
      if (idx >= 0 && idx < CHUNK_VOLUME) {
        this.blocks[idx] = blockId;
        this.modifications.set(idx, blockId);
      }
    }
    if (entries.length > 0) {
      this.dirty = true;
      this.lightDirty = true;
      this.editVersion++;
    }
  }

  /**
   * Exports sparse modification tuples for saving.
   * @returns {Array<[number, number]>}
   */
  exportModifications() {
    return Array.from(this.modifications.entries());
  }

  /**
   * Finds the highest non-air (or solid) block Y coordinate at local (lx, lz).
   * @param {number} lx
   * @param {number} lz
   * @param {(id: number) => boolean} [predicate] - Defaults to non-air.
   * @returns {number} Returns -1 if column is empty.
   */
  getHighestY(lx, lz, predicate = (id) => id !== BLOCK_IDS.AIR) {
    if (lx < 0 || lx >= CHUNK_WIDTH || lz < 0 || lz >= CHUNK_DEPTH) {
      return -1;
    }
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = this.blocks[(y << 8) | (lz << 4) | lx];
      if (predicate(id)) {
        return y;
      }
    }
    return -1;
  }

  /**
   * Releases GPU geometries attached to this chunk to avoid WebGL memory leaks.
   * @param {boolean} [keepGroup=false] - Preserve meshGroup container during remeshing.
   */
  disposeMesh(keepGroup = false) {
    if (this.opaqueMesh) {
      this.opaqueMesh.geometry?.dispose();
      this.meshGroup?.remove(this.opaqueMesh);
      this.opaqueMesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry?.dispose();
      this.meshGroup?.remove(this.waterMesh);
      this.waterMesh = null;
    }
    if (!keepGroup && this.meshGroup) {
      this.meshGroup.clear();
      this.meshGroup = null;
    }
  }
}
