/**
 * @file CraftingSystem.js
 * @description 2x2 hand-crafting and 3x3 Crafting Table recipe engine supporting
 * trimmed shaped patterns, shapeless recipes, and one-click recipe book crafting.
 */

import { itemRegistry as defaultItemRegistry } from './ItemRegistry.js';

/**
 * Built-in complete Minecraft survival & building crafting recipes.
 */
export const CRAFTING_RECIPES = [
  // Basic wood & utility
  {
    id: 'planks_from_oak_log',
    name: 'Oak Planks (from Oak Log)',
    shapeless: true,
    ingredients: [{ itemId: 'oak_log', count: 1 }],
    result: { itemId: 'oak_planks', count: 4 },
  },
  {
    id: 'planks_from_spruce_log',
    name: 'Oak Planks (from Spruce Log)',
    shapeless: true,
    ingredients: [{ itemId: 'spruce_log', count: 1 }],
    result: { itemId: 'oak_planks', count: 4 },
  },
  {
    id: 'sticks_from_planks',
    name: 'Sticks',
    pattern: ['P', 'P'],
    key: { P: 'oak_planks' },
    result: { itemId: 'stick', count: 4 },
  },
  {
    id: 'crafting_table',
    name: 'Crafting Table',
    pattern: ['PP', 'PP'],
    key: { P: 'oak_planks' },
    result: { itemId: 'crafting_table', count: 1 },
  },
  {
    id: 'furnace',
    name: 'Furnace',
    pattern: ['CCC', 'C C', 'CCC'],
    key: { C: 'cobblestone' },
    result: { itemId: 'furnace', count: 1 },
  },
  {
    id: 'chest',
    name: 'Chest',
    pattern: ['PPP', 'P P', 'PPP'],
    key: { P: 'oak_planks' },
    result: { itemId: 'chest', count: 1 },
  },
  {
    id: 'bed_from_wool',
    name: 'Red Bed',
    pattern: ['WWW', 'PPP'],
    key: { W: 'white_wool', P: 'oak_planks' },
    result: { itemId: 'bed', count: 1 },
  },
  {
    id: 'bed',
    name: 'Red Bed (from Wildflowers)',
    pattern: ['FFF', 'PPP'],
    key: { F: 'flower', P: 'oak_planks' },
    result: { itemId: 'bed', count: 1 },
  },
  {
    id: 'bed_from_string',
    name: 'Red Bed (from String)',
    pattern: ['SSS', 'PPP'],
    key: { S: 'string', P: 'oak_planks' },
    result: { itemId: 'bed', count: 1 },
  },
  {
    id: 'flint_and_steel',
    name: 'Flint and Steel',
    shapeless: true,
    ingredients: [
      { itemId: 'iron_ingot', count: 1 },
      { itemId: 'flint', count: 1 },
    ],
    result: { itemId: 'flint_and_steel', count: 1 },
  },
  {
    id: 'shears',
    name: 'Shears',
    pattern: [' I', 'I '],
    key: { I: 'iron_ingot' },
    result: { itemId: 'shears', count: 1 },
  },
  {
    id: 'nether_bricks',
    name: 'Nether Bricks',
    pattern: ['NN', 'NN'],
    key: { N: 'netherrack' },
    result: { itemId: 'nether_bricks', count: 4 },
  },
  {
    id: 'oak_door',
    name: 'Oak Door',
    pattern: ['PP', 'PP', 'PP'],
    key: { P: 'oak_planks' },
    result: { itemId: 'oak_door', count: 3 },
  },
  {
    id: 'ladder',
    name: 'Ladder',
    pattern: ['S S', 'SSS', 'S S'],
    key: { S: 'stick' },
    result: { itemId: 'ladder', count: 3 },
  },
  {
    id: 'tnt',
    name: 'TNT',
    pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: 'gunpowder', S: 'sand' },
    result: { itemId: 'tnt', count: 1 },
  },
  {
    id: 'bucket',
    name: 'Iron Bucket',
    pattern: ['I I', ' I '],
    key: { I: 'iron_ingot' },
    result: { itemId: 'bucket', count: 1 },
  },
  {
    id: 'bread',
    name: 'Bread',
    pattern: ['WWW'],
    key: { W: 'wheat' },
    result: { itemId: 'bread', count: 1 },
  },
  {
    id: 'torches_from_coal',
    name: 'Torches (from Coal)',
    pattern: ['C', 'S'],
    key: { C: 'coal', S: 'stick' },
    result: { itemId: 'torch', count: 4 },
  },
  {
    id: 'torches_from_coal_ore',
    name: 'Torches (from Coal Ore)',
    pattern: ['C', 'S'],
    key: { C: 'coal_ore', S: 'stick' },
    result: { itemId: 'torch', count: 4 },
  },
  {
    id: 'glass_from_sand_coal',
    name: 'Glass',
    shapeless: true,
    ingredients: [
      { itemId: 'sand', count: 2 },
      { itemId: 'coal', count: 1 },
    ],
    result: { itemId: 'glass', count: 2 },
  },
  {
    id: 'bricks_from_cobblestone',
    name: 'Bricks',
    pattern: ['CC', 'CC'],
    key: { C: 'cobblestone' },
    result: { itemId: 'bricks', count: 4 },
  },
  {
    id: 'bricks_from_stone',
    name: 'Bricks (from Stone)',
    pattern: ['SS', 'SS'],
    key: { S: 'stone' },
    result: { itemId: 'bricks', count: 4 },
  },
  {
    id: 'glowstone_lantern',
    name: 'Glowstone',
    shapeless: true,
    ingredients: [
      { itemId: 'glass', count: 1 },
      { itemId: 'torch', count: 4 },
    ],
    result: { itemId: 'glowstone', count: 1 },
  },

  // Combat: Bow & Arrows
  {
    id: 'bow',
    name: 'Bow',
    pattern: [' ST', 'S T', ' ST'],
    key: { S: 'stick', T: 'string' },
    result: { itemId: 'bow', count: 1 },
  },
  {
    id: 'arrow',
    name: 'Arrows',
    pattern: ['F', 'S', 'E'],
    key: { F: 'flint', S: 'stick', E: 'feather' },
    result: { itemId: 'arrow', count: 4 },
  },
  {
    id: 'arrow_from_cobble',
    name: 'Arrows (Stone Tip)',
    pattern: ['C', 'S', 'E'],
    key: { C: 'cobblestone', S: 'stick', E: 'feather' },
    result: { itemId: 'arrow', count: 4 },
  },

  // Wooden Tools
  { id: 'wooden_pickaxe', name: 'Wooden Pickaxe', pattern: ['PPP', ' S ', ' S '], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'wooden_pickaxe', count: 1 } },
  { id: 'wooden_axe', name: 'Wooden Axe', pattern: ['PP', 'PS', ' S'], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'wooden_axe', count: 1 } },
  { id: 'wooden_shovel', name: 'Wooden Shovel', pattern: ['P', 'S', 'S'], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'wooden_shovel', count: 1 } },
  { id: 'wooden_hoe', name: 'Wooden Hoe', pattern: ['PP', ' S', ' S'], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'wooden_hoe', count: 1 } },
  { id: 'wooden_sword', name: 'Wooden Sword', pattern: ['P', 'P', 'S'], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'wooden_sword', count: 1 } },

  // Stone Tools
  { id: 'stone_pickaxe', name: 'Stone Pickaxe', pattern: ['CCC', ' S ', ' S '], key: { C: 'cobblestone', S: 'stick' }, result: { itemId: 'stone_pickaxe', count: 1 } },
  { id: 'stone_axe', name: 'Stone Axe', pattern: ['CC', 'CS', ' S'], key: { C: 'cobblestone', S: 'stick' }, result: { itemId: 'stone_axe', count: 1 } },
  { id: 'stone_shovel', name: 'Stone Shovel', pattern: ['C', 'S', 'S'], key: { C: 'cobblestone', S: 'stick' }, result: { itemId: 'stone_shovel', count: 1 } },
  { id: 'stone_hoe', name: 'Stone Hoe', pattern: ['CC', ' S', ' S'], key: { C: 'cobblestone', S: 'stick' }, result: { itemId: 'stone_hoe', count: 1 } },
  { id: 'stone_sword', name: 'Stone Sword', pattern: ['C', 'C', 'S'], key: { C: 'cobblestone', S: 'stick' }, result: { itemId: 'stone_sword', count: 1 } },

  // Iron Tools (both ingot & legacy iron_ore compatibility)
  { id: 'iron_pickaxe_ingot', name: 'Iron Pickaxe', pattern: ['III', ' S ', ' S '], key: { I: 'iron_ingot', S: 'stick' }, result: { itemId: 'iron_pickaxe', count: 1 } },
  { id: 'iron_pickaxe', name: 'Iron Pickaxe (Raw Ore)', pattern: ['III', ' S ', ' S '], key: { I: 'iron_ore', S: 'stick' }, result: { itemId: 'iron_pickaxe', count: 1 } },
  { id: 'iron_axe', name: 'Iron Axe', pattern: ['II', 'IS', ' S'], key: { I: 'iron_ingot', S: 'stick' }, result: { itemId: 'iron_axe', count: 1 } },
  { id: 'iron_shovel', name: 'Iron Shovel', pattern: ['I', 'S', 'S'], key: { I: 'iron_ingot', S: 'stick' }, result: { itemId: 'iron_shovel', count: 1 } },
  { id: 'iron_hoe', name: 'Iron Hoe', pattern: ['II', ' S', ' S'], key: { I: 'iron_ingot', S: 'stick' }, result: { itemId: 'iron_hoe', count: 1 } },
  { id: 'iron_sword', name: 'Iron Sword', pattern: ['I', 'I', 'S'], key: { I: 'iron_ingot', S: 'stick' }, result: { itemId: 'iron_sword', count: 1 } },

  // Diamond Tools
  { id: 'diamond_pickaxe', name: 'Diamond Pickaxe', pattern: ['DDD', ' S ', ' S '], key: { D: 'diamond', S: 'stick' }, result: { itemId: 'diamond_pickaxe', count: 1 } },
  { id: 'diamond_axe', name: 'Diamond Axe', pattern: ['DD', 'DS', ' S'], key: { D: 'diamond', S: 'stick' }, result: { itemId: 'diamond_axe', count: 1 } },
  { id: 'diamond_shovel', name: 'Diamond Shovel', pattern: ['D', 'S', 'S'], key: { D: 'diamond', S: 'stick' }, result: { itemId: 'diamond_shovel', count: 1 } },
  { id: 'diamond_hoe', name: 'Diamond Hoe', pattern: ['DD', ' S', ' S'], key: { D: 'diamond', S: 'stick' }, result: { itemId: 'diamond_hoe', count: 1 } },
  { id: 'diamond_sword', name: 'Diamond Sword', pattern: ['D', 'D', 'S'], key: { D: 'diamond', S: 'stick' }, result: { itemId: 'diamond_sword', count: 1 } },

  // Leather Armor
  { id: 'leather_helmet', name: 'Leather Cap', pattern: ['LLL', 'L L'], key: { L: 'leather' }, result: { itemId: 'leather_helmet', count: 1 } },
  { id: 'leather_chestplate', name: 'Leather Tunic', pattern: ['L L', 'LLL', 'LLL'], key: { L: 'leather' }, result: { itemId: 'leather_chestplate', count: 1 } },
  { id: 'leather_leggings', name: 'Leather Pants', pattern: ['LLL', 'L L', 'L L'], key: { L: 'leather' }, result: { itemId: 'leather_leggings', count: 1 } },
  { id: 'leather_boots', name: 'Leather Boots', pattern: ['L L', 'L L'], key: { L: 'leather' }, result: { itemId: 'leather_boots', count: 1 } },

  // Iron Armor
  { id: 'iron_helmet', name: 'Iron Helmet', pattern: ['III', 'I I'], key: { I: 'iron_ingot' }, result: { itemId: 'iron_helmet', count: 1 } },
  { id: 'iron_chestplate', name: 'Iron Chestplate', pattern: ['I I', 'III', 'III'], key: { I: 'iron_ingot' }, result: { itemId: 'iron_chestplate', count: 1 } },
  { id: 'iron_leggings', name: 'Iron Leggings', pattern: ['III', 'I I', 'I I'], key: { I: 'iron_ingot' }, result: { itemId: 'iron_leggings', count: 1 } },
  { id: 'iron_boots', name: 'Iron Boots', pattern: ['I I', 'I I'], key: { I: 'iron_ingot' }, result: { itemId: 'iron_boots', count: 1 } },

  // Diamond Armor
  { id: 'diamond_helmet', name: 'Diamond Helmet', pattern: ['DDD', 'D D'], key: { D: 'diamond' }, result: { itemId: 'diamond_helmet', count: 1 } },
  { id: 'diamond_chestplate', name: 'Diamond Chestplate', pattern: ['D D', 'DDD', 'DDD'], key: { D: 'diamond' }, result: { itemId: 'diamond_chestplate', count: 1 } },
  { id: 'diamond_leggings', name: 'Diamond Leggings', pattern: ['DDD', 'D D', 'D D'], key: { D: 'diamond' }, result: { itemId: 'diamond_leggings', count: 1 } },
  { id: 'diamond_boots', name: 'Diamond Boots', pattern: ['D D', 'D D'], key: { D: 'diamond' }, result: { itemId: 'diamond_boots', count: 1 } },

  // Storage Blocks
  { id: 'iron_block', name: 'Block of Iron', pattern: ['III', 'III', 'III'], key: { I: 'iron_ingot' }, result: { itemId: 'iron_block', count: 1 } },
  { id: 'gold_block', name: 'Block of Gold', pattern: ['GGG', 'GGG', 'GGG'], key: { G: 'gold_ingot' }, result: { itemId: 'gold_block', count: 1 } },
  { id: 'diamond_block', name: 'Block of Diamond', pattern: ['DDD', 'DDD', 'DDD'], key: { D: 'diamond' }, result: { itemId: 'diamond_block', count: 1 } },
  { id: 'glowstone_from_dust', name: 'Glowstone (from Dust)', pattern: ['GG', 'GG'], key: { G: 'glowstone_dust' }, result: { itemId: 'glowstone', count: 1 } },
  { id: 'stone_bricks', name: 'Stone Bricks', pattern: ['SS', 'SS'], key: { S: 'stone' }, result: { itemId: 'stone_bricks', count: 4 } },

  // Magic, Enchanting, Brewing & End Progression
  { id: 'paper', name: 'Paper', pattern: ['WWW'], key: { W: 'wheat' }, result: { itemId: 'paper', count: 3 } },
  { id: 'book', name: 'Book', shapeless: true, ingredients: [{ itemId: 'paper', count: 3 }, { itemId: 'leather', count: 1 }], result: { itemId: 'book', count: 1 } },
  { id: 'bookshelf', name: 'Bookshelf', pattern: ['PPP', 'BBB', 'PPP'], key: { P: 'oak_planks', B: 'book' }, result: { itemId: 'bookshelf', count: 1 } },
  { id: 'enchanting_table', name: 'Enchanting Table', pattern: [' B ', 'DOD', 'OOO'], key: { B: 'book', D: 'diamond', O: 'obsidian' }, result: { itemId: 'enchanting_table', count: 1 } },
  { id: 'anvil', name: 'Anvil', pattern: ['BBB', ' I ', 'III'], key: { B: 'iron_block', I: 'iron_ingot' }, result: { itemId: 'anvil', count: 1 } },
  { id: 'anvil_compact', name: 'Anvil (Iron Ingots)', pattern: ['III', ' I ', 'III'], key: { I: 'iron_ingot' }, result: { itemId: 'anvil', count: 1 } },
  { id: 'brewing_stand', name: 'Brewing Stand', pattern: [' B ', 'CCC'], key: { B: 'blaze_rod', C: 'cobblestone' }, result: { itemId: 'brewing_stand', count: 1 } },
  { id: 'blaze_powder', name: 'Blaze Powder', shapeless: true, ingredients: [{ itemId: 'blaze_rod', count: 1 }], result: { itemId: 'blaze_powder', count: 2 } },
  { id: 'eye_of_ender', name: 'Eye of Ender', shapeless: true, ingredients: [{ itemId: 'ender_pearl', count: 1 }, { itemId: 'blaze_powder', count: 1 }], result: { itemId: 'eye_of_ender', count: 1 } },
  { id: 'glass_bottle', name: 'Glass Bottle', pattern: ['G G', ' G '], key: { G: 'glass' }, result: { itemId: 'glass_bottle', count: 3 } },
  { id: 'sugar', name: 'Sugar', shapeless: true, ingredients: [{ itemId: 'apple', count: 1 }], result: { itemId: 'sugar', count: 2 } },

  // Combat, Fishing & Transport
  { id: 'shield', name: 'Shield', pattern: ['PIP', 'PPP', ' P '], key: { P: 'oak_planks', I: 'iron_ingot' }, result: { itemId: 'shield', count: 1 } },
  { id: 'fishing_rod', name: 'Fishing Rod', pattern: ['  S', ' ST', 'S T'], key: { S: 'stick', T: 'string' }, result: { itemId: 'fishing_rod', count: 1 } },
  { id: 'oak_boat', name: 'Oak Boat', pattern: ['P P', 'PPP'], key: { P: 'oak_planks' }, result: { itemId: 'oak_boat', count: 1 } },

  // Redstone Components
  { id: 'redstone_torch', name: 'Redstone Torch', pattern: ['R', 'S'], key: { R: 'redstone', S: 'stick' }, result: { itemId: 'redstone_torch', count: 1 } },
  { id: 'lever', name: 'Lever', pattern: ['S', 'C'], key: { S: 'stick', C: 'cobblestone' }, result: { itemId: 'lever', count: 1 } },
  { id: 'stone_button', name: 'Stone Button', shapeless: true, ingredients: [{ itemId: 'stone', count: 1 }], result: { itemId: 'stone_button', count: 1 } },
  { id: 'pressure_plate', name: 'Oak Pressure Plate', pattern: ['PP'], key: { P: 'oak_planks' }, result: { itemId: 'pressure_plate', count: 1 } },
  { id: 'redstone_lamp', name: 'Redstone Lamp', pattern: [' R ', 'RGR', ' R '], key: { R: 'redstone', G: 'glowstone' }, result: { itemId: 'redstone_lamp', count: 1 } },
  { id: 'piston', name: 'Piston', pattern: ['PPP', 'CIC', 'CRC'], key: { P: 'oak_planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' }, result: { itemId: 'piston', count: 1 } },

  // Architectural & Utility Blocks
  { id: 'oak_stairs', name: 'Oak Stairs', pattern: ['P  ', 'PP ', 'PPP'], key: { P: 'oak_planks' }, result: { itemId: 'oak_stairs', count: 4 } },
  { id: 'cobblestone_stairs', name: 'Cobblestone Stairs', pattern: ['C  ', 'CC ', 'CCC'], key: { C: 'cobblestone' }, result: { itemId: 'cobblestone_stairs', count: 4 } },
  { id: 'oak_slab', name: 'Oak Slab', pattern: ['PPP'], key: { P: 'oak_planks' }, result: { itemId: 'oak_slab', count: 6 } },
  { id: 'stone_slab', name: 'Stone Slab', pattern: ['CCC'], key: { C: 'cobblestone' }, result: { itemId: 'stone_slab', count: 6 } },
  { id: 'oak_fence', name: 'Oak Fence', pattern: ['PSP', 'PSP'], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'oak_fence', count: 3 } },
  { id: 'lantern', name: 'Lantern', pattern: [' I ', 'ITI', ' I '], key: { I: 'iron_ingot', T: 'torch' }, result: { itemId: 'lantern', count: 2 } },
  { id: 'campfire', name: 'Campfire', pattern: [' S ', 'SCS', 'LLL'], key: { S: 'stick', C: 'coal', L: 'oak_log' }, result: { itemId: 'campfire', count: 1 } },
  { id: 'oak_sign', name: 'Oak Sign', pattern: ['PPP', 'PPP', ' S '], key: { P: 'oak_planks', S: 'stick' }, result: { itemId: 'oak_sign', count: 3 } },
];

