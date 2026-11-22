/**
 * @file MagicSystem.js
 * @description Classic Java-style Enchanting Table (bookshelf scaling, XP + Lapis costs),
 * Anvil (repair, enchant combine, enchanted book application, custom naming),
 * Brewing Stand potion recipes & effects, and Villager profession trading tables.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { ITEM_CATEGORIES } from '../inventory/ItemRegistry.js';

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export const ENCHANT_DEFS = Object.freeze({
  sharpness: {
    id: 'sharpness',
    name: 'Sharpness',
    maxLevel: 5,
    desc: '+1.5 melee damage per level',
    targets: ['sword', 'axe'],
  },
  looting: {
    id: 'looting',
    name: 'Looting',
    maxLevel: 3,
    desc: 'Bonus mob drops',
    targets: ['sword'],
  },
  efficiency: {
    id: 'efficiency',
    name: 'Efficiency',
    maxLevel: 5,
    desc: 'Faster block mining',
    targets: ['pickaxe', 'axe', 'shovel', 'hoe'],
  },
  fortune: {
    id: 'fortune',
    name: 'Fortune',
    maxLevel: 3,
    desc: 'Multiplies ore & gem drops',
    targets: ['pickaxe', 'shovel'],
  },
  silk_touch: {
    id: 'silk_touch',
    name: 'Silk Touch',
    maxLevel: 1,
    desc: 'Mines fragile blocks intact',
    targets: ['pickaxe', 'shovel', 'axe'],
  },
  unbreaking: {
    id: 'unbreaking',
    name: 'Unbreaking',
    maxLevel: 3,
    desc: 'Extends item durability',
    targets: ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'bow', 'shield', 'fishing_rod', 'armor'],
  },
  protection: {
    id: 'protection',
    name: 'Protection',
    maxLevel: 4,
    desc: 'Reduces incoming damage',
    targets: ['armor'],
  },
  power: {
    id: 'power',
    name: 'Power',
    maxLevel: 5,
    desc: 'Increases bow arrow damage',
    targets: ['bow'],
  },
  flame: {
    id: 'flame',
    name: 'Flame',
    maxLevel: 1,
    desc: 'Arrows deal bonus fire damage',
    targets: ['bow'],
  },
});

export function formatEnchantLabel(enchantId, level) {
  const def = ENCHANT_DEFS[enchantId];
  const name = def ? def.name : enchantId;
  if (def && def.maxLevel === 1) return name;
  return `${name} ${ROMAN[level] || level}`;
}

export function getEligibleEnchantsForItem(itemId, itemRegistry) {
  if (itemId === 'book' || itemId === 'enchanted_book') {
    return Object.values(ENCHANT_DEFS);
  }
  const def = itemRegistry.get(itemId);
  if (!def) return [];
  const tag = def.category === ITEM_CATEGORIES.ARMOR ? 'armor' : def.toolType;
  if (!tag) return [];
  return Object.values(ENCHANT_DEFS).filter((e) => e.targets.includes(tag));
}

/**
 * Counts Bookshelves in the classic 5x5x2 ring around an Enchanting Table (max 15).
 */
export function countNearbyBookshelves(world, x, y, z) {
  let count = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
        if (world.getBlock(x + dx, y + dy, z + dz) === BLOCK_IDS.BOOKSHELF) {
          count++;
        }
      }
    }
  }
  return Math.min(15, count);
}

function deterministicRoll(seed) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Generates the 3 classic Java enchanting offers (tiers 1..3) for an item stack.
 */
