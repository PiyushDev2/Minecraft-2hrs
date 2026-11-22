/**
 * @file ResourcePackManager.ts
 * @description Zero-OOM streaming selective Minecraft 1.21 Resource Pack Importer & IndexedDB Store.
 * Safely handles massive 700+ MB .zip/.jar files or extracted folders by reading ONLY the ZIP
 * Central Directory via File.slice() and inflating ONLY the ~120–200 PNG/OGG assets used by
 * VoxelCraft via native DecompressionStream('deflate-raw').
 */

export interface ResourcePackAssets {
  blockTextures: Record<string, Blob>;
  itemIcons: Record<string, Blob>;
  entitySkins: Record<string, Blob>;
  sounds: Record<string, Blob>;
}

export interface StoredResourcePack {
  id: string;
  name: string;
  sourceType: 'zip' | 'folder';
  enabled: boolean;
  importedAt: number;
  blockCount: number;
  itemCount: number;
  entityCount: number;
  soundCount: number;
  extractedBytes: number;
  assets: ResourcePackAssets;
}

export interface ResourcePackSummary {
  id: string;
  name: string;
  sourceType: 'zip' | 'folder';
  enabled: boolean;
  importedAt: number;
  blockCount: number;
  itemCount: number;
  entityCount: number;
  soundCount: number;
  extractedBytes: number;
}

export interface PackImportProgress {
  phase: 'scanning' | 'extracting' | 'saving' | 'done';
  scanned: number;
  matched: number;
  extracted: number;
  extractedBytes: number;
}

// --- Minecraft 1.21 Path Manifests ---

const BLOCK_FILENAME_TO_TILE: Record<string, string[]> = {
  'grass_block_top.png': ['grass_top'],
  'grass_block_side.png': ['grass_side'],
  'dirt.png': ['dirt'],
  'stone.png': ['stone'],
  'bedrock.png': ['bedrock'],
  'sand.png': ['sand'],
  'gravel.png': ['gravel'],
  'water_still.png': ['water'],
  'lava_still.png': ['lava'],
  'oak_log_top.png': ['oak_log_top'],
  'oak_log.png': ['oak_log_side'],
  'oak_leaves.png': ['oak_leaves'],
  'torch.png': ['torch'],
  'glowstone.png': ['glowstone'],
  'coal_ore.png': ['coal_ore'],
  'iron_ore.png': ['iron_ore'],
  'gold_ore.png': ['gold_ore'],
  'diamond_ore.png': ['diamond_ore'],
  'redstone_ore.png': ['redstone_ore'],
  'snow.png': ['snow'],
  'cactus_top.png': ['cactus_top'],
  'cactus_side.png': ['cactus_side'],
  'short_grass.png': ['tall_grass'],
  'grass.png': ['tall_grass'],
  'poppy.png': ['flower'],
  'spruce_log_top.png': ['spruce_log_top'],
  'spruce_log.png': ['spruce_log_side'],
  'spruce_leaves.png': ['spruce_leaves'],
  'oak_planks.png': ['planks_oak'],
  'cobblestone.png': ['cobblestone'],
  'crafting_table_top.png': ['crafting_table_top'],
  'crafting_table_side.png': ['crafting_table_side'],
  'crafting_table_front.png': ['crafting_table_side'],
  'glass.png': ['glass'],
  'bricks.png': ['bricks'],
  'obsidian.png': ['obsidian'],
  'furnace_front.png': ['furnace_front'],
  'furnace_front_on.png': ['furnace_front_lit'],
  'furnace_side.png': ['furnace_side'],
  'furnace_top.png': ['furnace_top'],
  'tnt_top.png': ['tnt_top'],
  'tnt_side.png': ['tnt_side'],
  'tnt_bottom.png': ['tnt_bottom'],
  'oak_door_top.png': ['oak_door'],
  'ladder.png': ['ladder'],
  'farmland.png': ['farmland_dry'],
  'farmland_moist.png': ['farmland_wet'],
  'wheat_stage0.png': ['wheat_0'],
  'wheat_stage2.png': ['wheat_1'],
  'wheat_stage5.png': ['wheat_2'],
  'wheat_stage7.png': ['wheat_3'],
  'iron_block.png': ['iron_block'],
  'gold_block.png': ['gold_block'],
  'diamond_block.png': ['diamond_block'],
  'netherrack.png': ['netherrack'],
  'soul_sand.png': ['soul_sand'],
  'nether_bricks.png': ['nether_bricks'],
  'nether_quartz_ore.png': ['nether_quartz_ore'],
  'nether_portal.png': ['nether_portal'],
  'mossy_cobblestone.png': ['mossy_cobblestone'],
  'white_wool.png': ['white_wool'],
};