/**
 * Evaluates 2x2 / 3x3 crafting grids and recipe book availability against player inventory.
 */
export class CraftingSystem {
  constructor(recipes = CRAFTING_RECIPES, itemRegistry = defaultItemRegistry) {
    this.recipes = recipes;
    this.itemRegistry = itemRegistry;
  }

  normalizeGrid(grid, gridSize) {
    let minR = gridSize;
    let maxR = -1;
    let minC = gridSize;
    let maxC = -1;
    const counts = new Map();

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const val = grid[r * gridSize + c] ?? null;
        if (val) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          counts.set(val, (counts.get(val) ?? 0) + 1);
        }
      }
    }

    if (maxR < minR || maxC < minC) return null;

    const width = maxC - minC + 1;
    const height = maxR - minR + 1;
    const cells = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        cells.push(grid[r * gridSize + c] ?? null);
      }
    }
    return { width, height, cells, counts };
  }

  findMatchingRecipe(grid, gridSize = 3) {
    const norm = this.normalizeGrid(grid, gridSize);
    if (!norm) return null;

    for (const recipe of this.recipes) {
      if (recipe.shapeless) {
        if (this._matchesShapeless(norm.counts, recipe.ingredients)) {
          return recipe;
        }
      } else if (recipe.pattern && recipe.key) {
        if (this._matchesShaped(norm, recipe.pattern, recipe.key)) {
          return recipe;
        }
      }
    }
    return null;
  }

  getRecipeCost(recipe) {
    if (recipe.shapeless && recipe.ingredients) {
      return recipe.ingredients.map((i) => ({ itemId: i.itemId, count: i.count }));
    }
    const tally = new Map();
    for (const row of recipe.pattern ?? []) {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch !== ' ' && recipe.key?.[ch]) {
          const itemId = recipe.key[ch];
          tally.set(itemId, (tally.get(itemId) ?? 0) + 1);
        }
      }
    }
    return Array.from(tally.entries()).map(([itemId, count]) => ({ itemId, count }));
  }

  canCraft(recipe, inventory) {
    if (inventory.creativeMode) return true;
    const costs = this.getRecipeCost(recipe);
    return costs.every((c) => inventory.countOf(c.itemId) >= c.count);
  }

  getRecipeBook(inventory, maxGridSize = 3) {
    return this.recipes
      .filter((recipe) => {
        if (recipe.shapeless && recipe.ingredients) {
          const totalItems = recipe.ingredients.reduce((acc, ing) => acc + ing.count, 0);
          return totalItems <= maxGridSize * maxGridSize;
        }
        const h = (recipe.pattern ?? []).length;
        const w = (recipe.pattern ?? []).reduce((m, row) => Math.max(m, row.length), 0);
        return h <= maxGridSize && w <= maxGridSize;
      })
      .map((recipe) => ({
        recipe,
        costs: this.getRecipeCost(recipe),
        craftable: this.canCraft(recipe, inventory),
      }));
  }

  craftFromGrid(grid, gridSize, inventory) {
    const recipe = this.findMatchingRecipe(grid, gridSize);
    if (!recipe || !this.canCraft(recipe, inventory)) {
      return { crafted: false, result: null };
    }
    if (!inventory.creativeMode) {
      for (const cost of this.getRecipeCost(recipe)) {
        inventory.consumeItem(cost.itemId, cost.count);
      }
    }
    inventory.addItem(recipe.result.itemId, recipe.result.count);
    return { crafted: true, result: { ...recipe.result }, recipeId: recipe.id };
  }

  craftById(recipeId, inventory) {
    const recipe = this.recipes.find((r) => r.id === recipeId);
    if (!recipe || !this.canCraft(recipe, inventory)) {
      return { crafted: false, result: null };
    }
    if (!inventory.creativeMode) {
      for (const cost of this.getRecipeCost(recipe)) {
        if (!inventory.consumeItem(cost.itemId, cost.count)) {
          return { crafted: false, result: null };
        }
      }
    }
    inventory.addItem(recipe.result.itemId, recipe.result.count);
    return { crafted: true, result: { ...recipe.result } };
  }

  /**
   * Returns a flat array of length gridSize*gridSize with itemIds placed for a recipe (for Recipe Book auto-fill).
   * @param {string} recipeId
   * @param {number} [gridSize=3]
   * @returns {(string|null)[]|null}
   */
  getGridLayoutForRecipe(recipeId, gridSize = 3) {
    const recipe = this.recipes.find((r) => r.id === recipeId);
    if (!recipe) return null;
    const grid = new Array(gridSize * gridSize).fill(null);
    if (recipe.shapeless && recipe.ingredients) {
      let idx = 0;
      for (const ing of recipe.ingredients) {
        for (let c = 0; c < ing.count; c++) {
          if (idx >= grid.length) return null;
          grid[idx++] = ing.itemId;
        }
      }
      return grid;
    }
    const pattern = recipe.pattern ?? [];
    const patH = pattern.length;
    const patW = pattern.reduce((m, row) => Math.max(m, row.length), 0);
    if (patH > gridSize || patW > gridSize) return null;
    for (let r = 0; r < patH; r++) {
      const row = pattern[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch !== ' ' && recipe.key?.[ch]) {
          grid[r * gridSize + c] = recipe.key[ch];
        }
      }
    }
    return grid;
  }

  /** @private */
  _matchesShapeless(counts, ingredients) {
    if (counts.size !== ingredients.length) return false;
    for (const ing of ingredients) {
      if ((counts.get(ing.itemId) ?? 0) !== ing.count) {
        return false;
      }
    }
    return true;
  }

  /** @private */
  _matchesShaped(norm, pattern, key) {
    const patH = pattern.length;
    const patW = pattern.reduce((m, row) => Math.max(m, row.length), 0);
    if (norm.height !== patH || norm.width !== patW) return false;

    let normalMatch = true;
    let mirroredMatch = true;
    for (let r = 0; r < patH; r++) {
      const row = pattern[r];
      for (let c = 0; c < patW; c++) {
        const sym = c < row.length ? row[c] : ' ';
        const expected = sym === ' ' ? null : (key[sym] ?? null);
        if (norm.cells[r * patW + c] !== expected) normalMatch = false;
        if (norm.cells[r * patW + (patW - 1 - c)] !== expected) mirroredMatch = false;
      }
    }
    return normalMatch || mirroredMatch;
  }
}
