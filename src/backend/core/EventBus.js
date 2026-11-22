/**
 * @file EventBus.js
 * @description Lightweight decoupled pub/sub event bus for backend-to-backend
 * and backend-to-frontend communication.
 */

/**
 * Standard backend engine event names.
 * @readonly
 * @enum {string}
 */
export const ENGINE_EVENTS = Object.freeze({
  WORLD_GENERATED: 'world:generated',
  WORLD_SAVED: 'world:saved',
  WORLD_LOADED: 'world:loaded',
  BLOCK_CHANGED: 'block:changed',
  TIME_UPDATED: 'world:time_updated',
  CHUNK_READY: 'chunk:ready',
  CHUNK_UNLOADED: 'chunk:unloaded',
  ENGINE_TICK: 'engine:tick',
  ENGINE_FRAME: 'engine:frame',
  INVENTORY_CHANGED: 'inventory:changed',
  ITEM_CRAFTED: 'inventory:crafted',
  ITEM_PICKED_UP: 'inventory:picked_up',
  GAME_MODE_CHANGED: 'world:game_mode_changed',
  PLAYER_DAMAGED: 'survival:player_damaged',
  PLAYER_DIED: 'survival:player_died',
  PLAYER_RESPAWNED: 'survival:player_respawned',
  SURVIVAL_UPDATED: 'survival:updated',
  ENTITY_SPAWNED: 'entity:spawned',
  ENTITY_KILLED: 'entity:killed',
  MP_CONNECTED: 'mp:connected',
  MP_DISCONNECTED: 'mp:disconnected',
  MP_CONNECTION_FAILED: 'mp:connection_failed',
  MP_PLAYER_JOINED: 'mp:player_joined',
  MP_PLAYER_LEFT: 'mp:player_left',
  MP_CHAT: 'mp:chat',
  EXPLOSION: 'world:explosion',
  ARROW_FIRED: 'entity:arrow_fired',
  TNT_PRIMED: 'entity:tnt_primed',
  CREEPER_FUSE: 'entity:creeper_fuse',
  WEATHER_CHANGED: 'world:weather_changed',
  BLOCK_BROKEN: 'world:block_broken',
  BLOCK_PLACED: 'world:block_placed',
  TOOL_BROKEN: 'inventory:tool_broken',
  DOOR_TOGGLED: 'world:door_toggled',
  PLAYER_SLEPT: 'world:player_slept',
  BOW_SHOT: 'entity:bow_shot',
  DIMENSION_CHANGED: 'world:dimension_changed',
  XP_CHANGED: 'survival:xp_changed',
  PORTAL_LIT: 'world:portal_lit',
  ENDERMAN_TELEPORT: 'entity:enderman_teleport',
  SHEEP_SHEARED: 'entity:sheep_sheared',
  ENCHANT_APPLIED: 'magic:enchant_applied',
  POTION_BREWED: 'magic:potion_brewed',
  POTION_DRUNK: 'survival:potion_drunk',
  ADVANCEMENT_UNLOCKED: 'progress:advancement_unlocked',
  VILLAGER_TRADED: 'entity:villager_traded',
  WOLF_TAMED: 'entity:wolf_tamed',
  DRAGON_DEFEATED: 'boss:dragon_defeated',
  END_CRYSTAL_DESTROYED: 'boss:end_crystal_destroyed',
  EYE_THROWN: 'entity:eye_thrown',
  FISH_CAUGHT: 'survival:fish_caught',
  REDSTONE_UPDATED: 'world:redstone_updated',
  SIGN_UPDATED: 'world:sign_updated',
  SHIELD_BLOCKED: 'combat:shield_blocked',
  BOAT_MOUNTED: 'entity:boat_mounted',
});

/**
 * Synchronous publish-subscribe bus with clean unsubscribe handles.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribes a listener to an event channel.
   * @param {string} event
   * @param {(payload: any) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('EventBus listener must be a function.');
    }
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Subscribes a one-shot listener that automatically removes itself after firing once.
   * @param {string} event
   * @param {(payload: any) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  once(event, listener) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Removes a specific listener from an event channel.
   * @param {string} event
   * @param {(payload: any) => void} listener
   */
  off(event, listener) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this._listeners.delete(event);
    }
  }

  /**
   * Emits an event payload to all registered listeners.
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot listeners so unsubscribes inside callbacks are safe
    const snapshot = Array.from(set);
    for (let i = 0; i < snapshot.length; i++) {
      snapshot[i](payload);
    }
  }

  /**
   * Returns active listener count for an event (or total across all events if omitted).
   * @param {string} [event]
   * @returns {number}
   */
  listenerCount(event) {
    if (event !== undefined) {
      return this._listeners.get(event)?.size ?? 0;
    }
    let total = 0;
    for (const set of this._listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Clears listeners for a specific event or all events.
   * @param {string} [event]
   */
  clear(event) {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}