const ITEM_FILENAME_TO_ID: Record<string, string> = {
  'stick.png': 'stick',
  'coal.png': 'coal',
  'iron_ingot.png': 'iron_ingot',
  'gold_ingot.png': 'gold_ingot',
  'diamond.png': 'diamond',
  'redstone.png': 'redstone',
  'gunpowder.png': 'gunpowder',
  'string.png': 'string',
  'bone.png': 'bone',
  'feather.png': 'feather',
  'flint.png': 'flint',
  'flint_and_steel.png': 'flint_and_steel',
  'shears.png': 'shears',
  'leather.png': 'leather',
  'ender_pearl.png': 'ender_pearl',
  'quartz.png': 'quartz',
  'wheat.png': 'wheat',
  'wheat_seeds.png': 'wheat_seeds',
  'arrow.png': 'arrow',
  'bucket.png': 'bucket',
  'water_bucket.png': 'water_bucket',
  'lava_bucket.png': 'lava_bucket',
  'bow.png': 'bow',
  'apple.png': 'apple',
  'bread.png': 'bread',
  'beef.png': 'raw_beef',
  'cooked_beef.png': 'cooked_beef',
  'porkchop.png': 'raw_porkchop',
  'cooked_porkchop.png': 'cooked_porkchop',
  'chicken.png': 'raw_chicken',
  'cooked_chicken.png': 'cooked_chicken',
  'oak_door.png': 'oak_door',
  'wooden_pickaxe.png': 'wooden_pickaxe',
  'wooden_axe.png': 'wooden_axe',
  'wooden_shovel.png': 'wooden_shovel',
  'wooden_hoe.png': 'wooden_hoe',
  'wooden_sword.png': 'wooden_sword',
  'stone_pickaxe.png': 'stone_pickaxe',
  'stone_axe.png': 'stone_axe',
  'stone_shovel.png': 'stone_shovel',
  'stone_hoe.png': 'stone_hoe',
  'stone_sword.png': 'stone_sword',
  'iron_pickaxe.png': 'iron_pickaxe',
  'iron_axe.png': 'iron_axe',
  'iron_shovel.png': 'iron_shovel',
  'iron_hoe.png': 'iron_hoe',
  'iron_sword.png': 'iron_sword',
  'diamond_pickaxe.png': 'diamond_pickaxe',
  'diamond_axe.png': 'diamond_axe',
  'diamond_shovel.png': 'diamond_shovel',
  'diamond_hoe.png': 'diamond_hoe',
  'diamond_sword.png': 'diamond_sword',
  'leather_helmet.png': 'leather_helmet',
  'leather_chestplate.png': 'leather_chestplate',
  'leather_leggings.png': 'leather_leggings',
  'leather_boots.png': 'leather_boots',
  'iron_helmet.png': 'iron_helmet',
  'iron_chestplate.png': 'iron_chestplate',
  'iron_leggings.png': 'iron_leggings',
  'iron_boots.png': 'iron_boots',
  'diamond_helmet.png': 'diamond_helmet',
  'diamond_chestplate.png': 'diamond_chestplate',
  'diamond_leggings.png': 'diamond_leggings',
  'diamond_boots.png': 'diamond_boots',
};

