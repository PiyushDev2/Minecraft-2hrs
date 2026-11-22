/**
 * @file BlockEntityManager.js
 * @description Manages coordinate-keyed stateful voxel block entities:
 * Furnaces (fuel burning + ore smelting & meat cooking), 27-slot Chests, and Beds.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { resolveBrewingResult } from '../mechanics/MagicSystem.js';

export const CHEST_SLOTS = 27;
export const FURNACE_COOK_DURATION = 4.5; // seconds per item
export const BREW_DURATION = 4.0; // seconds per brew cycle

export const SMELTING_RECIPES = Object.freeze({
  iron_ore: { outputId: 'iron_ingot', count: 1 },
  gold_ore: { outputId: 'gold_ingot', count: 1 },
  sand: { outputId: 'glass', count: 1 },
  cobblestone: { outputId: 'stone', count: 1 },
  oak_log: { outputId: 'coal', count: 1 },
  spruce_log: { outputId: 'coal', count: 1 },
  raw_beef: { outputId: 'cooked_beef', count: 1 },
  raw_porkchop: { outputId: 'cooked_porkchop', count: 1 },
  raw_chicken: { outputId: 'cooked_chicken', count: 1 },
  raw_cod: { outputId: 'cooked_cod', count: 1 },
  raw_salmon: { outputId: 'cooked_salmon', count: 1 },
});

export const FUEL_VALUES = Object.freeze({
  coal: 40,
  oak_planks: 12,
  oak_log: 15,
  spruce_log: 15,
  stick: 5,
  crafting_table: 12,
  chest: 12,
  lava_bucket: 120,
});

/**
 * Coordinates persistent block entities across loaded/saved worlds.
 */
export class BlockEntityManager {
  /**
   * @param {import('./World.js').World} world
   * @param {import('../inventory/ItemRegistry.js').ItemRegistry} itemRegistry
   */
  constructor(world, itemRegistry) {
    this.world = world;
    this.itemRegistry = itemRegistry;
    /** @type {Map<string, any>} */
    this.entities = new Map();
    /** @type {Set<() => void>} */
    this._listeners = new Set();
    /** @type {number} */
    this._uiEmitAccum = 0;
    /** @type {((payload: { x:number, y:number, z:number, brewed:string[] }) => void)|null} */
    this.onPotionBrewed = null;
  }

  static key(x, y, z) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /** @private */
  _emit() {
    for (const cb of this._listeners) cb();
  }

  clear() {
    this.entities.clear();
    this._emit();
  }

  get(x, y, z) {
    return this.entities.get(BlockEntityManager.key(x, y, z)) ?? null;
  }

  getChest(x, y, z) {
    const ent = this.get(x, y, z);
    return ent && ent.type === 'chest' ? ent : null;
  }

  getFurnace(x, y, z) {
    const ent = this.get(x, y, z);
    return ent && ent.type === 'furnace' ? ent : null;
  }

  getOrCreateFurnace(x, y, z) {
    const k = BlockEntityManager.key(x, y, z);
    let ent = this.entities.get(k);
    if (!ent || ent.type !== 'furnace') {
      ent = {
        type: 'furnace',
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        input: null,
        fuel: null,
        output: null,
        burnTime: 0,
        burnDuration: 0,
        cookProgress: 0,
      };
      this.entities.set(k, ent);
    }
    return ent;
  }

  getOrCreateChest(x, y, z) {
    const k = BlockEntityManager.key(x, y, z);
    let ent = this.entities.get(k);
    if (!ent || ent.type !== 'chest') {
      ent = {
        type: 'chest',
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        slots: new Array(CHEST_SLOTS).fill(null),
      };
      this.entities.set(k, ent);
    }
    return ent;
  }

  getBrewingStand(x, y, z) {
    const ent = this.get(x, y, z);
    return ent && ent.type === 'brewing_stand' ? ent : null;
  }

  getOrCreateBrewingStand(x, y, z) {
    const k = BlockEntityManager.key(x, y, z);
    let ent = this.entities.get(k);
    if (!ent || ent.type !== 'brewing_stand') {
      ent = {
        type: 'brewing_stand',
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        fuel: null,
        fuelCharges: 0,
        ingredient: null,
        bottles: [null, null, null],
        brewProgress: 0,
      };
      this.entities.set(k, ent);
    }
    return ent;
  }

  getSign(x, y, z) {
    const ent = this.get(x, y, z);
    return ent && ent.type === 'sign' ? ent : null;
  }

