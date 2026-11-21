/**
 * @file Inventory.js
 * @description 36-slot player inventory (9 hotbar + 27 storage) with stack merging,
 * slot swapping, creative/survival mode support, and compact save serialization.
 */

import { itemRegistry as defaultItemRegistry } from './ItemRegistry.js';

export const HOTBAR_SIZE = 9;
export const BACKPACK_SIZE = 27;
export const INVENTORY_SIZE = HOTBAR_SIZE + BACKPACK_SIZE; // 36

/**
 * Player inventory state container with event notifications.
 */
export class Inventory {
  /**
   * @param {Object} [options]
   * @param {import('./ItemRegistry.js').ItemRegistry} [options.itemRegistry]
   * @param {boolean} [options.creativeMode=true]
   */
  constructor({ itemRegistry = defaultItemRegistry, creativeMode = true } = {}) {
    this.itemRegistry = itemRegistry;
    /** @type {boolean} */
    this.creativeMode = Boolean(creativeMode);
    /** @type {number} */
    this.selectedSlot = 0;
    /** @type {Array<{ itemId: string, count: number }|null>} */
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    /** @type {Set<() => void>} */
    this._listeners = new Set();

    this.loadStarterKit();
  }

  /**
   * Populates a balanced hotbar starter kit for immediate playability.
   */
  loadStarterKit() {
    this.slots.fill(null);
    const starter = [
      { itemId: 'grass', count: 64 },
      { itemId: 'dirt', count: 64 },
      { itemId: 'stone', count: 64 },
      { itemId: 'oak_planks', count: 32 },
      { itemId: 'oak_log', count: 16 },
      { itemId: 'cobblestone', count: 32 },
      { itemId: 'glass', count: 16 },
      { itemId: 'torch', count: 32 },
      { itemId: 'water', count: 4 },
      { itemId: 'wooden_sword', count: 1 },
      { itemId: 'apple', count: 4 },
    ];
    for (let i = 0; i < starter.length && i < INVENTORY_SIZE; i++) {
      this.slots[i] = { ...starter[i] };
    }
    this._emit();
  }

  /**
   * Subscribes to inventory state changes.
   * @param {() => void} callback
   * @returns {() => void}
   */
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

  /**
   * Sets active hotbar slot [0..8].
   * @param {number} index
   */
  setSelectedSlot(index) {
    const clamped = Math.max(0, Math.min(HOTBAR_SIZE - 1, index | 0));
    if (this.selectedSlot !== clamped) {
      this.selectedSlot = clamped;
      this._emit();
    }
  }

  /**
   * Returns copy of stack at slot index, or null.
   * @param {number} index
   * @returns {{ itemId: string, count: number }|null}
   */
  getSlot(index) {
    if (index < 0 || index >= INVENTORY_SIZE) return null;
    const s = this.slots[index];
    return s ? { itemId: s.itemId, count: s.count } : null;
  }

  /**
   * Sets stack at slot index cleanly.
   * @param {number} index
   * @param {{ itemId: string, count: number }|null} stack
   */
  setSlot(index, stack) {
    if (index < 0 || index >= INVENTORY_SIZE) return;
    if (!stack || stack.count <= 0) {
      this.slots[index] = null;
    } else {
      const def = this.itemRegistry.get(stack.itemId);
      const maxStack = def?.maxStack ?? 64;
      this.slots[index] = {
        itemId: stack.itemId,
        count: Math.min(maxStack, Math.max(1, stack.count | 0)),
      };
    }
    this._emit();
  }

  /**
   * Returns currently held hotbar stack, or null.
   * @returns {{ itemId: string, count: number }|null}
   */
  getSelectedStack() {
    return this.getSlot(this.selectedSlot);
  }

  /**
   * Adds item count to inventory, merging into existing stacks first, then empty slots.
   * @param {string} itemId
   * @param {number} [count=1]
   * @returns {{ added: number, remainder: number }}
   */
  addItem(itemId, count = 1) {
    const def = this.itemRegistry.get(itemId);
    if (!def || count <= 0) {
      return { added: 0, remainder: Math.max(0, count | 0) };
    }

    const maxStack = def.maxStack;
    let remaining = count | 0;

    // 1. Merge into matching stacks (hotbar first, then backpack)
    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot && slot.itemId === itemId && slot.count < maxStack) {
        const space = maxStack - slot.count;
        const delta = Math.min(space, remaining);
        slot.count += delta;
        remaining -= delta;
      }
    }

    // 2. Fill empty slots
    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const delta = Math.min(maxStack, remaining);
        this.slots[i] = { itemId, count: delta };
        remaining -= delta;
      }
    }

    const added = (count | 0) - remaining;
    if (added > 0) {
      this._emit();
    }
    return { added, remainder: remaining };
  }

  /**
   * Returns total count of an item across all 36 slots.
   * @param {string} itemId
   * @returns {number}
   */
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

  /**
   * Consumes count units of itemId across slots (does not modify unless full amount is available).
   * @param {string} itemId
   * @param {number} [count=1]
   * @returns {boolean}
   */
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

  /**
   * Consumes count units from the currently selected hotbar slot (no-op in creative mode).
   * @param {number} [count=1]
   * @returns {boolean}
   */
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

  /**
   * Moves or merges stack from fromIdx to toIdx, swapping if different item types.
   * @param {number} fromIdx
   * @param {number} toIdx
   * @returns {boolean}
   */
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
    } else if (to.itemId === from.itemId) {
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
   * Sets or equips an item into the currently selected hotbar slot (helpful for Creative catalog picks).
   * @param {string} itemId
   * @param {number} [count=64]
   */
  equipInSelectedSlot(itemId, count = 64) {
    const def = this.itemRegistry.get(itemId);
    if (!def) return false;
    // If already present on hotbar (0..8), switch selection to it
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.itemId === itemId) {
        this.setSelectedSlot(i);
        return true;
      }
    }
    this.setSlot(this.selectedSlot, { itemId, count: Math.min(def.maxStack, count) });
    return true;
  }

  /**
   * Serializes inventory slots and selected hotbar slot.
   * @returns {{ creativeMode: boolean, selectedSlot: number, slots: Array<{ itemId: string, count: number }|null> }}
   */
  exportState() {
    return {
      creativeMode: this.creativeMode,
      selectedSlot: this.selectedSlot,
      slots: this.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null)),
    };
  }

  /**
   * Restores inventory state from a save payload.
   * @param {{ creativeMode?: boolean, selectedSlot?: number, slots?: Array<{ itemId: string, count: number }|null> }} state
   */
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
          const maxStack = this.itemRegistry.get(s.itemId)?.maxStack ?? 64;
          this.slots[i] = { itemId: s.itemId, count: Math.min(maxStack, s.count | 0) };
        }
      }
    }
    this._emit();
  }
}
