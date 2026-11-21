/**
 * @file BlockRegistry.js
 * @description Central registry for all voxel block types.
 * Provides O(1) lookup by numeric ID (for chunk arrays) and by string key.
 */

import { Block } from './Block.js';

/**
 * Canonical numeric IDs for built-in blocks.
 * @readonly
 * @enum {number}
 */
export const BLOCK_IDS = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  BEDROCK: 4,
  SAND: 5,
  GRAVEL: 6,
  WATER: 7,
  OAK_LOG: 8,
  OAK_LEAVES: 9,
  TORCH: 10,
  GLOWSTONE: 11,
  COAL_ORE: 12,
  IRON_ORE: 13,
  SNOW_BLOCK: 14,
  CACTUS: 15,
  TALL_GRASS: 16,
  FLOWER: 17,
  SPRUCE_LOG: 18,
  SPRUCE_LEAVES: 19,
  OAK_PLANKS: 20,
  COBBLESTONE: 21,
  CRAFTING_TABLE: 22,
  GLASS: 23,
  BRICKS: 24,
});

/**
 * Manages block definitions and fast typed-array lookup tables.
 */
export class BlockRegistry {
  constructor() {
    /** @type {Map<number, Block>} */
    this._byId = new Map();
    /** @type {Map<string, Block>} */
    this._byKey = new Map();
    /** @type {Array<Block|undefined>} */
    this._fastLookup = new Array(256);
  }

  /**
   * Registers a block definition or Block instance.
   * @param {Block|Object} blockConfig
   * @returns {Block}
   */
  register(blockConfig) {
    const block = blockConfig instanceof Block ? blockConfig : new Block(blockConfig);

    if (this._byId.has(block.id)) {
      throw new Error(`Duplicate block ID ${block.id} (${block.key})`);
    }
    if (this._byKey.has(block.key)) {
      throw new Error(`Duplicate block key "${block.key}"`);
    }

    this._byId.set(block.id, block);
    this._byKey.set(block.key, block);
    this._fastLookup[block.id] = block;
    return block;
  }

  /**
   * Retrieves a Block by numeric ID.
   * @param {number} id
   * @returns {Block|undefined}
   */
  getById(id) {
    return this._fastLookup[id];
  }

  /**
   * Retrieves a Block by programmatic key or display name (case-insensitive fallback).
   * @param {string} key
   * @returns {Block|undefined}
   */
  getByKey(key) {
    if (this._byKey.has(key)) {
      return this._byKey.get(key);
    }
    const normalized = String(key).toLowerCase().replace(/\s+/g, '_');
    return this._byKey.get(normalized);
  }

  /**
   * Checks whether a block ID exists in the registry.
   * @param {number} id
   * @returns {boolean}
   */
  has(id) {
    return this._fastLookup[id] !== undefined;
  }

  /**
   * Returns all registered Block instances.
   * @returns {Block[]}
   */
  getAll() {
    return Array.from(this._byId.values());
  }

  /**
   * Returns blocks players can select and place (excludes Air and unbreakable Bedrock by default).
   * @param {boolean} [includeUnbreakable=false]
   * @returns {Block[]}
   */
  getPlaceableBlocks(includeUnbreakable = false) {
    return this.getAll().filter(
      (b) => b.id !== BLOCK_IDS.AIR && (includeUnbreakable || b.breakable)
    );
  }

  /**
   * Fast solid check used by physics and collision systems.
   * @param {number} id
   * @returns {boolean}
   */
  isSolid(id) {
    const b = this._fastLookup[id];
    return b ? b.solid : false;
  }

  /**
   * Fast transparency check used by chunk meshing.
   * @param {number} id
   * @returns {boolean}
   */
  isTransparent(id) {
    const b = this._fastLookup[id];
    return b ? b.transparent : true;
  }

  /**
   * Fast liquid check used by physics and water meshing.
   * @param {number} id
   * @returns {boolean}
   */
  isLiquid(id) {
    const b = this._fastLookup[id];
    return b ? b.liquid : false;
  }

  /**
   * Fast breakable check used by block breaking mechanics.
   * @param {number} id
   * @returns {boolean}
   */
  isBreakable(id) {
    const b = this._fastLookup[id];
    return b ? b.breakable : false;
  }

