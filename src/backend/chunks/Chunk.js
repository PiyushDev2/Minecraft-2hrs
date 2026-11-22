/**
 * @file Chunk.js
 * @description Represents a 16x128x16 voxel chunk column in the world.
 * Uses a flat Uint8Array for cache-friendly, low-memory block storage and tracks
 * player modifications separately for compact persistence.
 */

import * as THREE from 'three';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import {
  CHUNK_DEPTH,
  CHUNK_HEIGHT,
  CHUNK_VOLUME,
  CHUNK_WIDTH,
  getChunkKey,
} from './ChunkConstants.js';

export { CHUNK_WIDTH, CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_VOLUME, getChunkKey };

export const SECTION_HEIGHT = 16;
export const CHUNK_SECTIONS = CHUNK_HEIGHT / SECTION_HEIGHT; // 8 vertical 16x16x16 sub-chunks

const isLiquidBlock = (id) => id === BLOCK_IDS.WATER || id === BLOCK_IDS.LAVA;

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
     * Per-voxel fluid metadata for WATER blocks:
     * 0 = source (full), 1..7 = horizontal flow distance, bit 0x10 = falling column.
     * @type {Uint8Array}
     */
    this.fluidData = new Uint8Array(CHUNK_VOLUME);

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
    /** @type {number} 8-bit bitmask of dirty 16x16x16 vertical sub-chunk sections */
    this.dirtySectionsMask = 0xff;
    /** @type {boolean} True when chunk uses per-section sub-chunk meshes instead of monolithic worker mesh */
    this.usingSectionMeshes = false;
    /** @type {number} Monotonic counter incremented on block or light mutations to reject stale worker meshes. */
    this.editVersion = 0;

    /** @type {THREE.Group|null} */
    this.meshGroup = null;
    /** @type {THREE.Mesh|null} */
    this.opaqueMesh = null;
    /** @type {THREE.Mesh|null} */
    this.waterMesh = null;
    /** @type {Array<THREE.Mesh|null>} */
    this.opaqueSections = new Array(CHUNK_SECTIONS).fill(null);
    /** @type {Array<THREE.Mesh|null>} */
    this.waterSections = new Array(CHUNK_SECTIONS).fill(null);

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
    if (!isLiquidBlock(blockId)) {
      this.fluidData[idx] = 0;
    }
    if (recordModification) {
      this.modifications.set(idx, blockId);
    }
    if (prev !== blockId) {
      this.dirty = true;
      this.lightDirty = true;
      this.markSectionDirty(y);
      this.editVersion++;
    }
    return prev !== blockId;
  }

  /**
   * Marks the 16x16x16 vertical sub-chunk containing world/local Y dirty (plus adjacent section on boundaries).
   * @param {number} y
   */
  markSectionDirty(y) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const sec = y >> 4;
    this.dirtySectionsMask |= 1 << sec;
    const rem = y & 15;
    if (rem === 0 && sec > 0) this.dirtySectionsMask |= 1 << (sec - 1);
    if (rem === 15 && sec < CHUNK_SECTIONS - 1) this.dirtySectionsMask |= 1 << (sec + 1);
  }

  /**
   * Marks all 8 vertical sub-chunk sections dirty.
   */
  markAllSectionsDirty() {
    this.dirty = true;
    this.dirtySectionsMask = 0xff;
  }

  /**
   * Gets fluid metadata byte at local chunk coordinates (0 = source, 1..7 = flow dist, 0x10 = falling).
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getFluidLevel(lx, y, lz) {
    if (!this.isInBounds(lx, y, lz)) return 0;
    return this.fluidData[(y << 8) | (lz << 4) | lx];
  }

  /**
   * Sets fluid metadata byte at local chunk coordinates and marks chunk dirty/versioned if changed.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @param {number} meta
   * @returns {boolean}
   */
  setFluidLevel(lx, y, lz, meta) {
    if (!this.isInBounds(lx, y, lz)) return false;
    const idx = (y << 8) | (lz << 4) | lx;
    const next = meta & 0xff;
    if (this.fluidData[idx] === next) return false;
    this.fluidData[idx] = next;
    this.dirty = true;
    this.markSectionDirty(y);
    this.editVersion++;
    return true;
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
   * Accepts both v1 [idx, blockId] and fluid-aware [idx, blockId, fluidMeta] tuples.
   * @param {Array<[number, number] | [number, number, number]>} entries
   */
  applyModifications(entries) {
    if (!Array.isArray(entries)) return;
    for (let i = 0; i < entries.length; i++) {
      const [idx, blockId, fluidMeta = 0] = entries[i];
      if (idx >= 0 && idx < CHUNK_VOLUME) {
        this.blocks[idx] = blockId;
        this.fluidData[idx] = isLiquidBlock(blockId) ? fluidMeta & 0xff : 0;
        this.modifications.set(idx, blockId);
      }
    }
    if (entries.length > 0) {
      this.dirty = true;
      this.dirtySectionsMask = 0xff;
      this.lightDirty = true;
      this.editVersion++;
    }
  }

  /**
   * Exports sparse modification tuples for saving.
   * @returns {Array<[number, number] | [number, number, number]>}
   */
  exportModifications() {
    const out = [];
    for (const [idx, blockId] of this.modifications.entries()) {
      const fMeta = isLiquidBlock(blockId) ? this.fluidData[idx] : 0;
      out.push(fMeta !== 0 ? [idx, blockId, fMeta] : [idx, blockId]);
    }
    return out;
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
   * Disposes GPU geometries for a single 16x16x16 vertical section.
   * @param {number} secY 0..7
   */
  disposeSectionMesh(secY) {
    const om = this.opaqueSections[secY];
    if (om) {
      om.geometry?.dispose();
      this.meshGroup?.remove(om);
      this.opaqueSections[secY] = null;
    }
    const wm = this.waterSections[secY];
    if (wm) {
      wm.geometry?.dispose();
      this.meshGroup?.remove(wm);
      this.waterSections[secY] = null;
    }
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
    for (let s = 0; s < CHUNK_SECTIONS; s++) {
      this.disposeSectionMesh(s);
    }
    this.usingSectionMeshes = false;
    if (!keepGroup && this.meshGroup) {
      this.meshGroup.clear();
      this.meshGroup = null;
    }
  }
}