export function getEnchantOptions(stack, itemRegistry, bookshelfCount = 0, tableSeed = 1) {
  if (!stack || (stack.enchants && Object.keys(stack.enchants).length > 0 && stack.itemId !== 'book')) {
    return [];
  }
  const eligible = getEligibleEnchantsForItem(stack.itemId, itemRegistry);
  if (eligible.length === 0) return [];

  const shelves = Math.max(0, Math.min(15, bookshelfCount | 0));
  const baseKey = stack.itemId.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), tableSeed * 17);

  const tierConfigs = [
    { tier: 1, lapisCost: 1, xpCost: 1, xpReq: Math.max(1, Math.round(1 + shelves * 0.45)), powerScale: 0.35 },
    { tier: 2, lapisCost: 2, xpCost: 2, xpReq: Math.max(4, Math.round(4 + shelves * 1.15)), powerScale: 0.68 },
    { tier: 3, lapisCost: 3, xpCost: 3, xpReq: Math.max(8, Math.round(8 + shelves * 1.48)), powerScale: 1.0 },
  ];

  return tierConfigs.map((cfg, idx) => {
    const r1 = deterministicRoll(baseKey + idx * 97 + shelves * 13);
    const primary = eligible[Math.floor(r1 * eligible.length) % eligible.length];
    const pLevel = Math.max(
      1,
      Math.min(primary.maxLevel, Math.ceil(primary.maxLevel * cfg.powerScale * (0.65 + r1 * 0.45)))
    );
    const enchants = { [primary.id]: pLevel };

    // Higher tiers with bookshelves can grant a secondary enchantment!
    if (cfg.tier >= 2 && eligible.length > 1) {
      const r2 = deterministicRoll(baseKey + idx * 193 + 41 + shelves * 7);
      if (r2 < (cfg.tier === 3 ? 0.85 : 0.45)) {
        const others = eligible.filter(
          (e) =>
            e.id !== primary.id &&
            !((primary.id === 'fortune' && e.id === 'silk_touch') || (primary.id === 'silk_touch' && e.id === 'fortune'))
        );
        if (others.length > 0) {
          const sec = others[Math.floor(r2 * 100) % others.length];
          const sLevel = Math.max(1, Math.min(sec.maxLevel, Math.ceil(sec.maxLevel * cfg.powerScale * 0.75)));
          enchants[sec.id] = sLevel;
        }
      }
    }

    return {
      tier: cfg.tier,
      xpReq: cfg.xpReq,
      xpCost: cfg.xpCost,
      lapisCost: cfg.lapisCost,
      clue: formatEnchantLabel(primary.id, pLevel),
      enchants,
    };
  });
}

/**
 * Returns the repair material itemId for a given tool or armor itemId.
 */
export function getRepairMaterial(itemId) {
  if (itemId.startsWith('wooden_') || itemId === 'shield') return 'oak_planks';
  if (itemId.startsWith('stone_')) return 'cobblestone';
  if (itemId.startsWith('iron_')) return 'iron_ingot';
  if (itemId.startsWith('diamond_')) return 'diamond';
  if (itemId.startsWith('leather_')) return 'leather';
  return null;
}

/**
 * Calculates Anvil output preview & XP level cost without mutating inventory.
 */
