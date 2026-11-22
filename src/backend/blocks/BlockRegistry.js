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
  GOLD_ORE: 25,
  DIAMOND_ORE: 26,
  REDSTONE_ORE: 27,
  OBSIDIAN: 28,
  LAVA: 29,
  FURNACE: 30,
  FURNACE_LIT: 31,
  CHEST: 32,
  BED: 33,
  TNT: 34,
  OAK_DOOR_CLOSED: 35,
  OAK_DOOR_OPEN: 36,
  LADDER: 37,
  FARMLAND: 38,
  FARMLAND_WET: 39,
  WHEAT_0: 40,
  WHEAT_1: 41,
  WHEAT_2: 42,
  WHEAT_3: 43,
  IRON_BLOCK: 44,
  GOLD_BLOCK: 45,
  DIAMOND_BLOCK: 46,
  NETHERRACK: 47,
  SOUL_SAND: 48,
  NETHER_BRICKS: 49,
  NETHER_QUARTZ_ORE: 50,
  NETHER_PORTAL: 51,
  MOSSY_COBBLESTONE: 52,
  WHITE_WOOL: 53,
  // Workstations & Magic
  LAPIS_ORE: 54,
  BOOKSHELF: 55,
  ENCHANTING_TABLE: 56,
  ANVIL: 57,
  BREWING_STAND: 58,
  // The End & Stronghold
  END_STONE: 59,
  END_PORTAL_FRAME: 60,
  END_PORTAL_FRAME_FILLED: 61,
  END_PORTAL: 62,
  DRAGON_EGG: 63,
  STONE_BRICKS: 64,
  NETHER_WART_BLOCK: 65,
  // Redstone Components
  REDSTONE_WIRE: 66,
  REDSTONE_WIRE_ON: 67,
  REDSTONE_TORCH: 68,
  LEVER: 69,
  LEVER_ON: 70,
  STONE_BUTTON: 71,
  STONE_BUTTON_ON: 72,
  PRESSURE_PLATE: 73,
  PRESSURE_PLATE_ON: 74,
  REDSTONE_LAMP: 75,
  REDSTONE_LAMP_ON: 76,
  PISTON: 77,
  PISTON_EXTENDED: 78,
  // Architectural & Utility Blocks
  OAK_STAIRS: 79,
  COBBLESTONE_STAIRS: 80,
  OAK_SLAB: 81,
  STONE_SLAB: 82,
  OAK_FENCE: 83,
  LANTERN: 84,
  CAMPFIRE: 85,
  OAK_SIGN: 86,
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

  isSolid(id) {
    const b = this._fastLookup[id];
    return b ? b.solid : false;
  }

  isTransparent(id) {
    const b = this._fastLookup[id];
    return b ? b.transparent : true;
  }

  isLiquid(id) {
    const b = this._fastLookup[id];
    return b ? b.liquid : false;
  }

  isWater(id) {
    const b = this._fastLookup[id];
    return Boolean(b && b.liquid && b.liquidType === 'water');
  }

  isLava(id) {
    const b = this._fastLookup[id];
    return Boolean(b && b.liquid && b.liquidType === 'lava');
  }

  isClimbable(id) {
    const b = this._fastLookup[id];
    return Boolean(b && b.climbable);
  }

  isBreakable(id) {
    const b = this._fastLookup[id];
    return b ? b.breakable : false;
  }

  occludesFaces(id) {
    const b = this._fastLookup[id];
    return b ? b.occludesFaces : false;
  }

  getLightEmission(id) {
    const b = this._fastLookup[id];
    return b ? b.lightEmission : 0;
  }

  getLightAttenuation(id) {
    const b = this._fastLookup[id];
    return b ? b.lightAttenuation : 1;
  }

  isCrossPlant(id) {
    const b = this._fastLookup[id];
    return b ? b.crossPlant : false;
  }

  getBlastResistance(id) {
    const b = this._fastLookup[id];
    return b ? b.blastResistance : 0;
  }

  isCrop(id) {
    return (
      id === BLOCK_IDS.WHEAT_0 ||
      id === BLOCK_IDS.WHEAT_1 ||
      id === BLOCK_IDS.WHEAT_2 ||
      id === BLOCK_IDS.WHEAT_3
    );
  }

  /**
   * Exports a plain, worker-transferable lookup table of meshing properties indexed by block ID.
   * @returns {Array<{ occludesFaces: boolean, lightEmission: number, crossPlant: boolean, liquid: boolean, liquidType: string|null, renderShape: string, textures: Record<string, string|null> }|null>}
   */
  exportMesherTable() {
    const table = new Array(256).fill(null);
    for (const block of this._byId.values()) {
      table[block.id] = {
        occludesFaces: block.occludesFaces,
        lightEmission: block.lightEmission,
        crossPlant: block.crossPlant,
        liquid: block.liquid,
        liquidType: block.liquidType,
        renderShape: block.renderShape,
        textures: { ...block.textures },
      };
    }
    return table;
  }
}

