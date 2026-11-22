/**
 * @file WorldSave.js
 * @description Compact world persistence using seed + sparse chunk modification deltas.
 * Supports browser localStorage slots as well as portable JSON export/import.
 */

import { IndexedDBSave } from './IndexedDBSave.js';

const SAVE_PREFIX = 'voxelcraft_save_v1_';
const SAVE_FORMAT_VERSION = 1;

/**
 * Handles serialization, localStorage persistence, and restoration of world & player state.
 */
export class WorldSave {
  /**
   * Serializes world seed, player state, world time, inventory, and modified block deltas into a plain object.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player} [player]
   * @param {string} [name='default']
   * @param {{ gameMode?: string, inventory?: any, survival?: any }} [extra]
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, timeOfDay: number, viewDistance: number, totalModifiedBlocks: number, gameMode?: string, inventory?: any, survival?: any, player: any, modifications: Record<string, Array<[number, number] | [number, number, number]>> }}
   */
  static serialize(world, player = null, name = 'default', extra = undefined) {
    const dimMods = world.exportAllDimensionModifications
      ? world.exportAllDimensionModifications()
      : { overworld: world.chunkManager.exportAllModifications(), nether: {}, end: {} };
    const modifications = world.chunkManager.exportAllModifications();
    let totalModifiedBlocks = 0;
    for (const list of Object.values(dimMods.overworld || {})) {
      totalModifiedBlocks += list.length;
    }
    for (const list of Object.values(dimMods.nether || {})) {
      totalModifiedBlocks += list.length;
    }
    for (const list of Object.values(dimMods.end || {})) {
      totalModifiedBlocks += list.length;
    }

    return {
      version: SAVE_FORMAT_VERSION,
      name,
      savedAt: new Date().toISOString(),
      seed: world.seed,
      dimension: world.dimension ?? 'overworld',
      worldTime: world.worldTime,
      timeOfDay: world.timeOfDay,
      viewDistance: world.viewDistance,
      totalModifiedBlocks,
      ...(extra?.gameMode ? { gameMode: extra.gameMode } : {}),
      ...(extra?.inventory ? { inventory: extra.inventory } : {}),
      ...(extra?.survival ? { survival: extra.survival } : {}),
      ...(extra?.blockEntities ? { blockEntities: extra.blockEntities } : {}),
      ...(extra?.overworldBlockEntities ? { overworldBlockEntities: extra.overworldBlockEntities } : {}),
      ...(extra?.netherBlockEntities ? { netherBlockEntities: extra.netherBlockEntities } : {}),
      ...(extra?.endBlockEntities ? { endBlockEntities: extra.endBlockEntities } : {}),
      ...(extra?.advancements ? { advancements: extra.advancements } : {}),
      ...(typeof extra?.dragonDefeated === 'boolean' ? { dragonDefeated: extra.dragonDefeated } : {}),
      ...(extra?.spawnPoint ? { spawnPoint: extra.spawnPoint } : {}),
      ...(extra?.weather ? { weather: extra.weather } : {}),
      player: player
        ? {
            position: player.getPosition(),
            rotation: player.getRotation(),
            flyMode: player.flyMode,
          }
        : null,
      modifications,
      overworldModifications: dimMods.overworld,
      netherModifications: dimMods.nether,
      endModifications: dimMods.end || {},
    };
  }

  /**
   * Exports serialized world data as a JSON string.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player} [player]
   * @param {string} [name='default']
   * @param {{ gameMode?: string, inventory?: any, survival?: any }} [extra]
   * @returns {string}
   */
  static exportJSON(world, player = null, name = 'default', extra = undefined) {
    return JSON.stringify(WorldSave.serialize(world, player, name, extra));
  }

