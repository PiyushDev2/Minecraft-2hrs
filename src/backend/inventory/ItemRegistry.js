/**
 * @file ItemRegistry.js
 * @description Unified item & tool registry mapping voxel block IDs, raw resources,
 * and crafted tools with drop tables, stack limits, and procedural icon rendering.
 */

import { BLOCK_IDS, blockRegistry as defaultBlockRegistry } from '../blocks/BlockRegistry.js';

export const ITEM_CATEGORIES = Object.freeze({
  BLOCK: 'block',
  MATERIAL: 'material',
  TOOL: 'tool',
  FOOD: 'food',
});

/**
 * Defines a stackable item, placeable block item, food, or tool/weapon.
 */
export class ItemDef {
  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.name
   * @param {string} [config.category='block']
   * @param {number|null} [config.blockId=null]
   * @param {number} [config.maxStack=64]
   * @param {string|null} [config.tileKey=null]
   * @param {number} [config.color=0xffffff]
   * @param {string|null} [config.toolType=null]
   * @param {number} [config.miningSpeed=1]
   * @param {number} [config.attackDamage=2]
   * @param {number} [config.foodValue=0]
   * @param {number} [config.saturationValue=0]
   */
  constructor({
    id,
    name,
    category = ITEM_CATEGORIES.BLOCK,
    blockId = null,
    maxStack = 64,
    tileKey = null,
    color = 0xffffff,
    toolType = null,
    miningSpeed = 1,
    attackDamage = 2,
    foodValue = 0,
    saturationValue = 0,
  }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.blockId = blockId;
    this.maxStack = maxStack;
    this.tileKey = tileKey;
    this.color = color;
    this.toolType = toolType;
    this.miningSpeed = miningSpeed;
    this.attackDamage = attackDamage;
    this.foodValue = foodValue;
    this.saturationValue = saturationValue;
  }
}

/**
 * Registry of all items, tools, and block-to-drop loot conversions.
 */
export class ItemRegistry {
  /**
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} [blockRegistry]
   */
  constructor(blockRegistry = defaultBlockRegistry) {
    this.blockRegistry = blockRegistry;
    /** @type {Map<string, ItemDef>} */
    this._byId = new Map();
    /** @type {Map<number, string>} */
    this._blockToItemId = new Map();
    /** @type {Map<string, string>} */
    this._iconCache = new Map();

    this._registerDefaults();
  }

  /**
   * Registers an item definition.
   * @param {ItemDef|Object} config
   * @returns {ItemDef}
   */
  register(config) {
    const def = config instanceof ItemDef ? config : new ItemDef(config);
    this._byId.set(def.id, def);
    if (def.blockId !== null && !this._blockToItemId.has(def.blockId)) {
      this._blockToItemId.set(def.blockId, def.id);
    }
    return def;
  }

  /**
   * Retrieves an item definition by string ID.
   * @param {string} id
   * @returns {ItemDef|undefined}
   */
  get(id) {
    return this._byId.get(id);
  }

  /**
   * Returns all registered items.
   * @returns {ItemDef[]}
   */
  getAll() {
    return Array.from(this._byId.values());
  }

  /**
   * Resolves the item ID corresponding to a given block ID.
   * @param {number} blockId
   * @returns {string|null}
   */
  getItemIdForBlock(blockId) {
    return this._blockToItemId.get(blockId) ?? null;
  }

  /**
   * Computes survival loot drops for breaking a given block ID.
   * @param {number} blockId
   * @param {number} [rng=Math.random()]
   * @returns {Array<{ itemId: string, count: number }>}
   */
  getDropsForBlock(blockId, rng = Math.random()) {
    switch (blockId) {
      case BLOCK_IDS.AIR:
      case BLOCK_IDS.BEDROCK:
      case BLOCK_IDS.WATER:
        return [];
      case BLOCK_IDS.GRASS:
        return [{ itemId: 'dirt', count: 1 }];
      case BLOCK_IDS.STONE:
        return [{ itemId: 'cobblestone', count: 1 }];
      case BLOCK_IDS.COAL_ORE:
        return [{ itemId: 'coal', count: 1 }];
      case BLOCK_IDS.IRON_ORE:
        return [{ itemId: 'iron_ore', count: 1 }];
      case BLOCK_IDS.OAK_LEAVES:
      case BLOCK_IDS.SPRUCE_LEAVES:
        if (rng < 0.28) return [{ itemId: 'stick', count: 1 }];
        if (rng < 0.4) return [{ itemId: 'apple', count: 1 }];
        return [];
      case BLOCK_IDS.GLASS:
        return [];
      default: {
        const itemId = this.getItemIdForBlock(blockId);
        return itemId ? [{ itemId, count: 1 }] : [];
      }
    }
  }