export function previewAnvil(primaryStack, secondaryStack, customName, itemRegistry) {
  if (!primaryStack) return null;
  const def = itemRegistry.get(primaryStack.itemId);
  if (!def) return null;

  const trimmedName = typeof customName === 'string' ? customName.trim().slice(0, 32) : '';
  const renamed = Boolean(trimmedName && trimmedName !== (primaryStack.customName || def.name));

  let durability = primaryStack.durability;
  const maxDurability = primaryStack.maxDurability || def.maxDurability || 0;
  const enchants = primaryStack.enchants ? { ...primaryStack.enchants } : {};
  let xpCost = 0;
  let validChange = false;

  if (secondaryStack) {
    const repairMat = getRepairMaterial(primaryStack.itemId);
    if (repairMat && secondaryStack.itemId === repairMat && maxDurability > 0 && (durability ?? maxDurability) < maxDurability) {
      // Material repair: restores 35% durability per ingot/material
      const restore = Math.ceil(maxDurability * 0.35);
      durability = Math.min(maxDurability, (durability ?? maxDurability) + restore);
      xpCost += 2;
      validChange = true;
    } else if (secondaryStack.itemId === primaryStack.itemId || secondaryStack.itemId === 'enchanted_book') {
      // Combine durability for matching items
      if (secondaryStack.itemId === primaryStack.itemId && maxDurability > 0) {
        const combinedDur = (durability ?? maxDurability) + (secondaryStack.durability ?? maxDurability) + Math.ceil(maxDurability * 0.12);
        if (combinedDur > (durability ?? maxDurability)) {
          durability = Math.min(maxDurability, combinedDur);
          xpCost += 2;
          validChange = true;
        }
      }
      // Combine compatible enchants
      if (secondaryStack.enchants) {
        const eligibleIds = new Set(getEligibleEnchantsForItem(primaryStack.itemId, itemRegistry).map((e) => e.id));
        for (const [eid, lvl] of Object.entries(secondaryStack.enchants)) {
          if (!eligibleIds.has(eid)) continue;
          const eDef = ENCHANT_DEFS[eid];
          if (!eDef) continue;
          const cur = enchants[eid] || 0;
          let nextLvl = cur;
          if (cur === lvl && cur < eDef.maxLevel) nextLvl = cur + 1;
          else if (lvl > cur) nextLvl = lvl;
          if (nextLvl > cur) {
            enchants[eid] = nextLvl;
            xpCost += nextLvl * 2;
            validChange = true;
          }
        }
      }
    } else {
      return null; // Incompatible secondary item
    }
  }

  if (renamed) {
    xpCost += 1;
    validChange = true;
  }

  if (!validChange) return null;

  const output = {
    itemId: primaryStack.itemId,
    count: 1,
    ...(maxDurability > 0 ? { durability: durability ?? maxDurability, maxDurability } : {}),
    ...(Object.keys(enchants).length > 0 ? { enchants } : {}),
    ...(trimmedName ? { customName: trimmedName } : primaryStack.customName ? { customName: primaryStack.customName } : {}),
  };

  return { output, xpCost: Math.max(1, Math.min(39, xpCost)) };
}

/**
 * Brewing Stand recipes: ingredient + bottle -> resulting potion itemId.
 */
export const BREWING_RECIPES = Object.freeze([
  { base: 'water_bottle', ingredient: 'nether_wart', result: 'awkward_potion' },
  { base: 'awkward_potion', ingredient: 'apple', result: 'potion_healing' },
  { base: 'awkward_potion', ingredient: 'sugar', result: 'potion_speed' },
  { base: 'awkward_potion', ingredient: 'blaze_powder', result: 'potion_strength' },
  { base: 'awkward_potion', ingredient: 'gold_ingot', result: 'potion_fire_resistance' },
  { base: 'awkward_potion', ingredient: 'glowstone_dust', result: 'potion_night_vision' },
  { base: 'awkward_potion', ingredient: 'flower', result: 'potion_regeneration' },
]);

export function resolveBrewingResult(bottleItemId, ingredientItemId) {
  if (!bottleItemId || !ingredientItemId) return null;
  const match = BREWING_RECIPES.find((r) => r.base === bottleItemId && r.ingredient === ingredientItemId);
  return match ? match.result : null;
}

/**
 * Potion effect definitions when consumed by player.
 */
export const POTION_EFFECTS = Object.freeze({
  potion_healing: { instantHeal: 8, label: 'Instant Health II', color: '#ef4444' },
  potion_speed: { effectId: 'speed', duration: 180, level: 1, label: 'Speed', color: '#38bdf8' },
  potion_strength: { effectId: 'strength', duration: 180, level: 1, label: 'Strength', color: '#ef4444' },
  potion_fire_resistance: { effectId: 'fire_resistance', duration: 180, level: 1, label: 'Fire Resistance', color: '#f97316' },
  potion_night_vision: { effectId: 'night_vision', duration: 180, level: 1, label: 'Night Vision', color: '#818cf8' },
  potion_regeneration: { effectId: 'regeneration', duration: 45, level: 1, label: 'Regeneration', color: '#f472b6' },
});