  getOrCreateSign(x, y, z) {
    const k = BlockEntityManager.key(x, y, z);
    let ent = this.entities.get(k);
    if (!ent || ent.type !== 'sign') {
      ent = {
        type: 'sign',
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        lines: ['', '', '', ''],
      };
      this.entities.set(k, ent);
    }
    return ent;
  }

  setSignLines(x, y, z, lines) {
    const sign = this.getOrCreateSign(x, y, z);
    sign.lines = [0, 1, 2, 3].map((i) => String(lines?.[i] ?? '').slice(0, 22));
    this._emit();
    return sign;
  }

  getAllSigns() {
    const out = [];
    for (const ent of this.entities.values()) {
      if (ent.type === 'sign') out.push(ent);
    }
    return out;
  }

  /**
   * Moves an item from player inventory into Brewing Stand ('fuel', 'ingredient', or bottle index 0..2).
   */
  insertIntoBrewingStand(x, y, z, target, inventory, invIdx) {
    const stand = this.getOrCreateBrewingStand(x, y, z);
    const stack = inventory.getSlot(invIdx);
    if (!stack) return false;

    if (target === 'fuel') {
      if (stack.itemId !== 'blaze_powder') return false;
      if (!stand.fuel) {
        stand.fuel = { itemId: 'blaze_powder', count: stack.count };
        inventory.setSlot(invIdx, null);
      } else {
        const move = Math.min(stack.count, 64 - stand.fuel.count);
        if (move <= 0) return false;
        stand.fuel.count += move;
        inventory.setSlot(invIdx, stack.count - move > 0 ? { ...stack, count: stack.count - move } : null);
      }
      this._emit();
      return true;
    }

    if (target === 'ingredient') {
      const validIng = new Set(['nether_wart', 'apple', 'sugar', 'blaze_powder', 'gold_ingot', 'glowstone_dust', 'flower']);
      if (!validIng.has(stack.itemId)) return false;
      if (!stand.ingredient) {
        stand.ingredient = { itemId: stack.itemId, count: stack.count };
        inventory.setSlot(invIdx, null);
      } else if (stand.ingredient.itemId === stack.itemId && stand.ingredient.count < 64) {
        const move = Math.min(stack.count, 64 - stand.ingredient.count);
        stand.ingredient.count += move;
        inventory.setSlot(invIdx, stack.count - move > 0 ? { ...stack, count: stack.count - move } : null);
      } else {
        return false;
      }
      this._emit();
      return true;
    }

    if (typeof target === 'number' && target >= 0 && target <= 2) {
      const isBottle = stack.itemId === 'water_bottle' || stack.itemId === 'awkward_potion' || stack.itemId.startsWith('potion_');
      if (!isBottle || stand.bottles[target]) return false;
      stand.bottles[target] = { itemId: stack.itemId, count: 1 };
      inventory.setSlot(invIdx, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
      this._emit();
      return true;
    }

    return false;
  }

  extractFromBrewingStand(x, y, z, target, inventory) {
    const stand = this.getOrCreateBrewingStand(x, y, z);
    if (target === 'fuel' && stand.fuel) {
      const res = inventory.addItem(stand.fuel.itemId, stand.fuel.count);
      if (res.added <= 0) return false;
      stand.fuel = res.remainder > 0 ? { itemId: stand.fuel.itemId, count: res.remainder } : null;
      this._emit();
      return true;
    }
    if (target === 'ingredient' && stand.ingredient) {
      const res = inventory.addItem(stand.ingredient.itemId, stand.ingredient.count);
      if (res.added <= 0) return false;
      stand.ingredient = res.remainder > 0 ? { itemId: stand.ingredient.itemId, count: res.remainder } : null;
      this._emit();
      return true;
    }
    if (typeof target === 'number' && target >= 0 && target <= 2 && stand.bottles[target]) {
      const b = stand.bottles[target];
      const res = inventory.addItem(b.itemId, b.count);
      if (res.added <= 0) return false;
      stand.bottles[target] = null;
      this._emit();
      return true;
    }
    return false;
  }

  /**
   * Removes block entity when its voxel is broken and returns any stored items to drop.
   * @returns {Array<{ itemId: string, count: number }>}
   */
  removeAndCollectDrops(x, y, z) {
    const k = BlockEntityManager.key(x, y, z);
    const ent = this.entities.get(k);
    if (!ent) return [];
    this.entities.delete(k);

    const drops = [];
    if (ent.type === 'chest') {
      for (const s of ent.slots) {
        if (s && s.count > 0) drops.push({ itemId: s.itemId, count: s.count });
      }
    } else if (ent.type === 'furnace') {
      if (ent.input?.count > 0) drops.push({ itemId: ent.input.itemId, count: ent.input.count });
      if (ent.fuel?.count > 0) drops.push({ itemId: ent.fuel.itemId, count: ent.fuel.count });
      if (ent.output?.count > 0) drops.push({ itemId: ent.output.itemId, count: ent.output.count });
    } else if (ent.type === 'brewing_stand') {
      if (ent.fuel?.count > 0) drops.push({ itemId: ent.fuel.itemId, count: ent.fuel.count });
      if (ent.ingredient?.count > 0) drops.push({ itemId: ent.ingredient.itemId, count: ent.ingredient.count });
      for (const b of ent.bottles || []) {
        if (b?.count > 0) drops.push({ itemId: b.itemId, count: b.count });
      }
    }
    this._emit();
    return drops;
  }

  /**
   * Moves an item stack from player inventory into a furnace slot ('input' or 'fuel').
   */
  insertIntoFurnace(x, y, z, targetSlot, inventory, invIdx) {
    const furnace = this.getOrCreateFurnace(x, y, z);
    const stack = inventory.getSlot(invIdx);
    if (!stack) return false;

    if (targetSlot === 'input' && !SMELTING_RECIPES[stack.itemId]) return false;
    if (targetSlot === 'fuel' && !FUEL_VALUES[stack.itemId]) return false;

    const current = furnace[targetSlot];
    const maxStack = this.itemRegistry.get(stack.itemId)?.maxStack ?? 64;
    if (!current) {
      furnace[targetSlot] = { itemId: stack.itemId, count: stack.count };
      inventory.setSlot(invIdx, null);
    } else if (current.itemId === stack.itemId && current.count < maxStack) {
      const move = Math.min(stack.count, maxStack - current.count);
      current.count += move;
      const rem = stack.count - move;
      inventory.setSlot(invIdx, rem > 0 ? { ...stack, count: rem } : null);
    } else {
      return false;
    }

    this._emit();
    return true;
  }

  /**
   * Extracts a furnace slot ('input' | 'fuel' | 'output') back into player inventory.
   */
  extractFromFurnace(x, y, z, targetSlot, inventory) {
    const furnace = this.getOrCreateFurnace(x, y, z);
    const stack = furnace[targetSlot];
    if (!stack || stack.count <= 0) return false;

    const res = inventory.addItem(stack.itemId, stack.count);
    if (res.added <= 0) return false;

    if (res.remainder > 0) {
      furnace[targetSlot] = { itemId: stack.itemId, count: res.remainder };
    } else {
      furnace[targetSlot] = null;
    }
    this._emit();
    return true;
  }

  /**
   * Transfers between a Chest slot and Player Inventory.
   */
  transferToChest(x, y, z, inventory, invIdx) {
    const chest = this.getOrCreateChest(x, y, z);
    const stack = inventory.getSlot(invIdx);
    if (!stack) return false;
    const maxStack = this.itemRegistry.get(stack.itemId)?.maxStack ?? 64;
    let remaining = stack.count;

    const hasMeta = Boolean(stack.enchants || stack.customName);
    if (maxStack > 1 && !hasMeta) {
      for (let i = 0; i < CHEST_SLOTS && remaining > 0; i++) {
        const cs = chest.slots[i];
        if (cs && cs.itemId === stack.itemId && !cs.enchants && !cs.customName && cs.count < maxStack) {
          const move = Math.min(remaining, maxStack - cs.count);
          cs.count += move;
          remaining -= move;
        }
      }
    }
    for (let i = 0; i < CHEST_SLOTS && remaining > 0; i++) {
      if (!chest.slots[i]) {
        const move = Math.min(remaining, hasMeta ? 1 : maxStack);
        chest.slots[i] = {
          itemId: stack.itemId,
          count: move,
          ...(stack.maxDurability ? { durability: stack.durability, maxDurability: stack.maxDurability } : {}),
          ...(stack.enchants ? { enchants: { ...stack.enchants } } : {}),
          ...(stack.customName ? { customName: stack.customName } : {}),
        };
        remaining -= move;
      }
    }

    if (remaining === stack.count) return false;
    inventory.setSlot(invIdx, remaining > 0 ? { ...stack, count: remaining } : null);
    this._emit();
    return true;
  }

  transferFromChest(x, y, z, chestSlotIdx, inventory) {
    const chest = this.getOrCreateChest(x, y, z);
    if (chestSlotIdx < 0 || chestSlotIdx >= CHEST_SLOTS) return false;
    const stack = chest.slots[chestSlotIdx];
    if (!stack) return false;

    const res = inventory.addItem(
      stack.itemId,
      stack.count,
      stack.durability,
      stack.enchants,
      stack.customName
    );
    if (res.added <= 0) return false;
    chest.slots[chestSlotIdx] = res.remainder > 0 ? { ...stack, count: res.remainder } : null;
    this._emit();
    return true;
  }

  /**
   * Advances all active Furnaces (fuel burning, smelting progress, lit/unlit block toggle).
   * @param {number} dt
   */
  update(dt) {
    if (dt <= 0 || this.entities.size === 0) return;
    let discreteChange = false;
    let progressTick = false;

    for (const ent of this.entities.values()) {
      if (ent.type === 'brewing_stand') {
        const canBrewAny =
          ent.ingredient &&
          ent.bottles.some((b) => b && resolveBrewingResult(b.itemId, ent.ingredient.itemId));

        // Refill blaze fuel charges (20 brews per blaze powder)
        if (canBrewAny && ent.fuelCharges <= 0 && ent.fuel && ent.fuel.itemId === 'blaze_powder' && ent.fuel.count > 0) {
          ent.fuelCharges = 20;
          ent.fuel.count -= 1;
          if (ent.fuel.count <= 0) ent.fuel = null;
          discreteChange = true;
        }

        if (canBrewAny && ent.fuelCharges > 0) {
          ent.brewProgress += dt;
          if (ent.brewProgress >= BREW_DURATION) {
            ent.brewProgress = 0;
            ent.fuelCharges = Math.max(0, ent.fuelCharges - 1);
            const brewed = [];
            for (let bi = 0; bi < 3; bi++) {
              const b = ent.bottles[bi];
              if (!b) continue;
              const nextId = resolveBrewingResult(b.itemId, ent.ingredient.itemId);
              if (nextId) {
                ent.bottles[bi] = { itemId: nextId, count: 1 };
                brewed.push(nextId);
              }
            }
            ent.ingredient.count -= 1;
            if (ent.ingredient.count <= 0) ent.ingredient = null;
            if (brewed.length > 0) {
              this.onPotionBrewed?.({ x: ent.x, y: ent.y, z: ent.z, brewed });
            }
            discreteChange = true;
          } else {
            progressTick = true;
          }
        } else if (ent.brewProgress > 0) {
          ent.brewProgress = 0;
          discreteChange = true;
        }
        continue;
      }

      if (ent.type !== 'furnace') continue;

      const wasBurning = ent.burnTime > 0;
      const recipe = ent.input ? SMELTING_RECIPES[ent.input.itemId] : null;
      const canAcceptOutput =
        recipe &&
        (!ent.output ||
          (ent.output.itemId === recipe.outputId &&
            ent.output.count + recipe.count <= (this.itemRegistry.get(recipe.outputId)?.maxStack ?? 64)));

      if (ent.burnTime > 0) {
        ent.burnTime = Math.max(0, ent.burnTime - dt);
        progressTick = true;
      }

      // Consume next fuel item if needed to smelt
      if (ent.burnTime <= 0 && canAcceptOutput && ent.fuel && FUEL_VALUES[ent.fuel.itemId]) {
        const fuelSec = FUEL_VALUES[ent.fuel.itemId];
        ent.burnTime = fuelSec;
        ent.burnDuration = fuelSec;
        const wasLavaBucket = ent.fuel.itemId === 'lava_bucket';
        ent.fuel.count -= 1;
        if (ent.fuel.count <= 0) {
          ent.fuel = wasLavaBucket ? { itemId: 'bucket', count: 1 } : null;
        }
        discreteChange = true;
      }

      if (ent.burnTime > 0 && canAcceptOutput) {
        ent.cookProgress += dt;
        if (ent.cookProgress >= FURNACE_COOK_DURATION) {
          ent.cookProgress -= FURNACE_COOK_DURATION;
          ent.input.count -= 1;
          if (ent.input.count <= 0) ent.input = null;

          if (!ent.output) {
            ent.output = { itemId: recipe.outputId, count: recipe.count };
          } else {
            ent.output.count += recipe.count;
          }
          discreteChange = true;
        } else {
          progressTick = true;
        }
      } else if (ent.cookProgress > 0) {
        ent.cookProgress = Math.max(0, ent.cookProgress - dt * 2);
        progressTick = true;
      }

      const isBurning = ent.burnTime > 0;
      if (isBurning !== wasBurning) {
        const curBlock = this.world.getBlock(ent.x, ent.y, ent.z);
        if (isBurning && curBlock === BLOCK_IDS.FURNACE) {
          this.world.setBlock(ent.x, ent.y, ent.z, BLOCK_IDS.FURNACE_LIT, true, true);
        } else if (!isBurning && curBlock === BLOCK_IDS.FURNACE_LIT) {
          this.world.setBlock(ent.x, ent.y, ent.z, BLOCK_IDS.FURNACE, true, true);
        }
        discreteChange = true;
      }
    }

    if (discreteChange) {
      this._uiEmitAccum = 0;
      this._emit();
    } else if (progressTick) {
      this._uiEmitAccum += dt;
      if (this._uiEmitAccum >= 0.2) {
        this._uiEmitAccum = 0;
        this._emit();
      }
    }
  }

  exportState() {
    const out = {};
    for (const [k, ent] of this.entities.entries()) {
      if (ent.type === 'chest') {
        out[k] = {
          type: 'chest',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          slots: ent.slots.map((s) => (s ? { ...s, ...(s.enchants ? { enchants: { ...s.enchants } } : {}) } : null)),
        };
      } else if (ent.type === 'furnace') {
        out[k] = {
          type: 'furnace',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          input: ent.input ? { ...ent.input } : null,
          fuel: ent.fuel ? { ...ent.fuel } : null,
          output: ent.output ? { ...ent.output } : null,
          burnTime: ent.burnTime,
          burnDuration: ent.burnDuration,
          cookProgress: ent.cookProgress,
        };
      } else if (ent.type === 'brewing_stand') {
        out[k] = {
          type: 'brewing_stand',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          fuel: ent.fuel ? { ...ent.fuel } : null,
          fuelCharges: ent.fuelCharges || 0,
          ingredient: ent.ingredient ? { ...ent.ingredient } : null,
          bottles: (ent.bottles || [null, null, null]).map((b) => (b ? { ...b } : null)),
          brewProgress: ent.brewProgress || 0,
        };
      } else if (ent.type === 'sign') {
        out[k] = {
          type: 'sign',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          lines: [...(ent.lines || ['', '', '', ''])],
        };
      }
    }
    return out;
  }

  importState(data) {
    this.entities.clear();
    if (!data || typeof data !== 'object') {
      this._emit();
      return;
    }
    for (const [k, ent] of Object.entries(data)) {
      if (!ent || typeof ent !== 'object') continue;
      if (ent.type === 'chest' && Array.isArray(ent.slots)) {
        const slots = new Array(CHEST_SLOTS).fill(null);
        for (let i = 0; i < Math.min(CHEST_SLOTS, ent.slots.length); i++) {
          if (ent.slots[i]?.itemId && ent.slots[i]?.count > 0) {
            slots[i] = {
              ...ent.slots[i],
              ...(ent.slots[i].enchants ? { enchants: { ...ent.slots[i].enchants } } : {}),
            };
          }
        }
        this.entities.set(k, { type: 'chest', x: ent.x, y: ent.y, z: ent.z, slots });
      } else if (ent.type === 'furnace') {
        this.entities.set(k, {
          type: 'furnace',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          input: ent.input ? { ...ent.input } : null,
          fuel: ent.fuel ? { ...ent.fuel } : null,
          output: ent.output ? { ...ent.output } : null,
          burnTime: Number(ent.burnTime) || 0,
          burnDuration: Number(ent.burnDuration) || 0,
          cookProgress: Number(ent.cookProgress) || 0,
        });
      } else if (ent.type === 'brewing_stand') {
        this.entities.set(k, {
          type: 'brewing_stand',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          fuel: ent.fuel ? { ...ent.fuel } : null,
          fuelCharges: Number(ent.fuelCharges) || 0,
          ingredient: ent.ingredient ? { ...ent.ingredient } : null,
          bottles: [0, 1, 2].map((i) => (ent.bottles?.[i] ? { ...ent.bottles[i] } : null)),
          brewProgress: Number(ent.brewProgress) || 0,
        });
      } else if (ent.type === 'sign') {
        this.entities.set(k, {
          type: 'sign',
          x: ent.x,
          y: ent.y,
          z: ent.z,
          lines: [0, 1, 2, 3].map((i) => String(ent.lines?.[i] ?? '').slice(0, 22)),
        });
      }
    }
    this._emit();
  }
}