/**
 * Registers the complete Minecraft-style block set into a registry.
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
    blastResistance: 0,
    color: 0x000000,
    occludesFaces: false,
  });

  registry.register({
    id: BLOCK_IDS.GRASS,
    key: 'grass',
    name: 'Grass Block',
    textures: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    hardness: 0.6,
    toolType: 'shovel',
    color: 0x5d9b42,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.DIRT,
    key: 'dirt',
    name: 'Dirt',
    textures: { all: 'dirt' },
    hardness: 0.5,
    toolType: 'shovel',
    color: 0x866043,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.STONE,
    key: 'stone',
    name: 'Stone',
    textures: { all: 'stone' },
    hardness: 1.5,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x7d7d7d,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.BEDROCK,
    key: 'bedrock',
    name: 'Bedrock',
    textures: { all: 'bedrock' },
    breakable: false,
    hardness: Infinity,
    blastResistance: 999999,
    color: 0x333333,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.SAND,
    key: 'sand',
    name: 'Sand',
    textures: { all: 'sand' },
    hardness: 0.5,
    toolType: 'shovel',
    color: 0xd9c893,
    soundGroup: 'sand',
  });

  registry.register({
    id: BLOCK_IDS.GRAVEL,
    key: 'gravel',
    name: 'Gravel',
    textures: { all: 'gravel' },
    hardness: 0.6,
    toolType: 'shovel',
    color: 0x837f7e,
    soundGroup: 'sand',
  });

  registry.register({
    id: BLOCK_IDS.WATER,
    key: 'water',
    name: 'Water',
    textures: { all: 'water' },
    solid: false,
    transparent: true,
    liquid: true,
    liquidType: 'water',
    breakable: false,
    hardness: 0,
    blastResistance: 100,
    color: 0x2f75c9,
    occludesFaces: false,
    soundGroup: 'water',
  });

  registry.register({
    id: BLOCK_IDS.OAK_LOG,
    key: 'oak_log',
    name: 'Oak Log',
    textures: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' },
    hardness: 2.0,
    toolType: 'axe',
    color: 0x6b5133,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.OAK_LEAVES,
    key: 'oak_leaves',
    name: 'Oak Leaves',
    textures: { all: 'oak_leaves' },
    transparent: true,
    hardness: 0.2,
    color: 0x3f7b2c,
    occludesFaces: false,
    lightAttenuation: 2,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.TORCH,
    key: 'torch',
    name: 'Torch',
    textures: { all: 'torch' },
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0xffb830,
    occludesFaces: false,
    lightEmission: 14,
    lightAttenuation: 1,
    crossPlant: true,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.GLOWSTONE,
    key: 'glowstone',
    name: 'Glowstone',
    textures: { all: 'glowstone' },
    hardness: 0.4,
    color: 0xf4c55b,
    occludesFaces: true,
    lightEmission: 15,
    lightAttenuation: 15,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.COAL_ORE,
    key: 'coal_ore',
    name: 'Coal Ore',
    textures: { all: 'coal_ore' },
    hardness: 2.5,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x3b3d42,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.IRON_ORE,
    key: 'iron_ore',
    name: 'Iron Ore',
    textures: { all: 'iron_ore' },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 2,
    color: 0xb99a82,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.SNOW_BLOCK,
    key: 'snow_block',
    name: 'Snow Block',
    textures: { all: 'snow' },
    hardness: 0.4,
    toolType: 'shovel',
    color: 0xeef6fb,
    soundGroup: 'sand',
  });

  registry.register({
    id: BLOCK_IDS.CACTUS,
    key: 'cactus',
    name: 'Cactus',
    textures: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' },
    hardness: 0.4,
    damageOnTouch: 1,
    color: 0x488a3a,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.TALL_GRASS,
    key: 'tall_grass',
    name: 'Tall Grass',
    textures: { all: 'tall_grass' },
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0x56963d,
    occludesFaces: false,
    lightAttenuation: 1,
    crossPlant: true,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.FLOWER,
    key: 'flower',
    name: 'Wildflower',
    textures: { all: 'flower' },
    solid: false,
    transparent: true,
    hardness: 0.05,
    color: 0xe85a4f,
    occludesFaces: false,
    lightAttenuation: 1,
    crossPlant: true,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.SPRUCE_LOG,
    key: 'spruce_log',
    name: 'Spruce Log',
    textures: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log_side' },
    hardness: 2.0,
    toolType: 'axe',
    color: 0x4b3522,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.SPRUCE_LEAVES,
    key: 'spruce_leaves',
    name: 'Spruce Needles',
    textures: { all: 'spruce_leaves' },
    transparent: true,
    hardness: 0.2,
    color: 0x2d5836,
    occludesFaces: false,
    lightAttenuation: 2,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.OAK_PLANKS,
    key: 'oak_planks',
    name: 'Oak Planks',
    textures: { all: 'planks_oak' },
    hardness: 2.0,
    toolType: 'axe',
    color: 0xb48a55,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.COBBLESTONE,
    key: 'cobblestone',
    name: 'Cobblestone',
    textures: { all: 'cobblestone' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x6c6e70,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.CRAFTING_TABLE,
    key: 'crafting_table',
    name: 'Crafting Table',
    textures: { top: 'crafting_table_top', bottom: 'planks_oak', side: 'crafting_table_side' },
    hardness: 2.5,
    toolType: 'axe',
    interactable: true,
    color: 0x9b6b3e,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.GLASS,
    key: 'glass',
    name: 'Glass',
    textures: { all: 'glass' },
    transparent: true,
    hardness: 0.3,
    color: 0xd0eef9,
    occludesFaces: false,
    lightAttenuation: 1,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.BRICKS,
    key: 'bricks',
    name: 'Bricks',
    textures: { all: 'bricks' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x9e4b3c,
    soundGroup: 'stone',
  });

  // --- New Complete Minecraft Blocks ---

  registry.register({
    id: BLOCK_IDS.GOLD_ORE,
    key: 'gold_ore',
    name: 'Gold Ore',
    textures: { all: 'gold_ore' },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 3,
    color: 0xe6c84f,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.DIAMOND_ORE,
    key: 'diamond_ore',
    name: 'Diamond Ore',
    textures: { all: 'diamond_ore' },
    hardness: 3.5,
    toolType: 'pickaxe',
    minToolTier: 3,
    color: 0x4de2e6,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.REDSTONE_ORE,
    key: 'redstone_ore',
    name: 'Redstone Ore',
    textures: { all: 'redstone_ore' },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 3,
    lightEmission: 4,
    color: 0xd93636,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.OBSIDIAN,
    key: 'obsidian',
    name: 'Obsidian',
    textures: { all: 'obsidian' },
    hardness: 9.0,
    blastResistance: 1200,
    toolType: 'pickaxe',
    minToolTier: 4,
    color: 0x261a3b,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.LAVA,
    key: 'lava',
    name: 'Lava',
    textures: { all: 'lava' },
    solid: false,
    transparent: false,
    liquid: true,
    liquidType: 'lava',
    breakable: false,
    hardness: 0,
    blastResistance: 100,
    damageOnTouch: 4,
    color: 0xe85a1c,
    occludesFaces: false,
    lightEmission: 15,
    lightAttenuation: 1,
    soundGroup: 'water',
  });

  registry.register({
    id: BLOCK_IDS.FURNACE,
    key: 'furnace',
    name: 'Furnace',
    textures: {
      top: 'furnace_top',
      bottom: 'furnace_top',
      north: 'furnace_front',
      south: 'furnace_side',
      east: 'furnace_side',
      west: 'furnace_side',
    },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    interactable: true,
    color: 0x73767b,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.FURNACE_LIT,
    key: 'furnace_lit',
    name: 'Lit Furnace',
    textures: {
      top: 'furnace_top',
      bottom: 'furnace_top',
      north: 'furnace_front_lit',
      south: 'furnace_side',
      east: 'furnace_side',
      west: 'furnace_side',
    },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    interactable: true,
    lightEmission: 13,
    color: 0xd97724,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.CHEST,
    key: 'chest',
    name: 'Chest',
    textures: {
      top: 'chest_top',
      bottom: 'chest_top',
      north: 'chest_front',
      south: 'chest_side',
      east: 'chest_side',
      west: 'chest_side',
    },
    hardness: 2.5,
    toolType: 'axe',
    interactable: true,
    color: 0xa67438,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.BED,
    key: 'bed',
    name: 'Red Bed',
    textures: { top: 'bed_top', bottom: 'planks_oak', side: 'bed_side' },
    transparent: true,
    occludesFaces: false,
    hardness: 0.4,
    interactable: true,
    renderShape: 'half',
    color: 0xc93535,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.TNT,
    key: 'tnt',
    name: 'TNT',
    textures: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
    hardness: 0.2,
    blastResistance: 0.5,
    interactable: true,
    color: 0xd93829,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.OAK_DOOR_CLOSED,
    key: 'oak_door',
    name: 'Oak Door',
    textures: { all: 'oak_door' },
    solid: true,
    transparent: true,
    occludesFaces: false,
    hardness: 2.0,
    toolType: 'axe',
    interactable: true,
    color: 0x996d3c,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.OAK_DOOR_OPEN,
    key: 'oak_door_open',
    name: 'Oak Door (Open)',
    textures: { all: 'oak_door' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 2.0,
    toolType: 'axe',
    interactable: true,
    renderShape: 'door_open',
    color: 0x996d3c,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.LADDER,
    key: 'ladder',
    name: 'Ladder',
    textures: { all: 'ladder' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    climbable: true,
    hardness: 0.4,
    toolType: 'axe',
    crossPlant: true,
    color: 0x9e7442,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.FARMLAND,
    key: 'farmland',
    name: 'Farmland',
    textures: { top: 'farmland_dry', bottom: 'dirt', side: 'dirt' },
    hardness: 0.6,
    toolType: 'shovel',
    color: 0x704d31,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.FARMLAND_WET,
    key: 'farmland_wet',
    name: 'Hydrated Farmland',
    textures: { top: 'farmland_wet', bottom: 'dirt', side: 'dirt' },
    hardness: 0.6,
    toolType: 'shovel',
    color: 0x4b321f,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.WHEAT_0,
    key: 'wheat_0',
    name: 'Wheat Sprouts',
    textures: { all: 'wheat_0' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    crossPlant: true,
    color: 0x5ea832,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.WHEAT_1,
    key: 'wheat_1',
    name: 'Growing Wheat',
    textures: { all: 'wheat_1' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    crossPlant: true,
    color: 0x7cb838,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.WHEAT_2,
    key: 'wheat_2',
    name: 'Ripening Wheat',
    textures: { all: 'wheat_2' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    crossPlant: true,
    color: 0xbaab38,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.WHEAT_3,
    key: 'wheat_3',
    name: 'Mature Wheat',
    textures: { all: 'wheat_3' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    crossPlant: true,
    color: 0xe3c24b,
    soundGroup: 'grass',
  });

  registry.register({
    id: BLOCK_IDS.IRON_BLOCK,
    key: 'iron_block',
    name: 'Block of Iron',
    textures: { all: 'iron_block' },
    hardness: 4.5,
    blastResistance: 10,
    toolType: 'pickaxe',
    minToolTier: 2,
    color: 0xd9dee3,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.GOLD_BLOCK,
    key: 'gold_block',
    name: 'Block of Gold',
    textures: { all: 'gold_block' },
    hardness: 3.5,
    blastResistance: 10,
    toolType: 'pickaxe',
    minToolTier: 3,
    color: 0xf7d33b,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.DIAMOND_BLOCK,
    key: 'diamond_block',
    name: 'Block of Diamond',
    textures: { all: 'diamond_block' },
    hardness: 5.0,
    blastResistance: 12,
    toolType: 'pickaxe',
    minToolTier: 3,
    color: 0x56ebe6,
    soundGroup: 'stone',
  });

  // --- Nether, Dungeon & Wool Blocks ---

  registry.register({
    id: BLOCK_IDS.NETHERRACK,
    key: 'netherrack',
    name: 'Netherrack',
    textures: { all: 'netherrack' },
    hardness: 0.5,
    blastResistance: 2.0,
    toolType: 'pickaxe',
    minToolTier: 0,
    color: 0x6f2c2c,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.SOUL_SAND,
    key: 'soul_sand',
    name: 'Soul Sand',
    textures: { all: 'soul_sand' },
    hardness: 0.5,
    blastResistance: 2.5,
    toolType: 'shovel',
    color: 0x513d32,
    soundGroup: 'sand',
  });

  registry.register({
    id: BLOCK_IDS.NETHER_BRICKS,
    key: 'nether_bricks',
    name: 'Nether Bricks',
    textures: { all: 'nether_bricks' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x381c22,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.NETHER_QUARTZ_ORE,
    key: 'nether_quartz_ore',
    name: 'Nether Quartz Ore',
    textures: { all: 'nether_quartz_ore' },
    hardness: 2.5,
    blastResistance: 4.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0xc9b4aa,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.NETHER_PORTAL,
    key: 'nether_portal',
    name: 'Nether Portal',
    textures: { all: 'nether_portal' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    breakable: true,
    hardness: 0.1,
    blastResistance: 0,
    lightEmission: 11,
    lightAttenuation: 1,
    renderShape: 'portal',
    color: 0x9b30ff,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.MOSSY_COBBLESTONE,
    key: 'mossy_cobblestone',
    name: 'Mossy Cobblestone',
    textures: { all: 'mossy_cobblestone' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x5b7a4a,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.WHITE_WOOL,
    key: 'white_wool',
    name: 'White Wool',
    textures: { all: 'white_wool' },
    hardness: 0.6,
    blastResistance: 2.0,
    color: 0xeaecef,
    soundGroup: 'grass',
  });

  // --- Workstations & Magic ---

  registry.register({
    id: BLOCK_IDS.LAPIS_ORE,
    key: 'lapis_ore',
    name: 'Lapis Lazuli Ore',
    textures: { all: 'lapis_ore' },
    hardness: 3.0,
    toolType: 'pickaxe',
    minToolTier: 2,
    color: 0x2654b8,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.BOOKSHELF,
    key: 'bookshelf',
    name: 'Bookshelf',
    textures: { top: 'planks_oak', bottom: 'planks_oak', side: 'bookshelf' },
    hardness: 1.5,
    toolType: 'axe',
    color: 0x8b623b,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.ENCHANTING_TABLE,
    key: 'enchanting_table',
    name: 'Enchanting Table',
    textures: { top: 'enchanting_top', bottom: 'obsidian', side: 'enchanting_side' },
    hardness: 5.0,
    blastResistance: 1200,
    toolType: 'pickaxe',
    minToolTier: 1,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    lightEmission: 7,
    renderShape: 'enchanting_table',
    color: 0x622440,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.ANVIL,
    key: 'anvil',
    name: 'Anvil',
    textures: { top: 'anvil_top', bottom: 'anvil_side', side: 'anvil_side' },
    hardness: 4.5,
    blastResistance: 1200,
    toolType: 'pickaxe',
    minToolTier: 1,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    renderShape: 'anvil',
    color: 0x45474d,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.BREWING_STAND,
    key: 'brewing_stand',
    name: 'Brewing Stand',
    textures: { all: 'brewing_stand' },
    hardness: 1.0,
    toolType: 'pickaxe',
    transparent: true,
    occludesFaces: false,
    interactable: true,
    lightEmission: 2,
    renderShape: 'brewing_stand',
    color: 0xd4a438,
    soundGroup: 'stone',
  });

  // --- The End & Stronghold ---

  registry.register({
    id: BLOCK_IDS.END_STONE,
    key: 'end_stone',
    name: 'End Stone',
    textures: { all: 'end_stone' },
    hardness: 3.0,
    blastResistance: 9.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0xd9dc9e,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.END_PORTAL_FRAME,
    key: 'end_portal_frame',
    name: 'End Portal Frame',
    textures: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side' },
    hardness: Infinity,
    breakable: false,
    blastResistance: 999999,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    lightEmission: 2,
    renderShape: 'end_portal_frame',
    color: 0x457d6e,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.END_PORTAL_FRAME_FILLED,
    key: 'end_portal_frame_filled',
    name: 'End Portal Frame (Eye)',
    textures: { top: 'end_portal_frame_top_filled', bottom: 'end_stone', side: 'end_portal_frame_side' },
    hardness: Infinity,
    breakable: false,
    blastResistance: 999999,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    lightEmission: 8,
    renderShape: 'end_portal_frame_filled',
    color: 0x39c496,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.END_PORTAL,
    key: 'end_portal',
    name: 'End Portal',
    textures: { all: 'end_portal' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    breakable: false,
    hardness: Infinity,
    blastResistance: 999999,
    lightEmission: 15,
    lightAttenuation: 1,
    renderShape: 'end_portal',
    color: 0x100826,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.DRAGON_EGG,
    key: 'dragon_egg',
    name: 'Dragon Egg',
    textures: { all: 'dragon_egg' },
    hardness: 2.5,
    blastResistance: 9.0,
    transparent: true,
    occludesFaces: false,
    lightEmission: 6,
    renderShape: 'dragon_egg',
    color: 0x1d0f2b,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.STONE_BRICKS,
    key: 'stone_bricks',
    name: 'Stone Bricks',
    textures: { all: 'stone_bricks' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    color: 0x7c7f82,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.NETHER_WART_BLOCK,
    key: 'nether_wart_block',
    name: 'Nether Wart Crop',
    textures: { all: 'nether_wart_block' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.1,
    crossPlant: true,
    color: 0x9c1c28,
    soundGroup: 'grass',
  });

  // --- Redstone Components ---

  registry.register({
    id: BLOCK_IDS.REDSTONE_WIRE,
    key: 'redstone_wire',
    name: 'Redstone Dust',
    textures: { all: 'redstone_wire_off' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    renderShape: 'redstone_dust',
    color: 0x6e0d0d,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.REDSTONE_WIRE_ON,
    key: 'redstone_wire_on',
    name: 'Powered Redstone',
    textures: { all: 'redstone_wire_on' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    lightEmission: 6,
    renderShape: 'redstone_dust',
    color: 0xff2219,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.REDSTONE_TORCH,
    key: 'redstone_torch',
    name: 'Redstone Torch',
    textures: { all: 'redstone_torch' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.05,
    lightEmission: 9,
    crossPlant: true,
    color: 0xe8251e,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.LEVER,
    key: 'lever',
    name: 'Lever',
    textures: { top: 'lever_wood', bottom: 'cobblestone', side: 'cobblestone' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    hardness: 0.5,
    renderShape: 'lever',
    color: 0x7b6a58,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.LEVER_ON,
    key: 'lever_on',
    name: 'Lever (On)',
    textures: { top: 'redstone_wire_on', bottom: 'cobblestone', side: 'cobblestone' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    hardness: 0.5,
    lightEmission: 4,
    renderShape: 'lever_on',
    color: 0xe84838,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.STONE_BUTTON,
    key: 'stone_button',
    name: 'Stone Button',
    textures: { all: 'stone' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    hardness: 0.4,
    renderShape: 'button',
    color: 0x8a8c90,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.STONE_BUTTON_ON,
    key: 'stone_button_on',
    name: 'Stone Button (Pressed)',
    textures: { all: 'redstone_wire_on' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    hardness: 0.4,
    lightEmission: 3,
    renderShape: 'button_on',
    color: 0xd94b3b,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.PRESSURE_PLATE,
    key: 'pressure_plate',
    name: 'Oak Pressure Plate',
    textures: { all: 'planks_oak' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.4,
    toolType: 'axe',
    renderShape: 'pressure_plate',
    color: 0xb48a55,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.PRESSURE_PLATE_ON,
    key: 'pressure_plate_on',
    name: 'Oak Pressure Plate (Pressed)',
    textures: { all: 'planks_oak' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    hardness: 0.4,
    toolType: 'axe',
    lightEmission: 2,
    renderShape: 'pressure_plate_on',
    color: 0xc99c62,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.REDSTONE_LAMP,
    key: 'redstone_lamp',
    name: 'Redstone Lamp',
    textures: { all: 'redstone_lamp_off' },
    hardness: 0.5,
    color: 0x694228,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.REDSTONE_LAMP_ON,
    key: 'redstone_lamp_on',
    name: 'Lit Redstone Lamp',
    textures: { all: 'redstone_lamp_on' },
    hardness: 0.5,
    lightEmission: 15,
    color: 0xffd578,
    soundGroup: 'glass',
  });

  registry.register({
    id: BLOCK_IDS.PISTON,
    key: 'piston',
    name: 'Piston',
    textures: {
      top: 'piston_top',
      bottom: 'piston_bottom',
      north: 'piston_head',
      south: 'piston_side',
      east: 'piston_side',
      west: 'piston_side',
    },
    hardness: 1.5,
    toolType: 'pickaxe',
    color: 0x8b7b66,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.PISTON_EXTENDED,
    key: 'piston_extended',
    name: 'Piston (Extended)',
    textures: {
      top: 'piston_top',
      bottom: 'piston_bottom',
      north: 'piston_head',
      south: 'piston_side',
      east: 'piston_side',
      west: 'piston_side',
    },
    hardness: 1.5,
    toolType: 'pickaxe',
    transparent: true,
    occludesFaces: false,
    renderShape: 'piston_extended',
    color: 0x9b8668,
    soundGroup: 'stone',
  });

  // --- Architectural & Utility Blocks ---

  registry.register({
    id: BLOCK_IDS.OAK_STAIRS,
    key: 'oak_stairs',
    name: 'Oak Stairs',
    textures: { all: 'planks_oak' },
    hardness: 2.0,
    toolType: 'axe',
    transparent: true,
    occludesFaces: false,
    renderShape: 'stairs',
    color: 0xb48a55,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.COBBLESTONE_STAIRS,
    key: 'cobblestone_stairs',
    name: 'Cobblestone Stairs',
    textures: { all: 'cobblestone' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    transparent: true,
    occludesFaces: false,
    renderShape: 'stairs',
    color: 0x6c6e70,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.OAK_SLAB,
    key: 'oak_slab',
    name: 'Oak Slab',
    textures: { all: 'planks_oak' },
    hardness: 2.0,
    toolType: 'axe',
    transparent: true,
    occludesFaces: false,
    renderShape: 'slab',
    color: 0xb48a55,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.STONE_SLAB,
    key: 'stone_slab',
    name: 'Stone Slab',
    textures: { all: 'stone_bricks' },
    hardness: 2.0,
    blastResistance: 6.0,
    toolType: 'pickaxe',
    minToolTier: 1,
    transparent: true,
    occludesFaces: false,
    renderShape: 'slab',
    color: 0x808387,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.OAK_FENCE,
    key: 'oak_fence',
    name: 'Oak Fence',
    textures: { all: 'planks_oak' },
    hardness: 2.0,
    toolType: 'axe',
    transparent: true,
    occludesFaces: false,
    renderShape: 'fence',
    color: 0xa87d48,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.LANTERN,
    key: 'lantern',
    name: 'Lantern',
    textures: { top: 'lantern_top', bottom: 'lantern_top', side: 'lantern_side' },
    hardness: 1.5,
    toolType: 'pickaxe',
    transparent: true,
    occludesFaces: false,
    lightEmission: 15,
    renderShape: 'lantern',
    color: 0xffc65c,
    soundGroup: 'stone',
  });

  registry.register({
    id: BLOCK_IDS.CAMPFIRE,
    key: 'campfire',
    name: 'Campfire',
    textures: { top: 'campfire_fire', bottom: 'campfire_log', side: 'campfire_log' },
    hardness: 1.5,
    toolType: 'axe',
    transparent: true,
    occludesFaces: false,
    interactable: true,
    lightEmission: 15,
    damageOnTouch: 1,
    renderShape: 'campfire',
    color: 0xf58426,
    soundGroup: 'wood',
  });

  registry.register({
    id: BLOCK_IDS.OAK_SIGN,
    key: 'oak_sign',
    name: 'Oak Sign',
    textures: { all: 'oak_sign' },
    solid: false,
    transparent: true,
    occludesFaces: false,
    interactable: true,
    hardness: 1.0,
    toolType: 'axe',
    renderShape: 'sign',
    color: 0xb0844e,
    soundGroup: 'wood',
  });

  return registry;
}

/**
 * Shared default registry instance.
 * @type {BlockRegistry}
 */
export const blockRegistry = createDefaultBlockRegistry();