  /**
   * Returns a cached CSS dataURL icon for HUD inventory/crafting slots.
   * Reuses TextureAtlas tiles for blocks and draws crisp pixel art for tools/materials.
   * @param {string} itemId
   * @param {import('../textures/TextureAtlas.js').TextureAtlas|null} [textureAtlas]
   * @returns {string|null}
   */
  getItemIconUrl(itemId, textureAtlas = null) {
    const cacheKey = `${itemId}:${textureAtlas ? 'atlas' : 'noatlas'}`;
    if (this._iconCache.has(cacheKey)) {
      return this._iconCache.get(cacheKey);
    }
    const def = this.get(itemId);
    if (!def) return null;

    if (def.tileKey && textureAtlas) {
      const url = textureAtlas.getTileDataURL(def.tileKey);
      if (url) {
        this._iconCache.set(cacheKey, url);
        return url;
      }
    }

    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    this._drawCustomItemIcon(ctx, itemId, def);
    const url = canvas.toDataURL();
    this._iconCache.set(cacheKey, url);
    return url;
  }

  /** @private */
  _drawCustomItemIcon(ctx, itemId, def) {
    const px = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    };

    if (itemId === 'stick') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#7c532c');
        px(i, 14 - i, '#a3713f');
      }
      return;
    }

    if (itemId === 'coal') {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 7.5) <= 4.1) {
            px(x, y, (x + y) % 3 === 0 ? '#1b1d22' : '#31343d');
          }
        }
      }
      return;
    }

    if (itemId === 'iron_ingot') {
      for (let y = 5; y <= 10; y++) {
        for (let x = 3; x <= 12; x++) {
          px(x, y, y <= 6 ? '#f3f6fa' : y >= 9 ? '#9aa3ad' : '#cfd6de');
        }
      }
      return;
    }

    if (itemId.endsWith('_pickaxe')) {
      const headColor =
        itemId.startsWith('wooden')
          ? '#b88b52'
          : itemId.startsWith('stone')
          ? '#8b9098'
          : '#d6dde5';
      const headDark =
        itemId.startsWith('wooden')
          ? '#866031'
          : itemId.startsWith('stone')
          ? '#5e626a'
          : '#98a1ac';
      for (let i = 3; i <= 11; i++) {
        px(i, 15 - i, '#7c532c');
        px(i + 1, 15 - i, '#9a6a38');
      }
      for (let x = 6; x <= 12; x++) px(x, 3, headColor);
      for (let y = 4; y <= 9; y++) px(12, y, headDark);
      px(11, 4, headColor);
      px(12, 3, headColor);
      return;
    }

    if (itemId.endsWith('_shovel')) {
      for (let i = 3; i <= 10; i++) {
        px(i, 15 - i, '#7c532c');
      }
      for (let y = 2; y <= 5; y++) {
        for (let x = 10; x <= 13; x++) {
          px(x, y, y === 2 || x === 13 ? '#b88b52' : '#8e6534');
        }
      }
      return;
    }

    if (itemId.endsWith('_sword')) {
      const bladeLight = itemId.startsWith('wooden') ? '#c4965b' : '#9ca3af';
      const bladeDark = itemId.startsWith('wooden') ? '#8f6737' : '#6b7280';
      px(3, 12, '#7c532c');
      px(4, 11, '#7c532c');
      px(5, 10, '#4b341b');
      px(4, 9, '#5e4324');
      px(6, 11, '#5e4324');
      for (let i = 6; i <= 12; i++) {
        px(i, 15 - i, bladeLight);
        px(i + 1, 15 - i, bladeDark);
      }
      px(13, 2, bladeLight);
      return;
    }

    if (itemId === 'apple') {
      px(8, 2, '#6f4e2a');
      px(9, 2, '#4ba83b');
      for (let y = 4; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 8) <= 4.1) {
            px(x, y, x <= 6 && y <= 6 ? '#f87171' : '#dc2626');
          }
        }
      }
      return;
    }

    if (itemId === 'raw_beef' || itemId === 'cooked_beef') {
      const main = itemId === 'cooked_beef' ? '#7c3f1d' : '#c9413b';
      const trim = itemId === 'cooked_beef' ? '#a65c2e' : '#f1d4d1';
      for (let y = 5; y <= 10; y++) {
        for (let x = 3; x <= 12; x++) {
          px(x, y, (x === 4 || y === 6) ? trim : main);
        }
      }
      return;
    }

    ctx.fillStyle = `#${def.color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(3, 3, 10, 10);
  }

  /** @private */
  _registerDefaults() {
    for (const block of this.blockRegistry.getAll()) {
      if (block.id === BLOCK_IDS.AIR || block.id === BLOCK_IDS.BEDROCK) continue;
      const tileKey =
        block.getTextureForFace('top') || block.getTextureForFace('north') || 'stone';
      this.register({
        id: block.key,
        name: block.name,
        category: ITEM_CATEGORIES.BLOCK,
        blockId: block.id,
        maxStack: block.id === BLOCK_IDS.WATER ? 16 : 64,
        tileKey,
        color: block.color,
      });
    }

    this.register({
      id: 'stick',
      name: 'Stick',
      category: ITEM_CATEGORIES.MATERIAL,
      maxStack: 64,
      color: 0x9a6a38,
    });

    this.register({
      id: 'coal',
      name: 'Coal',
      category: ITEM_CATEGORIES.MATERIAL,
      maxStack: 64,
      color: 0x2a2d34,
    });

    this.register({
      id: 'iron_ingot',
      name: 'Iron Ingot',
      category: ITEM_CATEGORIES.MATERIAL,
      maxStack: 64,
      color: 0xd8dee6,
    });

    this.register({
      id: 'wooden_pickaxe',
      name: 'Wooden Pickaxe',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'pickaxe',
      miningSpeed: 2,
      attackDamage: 3,
      color: 0xb48a55,
    });

    this.register({
      id: 'stone_pickaxe',
      name: 'Stone Pickaxe',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'pickaxe',
      miningSpeed: 3.5,
      attackDamage: 3.5,
      color: 0x8b9098,
    });

    this.register({
      id: 'iron_pickaxe',
      name: 'Iron Pickaxe',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'pickaxe',
      miningSpeed: 5.5,
      attackDamage: 4,
      color: 0xd6dde5,
    });

    this.register({
      id: 'wooden_shovel',
      name: 'Wooden Shovel',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'shovel',
      miningSpeed: 2,
      attackDamage: 2.5,
      color: 0xb48a55,
    });

    this.register({
      id: 'wooden_sword',
      name: 'Wooden Sword',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'sword',
      miningSpeed: 1.5,
      attackDamage: 5,
      color: 0xc4965b,
    });

    this.register({
      id: 'stone_sword',
      name: 'Stone Sword',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      toolType: 'sword',
      miningSpeed: 1.5,
      attackDamage: 6,
      color: 0x9ca3af,
    });

    this.register({
      id: 'apple',
      name: 'Apple',
      category: ITEM_CATEGORIES.FOOD,
      maxStack: 64,
      foodValue: 4,
      saturationValue: 2.4,
      color: 0xdc2626,
    });

    this.register({
      id: 'raw_beef',
      name: 'Raw Beef',
      category: ITEM_CATEGORIES.FOOD,
      maxStack: 64,
      foodValue: 3,
      saturationValue: 1.8,
      color: 0xc9413b,
    });

    this.register({
      id: 'cooked_beef',
      name: 'Steak',
      category: ITEM_CATEGORIES.FOOD,
      maxStack: 64,
      foodValue: 8,
      saturationValue: 6,
      color: 0x7c3f1d,
    });
  }
}

export const itemRegistry = new ItemRegistry(defaultBlockRegistry);
