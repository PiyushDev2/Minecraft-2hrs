/**
 * @file Inventory.js
 * @description 36-slot player inventory (9 hotbar + 27 storage) + 4 armor slots with
 * tool durability tracking, stack splitting, swapping, creative/survival mode support,
 * and backward-compatible save serialization.
 */

import { ARMOR_SLOTS, itemRegistry as defaultItemRegistry } from './ItemRegistry.js';

export const HOTBAR_SIZE = 9;
export const BACKPACK_SIZE = 27;
export const INVENTORY_SIZE = HOTBAR_SIZE + BACKPACK_SIZE; // 36
export const ARMOR_SIZE = 4;

/**
 * Player inventory & armor state container with event notifications.
 */
export class Inventory {
  constructor({ itemRegistry = defaultItemRegistry, creativeMode = true } = {}) {
    this.itemRegistry = itemRegistry;
    /** @type {boolean} */
    this.creativeMode = Boolean(creativeMode);
    /** @type {number} */
    this.selectedSlot = 0;
    /** @type {Array<{ itemId: string, count: number, durability?: number, maxDurability?: number }|null>} */
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    /** @type {Array<{ itemId: string, count: number, durability?: number, maxDurability?: number }|null>} */
    this.armor = new Array(ARMOR_SIZE).fill(null);
    /** @type {Set<() => void>} */
    this._listeners = new Set();

    this.loadStarterKit();
  }

  /** @private */
  _makeStack(itemId, count, durability = undefined, enchants = undefined, customName = undefined) {
    const def = this.itemRegistry.get(itemId);
    const maxStack = def?.maxStack ?? 64;
    const stack = {
      itemId,
      count: Math.min(maxStack, Math.max(1, count | 0)),
    };
    if (def?.maxDurability && def.maxDurability > 0) {
      stack.maxDurability = def.maxDurability;
      stack.durability =
        Number.isFinite(durability)
          ? Math.max(1, Math.min(def.maxDurability, durability | 0))
          : def.maxDurability;
    }
    if (enchants && typeof enchants === 'object' && Object.keys(enchants).length > 0) {
      stack.enchants = { ...enchants };
    }
    if (typeof customName === 'string' && customName.trim().length > 0) {
      stack.customName = customName.trim().slice(0, 32);
    }
    return stack;
  }

  /** @private */
  _cloneStack(s) {
    if (!s) return null;
    return {
      ...s,
      ...(s.enchants ? { enchants: { ...s.enchants } } : {}),
    };
  }

  /**
   * Populates a balanced hotbar starter kit for immediate playability.
   */
  loadStarterKit() {
    this.slots.fill(null);
    this.armor.fill(null);
    const starter = [
      { itemId: 'grass', count: 64 },
      { itemId: 'dirt', count: 64 },
      { itemId: 'stone', count: 64 },
      { itemId: 'oak_planks', count: 32 },
      { itemId: 'oak_log', count: 16 },
      { itemId: 'cobblestone', count: 32 },
      { itemId: 'glass', count: 16 },
      { itemId: 'torch', count: 32 },
      { itemId: 'water_bucket', count: 1 },
      { itemId: 'wooden_sword', count: 1 },
      { itemId: 'wooden_pickaxe', count: 1 },
      { itemId: 'apple', count: 4 },
    ];
    for (let i = 0; i < starter.length && i < INVENTORY_SIZE; i++) {
      this.slots[i] = this._makeStack(starter[i].itemId, starter[i].count);
    }
    this._emit();
  }