const ENTITY_PATH_RULES: Array<{ suffix: string; mobKey: string }> = [
  { suffix: 'entity/sheep/sheep.png', mobKey: 'sheep' },
  { suffix: 'entity/cow/cow.png', mobKey: 'cow' },
  { suffix: 'entity/pig/pig.png', mobKey: 'pig' },
  { suffix: 'entity/chicken.png', mobKey: 'chicken' },
  { suffix: 'entity/zombie/zombie.png', mobKey: 'zombie' },
  { suffix: 'entity/creeper/creeper.png', mobKey: 'creeper' },
  { suffix: 'entity/skeleton/skeleton.png', mobKey: 'skeleton' },
  { suffix: 'entity/spider/spider.png', mobKey: 'spider' },
  { suffix: 'entity/slime/slime.png', mobKey: 'slime' },
  { suffix: 'entity/enderman/enderman.png', mobKey: 'enderman' },
  { suffix: 'entity/piglin/zombified_piglin.png', mobKey: 'zombified_piglin' },
];

const SOUND_MATCHERS: Array<{ match: RegExp; key: string }> = [
  { match: /(?:^|\/)dig\/grass1\.ogg$/i, key: 'break_grass' },
  { match: /(?:^|\/)dig\/stone1\.ogg$/i, key: 'break_stone' },
  { match: /(?:^|\/)dig\/wood1\.ogg$/i, key: 'break_wood' },
  { match: /(?:^|\/)dig\/sand1\.ogg$/i, key: 'break_sand' },
  { match: /(?:^|\/)dig\/gravel1\.ogg$/i, key: 'break_gravel' },
  { match: /(?:^|\/)random\/glass1\.ogg$/i, key: 'break_glass' },
  { match: /(?:^|\/)step\/grass1\.ogg$/i, key: 'step_grass' },
  { match: /(?:^|\/)step\/stone1\.ogg$/i, key: 'step_stone' },
  { match: /(?:^|\/)step\/wood1\.ogg$/i, key: 'step_wood' },
  { match: /(?:^|\/)step\/sand1\.ogg$/i, key: 'step_sand' },
  { match: /(?:^|\/)random\/eat1\.ogg$/i, key: 'eat' },
  { match: /(?:^|\/)random\/orb\.ogg$/i, key: 'xp' },
  { match: /(?:^|\/)random\/levelup\.ogg$/i, key: 'levelup' },
  { match: /(?:^|\/)random\/bow\.ogg$/i, key: 'bow' },
  { match: /(?:^|\/)random\/bowhit1\.ogg$/i, key: 'arrow_hit' },
  { match: /(?:^|\/)random\/explode1\.ogg$/i, key: 'explode' },
  { match: /(?:^|\/)random\/fuse\.ogg$/i, key: 'fuse' },
  { match: /(?:^|\/)random\/click\.ogg$/i, key: 'ui_click' },
  { match: /(?:^|\/)random\/door_open\.ogg$/i, key: 'door' },
  { match: /(?:^|\/)random\/break\.ogg$/i, key: 'tool_break' },
  { match: /(?:^|\/)damage\/hit1\.ogg$/i, key: 'hurt' },
  { match: /(?:^|\/)fire\/ignite\.ogg$/i, key: 'flint_and_steel' },
  { match: /(?:^|\/)portal\/travel\.ogg$/i, key: 'portal_travel' },
  { match: /(?:^|\/)mob\/endermen\/portal\.ogg$/i, key: 'enderman_teleport' },
  { match: /(?:^|\/)mob\/sheep\/shear\.ogg$/i, key: 'shear' },
  { match: /(?:^|\/)liquid\/splash\.ogg$/i, key: 'splash' },
];

