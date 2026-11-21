/**
 * @file IndexedDBSave.js
 * @description Asynchronous IndexedDB persistence store for large voxel worlds and multi-slot saves,
 * with clean in-memory fallback when running in headless Node tests.
 */

const DB_NAME = 'voxelcraft_worlds_db';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';

/**
 * Fallback store used cleanly in environments without browser IndexedDB (e.g. Node unit tests).
 * @type {Map<string, any>}
 */
const memoryFallbackStore = new Map();

/**
 * Provides asynchronous multi-slot world persistence backed by IndexedDB.
 */
export class IndexedDBSave {
  /**
   * Returns true if browser IndexedDB API is available.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof indexedDB !== 'undefined';
  }

  /**
   * Opens (and initializes if needed) the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  static _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slotName' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Saves a serialized world record into IndexedDB under slotName.
   * @param {string} slotName
   * @param {any} payload
   * @returns {Promise<{ slotName: string, savedAt: string, seed: number, totalModifiedBlocks: number, byteSize: number }>}
   */
  static async put(slotName, payload) {
    const key = String(slotName || 'default').trim() || 'default';
    const jsonSize = JSON.stringify(payload).length;
    const record = {
      ...payload,
      slotName: key,
      byteSize: jsonSize,
    };

    if (!IndexedDBSave.isSupported()) {
      memoryFallbackStore.set(key, structuredClone(record));
      return {
        slotName: key,
        savedAt: record.savedAt,
        seed: record.seed,
        totalModifiedBlocks: record.totalModifiedBlocks ?? 0,
        byteSize: jsonSize,
      };
    }

    const db = await IndexedDBSave._openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }

    return {
      slotName: key,
      savedAt: record.savedAt,
      seed: record.seed,
      totalModifiedBlocks: record.totalModifiedBlocks ?? 0,
      byteSize: jsonSize,
    };
  }

  /**
   * Reads a saved world record by slotName from IndexedDB.
   * @param {string} slotName
   * @returns {Promise<any|null>}
   */
  static async get(slotName) {
    const key = String(slotName || 'default').trim() || 'default';
    if (!IndexedDBSave.isSupported()) {
      const hit = memoryFallbackStore.get(key);
      return hit ? structuredClone(hit) : null;
    }

    const db = await IndexedDBSave._openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  /**
   * Lists metadata summaries for all saved worlds in IndexedDB, newest first.
   * @returns {Promise<Array<{ slotName: string, seed: number, savedAt: string, totalModifiedBlocks: number, gameMode?: string, byteSize?: number }>>}
   */
  static async list() {
    if (!IndexedDBSave.isSupported()) {
      return Array.from(memoryFallbackStore.values())
        .map((d) => ({
          slotName: d.slotName,
          seed: d.seed,
          savedAt: d.savedAt,
          totalModifiedBlocks: d.totalModifiedBlocks ?? 0,
          gameMode: d.gameMode,
          byteSize: d.byteSize ?? 0,
        }))
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    }

    const db = await IndexedDBSave._openDB();
    try {
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });

      return all
        .map((d) => ({
          slotName: d.slotName,
          seed: d.seed,
          savedAt: d.savedAt,
          totalModifiedBlocks: d.totalModifiedBlocks ?? 0,
          gameMode: d.gameMode,
          byteSize: d.byteSize ?? 0,
        }))
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    } finally {
      db.close();
    }
  }

  /**
   * Deletes a saved world slot from IndexedDB.
   * @param {string} slotName
   * @returns {Promise<void>}
   */
  static async delete(slotName) {
    const key = String(slotName || 'default').trim() || 'default';
    if (!IndexedDBSave.isSupported()) {
      memoryFallbackStore.delete(key);
      return;
    }

    const db = await IndexedDBSave._openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  /**
   * Clears the in-memory fallback cache (primarily for deterministic testing).
   */
  static clearFallbackCache() {
    memoryFallbackStore.clear();
  }
}