  /**
   * Fast occlusion check for culling hidden faces between adjacent voxels.
   * @param {number} id
   * @returns {boolean}
   */
  occludesFaces(id) {
    const b = this._fastLookup[id];
    return b ? b.occludesFaces : false;
  }

  /**
   * Returns light emission level (0..15) for block ID.
   * @param {number} id
   * @returns {number}
   */
  getLightEmission(id) {
    const b = this._fastLookup[id];
    return b ? b.lightEmission : 0;
  }

  /**
   * Returns light attenuation (1..15) when light passes through block ID.
   * @param {number} id
   * @returns {number}
   */
  getLightAttenuation(id) {
    const b = this._fastLookup[id];
    return b ? b.lightAttenuation : 1;
  }

  /**
   * Returns true if block renders as a crossed flora/torch billboard.
   * @param {number} id
   * @returns {boolean}
   */
  isCrossPlant(id) {
    const b = this._fastLookup[id];
    return b ? b.crossPlant : false;
  }

  /**
   * Exports a plain, worker-transferable lookup table of meshing properties indexed by block ID.
   * @returns {Array<{ occludesFaces: boolean, lightEmission: number, crossPlant: boolean, textures: Record<string, string|null> }|null>}
   */
  exportMesherTable() {
    const table = new Array(256).fill(null);
    for (const block of this._byId.values()) {
      table[block.id] = {
        occludesFaces: block.occludesFaces,
        lightEmission: block.lightEmission,
        crossPlant: block.crossPlant,
        textures: { ...block.textures },
      };
    }
    return table;
  }
}

/**
 * Registers the standard initial Minecraft-style block set into a registry.
 * @param {BlockRegistry} [registry=new BlockRegistry()]
 * @returns {BlockRegistry}
 */
