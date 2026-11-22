/**
 * @file ItemRegistry.js
 * @description Unified item, tool, weapon, armor, and food registry mapping voxel block IDs,
 * raw resources, crafted tools, armor sets, durability, drop tables, and procedural 16x16 pixel icons.
 */

import { BLOCK_IDS, blockRegistry as defaultBlockRegistry } from '../blocks/BlockRegistry.js';

export const ITEM_CATEGORIES = Object.freeze({
  BLOCK: 'block',
  MATERIAL: 'material',
  TOOL: 'tool',
  FOOD: 'food',
  ARMOR: 'armor',
  POTION: 'potion',
});

export const ARMOR_SLOTS = Object.freeze(['helmet', 'chestplate', 'leggings', 'boots']);

/**
 * Defines a stackable item, placeable block item, food, armor piece, or tool/weapon.
 */
export class ItemDef {
  constructor({
    id,
    name,
    category = ITEM_CATEGORIES.BLOCK,
    blockId = null,
    maxStack = 64,
    tileKey = null,
    color = 0xffffff,
    toolType = null,
    toolTier = 0,
    miningSpeed = 1,
    attackDamage = 2,
    maxDurability = 0,
    armorSlot = null,
    armorPoints = 0,
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
    this.toolTier = toolTier;
    this.miningSpeed = miningSpeed;
    this.attackDamage = attackDamage;
    this.maxDurability = maxDurability;
    this.armorSlot = armorSlot;
    this.armorPoints = armorPoints;
    this.foodValue = foodValue;
    this.saturationValue = saturationValue;
  }
}

/**
 * Registry of all items, tools, armor, foods, and block-to-drop loot conversions.
 */
export class ItemRegistry {
  constructor(blockRegistry = defaultBlockRegistry) {
    this.blockRegistry = blockRegistry;
    /** @type {Map<string, ItemDef>} */
    this._byId = new Map();
    /** @type {Map<number, string>} */
    this._blockToItemId = new Map();
    /** @type {Map<string, string>} */
    this._iconCache = new Map();
    /** @type {Map<string, string>} */
    this._packItemIcons = new Map();

    this._registerDefaults();
  }

  /**
   * Clears cached icon data URLs (call after swapping texture atlas or item resource pack).
   */
  invalidateIconCache() {
    this._iconCache.clear();
  }

