/**
 * @file WorldSave.js
 * @description Compact world persistence using seed + sparse chunk modification deltas.
 * Supports browser localStorage slots as well as portable JSON export/import.
 */

const SAVE_PREFIX = 'voxelcraft_save_v1_';
const SAVE_FORMAT_VERSION = 1;

/**
 * Handles serialization, localStorage persistence, and restoration of world & player state.
 */
export class WorldSave {
  /**
   * Serializes world seed, player state, world time, and modified block deltas into a plain object.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player} [player]
   * @param {string} [name='default']
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, viewDistance: number, totalModifiedBlocks: number, player: any, modifications: Record<string, Array<[number, number]>> }}
   */
  static serialize(world, player = null, name = 'default') {
    const modifications = world.chunkManager.exportAllModifications();
    let totalModifiedBlocks = 0;
    for (const list of Object.values(modifications)) {
      totalModifiedBlocks += list.length;
    }

    return {
      version: SAVE_FORMAT_VERSION,
      name,
      savedAt: new Date().toISOString(),
      seed: world.seed,
      worldTime: world.worldTime,
      timeOfDay: world.timeOfDay,
      viewDistance: world.viewDistance,
      totalModifiedBlocks,
      player: player
        ? {
            position: player.getPosition(),
            rotation: player.getRotation(),
            flyMode: player.flyMode,
          }
        : null,
      modifications,
    };
  }

  /**
   * Exports serialized world data as a JSON string.
   * @param {import('../world/World.js').World} world
   * @param {import('../physics/Player.js').Player} [player]
   * @param {string} [name='default']
   * @returns {string}
   */
  static exportJSON(world, player = null, name = 'default') {
    return JSON.stringify(WorldSave.serialize(world, player, name));
  }

  /**
   * Parses and validates a JSON save string.
   * @param {string} jsonString
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, viewDistance: number, totalModifiedBlocks: number, player: any, modifications: Record<string, Array<[number, number]>> }}
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

    if (typeof saveData.viewDistance === 'number') {
      world.setViewDistance(saveData.viewDistance);
    }

    // Regenerate world cleanly with saved seed (without meshing before applying mods)
    world.generate(saveData.seed, { spawnCenter, pregenerateRadius: -1 });
    world.worldTime = Number.isFinite(saveData.worldTime) ? saveData.worldTime : 0;
    if (Number.isFinite(saveData.timeOfDay)) {
      world.setTimeOfDay(saveData.timeOfDay);
    }

    if (saveData.modifications) {
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
   * @returns {{ version: number, name: string, savedAt: string, seed: number, worldTime: number, viewDistance: number, totalModifiedBlocks: number, player: any, modifications: Record<string, Array<[number, number]>> }} The serialized save metadata.
   */
  static saveToStorage(world, player = null, slotName = 'default') {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available in this environment.');
    }
    const payload = WorldSave.serialize(world, player, slotName);
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
}