type MatchResult =
  | { kind: 'block'; targets: string[] }
  | { kind: 'item'; target: string }
  | { kind: 'entity'; target: string }
  | { kind: 'sound'; target: string }
  | null;

function classifyAssetPath(rawPath: string): MatchResult {
  const normalized = rawPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.endsWith('/')) return null;

  // 1. Block textures (supports standard 1.21 assets/minecraft/textures/block/ OR direct textures/block/ or block/)
  if (normalized.endsWith('.png') && /(?:^|\/)textures\/block\/[^/]+\.png$/.test(normalized)) {
    const file = normalized.slice(normalized.lastIndexOf('/') + 1);
    const targets = BLOCK_FILENAME_TO_TILE[file];
    if (targets) return { kind: 'block', targets };
  }

  // 2. Item icons
  if (normalized.endsWith('.png') && /(?:^|\/)textures\/item\/[^/]+\.png$/.test(normalized)) {
    const file = normalized.slice(normalized.lastIndexOf('/') + 1);
    const target = ITEM_FILENAME_TO_ID[file];
    if (target) return { kind: 'item', target };
  }

  // 3. Entity skins
  if (normalized.endsWith('.png') && normalized.includes('entity/')) {
    for (const rule of ENTITY_PATH_RULES) {
      if (normalized.endsWith(rule.suffix)) {
        return { kind: 'entity', target: rule.mobKey };
      }
    }
  }

  // 4. Sounds (.ogg or .wav)
  if (normalized.endsWith('.ogg') || normalized.endsWith('.wav')) {
    for (const rule of SOUND_MATCHERS) {
      if (rule.match.test(normalized)) {
        return { kind: 'sound', target: rule.key };
      }
    }
  }

  return null;
}

// --- Zero-OOM Streaming ZIP/JAR Central Directory Reader ---

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  match: NonNullable<MatchResult>;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;