/**
 * Classic Villager profession trade tables using Emeralds.
 */
export const VILLAGER_TRADES = Object.freeze({
  farmer: {
    title: 'Farmer Villager',
    offers: [
      { id: 'f1', costItem: 'wheat', costCount: 12, resultItem: 'emerald', resultCount: 1, xp: 4 },
      { id: 'f2', costItem: 'apple', costCount: 4, resultItem: 'emerald', resultCount: 1, xp: 4 },
      { id: 'f3', costItem: 'emerald', costCount: 1, resultItem: 'bread', resultCount: 6, xp: 3 },
      { id: 'f4', costItem: 'emerald', costCount: 1, resultItem: 'apple', resultCount: 4, xp: 3 },
      { id: 'f5', costItem: 'emerald', costCount: 2, resultItem: 'cooked_beef', resultCount: 4, xp: 5 },
    ],
  },
  blacksmith: {
    title: 'Armorer & Weaponsmith',
    offers: [
      { id: 'b1', costItem: 'coal', costCount: 12, resultItem: 'emerald', resultCount: 1, xp: 4 },
      { id: 'b2', costItem: 'iron_ingot', costCount: 4, resultItem: 'emerald', resultCount: 1, xp: 5 },
      { id: 'b3', costItem: 'emerald', costCount: 3, resultItem: 'shield', resultCount: 1, xp: 6 },
      { id: 'b4', costItem: 'emerald', costCount: 6, resultItem: 'diamond_pickaxe', resultCount: 1, resultEnchants: { efficiency: 2 }, xp: 10 },
      { id: 'b5', costItem: 'emerald', costCount: 7, resultItem: 'diamond_sword', resultCount: 1, resultEnchants: { sharpness: 2 }, xp: 10 },
      { id: 'b6', costItem: 'emerald', costCount: 8, resultItem: 'diamond_chestplate', resultCount: 1, resultEnchants: { protection: 2 }, xp: 12 },
    ],
  },
  librarian: {
    title: 'Librarian Villager',
    offers: [
      { id: 'l1', costItem: 'paper', costCount: 16, resultItem: 'emerald', resultCount: 1, xp: 4 },
      { id: 'l2', costItem: 'book', costCount: 3, resultItem: 'emerald', resultCount: 1, xp: 5 },
      { id: 'l3', costItem: 'emerald', costCount: 2, resultItem: 'bookshelf', resultCount: 2, xp: 5 },
      { id: 'l4', costItem: 'emerald', costCount: 1, resultItem: 'lapis_lazuli', resultCount: 6, xp: 4 },
      { id: 'l5', costItem: 'emerald', costCount: 3, resultItem: 'ender_pearl', resultCount: 2, xp: 8 },
      { id: 'l6', costItem: 'emerald', costCount: 5, resultItem: 'enchanted_book', resultCount: 1, resultEnchants: { fortune: 2 }, xp: 10 },
      { id: 'l7', costItem: 'emerald', costCount: 5, resultItem: 'enchanted_book', resultCount: 1, resultEnchants: { sharpness: 3 }, xp: 10 },
      { id: 'l8', costItem: 'emerald', costCount: 4, resultItem: 'lantern', resultCount: 4, xp: 4 },
    ],
  },
});

export function executeVillagerTrade(offer, inventory, survivalStats) {
  if (!offer || !inventory) return { ok: false, reason: 'Invalid trade.' };
  if (!inventory.creativeMode && inventory.countOf(offer.costItem) < offer.costCount) {
    return { ok: false, reason: `Need ${offer.costCount}x ${offer.costItem.replace(/_/g, ' ')}` };
  }
  if (!inventory.creativeMode) {
    inventory.consumeItem(offer.costItem, offer.costCount);
  }
  inventory.addItem(offer.resultItem, offer.resultCount, undefined, offer.resultEnchants || undefined);
  survivalStats?.addXp(offer.xp || 4);
  return { ok: true, offer };
}
