/**
 * @file VoxelRegion.js
 * @description Self-contained 18x128x18 padded neighborhood snapshot around a 16x128x16 chunk
 * for zero-callback, race-free Web Worker greedy meshing.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from './ChunkConstants.js';

export const REGION_WIDTH = CHUNK_WIDTH + 2; // 18 (-1..16)
export const REGION_DEPTH = CHUNK_DEPTH + 2; // 18 (-1..16)
export const REGION_HEIGHT = CHUNK_HEIGHT;   // 128
export const REGION_STRIDE_Z = REGION_WIDTH;
export const REGION_STRIDE_Y = REGION_WIDTH * REGION_DEPTH; // 324
export const REGION_VOLUME = REGION_STRIDE_Y * REGION_HEIGHT; // 41472

/**
 * Snapshot of a chunk + its 1-block border padding from all 8 surrounding neighbors.
 */
export class VoxelRegion {
  /**
   * @param {Object} params
   * @param {number} params.chunkX
   * @param {number} params.chunkZ
   * @param {Uint8Array} params.blocks
   * @param {Uint8Array} params.lightData
   * @param {Uint8Array} [params.fluidData]
   * @param {number} params.centerEditVersion
   * @param {string} params.versionSignature
   */
  constructor({ chunkX, chunkZ, blocks, lightData, fluidData, centerEditVersion, versionSignature }) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.blocks = blocks;
    this.lightData = lightData;
    this.fluidData = fluidData ?? new Uint8Array(REGION_VOLUME);
    this.centerEditVersion = centerEditVersion;
    this.versionSignature = versionSignature;
  }

  /**
   * Reads block ID at chunk-local coordinates lx in [-1..16], y in [0..127], lz in [-1..16].
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getBlock(lx, y, lz) {
    if (y < 0 || y >= REGION_HEIGHT) return BLOCK_IDS.AIR;
    if (lx < -1 || lx > CHUNK_WIDTH || lz < -1 || lz > CHUNK_DEPTH) return BLOCK_IDS.AIR;
    const idx = y * REGION_STRIDE_Y + (lz + 1) * REGION_STRIDE_Z + (lx + 1);
    return this.blocks[idx];
  }

  /**
   * Reads { sky, block } light levels at chunk-local coordinates lx in [-1..16], y in [0..127], lz in [-1..16].
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {{ sky: number, block: number }}
   */
  getLight(lx, y, lz) {
    if (y >= REGION_HEIGHT) return { sky: 15, block: 0 };
    if (y < 0) return { sky: 0, block: 0 };
    if (lx < -1 || lx > CHUNK_WIDTH || lz < -1 || lz > CHUNK_DEPTH) return { sky: 15, block: 0 };
    const byte = this.lightData[y * REGION_STRIDE_Y + (lz + 1) * REGION_STRIDE_Z + (lx + 1)];
    return { sky: (byte >> 4) & 0x0f, block: byte & 0x0f };
  }

  /**
   * Reads fluid metadata byte at chunk-local coordinates.
   * @param {number} lx
   * @param {number} y
   * @param {number} lz
   * @returns {number}
   */
  getFluidLevel(lx, y, lz) {
    if (y < 0 || y >= REGION_HEIGHT) return 0;
    if (lx < -1 || lx > CHUNK_WIDTH || lz < -1 || lz > CHUNK_DEPTH) return 0;
    return this.fluidData[y * REGION_STRIDE_Y + (lz + 1) * REGION_STRIDE_Z + (lx + 1)];
  }

  /**
   * Captures a standalone padded 18x128x18 neighborhood snapshot from ChunkManager.
   * @param {import('./ChunkManager.js').ChunkManager} chunkManager
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {VoxelRegion|null}
   */
  static captureChunkNeighborhood(chunkManager, chunkX, chunkZ) {
    const center = chunkManager.getChunk(chunkX, chunkZ);
    if (!center || !center.generated) return null;

    const blocks = new Uint8Array(REGION_VOLUME);
    const lightData = new Uint8Array(REGION_VOLUME);
    const fluidData = new Uint8Array(REGION_VOLUME);
    // Default unloaded perimeter voxels to open sky light (15)
    lightData.fill(0xf0);

    // 1. Copy center 16x128x16 interior directly row by row
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const srcYBase = y << 8;
      const dstYBase = y * REGION_STRIDE_Y;
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        const srcRow = srcYBase | (lz << 4);
        const dstRow = dstYBase + (lz + 1) * REGION_STRIDE_Z + 1;
        blocks.set(center.blocks.subarray(srcRow, srcRow + CHUNK_WIDTH), dstRow);
        lightData.set(center.lightData.subarray(srcRow, srcRow + CHUNK_WIDTH), dstRow);
        fluidData.set(center.fluidData.subarray(srcRow, srcRow + CHUNK_WIDTH), dstRow);
      }
    }

    // 2. Copy 1-block borders and corners from 8 neighboring chunks
    const west = chunkManager.getChunk(chunkX - 1, chunkZ);
    const east = chunkManager.getChunk(chunkX + 1, chunkZ);
    const north = chunkManager.getChunk(chunkX, chunkZ - 1);
    const south = chunkManager.getChunk(chunkX, chunkZ + 1);
    const nw = chunkManager.getChunk(chunkX - 1, chunkZ - 1);
    const ne = chunkManager.getChunk(chunkX + 1, chunkZ - 1);
    const sw = chunkManager.getChunk(chunkX - 1, chunkZ + 1);
    const se = chunkManager.getChunk(chunkX + 1, chunkZ + 1);

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const srcY = y << 8;
      const dstY = y * REGION_STRIDE_Y;

      if (west && west.generated) {
        for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
          const sIdx = srcY | (lz << 4) | 15;
          const dIdx = dstY + (lz + 1) * REGION_STRIDE_Z; // lx=-1 -> 0
          blocks[dIdx] = west.blocks[sIdx];
          lightData[dIdx] = west.lightData[sIdx];
          fluidData[dIdx] = west.fluidData[sIdx];
        }
      }

      if (east && east.generated) {
        for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
          const sIdx = srcY | (lz << 4) | 0;
          const dIdx = dstY + (lz + 1) * REGION_STRIDE_Z + 17; // lx=16 -> 17
          blocks[dIdx] = east.blocks[sIdx];
          lightData[dIdx] = east.lightData[sIdx];
          fluidData[dIdx] = east.fluidData[sIdx];
        }
      }

      if (north && north.generated) {
        const sRow = srcY | (15 << 4);
        const dRow = dstY + 1; // lz=-1 -> 0, lx=0..15 -> 1..16
        blocks.set(north.blocks.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
        lightData.set(north.lightData.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
        fluidData.set(north.fluidData.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
      }

      if (south && south.generated) {
        const sRow = srcY | (0 << 4);
        const dRow = dstY + 17 * REGION_STRIDE_Z + 1; // lz=16 -> 17
        blocks.set(south.blocks.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
        lightData.set(south.lightData.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
        fluidData.set(south.fluidData.subarray(sRow, sRow + CHUNK_WIDTH), dRow);
      }

      // 4 corners for accurate corner Ambient Occlusion across chunk seams
      if (nw && nw.generated) {
        const sIdx = srcY | (15 << 4) | 15;
        const dIdx = dstY;
        blocks[dIdx] = nw.blocks[sIdx];
        lightData[dIdx] = nw.lightData[sIdx];
        fluidData[dIdx] = nw.fluidData[sIdx];
      }
      if (ne && ne.generated) {
        const sIdx = srcY | (15 << 4) | 0;
        const dIdx = dstY + 17;
        blocks[dIdx] = ne.blocks[sIdx];
        lightData[dIdx] = ne.lightData[sIdx];
        fluidData[dIdx] = ne.fluidData[sIdx];
      }
      if (sw && sw.generated) {
        const sIdx = srcY | (0 << 4) | 15;
        const dIdx = dstY + 17 * REGION_STRIDE_Z;
        blocks[dIdx] = sw.blocks[sIdx];
        lightData[dIdx] = sw.lightData[sIdx];
        fluidData[dIdx] = sw.fluidData[sIdx];
      }
      if (se && se.generated) {
        const sIdx = srcY | (0 << 4) | 0;
        const dIdx = dstY + 17 * REGION_STRIDE_Z + 17;
        blocks[dIdx] = se.blocks[sIdx];
        lightData[dIdx] = se.lightData[sIdx];
        fluidData[dIdx] = se.fluidData[sIdx];
      }
    }

    const versionSignature = [
      center.editVersion,
      west ? west.editVersion : -1,
      east ? east.editVersion : -1,
      north ? north.editVersion : -1,
      south ? south.editVersion : -1,
      nw ? nw.editVersion : -1,
      ne ? ne.editVersion : -1,
      sw ? sw.editVersion : -1,
      se ? se.editVersion : -1,
    ].join(',');

    return new VoxelRegion({
      chunkX,
      chunkZ,
      blocks,
      lightData,
      fluidData,
      centerEditVersion: center.editVersion,
      versionSignature,
    });
  }

  /**
   * Computes current 3x3 version signature without copying voxel arrays (used to detect stale worker jobs).
   * @param {import('./ChunkManager.js').ChunkManager} chunkManager
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {string|null}
   */
  static computeVersionSignature(chunkManager, chunkX, chunkZ) {
    const center = chunkManager.getChunk(chunkX, chunkZ);
    if (!center) return null;
    const v = (cx, cz) => {
      const c = chunkManager.getChunk(cx, cz);
      return c && c.generated ? c.editVersion : -1;
    };
    return [
      center.editVersion,
      v(chunkX - 1, chunkZ),
      v(chunkX + 1, chunkZ),
      v(chunkX, chunkZ - 1),
      v(chunkX, chunkZ + 1),
      v(chunkX - 1, chunkZ - 1),
      v(chunkX + 1, chunkZ - 1),
      v(chunkX - 1, chunkZ + 1),
      v(chunkX + 1, chunkZ + 1),
    ].join(',');
  }
}
