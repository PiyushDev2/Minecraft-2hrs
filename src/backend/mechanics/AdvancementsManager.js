/**
 * @file AdvancementsManager.js
 * @description Tracks iconic Minecraft survival & endgame milestones, listens to EventBus,
 * emits toast notifications, grants bonus XP, and persists progress in WorldSave.
 */

import { ENGINE_EVENTS } from '../core/EventBus.js';

export const ADVANCEMENTS = Object.freeze([
  {
    id: 'getting_wood',
    title: 'Getting Wood',
    description: 'Punch a tree until a block of wood pops out',
    category: 'Story',
    iconItem: 'oak_log',
    xpReward: 5,
  },
  {
    id: 'stone_age',
    title: 'Stone Age',
    description: 'Mine stone with your new pickaxe',
    category: 'Story',
    iconItem: 'cobblestone',
    xpReward: 8,
  },
  {
    id: 'acquire_hardware',
    title: 'Acquire Hardware',
    description: 'Smelt or collect an Iron Ingot',
    category: 'Story',
    iconItem: 'iron_ingot',
    xpReward: 12,
  },
  {
    id: 'diamonds',
    title: 'Diamonds!',
    description: 'Acquire diamonds deep underground',
    category: 'Story',
    iconItem: 'diamond',
    xpReward: 20,
  },
  {
    id: 'suit_up',
    title: 'Suit Up',
    description: 'Protect yourself with a piece of armor or a Shield',
    category: 'Combat',
    iconItem: 'shield',
    xpReward: 10,
  },
  {
    id: 'we_need_to_go_deeper',
    title: 'We Need to Go Deeper',
    description: 'Build, light, and enter a Nether Portal',
    category: 'Nether',
    iconItem: 'obsidian',
    xpReward: 25,
  },
  {
    id: 'enchanter',
    title: 'Enchanter',
    description: 'Enchant an item at an Enchanting Table',
    category: 'Magic',
    iconItem: 'enchanting_table',
    xpReward: 18,
  },
  {
    id: 'local_brewery',
    title: 'Local Brewery',
    description: 'Brew a potion in a Brewing Stand',
    category: 'Magic',
    iconItem: 'potion_healing',
    xpReward: 18,
  },
  {
    id: 'eye_spy',
    title: 'Eye Spy',
    description: 'Follow an Eye of Ender toward the Stronghold',
    category: 'The End',
    iconItem: 'eye_of_ender',
    xpReward: 22,
  },
  {
    id: 'the_end',
    title: 'The End?',
    description: 'Enter the End Portal to face the Ender Dragon',
    category: 'The End',
    iconItem: 'end_stone',
    xpReward: 30,
  },
  {
    id: 'free_the_end',
    title: 'Free the End',
    description: 'Defeat the Ender Dragon and claim the Dragon Egg',
    category: 'The End',
    iconItem: 'dragon_egg',
    xpReward: 100,
  },
  {
    id: 'best_friends',
    title: 'Best Friends Forever',
    description: 'Tame a wild Wolf with a Bone',
    category: 'Adventure',
    iconItem: 'bone',
    xpReward: 15,
  },
  {
    id: 'fishy_business',
    title: 'Fishy Business',
    description: 'Catch a fish using a Fishing Rod',
    category: 'Adventure',
    iconItem: 'fishing_rod',
    xpReward: 12,
  },
  {
    id: 'redstone_engineer',
    title: 'Redstone Engineer',
    description: 'Power a Redstone circuit with a Lever, Button, or Torch',
    category: 'Adventure',
    iconItem: 'redstone',
    xpReward: 12,
  },
]);

export class AdvancementsManager {
  constructor({ eventBus = null, onGrantXp = null } = {}) {
    this.eventBus = eventBus;
    this.onGrantXp = onGrantXp;
    /** @type {Map<string, number>} id -> unlockedTimestamp */
    this.unlocked = new Map();
    this._unsubs = [];

    if (eventBus) {
      this._bindEvents(eventBus);
    }
  }

  /** @private */
  _bindEvents(bus) {
    this._unsubs.push(
      bus.on(ENGINE_EVENTS.ITEM_PICKED_UP, ({ itemId }) => this.checkItem(itemId)),
      bus.on(ENGINE_EVENTS.ITEM_CRAFTED, ({ result }) => {
        if (result?.itemId) this.checkItem(result.itemId);
      }),
      bus.on(ENGINE_EVENTS.DIMENSION_CHANGED, ({ dimension }) => {
        if (dimension === 'nether') this.unlock('we_need_to_go_deeper');
        if (dimension === 'end') this.unlock('the_end');
      }),
      bus.on(ENGINE_EVENTS.ENCHANT_APPLIED, () => this.unlock('enchanter')),
      bus.on(ENGINE_EVENTS.POTION_BREWED, () => this.unlock('local_brewery')),
      bus.on(ENGINE_EVENTS.EYE_THROWN, () => this.unlock('eye_spy')),
      bus.on(ENGINE_EVENTS.DRAGON_DEFEATED, () => this.unlock('free_the_end')),
      bus.on(ENGINE_EVENTS.WOLF_TAMED, () => this.unlock('best_friends')),
      bus.on(ENGINE_EVENTS.FISH_CAUGHT, () => this.unlock('fishy_business')),
      bus.on(ENGINE_EVENTS.REDSTONE_UPDATED, () => this.unlock('redstone_engineer')),
      bus.on(ENGINE_EVENTS.SHIELD_BLOCKED, () => this.unlock('suit_up'))
    );
  }

  checkItem(itemId) {
    if (!itemId) return;
    if (itemId === 'oak_log' || itemId === 'spruce_log') this.unlock('getting_wood');
    if (itemId === 'cobblestone' || itemId === 'stone_pickaxe') this.unlock('stone_age');
    if (itemId === 'iron_ingot' || itemId === 'iron_pickaxe') this.unlock('acquire_hardware');
    if (itemId === 'diamond') this.unlock('diamonds');
    if (itemId === 'shield' || itemId.endsWith('_helmet') || itemId.endsWith('_chestplate') || itemId.endsWith('_leggings') || itemId.endsWith('_boots')) {
      this.unlock('suit_up');
    }
    if (itemId === 'eye_of_ender') this.unlock('eye_spy');
  }

  unlock(id) {
    if (this.unlocked.has(id)) return false;
    const def = ADVANCEMENTS.find((a) => a.id === id);
    if (!def) return false;
    const unlockedAt = Date.now();
    this.unlocked.set(id, unlockedAt);
    if (def.xpReward > 0) {
      this.onGrantXp?.(def.xpReward);
    }
    this.eventBus?.emit(ENGINE_EVENTS.ADVANCEMENT_UNLOCKED, { ...def, unlockedAt });
    return true;
  }

  isUnlocked(id) {
    return this.unlocked.has(id);
  }

  getAllStatus() {
    return ADVANCEMENTS.map((def) => ({
      ...def,
      unlocked: this.unlocked.has(def.id),
      unlockedAt: this.unlocked.get(def.id) || null,
    }));
  }

  getAll() {
    return this.getAllStatus();
  }

  reset() {
    this.unlocked.clear();
  }

  exportState() {
    return Object.fromEntries(this.unlocked.entries());
  }

  importState(data) {
    this.unlocked.clear();
    if (!data || typeof data !== 'object') return;
    for (const [id, ts] of Object.entries(data)) {
      if (ADVANCEMENTS.some((a) => a.id === id) && Number.isFinite(ts)) {
        this.unlocked.set(id, ts);
      }
    }
  }

  dispose() {
    for (const u of this._unsubs) u?.();
    this._unsubs = [];
  }
}
