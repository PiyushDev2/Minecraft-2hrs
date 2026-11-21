/**
 * @file ChunkConstants.js
 * @description Pure zero-dependency chunk dimension constants and coordinate helpers.
 * Safe to import inside Web Workers without pulling Three.js into worker bundles.
 */

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