async function readZipMatchedEntries(
  file: File,
  onProgress?: (p: PackImportProgress) => void
): Promise<{ matched: ZipEntry[]; scanned: number }> {
  const fileSize = file.size;
  if (fileSize < 22) {
    throw new Error('Selected archive is too small to be a valid ZIP/JAR file.');
  }

  // Read only the trailing 65KB (+22 bytes) to locate End of Central Directory (never loads the 721MB file into RAM!)
  const tailSize = Math.min(fileSize, 65557);
  const tailStart = fileSize - tailSize;
  const tailBuf = await file.slice(tailStart, fileSize).arrayBuffer();
  const tailView = new DataView(tailBuf);

  let eocdOffset = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP/JAR archive: End of Central Directory not found.');
  }

  let cdSize = tailView.getUint32(eocdOffset + 12, true);
  let cdOffset = tailView.getUint32(eocdOffset + 16, true);
  let totalEntries = tailView.getUint16(eocdOffset + 10, true);

  // Support ZIP64 if archive exceeds 4GB or 65535 entries
  if (
    (cdOffset === 0xffffffff || cdSize === 0xffffffff || totalEntries === 0xffff) &&
    eocdOffset >= 20 &&
    tailView.getUint32(eocdOffset - 20, true) === ZIP64_LOCATOR_SIG
  ) {
    const z64Offset = Number(tailView.getBigUint64(eocdOffset - 12, true));
    const z64Buf = await file.slice(z64Offset, z64Offset + 56).arrayBuffer();
    const z64View = new DataView(z64Buf);
    if (z64View.getUint32(0, true) === ZIP64_EOCD_SIG) {
      totalEntries = Number(z64View.getBigUint64(32, true));
      cdSize = Number(z64View.getBigUint64(40, true));
      cdOffset = Number(z64View.getBigUint64(48, true));
    }
  }

  if (cdOffset + cdSize > fileSize) {
    throw new Error('Corrupted ZIP/JAR central directory offsets.');
  }

  // Read ONLY the Central Directory table (typically 0.5–4 MB even for a 721 MB ZIP)
  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cdView = new DataView(cdBuf);
  const cdBytes = new Uint8Array(cdBuf);
  const decoder = new TextDecoder('utf-8');

  const matched: ZipEntry[] = [];
  let pos = 0;
  let scanned = 0;

  while (pos + 46 <= cdBuf.byteLength) {
    if (cdView.getUint32(pos, true) !== CD_SIG) break;
    const compressionMethod = cdView.getUint16(pos + 10, true);
    let compressedSize = cdView.getUint32(pos + 20, true);
    let uncompressedSize = cdView.getUint32(pos + 24, true);
    const nameLen = cdView.getUint16(pos + 28, true);
    const extraLen = cdView.getUint16(pos + 30, true);
    const commentLen = cdView.getUint16(pos + 32, true);
    let localHeaderOffset = cdView.getUint32(pos + 42, true);

    const name = decoder.decode(cdBytes.subarray(pos + 46, pos + 46 + nameLen));

    // Handle ZIP64 extra field per entry if needed
    if (
      (compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff) &&
      extraLen >= 4
    ) {
      let exPos = pos + 46 + nameLen;
      const exEnd = exPos + extraLen;
      while (exPos + 4 <= exEnd) {
        const headerId = cdView.getUint16(exPos, true);
        const dataSize = cdView.getUint16(exPos + 2, true);
        if (headerId === 0x0001) {
          let cursor = exPos + 4;
          if (uncompressedSize === 0xffffffff && cursor + 8 <= exEnd) {
            uncompressedSize = Number(cdView.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (compressedSize === 0xffffffff && cursor + 8 <= exEnd) {
            compressedSize = Number(cdView.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (localHeaderOffset === 0xffffffff && cursor + 8 <= exEnd) {
            localHeaderOffset = Number(cdView.getBigUint64(cursor, true));
          }
          break;
        }
        exPos += 4 + dataSize;
      }
    }

    scanned++;
    const match = classifyAssetPath(name);
    if (match && (compressionMethod === 0 || compressionMethod === 8)) {
      matched.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        match,
      });
    }

    if (scanned % 1000 === 0) {
      onProgress?.({
        phase: 'scanning',
        scanned,
        matched: matched.length,
        extracted: 0,
        extractedBytes: 0,
      });
      await new Promise((r) => setTimeout(r, 0));
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  onProgress?.({
    phase: 'scanning',
    scanned: Math.max(scanned, totalEntries),
    matched: matched.length,
    extracted: 0,
    extractedBytes: 0,
  });

  return { matched, scanned };
}

async function extractZipEntryBlob(file: File, entry: ZipEntry, mime: string): Promise<Blob> {
  // Read 30-byte local header to get exact variable filename/extra lengths
  const lhBuf = await file
    .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    .arrayBuffer();
  const lhView = new DataView(lhBuf);
  if (lhView.getUint32(0, true) !== LOCAL_SIG) {
    throw new Error(`Invalid local header for ${entry.name}`);
  }
  const nameLen = lhView.getUint16(26, true);
  const extraLen = lhView.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const rawSlice = file.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return new Blob([await rawSlice.arrayBuffer()], { type: mime });
  }

  // Native hardware-accelerated deflate-raw stream (zero JS zip dependency!)
  if (typeof DecompressionStream !== 'undefined') {
    const stream = rawSlice.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const resp = new Response(stream);
    const buf = await resp.arrayBuffer();
    return new Blob([buf], { type: mime });
  }

  throw new Error('This browser does not support native DecompressionStream for compressed ZIP entries.');
}

// --- IndexedDB Persistence ---

const DB_NAME = 'voxelcraft_packs_v1';
const STORE_NAME = 'packs';

function openPackDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open Resource Pack database.'));
  });
}

