/**
 * @file CraftingSystem.js
 * @description 2x2 hand-crafting and 3x3 Crafting Table recipe engine supporting
 * trimmed shaped patterns, shapeless recipes, and one-click recipe book crafting.
 */

import { itemRegistry as defaultItemRegistry } from './ItemRegistry.js';

/**
 * Built-in survival & building crafting recipes.
 */
export const CRAFTING_RECIPES = [
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
  {
    id: 'wooden_pickaxe',
    name: 'Wooden Pickaxe',
    pattern: ['PPP', ' S ', ' S '],
    key: { P: 'oak_planks', S: 'stick' },
    result: { itemId: 'wooden_pickaxe', count: 1 },
  },
  {
    id: 'stone_pickaxe',
    name: 'Stone Pickaxe',
    pattern: ['CCC', ' S ', ' S '],
    key: { C: 'cobblestone', S: 'stick' },
    result: { itemId: 'stone_pickaxe', count: 1 },
  },
  {
    id: 'iron_pickaxe',
    name: 'Iron Pickaxe',
    pattern: ['III', ' S ', ' S '],
    key: { I: 'iron_ore', S: 'stick' },
    result: { itemId: 'iron_pickaxe', count: 1 },
  },
  {
    id: 'wooden_shovel',
    name: 'Wooden Shovel',
    pattern: ['P', 'S', 'S'],
    key: { P: 'oak_planks', S: 'stick' },
    result: { itemId: 'wooden_shovel', count: 1 },
  },
  {
    id: 'wooden_sword',
    name: 'Wooden Sword',
    pattern: ['P', 'P', 'S'],
    key: { P: 'oak_planks', S: 'stick' },
    result: { itemId: 'wooden_sword', count: 1 },
  },
  {
    id: 'stone_sword',
    name: 'Stone Sword',
    pattern: ['C', 'C', 'S'],
    key: { C: 'cobblestone', S: 'stick' },
    result: { itemId: 'stone_sword', count: 1 },
  },
  {
    id: 'cooked_beef_from_coal',
    name: 'Steak (Cooked Beef)',
    shapeless: true,
    ingredients: [
      { itemId: 'raw_beef', count: 1 },
      { itemId: 'coal', count: 1 },
    ],
    result: { itemId: 'cooked_beef', count: 1 },
  },
];

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   shapeless?: boolean,
 *   ingredients?: Array<{ itemId: string, count: number }>,
 *   pattern?: string[],
 *   key?: Record<string, string>,
 *   result: { itemId: string, count: number }
 * }} CraftingRecipe
 */

/**
 * Resolves 2x2 and 3x3 crafting grid matches and one-click recipe book crafting.
 */
export class CraftingSystem {
  /**
   * @param {CraftingRecipe[]} [recipes=CRAFTING_RECIPES]
   * @param {import('./ItemRegistry.js').ItemRegistry} [itemRegistry]
   */
  constructor(recipes = CRAFTING_RECIPES, itemRegistry = defaultItemRegistry) {
    this.recipes = recipes;
    this.itemRegistry = itemRegistry;
  }

  /**
   * Returns normalized bounding-box trimmed dimensions of a flat crafting grid.
   * @param {Array<string|null>} grid
   * @param {number} gridSize - 2 or 3
   * @returns {{ width: number, height: number, cells: Array<string|null>, counts: Map<string, number> }|null}
   */
  normalizeGrid(grid, gridSize) {
    let minR = gridSize;
    let maxR = -1;
    let minC = gridSize;
    let maxC = -1;
    /** @type {Map<string, number>} */
    const counts = new Map();

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const itemId = grid[r * gridSize + c] ?? null;
        if (itemId) {
          minR = Math.min(minR, r);
          maxR = Math.max(maxR, r);
          minC = Math.min(minC, c);
          maxC = Math.max(maxC, c);
          counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
        }
      }
    }

    if (maxR === -1) return null;

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

  /**
   * Finds the first recipe matching the given crafting grid.
   * @param {Array<string|null>} grid
   * @param {number} [gridSize=3]
   * @returns {CraftingRecipe|null}
   */
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

  /**
   * Returns required ingredient totals for any recipe.
   * @param {CraftingRecipe} recipe
   * @returns {Array<{ itemId: string, count: number }>}
   */
  getRecipeCost(recipe) {
    if (recipe.shapeless && recipe.ingredients) {
      return recipe.ingredients.map((i) => ({ itemId: i.itemId, count: i.count }));
    }
    /** @type {Map<string, number>} */
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

  /**
   * Checks whether an inventory has all ingredients required to craft recipe.
   * @param {CraftingRecipe} recipe
   * @param {import('./Inventory.js').Inventory} inventory
   * @returns {boolean}
   */
  canCraft(recipe, inventory) {
    if (inventory.creativeMode) return true;
    const costs = this.getRecipeCost(recipe);
    return costs.every((c) => inventory.countOf(c.itemId) >= c.count);
  }

  /**
   * Lists all recipes (optionally filtered to 2x2 hand-craftable) with craftability flag.
   * @param {import('./Inventory.js').Inventory} inventory
   * @param {number} [maxGridSize=3]
   * @returns {Array<{ recipe: CraftingRecipe, costs: Array<{ itemId: string, count: number }>, craftable: boolean }>}
   */
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

  /**
   * Crafts from an explicit crafting grid (consumes 1 of each non-empty slot from grid or inventory).
   * @param {Array<string|null>} grid
   * @param {number} gridSize
   * @param {import('./Inventory.js').Inventory} inventory
   * @returns {{ crafted: boolean, result: { itemId: string, count: number }|null, recipeId?: string }}
   */
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

  /**
   * One-click crafts a recipe by ID using ingredients directly from the player's inventory.
   * @param {string} recipeId
   * @param {import('./Inventory.js').Inventory} inventory
   * @returns {{ crafted: boolean, result: { itemId: string, count: number }|null }}
   */
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

    for (let r = 0; r < patH; r++) {
      const row = pattern[r];
      for (let c = 0; c < patW; c++) {
        const sym = c < row.length ? row[c] : ' ';
        const expected = sym === ' ' ? null : (key[sym] ?? null);
        const actual = norm.cells[r * patW + c];
        if (actual !== expected) return false;
      }
    }
    return true;
  }
}