  /**
   * Parses and validates a JSON save string.
   * @param {string} jsonString
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, timeOfDay: number, viewDistance: number, totalModifiedBlocks: number, player: any, modifications: Record<string, Array<[number, number] | [number, number, number]>> }}
   */
  static parseJSON(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object' || typeof data.seed !== 'number') {
      throw new Error('Invalid world save format: missing seed.');
    }
    return data;
  }

  /**
   * Applies parsed save data onto a World (and optional Player), regenerating terrain and edits.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player|null} player
   * @param {any} saveData
   */
  static apply(world, player, saveData) {
    const spawnCenter = saveData.player?.position
      ? { x: saveData.player.position.x, z: saveData.player.position.z }
      : { x: 8, z: 8 };
    const savedDimension =
      saveData.dimension === 'nether' ? 'nether' : saveData.dimension === 'end' ? 'end' : 'overworld';

    if (typeof saveData.viewDistance === 'number') {
      world.setViewDistance(saveData.viewDistance);
    }

    // Regenerate world cleanly with saved seed & dimension (without meshing before applying mods)
    world.generate(saveData.seed, {
      spawnCenter,
      pregenerateRadius: -1,
      dimension: savedDimension,
    });
    world.worldTime = Number.isFinite(saveData.worldTime) ? saveData.worldTime : 0;
    if (Number.isFinite(saveData.timeOfDay)) {
      world.setTimeOfDay(saveData.timeOfDay);
    }

    if (
      world.importAllDimensionModifications &&
      (saveData.overworldModifications || saveData.netherModifications || saveData.endModifications)
    ) {
      world.importAllDimensionModifications(
        saveData.overworldModifications ?? (savedDimension === 'overworld' ? saveData.modifications : {}),
        saveData.netherModifications ?? (savedDimension === 'nether' ? saveData.modifications : {}),
        saveData.endModifications ?? (savedDimension === 'end' ? saveData.modifications : {})
      );
    } else if (saveData.modifications) {
      world.chunkManager.importModifications(saveData.modifications);
    }

    // Pre-generate spawn area with modifications already applied
    world.chunkManager.pregenerateAround(spawnCenter.x, spawnCenter.z, 2);

    if (player && saveData.player) {
      const p = saveData.player.position;
      const r = saveData.player.rotation;
      if (p) player.setPosition(p.x, p.y, p.z);
      if (r) player.setRotation(r.yaw, r.pitch);
      player.setFlyMode(Boolean(saveData.player.flyMode));
    }
  }

  /**
   * Saves world & player state into browser localStorage under a named slot.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player|null} player
   * @param {string} [slotName='default']
   * @param {{ gameMode?: string, inventory?: any, survival?: any }} [extra]
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, timeOfDay: number, viewDistance: number, totalModifiedBlocks: number, gameMode?: string, inventory?: any, survival?: any, player: any, modifications: Record<string, Array<[number, number] | [number, number, number]>> }} The serialized save metadata.
   */
  static saveToStorage(world, player = null, slotName = 'default', extra = undefined) {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available in this environment.');
    }
    const payload = WorldSave.serialize(world, player, slotName, extra);
    localStorage.setItem(`${SAVE_PREFIX}${slotName}`, JSON.stringify(payload));
    return payload;
  }

  /**
   * Loads save data from browser localStorage for a named slot.
   * @param {string} [slotName='default']
   * @returns {Object|null}
   */
  static loadFromStorage(slotName = 'default') {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${SAVE_PREFIX}${slotName}`);
    if (!raw) return null;
    return WorldSave.parseJSON(raw);
  }

  /**
   * Lists metadata for all saved world slots in localStorage.
   * @returns {Array<{ slotName: string, seed: number, savedAt: string, totalModifiedBlocks: number }>}
   */
  static listSaves() {
    if (typeof localStorage === 'undefined') return [];
    const saves = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SAVE_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          saves.push({
            slotName: key.slice(SAVE_PREFIX.length),
            seed: data.seed,
            savedAt: data.savedAt,
            totalModifiedBlocks: data.totalModifiedBlocks ?? 0,
            gameMode: data.gameMode,
          });
        } catch {
          // Ignore corrupted entries
        }
      }
    }
    return saves.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  /**
   * Deletes a saved slot from localStorage.
   * @param {string} slotName
   */
  static deleteSave(slotName) {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${SAVE_PREFIX}${slotName}`);
  }

  /**
   * Asynchronously saves world, player, inventory, and survival vitals to IndexedDB.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player|null} player
   * @param {string} [slotName='default']
   * @param {{ gameMode?: string, inventory?: any, survival?: any }} [extra]
   */
  static async saveAsync(world, player = null, slotName = 'default', extra = undefined) {
    const payload = WorldSave.serialize(world, player, slotName, extra);
    try {
      return await IndexedDBSave.put(slotName, payload);
    } catch {
      return WorldSave.saveToStorage(world, player, slotName, extra);
    }
  }

  /**
   * Asynchronously loads a saved slot from IndexedDB (falling back to localStorage if present).
   * @param {string} [slotName='default']
   * @returns {Promise<any|null>}
   */
  static async loadAsync(slotName = 'default') {
    try {
      const idbData = await IndexedDBSave.get(slotName);
      if (idbData) return idbData;
    } catch {
      // Fallback to localStorage below when IndexedDB is unavailable
    }
    return WorldSave.loadFromStorage(slotName);
  }

  /**
   * Lists saved world slots across IndexedDB (plus any legacy localStorage-only slots).
   * @returns {Promise<Array<{ slotName: string, seed: number, savedAt: string, totalModifiedBlocks: number, gameMode?: string, byteSize?: number }>>}
   */
  static async listSavesAsync() {
    let idbList = [];
    try {
      idbList = await IndexedDBSave.list();
    } catch {
      idbList = [];
    }
    const seen = new Set(idbList.map((s) => s.slotName));
    for (const legacy of WorldSave.listSaves()) {
      if (!seen.has(legacy.slotName)) {
        idbList.push(legacy);
      }
    }
    return idbList.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  /**
   * Deletes a saved slot from both IndexedDB and localStorage.
   * @param {string} slotName
   */
  static async deleteSaveAsync(slotName) {
    try {
      await IndexedDBSave.delete(slotName);
    } catch {
      // Continue deleting localStorage copy even if IndexedDB is blocked
    }
    WorldSave.deleteSave(slotName);
  }
}