  /**
   * Applies matched item PNG blobs from a 1.21 Resource Pack.
   * @param {Record<string, Blob>} itemIconBlobs
   * @returns {Promise<number>}
   */
  async applyResourcePackIcons(itemIconBlobs) {
    this.clearResourcePackIcons();
    if (!itemIconBlobs || typeof document === 'undefined') return 0;
    let count = 0;
    for (const [itemId, blob] of Object.entries(itemIconBlobs)) {
      if (!blob) continue;
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          const srcSize = Math.min(bitmap.width, bitmap.height);
          ctx.drawImage(bitmap, 0, 0, srcSize, srcSize, 0, 0, 16, 16);
          this._packItemIcons.set(itemId, canvas.toDataURL());
          count++;
        }
        bitmap.close();
      } catch {
        // fallback to procedural icon
      }
    }
    this._iconCache.clear();
    return count;
  }

  clearResourcePackIcons() {
    this._packItemIcons.clear();
    this._iconCache.clear();
  }

  register(config) {
    const def = config instanceof ItemDef ? config : new ItemDef(config);
    this._byId.set(def.id, def);
    if (def.blockId !== null && !this._blockToItemId.has(def.blockId)) {
      this._blockToItemId.set(def.blockId, def.id);
    }
    return def;
  }

  get(id) {
    return this._byId.get(id);
  }

  getAll() {
    return Array.from(this._byId.values());
  }

  getItemIdForBlock(blockId) {
    return this._blockToItemId.get(blockId) ?? null;
  }

  /**
   * Computes survival loot drops for breaking a given block ID.
   * Respects optional toolDef tier when provided (backward-compatible when omitted).
   * @param {number} blockId
   * @param {number} [rng=Math.random()]
   * @param {ItemDef|null} [toolDef=null]
   * @returns {Array<{ itemId: string, count: number }>}
   */
  getDropsForBlock(blockId, rng = Math.random(), toolDef = null, enforceToolTier = false, toolEnchants = null) {
    const roll = typeof rng === 'number' && Number.isFinite(rng) ? rng : Math.random();
    const silkTouch = Boolean(toolEnchants && toolEnchants.silk_touch > 0);
    const fortune = Math.max(0, Math.floor(toolEnchants?.fortune || 0));
    const fortuneMult = () => {
      if (fortune <= 0) return 1;
      return 1 + Math.floor(roll * (fortune + 1));
    };

    // Optional harvest-tier check when caller enables progressive mining enforcement or passes a tool
    if (enforceToolTier || (toolDef !== null && toolDef !== undefined)) {
      const bDef = this.blockRegistry.getById(blockId);
      if (bDef && bDef.minToolTier > 0) {
        const hasRightTool =
          Boolean(toolDef) &&
          toolDef.toolType === bDef.toolType &&
          (toolDef.toolTier ?? 0) >= bDef.minToolTier;
        if (!hasRightTool) {
          return [];
        }
      }
    }

    if (silkTouch) {
      if (
        blockId === BLOCK_IDS.STONE ||
        blockId === BLOCK_IDS.GRASS ||
        blockId === BLOCK_IDS.GLASS ||
        blockId === BLOCK_IDS.BOOKSHELF ||
        blockId === BLOCK_IDS.COAL_ORE ||
        blockId === BLOCK_IDS.DIAMOND_ORE ||
        blockId === BLOCK_IDS.LAPIS_ORE ||
        blockId === BLOCK_IDS.REDSTONE_ORE ||
        blockId === BLOCK_IDS.GLOWSTONE
      ) {
        const silkItem = this.getItemIdForBlock(blockId);
        if (silkItem) return [{ itemId: silkItem, count: 1 }];
      }
    }

    switch (blockId) {
      case BLOCK_IDS.AIR:
      case BLOCK_IDS.BEDROCK:
      case BLOCK_IDS.WATER:
      case BLOCK_IDS.LAVA:
      case BLOCK_IDS.NETHER_PORTAL:
      case BLOCK_IDS.END_PORTAL:
      case BLOCK_IDS.END_PORTAL_FRAME:
      case BLOCK_IDS.END_PORTAL_FRAME_FILLED:
        return [];
      case BLOCK_IDS.GRASS:
      case BLOCK_IDS.FARMLAND:
      case BLOCK_IDS.FARMLAND_WET:
        return [{ itemId: 'dirt', count: 1 }];
      case BLOCK_IDS.GRAVEL:
        return roll < 0.2 ? [{ itemId: 'flint', count: 1 }] : [{ itemId: 'gravel', count: 1 }];
      case BLOCK_IDS.STONE:
        return [{ itemId: 'cobblestone', count: 1 }];
      case BLOCK_IDS.COAL_ORE:
        return [{ itemId: 'coal', count: fortuneMult() }];
      case BLOCK_IDS.IRON_ORE:
        return [{ itemId: 'iron_ore', count: 1 }];
      case BLOCK_IDS.GOLD_ORE:
        return [{ itemId: 'gold_ore', count: 1 }];
      case BLOCK_IDS.DIAMOND_ORE:
        return [{ itemId: 'diamond', count: fortuneMult() }];
      case BLOCK_IDS.LAPIS_ORE:
        return [{ itemId: 'lapis_lazuli', count: (4 + Math.floor(roll * 3)) * fortuneMult() }];
      case BLOCK_IDS.REDSTONE_ORE:
        return [{ itemId: 'redstone', count: 3 + fortune }];
      case BLOCK_IDS.NETHER_QUARTZ_ORE:
        return [{ itemId: 'quartz', count: fortuneMult() }];
      case BLOCK_IDS.BOOKSHELF:
        return [{ itemId: 'book', count: 3 }];
      case BLOCK_IDS.GLOWSTONE:
        return [{ itemId: 'glowstone_dust', count: Math.min(4, 2 + Math.floor(roll * 3) + fortune) }];
      case BLOCK_IDS.NETHER_WART_BLOCK:
        return [{ itemId: 'nether_wart', count: 2 + Math.floor(roll * 2) }];
      case BLOCK_IDS.REDSTONE_WIRE:
      case BLOCK_IDS.REDSTONE_WIRE_ON:
        return [{ itemId: 'redstone', count: 1 }];
      case BLOCK_IDS.LEVER_ON:
        return [{ itemId: 'lever', count: 1 }];
      case BLOCK_IDS.STONE_BUTTON_ON:
        return [{ itemId: 'stone_button', count: 1 }];
      case BLOCK_IDS.PRESSURE_PLATE_ON:
        return [{ itemId: 'pressure_plate', count: 1 }];
      case BLOCK_IDS.REDSTONE_LAMP_ON:
        return [{ itemId: 'redstone_lamp', count: 1 }];
      case BLOCK_IDS.PISTON_EXTENDED:
        return [{ itemId: 'piston', count: 1 }];
      case BLOCK_IDS.FURNACE_LIT:
        return [{ itemId: 'furnace', count: 1 }];
      case BLOCK_IDS.OAK_DOOR_OPEN:
      case BLOCK_IDS.OAK_DOOR_CLOSED:
        return [{ itemId: 'oak_door', count: 1 }];
      case BLOCK_IDS.TALL_GRASS:
        return roll < 0.35 ? [{ itemId: 'wheat_seeds', count: 1 }] : [];
      case BLOCK_IDS.WHEAT_0:
      case BLOCK_IDS.WHEAT_1:
      case BLOCK_IDS.WHEAT_2:
        return [{ itemId: 'wheat_seeds', count: 1 }];
      case BLOCK_IDS.WHEAT_3:
        return [
          { itemId: 'wheat', count: 1 },
          { itemId: 'wheat_seeds', count: roll < 0.5 ? 2 : 1 },
        ];
      case BLOCK_IDS.OAK_LEAVES:
      case BLOCK_IDS.SPRUCE_LEAVES:
        if (roll < 0.28) return [{ itemId: 'stick', count: 1 }];
        if (roll < 0.4) return [{ itemId: 'apple', count: 1 }];
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
   */
  /**
   * Returns a cached data-URL 16x16 crisp icon for any block or item.
   * @param {string} itemId
   * @param {any} [textureAtlas=null]
   * @returns {string}
   */
  getItemIconUrl(itemId, textureAtlas = null) {
    const cacheKey = `${itemId}:${textureAtlas ? 'atlas' : 'noatlas'}`;
    if (this._iconCache.has(cacheKey)) {
      return this._iconCache.get(cacheKey);
    }

    if (this._packItemIcons.has(itemId)) {
      const packUrl = this._packItemIcons.get(itemId);
      this._iconCache.set(cacheKey, packUrl);
      return packUrl;
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
      if (x < 0 || x > 15 || y < 0 || y > 15) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    };

    const tierPalettes = {
      wooden: ['#c49658', '#8a6232'],
      leather: ['#b5693d', '#7c4223'],
      stone: ['#9ca2ab', '#676c75'],
      iron: ['#e4ebf2', '#9ba5b0'],
      gold: ['#ffe054', '#c9971c'],
      diamond: ['#62f2ec', '#28a8b2'],
    };
    const prefix = itemId.split('_')[0];
    const [hi, lo] = tierPalettes[prefix] || ['#d6dde5', '#98a1ac'];

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

    if (itemId === 'iron_ingot' || itemId === 'gold_ingot') {
      const top = itemId === 'gold_ingot' ? '#fff08a' : '#f3f6fa';
      const mid = itemId === 'gold_ingot' ? '#f0be2e' : '#cfd6de';
      const bot = itemId === 'gold_ingot' ? '#b88212' : '#96a0ab';
      for (let y = 5; y <= 10; y++) {
        for (let x = 3; x <= 12; x++) {
          px(x, y, y <= 6 ? top : y >= 9 ? bot : mid);
        }
      }
      return;
    }

    if (itemId === 'diamond') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 3; x <= 12; x++) {
          const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
          if (d <= 5.2) {
            px(x, y, d <= 2 ? '#c4ffff' : y < 7 ? '#63f2ed' : '#26a9b5');
          }
        }
      }
      return;
    }

    if (itemId === 'redstone' || itemId === 'gunpowder') {
      const c1 = itemId === 'redstone' ? '#ff3838' : '#73767a';
      const c2 = itemId === 'redstone' ? '#b01818' : '#4a4c52';
      for (let y = 5; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 8) <= 3.8) {
            px(x, y, (x * 3 + y) % 2 === 0 ? c1 : c2);
          }
        }
      }
      return;
    }

    if (itemId === 'string') {
      for (let i = 3; i <= 12; i++) {
        px(i, Math.round(7.5 + Math.sin(i * 0.7) * 3), '#e6ecf2');
        px(i, Math.round(8.5 + Math.sin(i * 0.7) * 3), '#b9c4cf');
      }
      return;
    }

    if (itemId === 'bone') {
      for (let i = 4; i <= 11; i++) {
        px(i, 15 - i, '#ebe8dc');
        px(i + 1, 15 - i, '#d4cfbf');
      }
      px(3, 12, '#ebe8dc'); px(4, 13, '#ebe8dc');
      px(11, 3, '#ebe8dc'); px(12, 4, '#ebe8dc');
      return;
    }

    if (itemId === 'feather') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#ffffff');
        if (i >= 5) px(i - 1, 14 - i, '#dce3eb');
        if (i >= 6) px(i, 14 - i, '#f2f6fa');
      }
      return;
    }

    if (itemId === 'flint') {
      for (let y = 5; y <= 11; y++) {
        for (let x = 5; x <= 11; x++) {
          if (x + y >= 11 && x + y <= 20) {
            px(x, y, y < 8 ? '#52555c' : '#2d2f36');
          }
        }
      }
      return;
    }

    if (itemId === 'flint_and_steel') {
      // C-shaped steel striker + dark flint
      const steel = [[4, 4], [5, 3], [6, 3], [7, 3], [8, 4], [8, 5], [7, 6], [6, 7], [5, 7], [4, 6]];
      for (const [x, y] of steel) px(x, y, x < 6 ? '#dce3ec' : '#96a0ac');
      for (let y = 8; y <= 12; y++) {
        for (let x = 8; x <= 12; x++) {
          if (x + y >= 17 && x + y <= 22) px(x, y, y < 10 ? '#50545e' : '#2a2d34');
        }
      }
      px(7, 8, '#ff9f2e');
      return;
    }

    if (itemId === 'shears') {
      for (let i = 0; i < 6; i++) {
        px(4 + i, 3 + i, '#dce3ec');
        px(11 - i, 3 + i, '#b0bac5');
      }
      px(4, 10, '#c23a3a'); px(5, 10, '#c23a3a'); px(4, 11, '#8c2222'); px(5, 11, '#8c2222');
      px(10, 10, '#c23a3a'); px(11, 10, '#c23a3a'); px(10, 11, '#8c2222'); px(11, 11, '#8c2222');
      return;
    }

    if (itemId === 'leather') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 3; x <= 12; x++) {
          if ((x === 3 || x === 12) && (y === 3 || y === 12)) continue;
          px(x, y, y <= 5 ? '#c87743' : y >= 10 ? '#7c4220' : '#a85d32');
        }
      }
      return;
    }

    if (itemId === 'ender_pearl') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 3; x <= 12; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (d <= 4.6) {
            px(x, y, d < 1.8 ? '#8ef5e4' : d < 3.2 ? '#1a9e8c' : '#0b4a45');
          }
        }
      }
      return;
    }

    if (itemId === 'quartz') {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
          if (d <= 4.4) {
            px(x, y, y < 7 ? '#f7f3eb' : '#d6cec0');
          }
        }
      }
      return;
    }

    if (itemId === 'wheat_seeds') {
      const pts = [[5, 6], [9, 5], [7, 9], [10, 10], [5, 11]];
      for (const [x, y] of pts) {
        px(x, y, '#7ec242');
        px(x + 1, y + 1, '#528726');
      }
      return;
    }

    if (itemId === 'wheat') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#d4ab39');
        px(i + 1, 15 - i, '#f2d05a');
        if (i >= 7) px(i - 1, 14 - i, '#b88f27');
      }
      return;
    }

    if (itemId === 'bread') {
      for (let y = 6; y <= 11; y++) {
        for (let x = 2; x <= 13; x++) {
          if (y === 6 && (x < 4 || x > 11)) continue;
          px(x, y, y <= 7 ? '#e6b15c' : y >= 10 ? '#8c5a26' : '#c78c3c');
        }
      }
      return;
    }

    if (itemId.endsWith('_bucket') || itemId === 'bucket') {
      for (let y = 5; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          const rim = y === 5 || x === 4 || x === 11 || y === 12;
          if (rim) px(x, y, y === 12 ? '#7b838c' : '#cbd4de');
          else if (y <= 7 && itemId === 'water_bucket') px(x, y, '#3b82f6');
          else if (y <= 7 && itemId === 'lava_bucket') px(x, y, '#f97316');
          else px(x, y, '#96a0ab');
        }
      }
      return;
    }

    if (itemId === 'bow') {
      for (let i = 3; i <= 12; i++) {
        px(12, i, '#d1d5db'); // bowstring
      }
      const arc = [[11, 3], [9, 4], [7, 5], [6, 7], [6, 8], [7, 10], [9, 11], [11, 12]];
      for (const [x, y] of arc) {
        px(x, y, '#9a6838');
        px(x - 1, y, '#6b4522');
      }
      return;
    }

    if (itemId === 'arrow') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#9a6a38');
      }
      px(12, 3, '#d6dde5'); px(11, 3, '#98a1ac'); px(12, 4, '#98a1ac');
      px(3, 12, '#ffffff'); px(4, 12, '#dbe4ed'); px(3, 11, '#dbe4ed');
      return;
    }

    if (itemId.endsWith('_pickaxe')) {
      for (let i = 3; i <= 11; i++) {
        px(i, 15 - i, '#7c532c');
        px(i + 1, 15 - i, '#9a6a38');
      }
      for (let x = 6; x <= 12; x++) px(x, 3, hi);
      for (let y = 4; y <= 9; y++) px(12, y, lo);
      px(11, 4, hi); px(12, 3, hi);
      return;
    }

    if (itemId.endsWith('_axe')) {
      for (let i = 3; i <= 11; i++) {
        px(i, 15 - i, '#7c532c');
      }
      for (let y = 3; y <= 7; y++) {
        for (let x = 8; x <= 12; x++) {
          if (x + y >= 12) px(x, y, y <= 4 || x === 12 ? hi : lo);
        }
      }
      return;
    }

    if (itemId.endsWith('_shovel')) {
      for (let i = 3; i <= 10; i++) {
        px(i, 15 - i, '#7c532c');
      }
      for (let y = 2; y <= 5; y++) {
        for (let x = 10; x <= 13; x++) {
          px(x, y, y === 2 || x === 13 ? hi : lo);
        }
      }
      return;
    }

    if (itemId.endsWith('_hoe')) {
      for (let i = 3; i <= 11; i++) {
        px(i, 15 - i, '#7c532c');
      }
      for (let x = 7; x <= 12; x++) {
        px(x, 3, hi);
        px(x, 4, lo);
      }
      px(7, 5, lo);
      return;
    }

    if (itemId.endsWith('_sword')) {
      for (let i = 5; i <= 13; i++) {
        px(i, 15 - i, hi);
        px(i - 1, 15 - i, lo);
      }
      px(4, 10, '#5a3a1e'); px(5, 11, '#5a3a1e'); px(6, 12, '#5a3a1e');
      px(3, 12, '#7c532c'); px(2, 13, '#7c532c');
      return;
    }

    if (itemId.endsWith('_helmet')) {
      for (let y = 4; y <= 11; y++) {
        for (let x = 3; x <= 12; x++) {
          if (y >= 8 && x >= 6 && x <= 9) continue;
          px(x, y, y <= 5 || x === 3 ? hi : lo);
        }
      }
      return;
    }

    if (itemId.endsWith('_chestplate')) {
      for (let y = 3; y <= 12; y++) {
        for (let x = 2; x <= 13; x++) {
          if (y >= 7 && (x <= 3 || x >= 12)) continue;
          if (y === 3 && x >= 6 && x <= 9) continue;
          px(x, y, y <= 5 || x === 5 ? hi : lo);
        }
      }
      return;
    }

    if (itemId.endsWith('_leggings')) {
      for (let y = 3; y <= 13; y++) {
        for (let x = 4; x <= 11; x++) {
          if (y >= 7 && x >= 7 && x <= 8) continue;
          px(x, y, y <= 5 || x === 4 ? hi : lo);
        }
      }
      return;
    }

    if (itemId.endsWith('_boots')) {
      for (let y = 6; y <= 12; y++) {
        for (let x = 2; x <= 6; x++) px(x, y, y <= 7 ? hi : lo);
        for (let x = 9; x <= 13; x++) px(x, y, y <= 7 ? hi : lo);
      }
      return;
    }

    if (itemId === 'apple') {
      for (let y = 5; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 8.5) <= 4.1) {
            px(x, y, x <= 6 && y <= 7 ? '#ff6b6b' : '#c92a2a');
          }
        }
      }
      px(7, 4, '#6b4226'); px(8, 3, '#4da33b'); px(9, 4, '#4da33b');
      return;
    }

    if (
      itemId === 'raw_beef' ||
      itemId === 'cooked_beef' ||
      itemId === 'raw_porkchop' ||
      itemId === 'cooked_porkchop' ||
      itemId === 'raw_chicken' ||
      itemId === 'cooked_chicken'
    ) {
      const cooked = itemId.startsWith('cooked_');
      const outer = cooked ? '#754120' : itemId.includes('pork') ? '#f29ea6' : itemId.includes('chicken') ? '#f5d4c1' : '#b83232';
      const inner = cooked ? '#9e5d32' : itemId.includes('pork') ? '#f7bdc3' : itemId.includes('chicken') ? '#fce5d8' : '#e05353';
      for (let y = 5; y <= 11; y++) {
        for (let x = 3; x <= 12; x++) {
          if (Math.hypot((x - 7.5) * 0.85, y - 8) <= 3.9) {
            px(x, y, (x + y) % 4 === 0 ? '#f7d8d0' : y < 8 ? inner : outer);
          }
        }
      }
      return;
    }

    if (itemId === 'lapis_lazuli') {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 7.5) <= 4.1) {
            px(x, y, y < 7 ? '#5b8cff' : (x + y) % 3 === 0 ? '#1d4ed8' : '#2563eb');
          }
        }
      }
      return;
    }

    if (itemId === 'emerald') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          const d = Math.abs(x - 7.5) * 1.15 + Math.abs(y - 7.5) * 0.85;
          if (d <= 4.6) {
            px(x, y, d < 1.8 ? '#a7f3d0' : y < 8 ? '#10b981' : '#047857');
          }
        }
      }
      return;
    }

    if (itemId === 'blaze_rod') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#f59e0b');
        px(i, 14 - i, '#fef08a');
      }
      return;
    }

    if (itemId === 'blaze_powder' || itemId === 'glowstone_dust' || itemId === 'sugar') {
      const c1 = itemId === 'blaze_powder' ? '#fb923c' : itemId === 'sugar' ? '#f8fafc' : '#fde047';
      const c2 = itemId === 'blaze_powder' ? '#ea580c' : itemId === 'sugar' ? '#cbd5e1' : '#ca8a04';
      for (let y = 5; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 8) <= 3.7) {
            px(x, y, (x + y) % 2 === 0 ? c1 : c2);
          }
        }
      }
      return;
    }

    if (itemId === 'eye_of_ender') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 3; x <= 12; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (d <= 4.7) {
            if (x >= 7 && x <= 8 && y >= 5 && y <= 10) px(x, y, '#062b22');
            else if (d < 2.6) px(x, y, '#86efac');
            else px(x, y, '#10b981');
          }
        }
      }
      return;
    }

    if (itemId === 'nether_wart') {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if (Math.hypot(x - 7.5, y - 7.5) <= 4) {
            px(x, y, y < 7 ? '#dc2626' : '#7f1d1d');
          }
        }
      }
      return;
    }

    if (itemId === 'paper') {
      for (let y = 3; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          px(x, y, y === 3 || x === 4 ? '#ffffff' : y === 12 ? '#cbd5e1' : '#f1f5f9');
        }
      }
      return;
    }

    if (itemId === 'book' || itemId === 'enchanted_book') {
      const cover = itemId === 'enchanted_book' ? '#9333ea' : '#92400e';
      const trim = itemId === 'enchanted_book' ? '#e879f9' : '#d97706';
      for (let y = 3; y <= 12; y++) {
        for (let x = 4; x <= 12; x++) {
          if (x === 4) px(x, y, '#f8fafc');
          else px(x, y, y === 3 || y === 12 ? trim : cover);
        }
      }
      if (itemId === 'enchanted_book') {
        px(7, 7, '#fde047'); px(8, 7, '#fde047'); px(9, 8, '#fde047');
      }
      return;
    }

    if (itemId === 'glass_bottle' || itemId === 'water_bottle' || itemId === 'awkward_potion' || itemId.startsWith('potion_')) {
      const liquidColors = {
        glass_bottle: null,
        water_bottle: '#3b82f6',
        awkward_potion: '#60a5fa',
        potion_healing: '#ef4444',
        potion_speed: '#38bdf8',
        potion_strength: '#b91c1c',
        potion_fire_resistance: '#f97316',
        potion_night_vision: '#312e81',
        potion_regeneration: '#ec4899',
      };
      const liq = liquidColors[itemId] ?? null;
      // Cork & neck
      px(7, 2, '#9a6838'); px(8, 2, '#9a6838');
      px(6, 3, '#cbd5e1'); px(7, 3, '#e2e8f0'); px(8, 3, '#e2e8f0'); px(9, 3, '#cbd5e1');
      px(7, 4, '#cbd5e1'); px(8, 4, '#cbd5e1');
      for (let y = 5; y <= 13; y++) {
        for (let x = 4; x <= 11; x++) {
          const rim = x === 4 || x === 11 || y === 5 || y === 13;
          if ((x === 4 || x === 11) && (y === 5 || y === 13)) continue;
          if (rim) px(x, y, '#e2e8f0');
          else if (liq && y >= 7) px(x, y, liq);
          else px(x, y, 'rgba(226,232,240,0.35)');
        }
      }
      return;
    }

    if (itemId === 'shield') {
      for (let y = 2; y <= 13; y++) {
        for (let x = 4; x <= 11; x++) {
          const edge = x === 4 || x === 11 || y === 2 || y === 13;
          px(x, y, edge ? '#9ca3af' : x === 7 || x === 8 ? '#b48a55' : '#9a6b3b');
        }
      }
      return;
    }

    if (itemId === 'fishing_rod') {
      for (let i = 3; i <= 12; i++) {
        px(i, 15 - i, '#8a5a2b');
      }
      for (let y = 4; y <= 11; y++) px(12, y, '#e2e8f0');
      px(11, 12, '#ef4444'); px(12, 12, '#ffffff');
      return;
    }

    if (itemId === 'oak_boat') {
      for (let y = 7; y <= 11; y++) {
        for (let x = 2; x <= 13; x++) {
          if (y === 11 && (x < 4 || x > 11)) continue;
          px(x, y, y === 7 ? '#8c5f32' : y === 11 ? '#704923' : '#b48a55');
        }
      }
      px(5, 6, '#d1a46b'); px(10, 6, '#d1a46b');
      return;
    }

    if (itemId === 'raw_cod' || itemId === 'cooked_cod' || itemId === 'raw_salmon' || itemId === 'cooked_salmon') {
      const isSalmon = itemId.includes('salmon');
      const cooked = itemId.startsWith('cooked_');
      const body = cooked ? (isSalmon ? '#c25e3e' : '#b5844f') : (isSalmon ? '#3d7c68' : '#b8aa8f');
      const belly = cooked ? '#e0b379' : (isSalmon ? '#d96b5b' : '#e0d6c1');
      for (let i = 4; i <= 11; i++) {
        px(i, 15 - i, body);
        px(i + 1, 15 - i, belly);
        px(i, 14 - i, body);
      }
      px(3, 12, body); px(12, 4, '#111827');
      return;
    }

    ctx.fillStyle = `#${def.color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(3, 3, 10, 10);
  }

  /** @private */
  _registerDefaults() {
    // 1. Register every placeable/inspectable block from BlockRegistry
    for (const block of this.blockRegistry.getAll()) {
      if (block.id === BLOCK_IDS.AIR) continue;
      if (
        block.id === BLOCK_IDS.FURNACE_LIT ||
        block.id === BLOCK_IDS.OAK_DOOR_OPEN ||
        block.id === BLOCK_IDS.WHEAT_0 ||
        block.id === BLOCK_IDS.WHEAT_1 ||
        block.id === BLOCK_IDS.WHEAT_2 ||
        block.id === BLOCK_IDS.WHEAT_3 ||
        block.id === BLOCK_IDS.FARMLAND ||
        block.id === BLOCK_IDS.FARMLAND_WET ||
        block.id === BLOCK_IDS.NETHER_PORTAL ||
        block.id === BLOCK_IDS.END_PORTAL ||
        block.id === BLOCK_IDS.END_PORTAL_FRAME_FILLED ||
        block.id === BLOCK_IDS.NETHER_WART_BLOCK ||
        block.id === BLOCK_IDS.REDSTONE_WIRE ||
        block.id === BLOCK_IDS.REDSTONE_WIRE_ON ||
        block.id === BLOCK_IDS.LEVER_ON ||
        block.id === BLOCK_IDS.STONE_BUTTON_ON ||
        block.id === BLOCK_IDS.PRESSURE_PLATE_ON ||
        block.id === BLOCK_IDS.REDSTONE_LAMP_ON ||
        block.id === BLOCK_IDS.PISTON_EXTENDED
      ) {
        continue;
      }
      const tileKey = block.textures.north || block.textures.top || null;
      this.register({
        id: block.key,
        name: block.name,
        category: ITEM_CATEGORIES.BLOCK,
        blockId: block.id,
        maxStack: 64,
        tileKey,
        color: block.color,
      });
    }

    // 2. Materials & crafting drops
    const materials = [
      { id: 'stick', name: 'Stick', color: 0x9a6a38 },
      { id: 'coal', name: 'Coal', color: 0x262930 },
      { id: 'iron_ingot', name: 'Iron Ingot', color: 0xd0d7e0 },
      { id: 'gold_ingot', name: 'Gold Ingot', color: 0xf4c83c },
      { id: 'diamond', name: 'Diamond', color: 0x52eee9 },
      { id: 'lapis_lazuli', name: 'Lapis Lazuli', color: 0x2563eb },
      { id: 'emerald', name: 'Emerald', color: 0x10b981 },
      { id: 'redstone', name: 'Redstone Dust', color: 0xd92626, blockId: BLOCK_IDS.REDSTONE_WIRE },
      { id: 'gunpowder', name: 'Gunpowder', color: 0x62656b },
      { id: 'string', name: 'String', color: 0xe2e8f0 },
      { id: 'bone', name: 'Bone', color: 0xe6e1d3 },
      { id: 'feather', name: 'Feather', color: 0xf8fafc },
      { id: 'flint', name: 'Flint', color: 0x3b3d42 },
      { id: 'leather', name: 'Leather', color: 0xa85d32 },
      { id: 'ender_pearl', name: 'Ender Pearl', color: 0x1a9e8c, maxStack: 16 },
      { id: 'blaze_rod', name: 'Blaze Rod', color: 0xf59e0b },
      { id: 'blaze_powder', name: 'Blaze Powder', color: 0xfb923c },
      { id: 'eye_of_ender', name: 'Eye of Ender', color: 0x10b981, maxStack: 16 },
      { id: 'nether_wart', name: 'Nether Wart', color: 0xb91c1c, blockId: BLOCK_IDS.NETHER_WART_BLOCK },
      { id: 'glowstone_dust', name: 'Glowstone Dust', color: 0xfacc15 },
      { id: 'sugar', name: 'Sugar', color: 0xf1f5f9 },
      { id: 'paper', name: 'Paper', color: 0xf8fafc },
      { id: 'book', name: 'Book', color: 0x92400e },
      { id: 'enchanted_book', name: 'Enchanted Book', color: 0x9333ea, maxStack: 1 },
      { id: 'glass_bottle', name: 'Glass Bottle', color: 0xe2e8f0 },
      { id: 'quartz', name: 'Nether Quartz', color: 0xeae4d8 },
      { id: 'wheat', name: 'Wheat', color: 0xe3bf4b },
      { id: 'wheat_seeds', name: 'Wheat Seeds', color: 0x6eb536 },
      { id: 'arrow', name: 'Arrow', color: 0xcbd5e1 },
    ];
    for (const m of materials) {
      this.register({ maxStack: 64, ...m, category: ITEM_CATEGORIES.MATERIAL });
    }

    // 2b. Potions
    const potions = [
      { id: 'water_bottle', name: 'Water Bottle', color: 0x3b82f6 },
      { id: 'awkward_potion', name: 'Awkward Potion', color: 0x60a5fa },
      { id: 'potion_healing', name: 'Potion of Healing', color: 0xef4444 },
      { id: 'potion_speed', name: 'Potion of Swiftness', color: 0x38bdf8 },
      { id: 'potion_strength', name: 'Potion of Strength', color: 0xb91c1c },
      { id: 'potion_fire_resistance', name: 'Potion of Fire Resistance', color: 0xf97316 },
      { id: 'potion_night_vision', name: 'Potion of Night Vision', color: 0x312e81 },
      { id: 'potion_regeneration', name: 'Potion of Regeneration', color: 0xec4899 },
    ];
    for (const p of potions) {
      this.register({ ...p, category: ITEM_CATEGORIES.POTION, maxStack: 1 });
    }

    // 3. Utility tools, Shield, Fishing Rod, Boat & Buckets
    this.register({ id: 'bucket', name: 'Bucket', category: ITEM_CATEGORIES.TOOL, maxStack: 16, color: 0xb8c2cc, toolType: 'bucket' });
    this.register({ id: 'water_bucket', name: 'Water Bucket', category: ITEM_CATEGORIES.TOOL, maxStack: 1, color: 0x3b82f6, toolType: 'water_bucket' });
    this.register({ id: 'lava_bucket', name: 'Lava Bucket', category: ITEM_CATEGORIES.TOOL, maxStack: 1, color: 0xf97316, toolType: 'lava_bucket' });
    this.register({
      id: 'flint_and_steel',
      name: 'Flint and Steel',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0xb8c2cc,
      toolType: 'flint_and_steel',
      maxDurability: 64,
    });
    this.register({
      id: 'shears',
      name: 'Shears',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0xd0d7e0,
      toolType: 'shears',
      miningSpeed: 4.0,
      maxDurability: 238,
    });
    this.register({
      id: 'shield',
      name: 'Shield',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0xa37846,
      toolType: 'shield',
      maxDurability: 336,
    });
    this.register({
      id: 'fishing_rod',
      name: 'Fishing Rod',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0x8c5f32,
      toolType: 'fishing_rod',
      maxDurability: 64,
    });
    this.register({
      id: 'oak_boat',
      name: 'Oak Boat',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0xb48a55,
      toolType: 'boat',
    });

    // 4. Bow
    this.register({
      id: 'bow',
      name: 'Bow',
      category: ITEM_CATEGORIES.TOOL,
      maxStack: 1,
      color: 0x9a6838,
      toolType: 'bow',
      attackDamage: 2,
      maxDurability: 384,
    });

    // 5. Tools & Weapons across Wood (1), Stone (2), Iron (3), Diamond (4)
    const tiers = [
      { key: 'wooden', label: 'Wooden', tier: 1, speed: 2.2, dur: 60, dmgBonus: 0, color: 0xb88b52 },
      { key: 'stone', label: 'Stone', tier: 2, speed: 4.0, dur: 132, dmgBonus: 1, color: 0x8b9098 },
      { key: 'iron', label: 'Iron', tier: 3, speed: 6.2, dur: 251, dmgBonus: 2, color: 0xd6dde5 },
      { key: 'diamond', label: 'Diamond', tier: 4, speed: 8.8, dur: 1561, dmgBonus: 3, color: 0x52eee9 },
    ];
    for (const t of tiers) {
      this.register({
        id: `${t.key}_pickaxe`,
        name: `${t.label} Pickaxe`,
        category: ITEM_CATEGORIES.TOOL,
        maxStack: 1,
        color: t.color,
        toolType: 'pickaxe',
        toolTier: t.tier,
        miningSpeed: t.speed,
        attackDamage: 2 + t.dmgBonus,
        maxDurability: t.dur,
      });
      this.register({
        id: `${t.key}_axe`,
        name: `${t.label} Axe`,
        category: ITEM_CATEGORIES.TOOL,
        maxStack: 1,
        color: t.color,
        toolType: 'axe',
        toolTier: t.tier,
        miningSpeed: t.speed,
        attackDamage: 4 + t.dmgBonus,
        maxDurability: t.dur,
      });
      this.register({
        id: `${t.key}_shovel`,
        name: `${t.label} Shovel`,
        category: ITEM_CATEGORIES.TOOL,
        maxStack: 1,
        color: t.color,
        toolType: 'shovel',
        toolTier: t.tier,
        miningSpeed: t.speed,
        attackDamage: 2 + Math.floor(t.dmgBonus * 0.5),
        maxDurability: t.dur,
      });
      this.register({
        id: `${t.key}_hoe`,
        name: `${t.label} Hoe`,
        category: ITEM_CATEGORIES.TOOL,
        maxStack: 1,
        color: t.color,
        toolType: 'hoe',
        toolTier: t.tier,
        miningSpeed: 1.5,
        attackDamage: 2,
        maxDurability: t.dur,
      });
      this.register({
        id: `${t.key}_sword`,
        name: `${t.label} Sword`,
        category: ITEM_CATEGORIES.TOOL,
        maxStack: 1,
        color: t.color,
        toolType: 'sword',
        toolTier: t.tier,
        miningSpeed: 1.5,
        attackDamage: 5 + t.dmgBonus,
        maxDurability: t.dur,
      });
    }

    // 6. Armor Sets (Leather, Iron, Diamond)
    const armorTiers = [
      { key: 'leather', label: 'Leather', color: 0xa65f36, dur: 80, pts: [1, 3, 2, 1] },
      { key: 'iron', label: 'Iron', color: 0xd2dae2, dur: 220, pts: [2, 6, 5, 2] },
      { key: 'diamond', label: 'Diamond', color: 0x52eee9, dur: 480, pts: [3, 8, 6, 3] },
    ];
    const pieceNames = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
    for (const a of armorTiers) {
      ARMOR_SLOTS.forEach((slot, idx) => {
        this.register({
          id: `${a.key}_${slot}`,
          name: `${a.label} ${pieceNames[idx]}`,
          category: ITEM_CATEGORIES.ARMOR,
          maxStack: 1,
          color: a.color,
          armorSlot: slot,
          armorPoints: a.pts[idx],
          maxDurability: a.dur,
        });
      });
    }

    // 7. Foods
    const foods = [
      { id: 'apple', name: 'Apple', color: 0xd93838, foodValue: 4, saturationValue: 2.4 },
      { id: 'bread', name: 'Bread', color: 0xd49c48, foodValue: 5, saturationValue: 6.0 },
      { id: 'raw_beef', name: 'Raw Beef', color: 0xc94242, foodValue: 3, saturationValue: 1.8 },
      { id: 'cooked_beef', name: 'Steak', color: 0x8c4c26, foodValue: 8, saturationValue: 12.8 },
      { id: 'raw_porkchop', name: 'Raw Porkchop', color: 0xf29ca4, foodValue: 3, saturationValue: 1.8 },
      { id: 'cooked_porkchop', name: 'Cooked Porkchop', color: 0xb56d38, foodValue: 8, saturationValue: 12.8 },
      { id: 'raw_chicken', name: 'Raw Chicken', color: 0xf2cbb6, foodValue: 2, saturationValue: 1.2 },
      { id: 'cooked_chicken', name: 'Cooked Chicken', color: 0xc47d3d, foodValue: 6, saturationValue: 7.2 },
      { id: 'raw_cod', name: 'Raw Cod', color: 0xb8aa8f, foodValue: 2, saturationValue: 0.4 },
      { id: 'cooked_cod', name: 'Cooked Cod', color: 0xb5844f, foodValue: 5, saturationValue: 6.0 },
      { id: 'raw_salmon', name: 'Raw Salmon', color: 0x3d7c68, foodValue: 2, saturationValue: 0.4 },
      { id: 'cooked_salmon', name: 'Cooked Salmon', color: 0xc25e3e, foodValue: 6, saturationValue: 9.6 },
    ];
    for (const f of foods) {
      this.register({ ...f, category: ITEM_CATEGORIES.FOOD, maxStack: 64 });
    }
  }
}

/** Shared default ItemRegistry instance */
export const itemRegistry = new ItemRegistry(defaultBlockRegistry);