export function createDefaultBlockRegistry(registry = new BlockRegistry()) {
  registry.register({
    id: BLOCK_IDS.AIR,
    key: 'air',
    name: 'Air',
    textures: null,
    solid: false,
    transparent: true,
    liquid: false,
    breakable: false,
    hardness: 0,
    color: 0x000000,
    occludesFaces: false,
  });

  registry.register({
    id: BLOCK_IDS.GRASS,
    key: 'grass',
    name: 'Grass',
    textures: {
      top: 'grass_top',
      bottom: 'dirt',
      side: 'grass_side',
    },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.6,
    color: 0x5d9b42,
  });

  registry.register({
    id: BLOCK_IDS.DIRT,
    key: 'dirt',
    name: 'Dirt',
    textures: { all: 'dirt' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.5,
    color: 0x866043,
  });

  registry.register({
    id: BLOCK_IDS.STONE,
    key: 'stone',
    name: 'Stone',
    textures: { all: 'stone' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 1.5,
    color: 0x7d7d7d,
  });

  registry.register({
    id: BLOCK_IDS.BEDROCK,
    key: 'bedrock',
    name: 'Bedrock',
    textures: { all: 'bedrock' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: false,
    hardness: Infinity,
    color: 0x333333,
  });

  registry.register({
    id: BLOCK_IDS.SAND,
    key: 'sand',
    name: 'Sand',
    textures: { all: 'sand' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.5,
    color: 0xd9c893,
  });

  registry.register({
    id: BLOCK_IDS.GRAVEL,
    key: 'gravel',
    name: 'Gravel',
    textures: { all: 'gravel' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.6,
    color: 0x837f7e,
  });

  registry.register({
    id: BLOCK_IDS.WATER,
    key: 'water',
    name: 'Water',
    textures: { all: 'water' },
    solid: false,
    transparent: true,
    liquid: true,
    breakable: false,
    hardness: 0,
    color: 0x2f75c9,
    occludesFaces: false,
  });

  registry.register({
    id: BLOCK_IDS.OAK_LOG,
    key: 'oak_log',
    name: 'Oak Log',
    textures: {
      top: 'oak_log_top',
      bottom: 'oak_log_top',
      side: 'oak_log_side',
    },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.0,
    color: 0x6b5133,
  });

  registry.register({
    id: BLOCK_IDS.OAK_LEAVES,
    key: 'oak_leaves',
    name: 'Oak Leaves',
    textures: { all: 'oak_leaves' },
    solid: true,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.2,
    color: 0x3f7b2c,
    occludesFaces: false,
    lightAttenuation: 2,
  });

  registry.register({
    id: BLOCK_IDS.TORCH,
    key: 'torch',
    name: 'Torch',
    textures: { all: 'torch' },
    solid: false,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.05,
    color: 0xffb830,
    occludesFaces: false,
    lightEmission: 14,
    lightAttenuation: 1,
    crossPlant: true,
  });

  registry.register({
    id: BLOCK_IDS.GLOWSTONE,
    key: 'glowstone',
    name: 'Glowstone',
    textures: { all: 'glowstone' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.4,
    color: 0xf4c55b,
    occludesFaces: true,
    lightEmission: 15,
    lightAttenuation: 15,
  });

  registry.register({
    id: BLOCK_IDS.COAL_ORE,
    key: 'coal_ore',
    name: 'Coal Ore',
    textures: { all: 'coal_ore' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 3.0,
    color: 0x3b3d42,
  });

  registry.register({
    id: BLOCK_IDS.IRON_ORE,
    key: 'iron_ore',
    name: 'Iron Ore',
    textures: { all: 'iron_ore' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 3.0,
    color: 0xb99a82,
  });

  registry.register({
    id: BLOCK_IDS.SNOW_BLOCK,
    key: 'snow_block',
    name: 'Snow',
    textures: { all: 'snow' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.4,
    color: 0xeef6fb,
  });

  registry.register({
    id: BLOCK_IDS.CACTUS,
    key: 'cactus',
    name: 'Cactus',
    textures: {
      top: 'cactus_top',
      bottom: 'cactus_top',
      side: 'cactus_side',
    },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 0.4,
    color: 0x488a3a,
  });

  registry.register({
    id: BLOCK_IDS.TALL_GRASS,
    key: 'tall_grass',
    name: 'Tall Grass',
    textures: { all: 'tall_grass' },
    solid: false,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.05,
    color: 0x56963d,
    occludesFaces: false,
    lightAttenuation: 1,
    crossPlant: true,
  });

  registry.register({
    id: BLOCK_IDS.FLOWER,
    key: 'flower',
    name: 'Wildflower',
    textures: { all: 'flower' },
    solid: false,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.05,
    color: 0xe85a4f,
    occludesFaces: false,
    lightAttenuation: 1,
    crossPlant: true,
  });

  registry.register({
    id: BLOCK_IDS.SPRUCE_LOG,
    key: 'spruce_log',
    name: 'Spruce Log',
    textures: {
      top: 'spruce_log_top',
      bottom: 'spruce_log_top',
      side: 'spruce_log_side',
    },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.0,
    color: 0x4b3522,
  });

  registry.register({
    id: BLOCK_IDS.SPRUCE_LEAVES,
    key: 'spruce_leaves',
    name: 'Spruce Needles',
    textures: { all: 'spruce_leaves' },
    solid: true,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.2,
    color: 0x2d5836,
    occludesFaces: false,
    lightAttenuation: 2,
  });

  registry.register({
    id: BLOCK_IDS.OAK_PLANKS,
    key: 'oak_planks',
    name: 'Oak Planks',
    textures: { all: 'planks_oak' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.0,
    color: 0xb48a55,
  });

  registry.register({
    id: BLOCK_IDS.COBBLESTONE,
    key: 'cobblestone',
    name: 'Cobblestone',
    textures: { all: 'cobblestone' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.0,
    color: 0x6c6e70,
  });

  registry.register({
    id: BLOCK_IDS.CRAFTING_TABLE,
    key: 'crafting_table',
    name: 'Crafting Table',
    textures: {
      top: 'crafting_table_top',
      bottom: 'planks_oak',
      side: 'crafting_table_side',
    },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.5,
    color: 0x9b6b3e,
  });

  registry.register({
    id: BLOCK_IDS.GLASS,
    key: 'glass',
    name: 'Glass',
    textures: { all: 'glass' },
    solid: true,
    transparent: true,
    liquid: false,
    breakable: true,
    hardness: 0.3,
    color: 0xd0eef9,
    occludesFaces: false,
    lightAttenuation: 1,
  });

  registry.register({
    id: BLOCK_IDS.BRICKS,
    key: 'bricks',
    name: 'Bricks',
    textures: { all: 'bricks' },
    solid: true,
    transparent: false,
    liquid: false,
    breakable: true,
    hardness: 2.0,
    color: 0x9e4b3c,
  });

  return registry;
}

/**
 * Shared default registry instance.
 * @type {BlockRegistry}
 */
export const blockRegistry = createDefaultBlockRegistry();