function summarizePack(p: StoredResourcePack): ResourcePackSummary {
  return {
    id: p.id,
    name: p.name,
    sourceType: p.sourceType,
    enabled: p.enabled,
    importedAt: p.importedAt,
    blockCount: p.blockCount,
    itemCount: p.itemCount,
    entityCount: p.entityCount,
    soundCount: p.soundCount,
    extractedBytes: p.extractedBytes,
  };
}

export class ResourcePackManager {
  public async listPacks(): Promise<ResourcePackSummary[]> {
    try {
      const db = await openPackDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const rows = (req.result as StoredResourcePack[]) || [];
          rows.sort((a, b) => b.importedAt - a.importedAt);
          resolve(rows.map(summarizePack));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async getPack(id: string): Promise<StoredResourcePack | null> {
    try {
      const db = await openPackDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve((req.result as StoredResourcePack) || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  public async getActivePack(): Promise<StoredResourcePack | null> {
    try {
      const db = await openPackDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const rows = (req.result as StoredResourcePack[]) || [];
          const active = rows.find((r) => r.enabled) || null;
          resolve(active);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  public async setActivePack(id: string | null): Promise<StoredResourcePack | null> {
    const db = await openPackDb();
    const all: StoredResourcePack[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredResourcePack[]) || []);
      req.onerror = () => reject(req.error);
    });

    let activePack: StoredResourcePack | null = null;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const pack of all) {
        const shouldEnable = id !== null && pack.id === id;
        if (pack.enabled !== shouldEnable) {
          pack.enabled = shouldEnable;
          store.put(pack);
        }
        if (shouldEnable) activePack = pack;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return activePack;
  }

  public async deletePack(id: string): Promise<void> {
    const db = await openPackDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Streams a Minecraft 1.21 .zip/.jar (even 721 MB+) with near-zero RAM usage,
   * extracting only matched block/item/entity PNGs & OGG SFX into IndexedDB.
   */
  public async importFromZip(
    file: File,
    onProgress?: (p: PackImportProgress) => void
  ): Promise<StoredResourcePack> {
    const { matched, scanned } = await readZipMatchedEntries(file, onProgress);
    if (matched.length === 0) {
      throw new Error(
        'No Minecraft textures or sounds found in this archive. Ensure it contains assets/minecraft/textures/block/ or sounds/.'
      );
    }

    const assets: ResourcePackAssets = {
      blockTextures: {},
      itemIcons: {},
      entitySkins: {},
      sounds: {},
    };

    let extracted = 0;
    let extractedBytes = 0;

    for (const entry of matched) {
      const mime =
        entry.match.kind === 'sound'
          ? entry.name.toLowerCase().endsWith('.wav')
            ? 'audio/wav'
            : 'audio/ogg'
          : 'image/png';
      try {
        const blob = await extractZipEntryBlob(file, entry, mime);
        extractedBytes += blob.size;
        if (entry.match.kind === 'block') {
          for (const t of entry.match.targets) {
            assets.blockTextures[t] = blob;
          }
        } else if (entry.match.kind === 'item') {
          assets.itemIcons[entry.match.target] = blob;
        } else if (entry.match.kind === 'entity') {
          assets.entitySkins[entry.match.target] = blob;
        } else if (entry.match.kind === 'sound') {
          assets.sounds[entry.match.target] = blob;
        }
      } catch {
        // Skip single corrupt entry, keep importing remaining assets
      }
      extracted++;
      if (extracted % 8 === 0 || extracted === matched.length) {
        onProgress?.({
          phase: 'extracting',
          scanned,
          matched: matched.length,
          extracted,
          extractedBytes,
        });
      }
    }

    const packName = file.name.replace(/\.(zip|jar)$/i, '') || 'Imported 1.21 Pack';
    return this._saveAndActivatePack(packName, 'zip', assets, extractedBytes, scanned, matched.length, onProgress);
  }

  /**
   * Selectively imports ONLY matched PNG/OGG files from an extracted folder (`webkitdirectory`).
   * Unmatched files in a 721 MB folder are never read from disk.
   */
  public async importFromFolder(
    fileList: FileList | File[],
    onProgress?: (p: PackImportProgress) => void
  ): Promise<StoredResourcePack> {
    const files = Array.from(fileList);
    if (files.length === 0) {
      throw new Error('No files were selected.');
    }

    const matched: Array<{ file: File; match: NonNullable<MatchResult> }> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const m = classifyAssetPath(rel);
      if (m) {
        matched.push({ file: f, match: m });
      }
      if (i % 500 === 0) {
        onProgress?.({
          phase: 'scanning',
          scanned: i + 1,
          matched: matched.length,
          extracted: 0,
          extractedBytes: 0,
        });
      }
    }

    if (matched.length === 0) {
      throw new Error(
        'No Minecraft 1.21 textures or sounds found in that folder. Select the folder containing assets/minecraft/ (or textures/block/).'
      );
    }

    const assets: ResourcePackAssets = {
      blockTextures: {},
      itemIcons: {},
      entitySkins: {},
      sounds: {},
    };

    let extracted = 0;
    let extractedBytes = 0;

    for (const item of matched) {
      const buf = await item.file.arrayBuffer();
      const mime =
        item.match.kind === 'sound'
          ? item.file.name.toLowerCase().endsWith('.wav')
            ? 'audio/wav'
            : 'audio/ogg'
          : 'image/png';
      const blob = new Blob([buf], { type: mime });
      extractedBytes += blob.size;

      if (item.match.kind === 'block') {
        for (const t of item.match.targets) {
          assets.blockTextures[t] = blob;
        }
      } else if (item.match.kind === 'item') {
        assets.itemIcons[item.match.target] = blob;
      } else if (item.match.kind === 'entity') {
        assets.entitySkins[item.match.target] = blob;
      } else if (item.match.kind === 'sound') {
        assets.sounds[item.match.target] = blob;
      }

      extracted++;
      if (extracted % 10 === 0 || extracted === matched.length) {
        onProgress?.({
          phase: 'extracting',
          scanned: files.length,
          matched: matched.length,
          extracted,
          extractedBytes,
        });
      }
    }

    const firstRel =
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || 'Minecraft 1.21 Folder';
    const rootName = firstRel.split('/')[0] || 'Minecraft 1.21 Folder';

    return this._saveAndActivatePack(
      rootName,
      'folder',
      assets,
      extractedBytes,
      files.length,
      matched.length,
      onProgress
    );
  }

  private async _saveAndActivatePack(
    name: string,
    sourceType: 'zip' | 'folder',
    assets: ResourcePackAssets,
    extractedBytes: number,
    scanned: number,
    matched: number,
    onProgress?: (p: PackImportProgress) => void
  ): Promise<StoredResourcePack> {
    onProgress?.({
      phase: 'saving',
      scanned,
      matched,
      extracted: matched,
      extractedBytes,
    });

    const pack: StoredResourcePack = {
      id: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      sourceType,
      enabled: true,
      importedAt: Date.now(),
      blockCount: Object.keys(assets.blockTextures).length,
      itemCount: Object.keys(assets.itemIcons).length,
      entityCount: Object.keys(assets.entitySkins).length,
      soundCount: Object.keys(assets.sounds).length,
      extractedBytes,
      assets,
    };

    const db = await openPackDb();
    // Disable other packs and store new pack as active
    const existing: StoredResourcePack[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredResourcePack[]) || []);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const p of existing) {
        if (p.enabled) {
          p.enabled = false;
          store.put(p);
        }
      }
      store.put(pack);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    onProgress?.({
      phase: 'done',
      scanned,
      matched,
      extracted: matched,
      extractedBytes,
    });

    return pack;
  }
}

export const resourcePackManager = new ResourcePackManager();
