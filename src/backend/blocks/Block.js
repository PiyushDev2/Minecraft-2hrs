/**
 * @file Block.js
 * @description Core Block definition model for the voxel engine.
 * Every block type registered in BlockRegistry is instantiated as a Block
 * containing physical, rendering, and gameplay metadata.
 */

/**
 * Standard cube face identifiers used for texture mapping and meshing.
 * @readonly
 * @enum {string}
 */
export const BlockFace = Object.freeze({
  TOP: 'top',
  BOTTOM: 'bottom',
  NORTH: 'north', // -Z
  SOUTH: 'south', // +Z
  EAST: 'east',   // +X
  WEST: 'west',   // -X
});

/**
 * Represents a single block type definition in the voxel world.
 */
export class Block {
  /**
   * @param {Object} config
   * @param {number} config.id - Unique numeric ID (0-255, stored in Uint8Array).
   * @param {string} config.key - Programmatic identifier (e.g. 'grass', 'oak_log').
   * @param {string} config.name - Human-readable display name.
   * @param {Object|string|null} [config.textures=null] - Texture tile mapping ({ all } or { top, bottom, side } or per-face).
   * @param {boolean} [config.solid=true] - Whether entities collide with this block.
   * @param {boolean} [config.transparent=false] - Whether light/neighbor faces pass through this block.
   * @param {boolean} [config.liquid=false] - Whether this block behaves as a fluid (e.g. water).
   * @param {boolean} [config.breakable=true] - Whether players can break this block.
   * @param {number} [config.hardness=1.0] - Relative break duration in seconds.
   * @param {number} [config.color=0xffffff] - Fallback/icon hex color for UI swatches & vertex tinting.
   * @param {boolean} [config.occludesFaces] - Whether adjacent solid faces against this block are culled.
   * @param {number} [config.lightEmission=0] - Emitted artificial light level (0..15).
   * @param {number} [config.lightAttenuation] - Light falloff passing through block (1..15).
   * @param {boolean} [config.crossPlant=false] - Whether block renders as an X-crossed billboard (flora/torch) instead of a full cube.
   */
  constructor({
    id,
    key,
    name,
    textures = null,
    solid = true,
    transparent = false,
    liquid = false,
    breakable = true,
    hardness = 1.0,
    color = 0xffffff,
    occludesFaces,
    lightEmission = 0,
    lightAttenuation,
    crossPlant = false,
  }) {
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`Block ID must be an integer between 0 and 255. Received: ${id}`);
    }
    if (!key || typeof key !== 'string') {
      throw new Error(`Block key must be a non-empty string. Received: ${key}`);
    }

    /** @type {number} */
    this.id = id;
    /** @type {string} */
    this.key = key;
    /** @type {string} */
    this.name = name || key;
    /** @type {boolean} */
    this.solid = Boolean(solid);
    /** @type {boolean} */
    this.transparent = Boolean(transparent);
    /** @type {boolean} */
    this.liquid = Boolean(liquid);
    /** @type {boolean} */
    this.breakable = Boolean(breakable);
    /** @type {number} */
    this.hardness = Number.isFinite(hardness) ? hardness : 1.0;
    /** @type {number} */
    this.color = color;
    /** @type {boolean} */
    this.occludesFaces = occludesFaces !== undefined ? Boolean(occludesFaces) : !this.transparent;
    /** @type {number} */
    this.lightEmission = Math.max(0, Math.min(15, lightEmission | 0));
    /** @type {number} */
    this.lightAttenuation =
      lightAttenuation !== undefined
        ? Math.max(1, Math.min(15, lightAttenuation | 0))
        : this.occludesFaces
        ? 15
        : this.liquid
        ? 2
        : 1;
    /** @type {boolean} */
    this.crossPlant = Boolean(crossPlant);

    /**
     * Normalized per-face texture info.
     * @type {{ top: string|null, bottom: string|null, north: string|null, south: string|null, east: string|null, west: string|null }}
     */
    this.textures = Block.normalizeTextures(textures);

    Object.freeze(this.textures);
    Object.freeze(this);
  }

  /**
   * Normalizes shorthand texture specs ({ all } or { top, bottom, side }) into explicit 6-face mapping.
   * @param {Object|string|null} textures
   * @returns {{ top: string|null, bottom: string|null, north: string|null, south: string|null, east: string|null, west: string|null }}
   */
  static normalizeTextures(textures) {
    if (!textures) {
      return { top: null, bottom: null, north: null, south: null, east: null, west: null };
    }
    if (typeof textures === 'string') {
      return {
        top: textures,
        bottom: textures,
        north: textures,
        south: textures,
        east: textures,
        west: textures,
      };
    }

    const fallback = textures.all ?? null;
    const side = textures.side ?? fallback;
    return {
      top: textures.top ?? fallback,
      bottom: textures.bottom ?? fallback,
      north: textures.north ?? side,
      south: textures.south ?? side,
      east: textures.east ?? side,
      west: textures.west ?? side,
    };
  }

  /**
   * Returns the texture tile key for a given face direction.
   * @param {string} face - One of BlockFace values ('top', 'bottom', 'north', 'south', 'east', 'west').
   * @returns {string|null}
   */
  getTextureForFace(face) {
    return this.textures[face] ?? null;
  }
}