  onChange(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /** @private */
  _emit() {
    for (const cb of this._listeners) {
      cb();
    }
  }

  setSelectedSlot(index) {
    const clamped = Math.max(0, Math.min(HOTBAR_SIZE - 1, index | 0));
    if (this.selectedSlot !== clamped) {
      this.selectedSlot = clamped;
      this._emit();
    }
  }

  getSlot(index) {
    if (index < 0 || index >= INVENTORY_SIZE) return null;
    return this._cloneStack(this.slots[index]);
  }

  setSlot(index, stack) {
    if (index < 0 || index >= INVENTORY_SIZE) return;
    if (!stack || stack.count <= 0) {
      this.slots[index] = null;
    } else {
      this.slots[index] = this._makeStack(
        stack.itemId,
        stack.count,
        stack.durability,
        stack.enchants,
        stack.customName
      );
    }
    this._emit();
  }

  getSelectedStack() {
    return this.getSlot(this.selectedSlot);
  }

  getArmorSlot(armorIdx) {
    if (armorIdx < 0 || armorIdx >= ARMOR_SIZE) return null;
    return this._cloneStack(this.armor[armorIdx]);
  }

  /**
   * Returns equipped armor itemIds array [helmet, chestplate, leggings, boots] (or null).
   */
  getArmorIds() {
    return this.armor.map((s) => (s ? s.itemId : null));
  }

  /**
   * Returns true if player has a shield in hotbar or selected slot.
   */
  hasShield() {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.itemId === 'shield') return true;
    }
    return false;
  }

  /**
   * Computes total worn armor defense points (0..20).
   */
  getArmorPoints() {
    let total = 0;
    for (let i = 0; i < ARMOR_SIZE; i++) {
      const s = this.armor[i];
      if (!s) continue;
      const def = this.itemRegistry.get(s.itemId);
      if (def?.armorPoints) total += def.armorPoints;
    }
    return Math.min(20, total);
  }

  /**
   * Sums Protection enchantment levels across all worn armor pieces.
   */
  getProtectionBonus() {
    let total = 0;
    for (let i = 0; i < ARMOR_SIZE; i++) {
      const s = this.armor[i];
      if (s?.enchants?.protection) {
        total += s.enchants.protection;
      }
    }
    return Math.min(16, total);
  }

  /**
   * Equips an armor piece from inventory slot into its matching armor slot.
   */
  equipArmorFromSlot(invIdx) {
    const stack = this.slots[invIdx];
    if (!stack) return false;
    const def = this.itemRegistry.get(stack.itemId);
    if (!def?.armorSlot) return false;
    const armorIdx = ARMOR_SLOTS.indexOf(def.armorSlot);
    if (armorIdx < 0) return false;

    const prevArmor = this.armor[armorIdx];
    this.armor[armorIdx] = stack;
    this.slots[invIdx] = prevArmor || null;
    this._emit();
    return true;
  }

  /**
   * Moves an equipped armor piece back into the first free inventory slot.
   */
  unequipArmor(armorIdx) {
    if (armorIdx < 0 || armorIdx >= ARMOR_SIZE) return false;
    const piece = this.armor[armorIdx];
    if (!piece) return false;
    const emptyIdx = this.slots.findIndex((s) => !s);
    if (emptyIdx === -1) return false;
    this.slots[emptyIdx] = piece;
    this.armor[armorIdx] = null;
    this._emit();
    return true;
  }

  /**
   * Reduces durability of worn armor pieces when player absorbs damage in Survival.
   */
  damageArmor(amount = 1) {
    if (this.creativeMode || amount <= 0) return;
    let changed = false;
    for (let i = 0; i < ARMOR_SIZE; i++) {
      const s = this.armor[i];
      if (!s || !s.maxDurability) continue;
      const unbreaking = s.enchants?.unbreaking || 0;
      if (unbreaking > 0 && Math.random() > 1 / (unbreaking + 1)) continue;
      s.durability = (s.durability ?? s.maxDurability) - amount;
      if (s.durability <= 0) {
        this.armor[i] = null;
      }
      changed = true;
    }
    if (changed) this._emit();
  }

  /**
   * Reduces durability of the selected tool/weapon by amount in Survival mode.
   * Honors Unbreaking enchantment. Returns { damaged, broken, remaining, itemId }.
   */
  damageSelectedTool(amount = 1) {
    if (this.creativeMode || amount <= 0) return { damaged: false, broken: false, remaining: 0, itemId: null };
    const slot = this.slots[this.selectedSlot];
    if (!slot || !slot.maxDurability) return { damaged: false, broken: false, remaining: 0, itemId: null };

    const unbreaking = slot.enchants?.unbreaking || 0;
    if (unbreaking > 0 && Math.random() > 1 / (unbreaking + 1)) {
      return { damaged: false, broken: false, remaining: slot.durability ?? slot.maxDurability, itemId: slot.itemId };
    }

    const itemId = slot.itemId;
    slot.durability = (slot.durability ?? slot.maxDurability) - amount;
    let broken = false;
    let remaining = slot.durability;
    if (slot.durability <= 0) {
      this.slots[this.selectedSlot] = null;
      broken = true;
      remaining = 0;
    }
    this._emit();
    return { damaged: true, broken, remaining, itemId };
  }

  /**
   * Reduces durability of the first Shield found in hotbar/selected slot.
   */
  damageShield(amount = 1) {
    if (this.creativeMode || amount <= 0) return false;
    let idx = this.slots[this.selectedSlot]?.itemId === 'shield' ? this.selectedSlot : -1;
    if (idx === -1) {
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        if (this.slots[i]?.itemId === 'shield') {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1) return false;
    const slot = this.slots[idx];
    const unbreaking = slot.enchants?.unbreaking || 0;
    if (unbreaking > 0 && Math.random() > 1 / (unbreaking + 1)) return true;
    slot.durability = (slot.durability ?? slot.maxDurability) - amount;
    if (slot.durability <= 0) {
      this.slots[idx] = null;
    }
    this._emit();
    return true;
  }

  addItem(itemId, count = 1, durability = undefined, enchants = undefined, customName = undefined) {
    const def = this.itemRegistry.get(itemId);
    if (!def || count <= 0) {
      return { added: 0, remainder: Math.max(0, count | 0) };
    }

    const hasMeta = Boolean((enchants && Object.keys(enchants).length > 0) || customName);
    const maxStack = hasMeta ? 1 : def.maxStack;
    let remaining = count | 0;

    if (maxStack > 1 && !hasMeta) {
      for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.itemId === itemId && !slot.enchants && !slot.customName && slot.count < maxStack) {
          const space = maxStack - slot.count;
          const delta = Math.min(space, remaining);
          slot.count += delta;
          remaining -= delta;
        }
      }
    }

    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const delta = Math.min(maxStack, remaining);
        this.slots[i] = this._makeStack(itemId, delta, durability, enchants, customName);
        remaining -= delta;
      }
    }

    const added = (count | 0) - remaining;
    if (added > 0) {
      this._emit();
    }
    return { added, remainder: remaining };
  }

  countOf(itemId) {
    let total = 0;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = this.slots[i];
      if (slot && slot.itemId === itemId) {
        total += slot.count;
      }
    }
    return total;
  }

  countItem(itemId) {
    return this.countOf(itemId);
  }

  removeItem(itemId, count = 1) {
    return this.consumeItem(itemId, count);
  }

  swapSlots(fromIdx, toIdx) {
    return this.moveOrSwap(fromIdx, toIdx);
  }

  consumeItem(itemId, count = 1) {
    const needed = count | 0;
    if (needed <= 0) return true;
    if (this.countOf(itemId) < needed) return false;

    let remaining = needed;
    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.itemId !== itemId) continue;
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
      if (slot.count <= 0) {
        this.slots[i] = null;
      }
    }

    this._emit();
    return true;
  }

  consumeSelected(count = 1) {
    const slot = this.slots[this.selectedSlot];
    if (!slot) return false;
    if (this.creativeMode) return true;
    if (slot.count < count) return false;

    slot.count -= count;
    if (slot.count <= 0) {
      this.slots[this.selectedSlot] = null;
    }
    this._emit();
    return true;
  }

  moveOrSwap(fromIdx, toIdx) {
    if (
      fromIdx === toIdx ||
      fromIdx < 0 ||
      fromIdx >= INVENTORY_SIZE ||
      toIdx < 0 ||
      toIdx >= INVENTORY_SIZE
    ) {
      return false;
    }

    const from = this.slots[fromIdx];
    if (!from) return false;
    const to = this.slots[toIdx];

    if (!to) {
      this.slots[toIdx] = from;
      this.slots[fromIdx] = null;
    } else if (to.itemId === from.itemId && (this.itemRegistry.get(to.itemId)?.maxStack ?? 64) > 1) {
      const maxStack = this.itemRegistry.get(to.itemId)?.maxStack ?? 64;
      const space = maxStack - to.count;
      if (space <= 0) return false;
      const moved = Math.min(space, from.count);
      to.count += moved;
      from.count -= moved;
      if (from.count <= 0) {
        this.slots[fromIdx] = null;
      }
    } else {
      this.slots[toIdx] = from;
      this.slots[fromIdx] = to;
    }

    this._emit();
    return true;
  }

  /**
   * Splits half of stack at fromIdx into an empty or matching toIdx slot.
   */
  splitHalf(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= INVENTORY_SIZE || toIdx < 0 || toIdx >= INVENTORY_SIZE) {
      return false;
    }
    const from = this.slots[fromIdx];
    if (!from || from.count < 2) return false;
    const half = Math.ceil(from.count / 2);
    const to = this.slots[toIdx];
    if (!to) {
      this.slots[toIdx] = this._makeStack(from.itemId, half, from.durability);
      from.count -= half;
      this._emit();
      return true;
    }
    if (to.itemId === from.itemId) {
      const maxStack = this.itemRegistry.get(to.itemId)?.maxStack ?? 64;
      const move = Math.min(half, maxStack - to.count);
      if (move <= 0) return false;
      to.count += move;
      from.count -= move;
      if (from.count <= 0) this.slots[fromIdx] = null;
      this._emit();
      return true;
    }
    return false;
  }

  equipInSelectedSlot(itemId, count = 64) {
    const def = this.itemRegistry.get(itemId);
    if (!def) return false;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.itemId === itemId) {
        this.setSelectedSlot(i);
        return true;
      }
    }
    this.setSlot(this.selectedSlot, { itemId, count: Math.min(def.maxStack, count) });
    return true;
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this._emit();
  }

  exportState() {
    const serializeStack = (s) =>
      s
        ? {
            itemId: s.itemId,
            count: s.count,
            ...(s.maxDurability ? { durability: s.durability, maxDurability: s.maxDurability } : {}),
            ...(s.enchants ? { enchants: { ...s.enchants } } : {}),
            ...(s.customName ? { customName: s.customName } : {}),
          }
        : null;
    return {
      creativeMode: this.creativeMode,
      selectedSlot: this.selectedSlot,
      slots: this.slots.map(serializeStack),
      armor: this.armor.map(serializeStack),
    };
  }

  importState(state) {
    if (!state || typeof state !== 'object') return;
    if (typeof state.creativeMode === 'boolean') {
      this.creativeMode = state.creativeMode;
    }
    if (typeof state.selectedSlot === 'number') {
      this.selectedSlot = Math.max(0, Math.min(HOTBAR_SIZE - 1, state.selectedSlot | 0));
    }
    if (Array.isArray(state.slots)) {
      this.slots.fill(null);
      for (let i = 0; i < Math.min(INVENTORY_SIZE, state.slots.length); i++) {
        const s = state.slots[i];
        if (s && typeof s.itemId === 'string' && s.count > 0 && this.itemRegistry.get(s.itemId)) {
          this.slots[i] = this._makeStack(s.itemId, s.count, s.durability, s.enchants, s.customName);
        }
      }
    }
    this.armor.fill(null);
    if (Array.isArray(state.armor)) {
      for (let i = 0; i < Math.min(ARMOR_SIZE, state.armor.length); i++) {
        const s = state.armor[i];
        if (s && typeof s.itemId === 'string' && s.count > 0 && this.itemRegistry.get(s.itemId)) {
          this.armor[i] = this._makeStack(s.itemId, s.count, s.durability, s.enchants, s.customName);
        }
      }
    }
    this._emit();
  }
}
