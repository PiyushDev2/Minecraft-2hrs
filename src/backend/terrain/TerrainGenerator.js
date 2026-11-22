/**
 * @file TerrainGenerator.js
 * @description Procedural multi-biome terrain generator for Overworld (mountains, plains,
 * valleys, oceans, beaches, caves, trees, woodland cottages, desert wells, underground mossy
 * dungeons with loot chests) and the Nether dimension (netherrack caverns, lava sea, soul sand,
 * nether quartz ore, hanging glowstone, and nether brick ruins).
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from '../chunks/Chunk.js';
import { BiomeGenerator, BIOMES } from './BiomeGenerator.js';
import { Noise, hash2D, normalizeSeed } from './Noise.js';

export const SEA_LEVEL = 32;
export const NETHER_LAVA_LEVEL = 24;

const NETHER_BIOME = Object.freeze({
  id: 'nether',
  name: 'Nether Wastes',
  baseHeight: 36,
  heightAmplitude: 0,
  ridgeStrength: 0,
  surfaceBlock: BLOCK_IDS.NETHERRACK,
  subsurfaceBlock: BLOCK_IDS.NETHERRACK,
  treeChance: 0,
  grassColor: 0x6b2824,
});

const END_BIOME = Object.freeze({
  id: 'end',
  name: 'The End',
  baseHeight: 54,
  heightAmplitude: 0,
  ridgeStrength: 0,
  surfaceBlock: BLOCK_IDS.END_STONE,
  subsurfaceBlock: BLOCK_IDS.END_STONE,
  treeChance: 0,
  grassColor: 0xd9dc9e,
});

/**
 * Computes deterministic Stronghold End Portal Room world coordinates for a seed.
 * Placed ~176..224 blocks from origin so Eyes of Ender lead a rewarding trek.
 */
export function getStrongholdCoords(seed) {
  const s = normalizeSeed(seed);
  const angle = hash2D(17, 43, s + 9901) * Math.PI * 2;
  const dist = 176 + Math.floor(hash2D(53, 89, s + 9917) * 48);
  const x = Math.round(Math.cos(angle) * dist);
  const z = Math.round(Math.sin(angle) * dist);
  return { x, y: 18, z };
}

/**
 * Deterministic coordinates for the 8 Obsidian End Crystal pillars on the main End island.
 */
export function getEndPillarPositions() {
  const pillars = [];
  const count = 8;
  const radius = 26;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.round(Math.cos(angle) * radius);
    const z = Math.round(Math.sin(angle) * radius);
    const topY = 69 + (i % 4) * 3;
    pillars.push({ index: i, x, z, topY });
  }
  return pillars;
}

/**
 * Generates deterministic 3D voxel terrain, structures, and vegetation for chunks from a seed.
 */
export class TerrainGenerator {
  /**
   * @param {number|string} [seed=1337]
   * @param {'overworld'|'nether'|'end'} [dimension='overworld']
   */
  constructor(seed = 1337, dimension = 'overworld') {
    this.seed = normalizeSeed(seed);
    /** @type {'overworld'|'nether'|'end'} */
    this.dimension = dimension === 'nether' ? 'nether' : dimension === 'end' ? 'end' : 'overworld';
    this.biomeGenerator = new BiomeGenerator(this.seed);
    this.elevationNoise = new Noise(this.seed + 505);
    this.ridgeNoise = new Noise(this.seed + 606);
    this.detailNoise = new Noise(this.seed + 707);
    this.caveNoise = new Noise(this.seed + 808);
    this.riverNoise = new Noise(this.seed + 909);
    this.oreNoise = new Noise(this.seed + 1010);
    this.netherNoise = new Noise(this.seed + 1414);

    /**
     * Optional hook called whenever a deterministic structure places a loot chest inside a chunk.
     * @type {((wx: number, wy: number, wz: number, kind: 'cottage'|'dungeon'|'nether_ruin') => void)|null}
     */
    this.onStructureChestSpawn = null;
  }

  /**
   * Computes deterministic terrain surface info at world (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {{ height: number, biome: Object, isRiver: boolean }}
   */
  getColumnInfo(x, z) {
    if (this.dimension === 'end') {
      const dist = Math.hypot(x, z);
      const h = dist <= 46 ? Math.round(54 + Math.max(0, 1 - dist / 46) * 2) : 0;
      return { height: h, biome: END_BIOME, isRiver: false };
    }
    if (this.dimension === 'nether') {
      const floorSample = this.elevationNoise.fbm2D(x * 0.025, z * 0.025, 3, 2.0, 0.5);
      const h = Math.max(NETHER_LAVA_LEVEL + 2, Math.min(54, Math.round(34 + floorSample * 14)));
      return { height: h, biome: NETHER_BIOME, isRiver: false };
    }

    const params = this.biomeGenerator.getBlendedBiomeParams(x, z);
    const biome = params.primaryBiome;

    const fbm = this.elevationNoise.fbm2D(x * 0.0075, z * 0.0075, 4, 2.0, 0.5);
    const ridge = this.ridgeNoise.ridged2D(x * 0.009, z * 0.009, 3, 2.1, 0.5);
    const detail = this.detailNoise.fbm2D(x * 0.032, z * 0.032, 2, 2.0, 0.5) * 2.4;

    let height =
      params.baseHeight +
      fbm * params.heightAmplitude +
      Math.pow(ridge, 1.4) * params.ridgeStrength +
      detail;

    const riverSample = Math.abs(this.riverNoise.fbm2D(x * 0.0032, z * 0.0032, 3, 2.0, 0.5));
    let isRiver = false;
    if (biome.id !== BIOMES.OCEAN && riverSample < 0.042 && height < 58) {
      const riverFactor = 1 - riverSample / 0.042;
      const targetBed = SEA_LEVEL - 4;
      height = height * (1 - riverFactor * 0.85) + targetBed * (riverFactor * 0.85);
      if (height <= SEA_LEVEL) {
        isRiver = true;
      }
    }

    const clampedHeight = Math.max(4, Math.min(CHUNK_HEIGHT - 16, Math.round(height)));
    return { height: clampedHeight, biome, isRiver };
  }

  /**
   * Convenience helper returning surface block Y at world (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getHeightAt(x, z) {
    return this.getColumnInfo(x, z).height;
  }

  /**
   * Returns biome profile at world (x, z).
   * @param {number} x
   * @param {number} z
   */
  getBiomeAt(x, z) {
    if (this.dimension === 'end') return END_BIOME;
    if (this.dimension === 'nether') return NETHER_BIOME;
    return this.biomeGenerator.getBiome(x, z);
  }

  /**
   * Populates a Chunk's voxel array with terrain, caves, water/lava, trees, and structures.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   */
  generateChunk(chunk) {
    if (this.dimension === 'end') {
      this._generateEndChunk(chunk);
      return;
    }
    if (this.dimension === 'nether') {
      this._generateNetherChunk(chunk);
      return;
    }

    const blocks = chunk.blocks;
    blocks.fill(BLOCK_IDS.AIR);

    const heights = new Int16Array(CHUNK_WIDTH * CHUNK_DEPTH);
    const columnBiomes = new Array(CHUNK_WIDTH * CHUNK_DEPTH);

    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        const info = this.getColumnInfo(wx, wz);
        const colIdx = (lz << 4) | lx;
        heights[colIdx] = info.height;
        columnBiomes[colIdx] = info;
      }
    }

    // Pass 1: Strata, caves, surface materials, and water bodies
    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        const colIdx = (lz << 4) | lx;
        const { height: surfaceY, biome, isRiver } = columnBiomes[colIdx];

        const bedrockTop = 1 + Math.floor(hash2D(wx, wz, this.seed + 11) * 2);
        const dirtDepth = biome.id === BIOMES.MOUNTAINS && surfaceY > 64 ? 1 : 3;

        let surfaceBlock = biome.surfaceBlock;
        let subsurfaceBlock = biome.subsurfaceBlock;

        if (isRiver || surfaceY <= SEA_LEVEL - 1) {
          const shoreRoll = hash2D(wx, wz, this.seed + 31);
          surfaceBlock = surfaceY < SEA_LEVEL - 3 && shoreRoll > 0.45 ? BLOCK_IDS.GRAVEL : BLOCK_IDS.SAND;
          subsurfaceBlock = BLOCK_IDS.GRAVEL;
        } else if (surfaceY <= SEA_LEVEL + 1 && biome.id !== BIOMES.DESERT) {
          surfaceBlock = BLOCK_IDS.SAND;
          subsurfaceBlock = BLOCK_IDS.SAND;
        } else if (biome.id === BIOMES.MOUNTAINS && surfaceY >= 72) {
          surfaceBlock = BLOCK_IDS.SNOW_BLOCK;
          subsurfaceBlock = BLOCK_IDS.STONE;
        } else if (biome.id === BIOMES.MOUNTAINS && surfaceY >= 64) {
          surfaceBlock = BLOCK_IDS.STONE;
          subsurfaceBlock = BLOCK_IDS.STONE;
        } else if (biome.id === BIOMES.MOUNTAINS && surfaceY >= 58) {
          const gravelPatch = this.detailNoise.noise2D(wx * 0.08, wz * 0.08);
          if (gravelPatch > 0.25) {
            surfaceBlock = BLOCK_IDS.GRAVEL;
          }
        }

        for (let y = 0; y <= surfaceY; y++) {
          const idx = (y << 8) | (lz << 4) | lx;

          if (y <= bedrockTop) {
            blocks[idx] = BLOCK_IDS.BEDROCK;
            continue;
          }

          // Carve underground 3D caves
          if (y < surfaceY - 3 && y > 3) {
            const caveVal = Math.abs(this.caveNoise.noise3D(wx * 0.045, y * 0.06, wz * 0.045));
            const caveVal2 = Math.abs(
              this.caveNoise.noise3D(wx * 0.045 + 31.7, y * 0.06 - 12.4, wz * 0.045 + 19.2)
            );
            if (caveVal < 0.095 && caveVal2 < 0.14 && !(surfaceY <= SEA_LEVEL + 1 && y > surfaceY - 6)) {
              if (y <= 7) {
                blocks[idx] = BLOCK_IDS.LAVA;
              }
              continue;
            }
          }

          if (y === surfaceY) {
            blocks[idx] = surfaceBlock;
          } else if (y >= surfaceY - dirtDepth) {
            blocks[idx] = subsurfaceBlock;
          } else {
            let blockId = BLOCK_IDS.STONE;
            if (y <= 15 && y >= 4) {
              const diamondSample = this.oreNoise.noise3D(wx * 0.24 - 63.4, y * 0.28, wz * 0.24 + 51.9);
              if (diamondSample > 0.77) blockId = BLOCK_IDS.DIAMOND_ORE;
            }
            if (blockId === BLOCK_IDS.STONE && y <= 18 && y >= 4) {
              const redstoneSample = this.oreNoise.noise3D(wx * 0.22 + 88.1, y * 0.24, wz * 0.22 - 44.3);
              if (redstoneSample > 0.73) blockId = BLOCK_IDS.REDSTONE_ORE;
            }
            if (blockId === BLOCK_IDS.STONE && y <= 26 && y >= 5) {
              const lapisSample = this.oreNoise.noise3D(wx * 0.22 + 123.7, y * 0.25, wz * 0.22 + 91.4);
              if (lapisSample > 0.75) blockId = BLOCK_IDS.LAPIS_ORE;
            }
            if (blockId === BLOCK_IDS.STONE && y <= 28 && y >= 5) {
              const goldSample = this.oreNoise.noise3D(wx * 0.21 - 29.7, y * 0.23, wz * 0.21 + 73.2);
              if (goldSample > 0.74) blockId = BLOCK_IDS.GOLD_ORE;
            }
            if (blockId === BLOCK_IDS.STONE && y <= 46 && y >= 5) {
              const ironSample = this.oreNoise.noise3D(wx * 0.19 + 41.2, y * 0.22, wz * 0.19 - 17.5);
              if (ironSample > 0.68) blockId = BLOCK_IDS.IRON_ORE;
            }
            if (blockId === BLOCK_IDS.STONE && y <= 62 && y >= 6) {
              const coalSample = this.oreNoise.noise3D(wx * 0.15 - 12.8, y * 0.17, wz * 0.15 + 29.1);
              if (coalSample > 0.62) blockId = BLOCK_IDS.COAL_ORE;
            }
            blocks[idx] = blockId;
          }
        }

        if (surfaceY < SEA_LEVEL) {
          for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
            const idx = (y << 8) | (lz << 4) | lx;
            if (blocks[idx] === BLOCK_IDS.AIR) {
              blocks[idx] = BLOCK_IDS.WATER;
            }
          }
        } else if (!isRiver && surfaceY > SEA_LEVEL + 1 && surfaceY < CHUNK_HEIGHT - 4) {
          const aboveIdx = ((surfaceY + 1) << 8) | (lz << 4) | lx;
          if (blocks[aboveIdx] === BLOCK_IDS.AIR) {
            if (
              surfaceBlock === BLOCK_IDS.GRASS &&
              (biome.id === BIOMES.PLAINS || biome.id === BIOMES.VALLEY || biome.id === BIOMES.FOREST)
            ) {
              const floraRoll = hash2D(wx, wz, this.seed + 2207);
              if (floraRoll < 0.014) {
                blocks[aboveIdx] = BLOCK_IDS.FLOWER;
              } else if (floraRoll < 0.11) {
                blocks[aboveIdx] = BLOCK_IDS.TALL_GRASS;
              }
            } else if (biome.id === BIOMES.DESERT && surfaceBlock === BLOCK_IDS.SAND) {
              const cactusRoll = hash2D(wx, wz, this.seed + 2411);
              if (cactusRoll < 0.0055) {
                const cactusHeight = 2 + Math.floor(hash2D(wx, wz, this.seed + 2477) * 2);
                for (let ch = 1; ch <= cactusHeight && surfaceY + ch < CHUNK_HEIGHT; ch++) {
                  blocks[((surfaceY + ch) << 8) | (lz << 4) | lx] = BLOCK_IDS.CACTUS;
                }
              }
            }
          }
        }
      }
    }

    // Pass 2: Deterministic cross-chunk oak & spruce trees
    this._generateTreesForChunk(chunk);

    // Pass 3: Deterministic world structures (Woodland Cottages, Desert Wells, Mossy Dungeons)
    this._generateStructuresForChunk(chunk);

    chunk.generated = true;
    chunk.dirty = true;
    chunk.markAllSectionsDirty?.();
  }

  /**
   * Generates a full Nether dimension chunk: bedrock floor/ceiling, 3D netherrack caverns,
   * lava sea, soul sand shores, nether quartz ore, hanging glowstone, and nether brick ruins.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   * @private
   */
  _generateNetherChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(BLOCK_IDS.AIR);

    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        const floorBedrock = 1 + Math.floor(hash2D(wx, wz, this.seed + 911) * 2);
        const ceilBedrock = CHUNK_HEIGHT - 2 - Math.floor(hash2D(wx, wz, this.seed + 919) * 3);

        const floorBase = 22 + this.elevationNoise.fbm2D(wx * 0.022, wz * 0.022, 3, 2.0, 0.5) * 16;
        const ceilBase = 92 + this.ridgeNoise.fbm2D(wx * 0.02, wz * 0.02, 2, 2.0, 0.5) * 14;
        const soulMask = this.detailNoise.noise2D(wx * 0.045 + 17, wz * 0.045 - 11);

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = (y << 8) | (lz << 4) | lx;
          if (y <= floorBedrock || y >= ceilBedrock) {
            blocks[idx] = BLOCK_IDS.BEDROCK;
            continue;
          }

          // 3D cavern density field: solid near floor/ceiling, carved dramatic arches in mid-band
          const density3D = this.netherNoise.noise3D(wx * 0.032, y * 0.048, wz * 0.032);
          const distFromFloor = (y - floorBase) / 14;
          const distFromCeil = (ceilBase - y) / 16;
          const solidFloor = distFromFloor < 0.25 + density3D * 0.75;
          const solidCeil = distFromCeil < 0.22 + density3D * 0.65;
          const pillar = density3D > 0.44;

          if (solidFloor || solidCeil || pillar) {
            let blockId = BLOCK_IDS.NETHERRACK;
            // Soul Sand shoreline beaches near lava level
            if (y >= NETHER_LAVA_LEVEL - 1 && y <= NETHER_LAVA_LEVEL + 4 && soulMask > 0.22 && !solidCeil) {
              blockId = BLOCK_IDS.SOUL_SAND;
            } else if (y > 8 && y < 110) {
              const quartz = this.oreNoise.noise3D(wx * 0.21 + 19.3, y * 0.23, wz * 0.21 - 27.8);
              if (quartz > 0.71) {
                blockId = BLOCK_IDS.NETHER_QUARTZ_ORE;
              }
            }
            blocks[idx] = blockId;
          } else if (y <= NETHER_LAVA_LEVEL) {
            blocks[idx] = BLOCK_IDS.LAVA;
          }
        }

        // Hanging Glowstone stalactite clusters on cavern ceilings
        const glowRoll = hash2D(wx, wz, this.seed + 3331);
        if (glowRoll < 0.018) {
          for (let y = 104; y >= 62; y--) {
            const idx = (y << 8) | (lz << 4) | lx;
            const belowIdx = ((y - 1) << 8) | (lz << 4) | lx;
            if (blocks[idx] === BLOCK_IDS.NETHERRACK && blocks[belowIdx] === BLOCK_IDS.AIR) {
              const len = 2 + Math.floor(hash2D(wx, wz, this.seed + 3347) * 3);
              for (let d = 1; d <= len && y - d > NETHER_LAVA_LEVEL + 4; d++) {
                blocks[((y - d) << 8) | (lz << 4) | lx] = BLOCK_IDS.GLOWSTONE;
              }
              break;
            }
          }
        }
      }
    }

    // Occasional Nether Brick ruin outpost with loot chest
    this._generateNetherRuinsForChunk(chunk);

    chunk.generated = true;
    chunk.dirty = true;
    chunk.markAllSectionsDirty?.();
  }

  /** @private */
  _generateNetherRuinsForChunk(chunk) {
    const cellSize = 64;
    const minCX = Math.floor((chunk.worldX - 8) / cellSize);
    const maxCX = Math.floor((chunk.worldX + CHUNK_WIDTH + 8) / cellSize);
    const minCZ = Math.floor((chunk.worldZ - 8) / cellSize);
    const maxCZ = Math.floor((chunk.worldZ + CHUNK_DEPTH + 8) / cellSize);

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        if (hash2D(cx, cz, this.seed + 8811) > 0.35) continue;
        const ox = cx * cellSize + 12 + Math.floor(hash2D(cx, cz, this.seed + 8819) * (cellSize - 24));
        const oz = cz * cellSize + 12 + Math.floor(hash2D(cx, cz, this.seed + 8827) * (cellSize - 24));
        const oy = 34;

        // 7x7 Nether Brick platform & pillars
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            this._setIfInChunk(chunk, ox + dx, oy, oz + dz, BLOCK_IDS.NETHER_BRICKS);
            for (let dy = 1; dy <= 5; dy++) {
              this._setIfInChunk(chunk, ox + dx, oy + dy, oz + dz, BLOCK_IDS.AIR);
            }
            // Pillars down to lava bed
            if (Math.abs(dx) === 3 && Math.abs(dz) === 3) {
              for (let py = oy - 1; py >= NETHER_LAVA_LEVEL - 4; py--) {
                this._setIfInChunk(chunk, ox + dx, py, oz + dz, BLOCK_IDS.NETHER_BRICKS);
              }
              for (let py = 1; py <= 4; py++) {
                this._setIfInChunk(chunk, ox + dx, oy + py, oz + dz, BLOCK_IDS.NETHER_BRICKS);
              }
            }
          }
        }
        // Top rim & glowstone beacon
        for (let dx = -3; dx <= 3; dx++) {
          this._setIfInChunk(chunk, ox + dx, oy + 5, oz - 3, BLOCK_IDS.NETHER_BRICKS);
          this._setIfInChunk(chunk, ox + dx, oy + 5, oz + 3, BLOCK_IDS.NETHER_BRICKS);
        }
        for (let dz = -3; dz <= 3; dz++) {
          this._setIfInChunk(chunk, ox - 3, oy + 5, oz + dz, BLOCK_IDS.NETHER_BRICKS);
          this._setIfInChunk(chunk, ox + 3, oy + 5, oz + dz, BLOCK_IDS.NETHER_BRICKS);
        }
        this._setIfInChunk(chunk, ox, oy + 1, oz, BLOCK_IDS.GLOWSTONE);
        // Nether Wart farm strip inside Nether Ruins
        for (let wxOff = -2; wxOff <= -1; wxOff++) {
          for (let wzOff = -1; wzOff <= 1; wzOff++) {
            this._setIfInChunk(chunk, ox + wxOff, oy, oz + wzOff, BLOCK_IDS.SOUL_SAND);
            this._setIfInChunk(chunk, ox + wxOff, oy + 1, oz + wzOff, BLOCK_IDS.NETHER_WART_BLOCK);
          }
        }
        if (this._setIfInChunk(chunk, ox + 2, oy + 1, oz, BLOCK_IDS.CHEST)) {
          this.onStructureChestSpawn?.(ox + 2, oy + 1, oz, 'nether_ruin');
        }
      }
    }
  }

  /**
   * Generates The End floating End Stone island, 8 Obsidian pillars, Exit Portal fountain, and arrival platform.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   * @private
   */
  _generateEndChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(BLOCK_IDS.AIR);

    for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
      const wz = chunk.worldZ + lz;
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wx = chunk.worldX + lx;
        const dist = Math.hypot(wx, wz);
        const edgeJitter = this.detailNoise.noise2D(wx * 0.06, wz * 0.06) * 4.5;
        const effDist = dist + edgeJitter;
        if (effDist <= 46) {
          const norm = Math.max(0, 1 - effDist / 46);
          const surfaceY = Math.round(54 + Math.sqrt(norm) * 2.5 + this.elevationNoise.noise2D(wx * 0.05, wz * 0.05) * 1.4);
          const bottomY = Math.round(53 - Math.pow(norm, 0.75) * 15);
          for (let y = Math.max(8, bottomY); y <= surfaceY; y++) {
            blocks[(y << 8) | (lz << 4) | lx] = BLOCK_IDS.END_STONE;
          }
        }
      }
    }

    // Stamp 8 tall Obsidian End Crystal pillars around the arena
    const pillars = getEndPillarPositions();
    for (const p of pillars) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let y = 44; y <= p.topY; y++) {
            this._setIfInChunk(chunk, p.x + dx, y, p.z + dz, BLOCK_IDS.OBSIDIAN);
          }
        }
      }
      this._setIfInChunk(chunk, p.x, p.topY + 1, p.z, BLOCK_IDS.BEDROCK);
    }

    // Center End Exit Portal Fountain at (0, 56, 0)
    const fy = 56;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const d = Math.hypot(dx, dz);
        if (d <= 3.3 && d >= 2.2) {
          this._setIfInChunk(chunk, dx, fy, dz, BLOCK_IDS.BEDROCK);
        } else if (d < 2.2) {
          this._setIfInChunk(chunk, dx, fy - 1, dz, BLOCK_IDS.BEDROCK);
          this._setIfInChunk(chunk, dx, fy, dz, BLOCK_IDS.AIR);
        }
      }
    }
    for (let py = fy; py <= fy + 3; py++) {
      this._setIfInChunk(chunk, 0, py, 0, BLOCK_IDS.BEDROCK);
    }
    this._setIfInChunk(chunk, 1, fy + 2, 0, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, -1, fy + 2, 0, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, 0, fy + 2, 1, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, 0, fy + 2, -1, BLOCK_IDS.TORCH);

    // Safe Obsidian arrival platform at (0, 55, 36)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this._setIfInChunk(chunk, dx, 55, 36 + dz, BLOCK_IDS.OBSIDIAN);
        for (let dy = 1; dy <= 3; dy++) {
          this._setIfInChunk(chunk, dx, 55 + dy, 36 + dz, BLOCK_IDS.AIR);
        }
      }
    }

    chunk.generated = true;
    chunk.dirty = true;
    chunk.markAllSectionsDirty?.();
  }

  /**
   * Deterministically generates Overworld structures (Woodland Cottages, Desert Wells, Mossy Dungeons)
   * across chunk boundaries without clipping.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   * @private
   */
  _generateStructuresForChunk(chunk) {
    // 1. Surface structures (Woodland Oak Cottage / Desert Well) on a 56x56 cell grid
    const surfCell = 56;
    const minSCX = Math.floor((chunk.worldX - 8) / surfCell);
    const maxSCX = Math.floor((chunk.worldX + CHUNK_WIDTH + 8) / surfCell);
    const minSCZ = Math.floor((chunk.worldZ - 8) / surfCell);
    const maxSCZ = Math.floor((chunk.worldZ + CHUNK_DEPTH + 8) / surfCell);

    for (let cz = minSCZ; cz <= maxSCZ; cz++) {
      for (let cx = minSCX; cx <= maxSCX; cx++) {
        // Keep immediate world origin (0,0) clear of overlapping cabins
        if (cx === 0 && cz === 0) continue;
        const roll = hash2D(cx, cz, this.seed + 5101);
        if (roll > 0.34) continue;

        const sx = cx * surfCell + 10 + Math.floor(hash2D(cx, cz, this.seed + 5113) * (surfCell - 20));
        const sz = cz * surfCell + 10 + Math.floor(hash2D(cx, cz, this.seed + 5119) * (surfCell - 20));
        const info = this.getColumnInfo(sx, sz);

        if (info.isRiver || info.height <= SEA_LEVEL + 2 || info.height >= 60) continue;

        if (
          info.biome.id === BIOMES.PLAINS ||
          info.biome.id === BIOMES.FOREST ||
          info.biome.id === BIOMES.VALLEY
        ) {
          // Verify reasonably flat ground across footprint
          const h1 = this.getHeightAt(sx - 3, sz - 3);
          const h2 = this.getHeightAt(sx + 3, sz + 3);
          const h3 = this.getHeightAt(sx - 3, sz + 3);
          const h4 = this.getHeightAt(sx + 3, sz - 3);
          const minH = Math.min(info.height, h1, h2, h3, h4);
          const maxH = Math.max(info.height, h1, h2, h3, h4);
          if (maxH - minH <= 3 && minH > SEA_LEVEL + 1) {
            this._stampWoodlandCottage(chunk, sx, info.height, sz);
          }
        } else if (info.biome.id === BIOMES.DESERT) {
          this._stampDesertWell(chunk, sx, info.height, sz);
        }
      }
    }

    // 2. Underground Mossy Cobblestone Dungeons on a 44x44 cell grid
    const dungCell = 44;
    const minDCX = Math.floor((chunk.worldX - 6) / dungCell);
    const maxDCX = Math.floor((chunk.worldX + CHUNK_WIDTH + 6) / dungCell);
    const minDCZ = Math.floor((chunk.worldZ - 6) / dungCell);
    const maxDCZ = Math.floor((chunk.worldZ + CHUNK_DEPTH + 6) / dungCell);

    for (let cz = minDCZ; cz <= maxDCZ; cz++) {
      for (let cx = minDCX; cx <= maxDCX; cx++) {
        const roll = hash2D(cx, cz, this.seed + 6421);
        if (roll > 0.36) continue;

        const dx = cx * dungCell + 8 + Math.floor(hash2D(cx, cz, this.seed + 6427) * (dungCell - 16));
        const dz = cz * dungCell + 8 + Math.floor(hash2D(cx, cz, this.seed + 6449) * (dungCell - 16));
        const surfaceY = this.getHeightAt(dx, dz);
        const dy = 12 + Math.floor(hash2D(cx, cz, this.seed + 6451) * 14);
        if (dy < surfaceY - 9) {
          this._stampMossyDungeon(chunk, dx, dy, dz);
        }
      }
    }

    // 3. Deterministic Stronghold End Portal Room
    const sh = getStrongholdCoords(this.seed);
    if (
      chunk.worldX + CHUNK_WIDTH >= sh.x - 7 &&
      chunk.worldX <= sh.x + 7 &&
      chunk.worldZ + CHUNK_DEPTH >= sh.z - 7 &&
      chunk.worldZ <= sh.z + 7
    ) {
      this._stampStrongholdPortalRoom(chunk, sh.x, sh.y, sh.z);
    }
  }

  /**
   * Stamps the iconic Stronghold End Portal Room with 12 End Portal Frames, stone brick walls,
   * lava pit beneath the portal, stairs, torches, and a treasure chest.
   * @private
   */
  _stampStrongholdPortalRoom(chunk, cx, baseY, cz) {
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dy = 0; dy <= 6; dy++) {
          const isShell =
            Math.abs(dx) === 5 || Math.abs(dz) === 5 || dy === 0 || dy === 6;
          if (isShell) {
            this._setIfInChunk(chunk, cx + dx, baseY + dy, cz + dz, BLOCK_IDS.STONE_BRICKS);
          } else {
            this._setIfInChunk(chunk, cx + dx, baseY + dy, cz + dz, BLOCK_IDS.AIR);
          }
        }
      }
    }

    // Lava pool under the 3x3 portal center
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this._setIfInChunk(chunk, cx + dx, baseY + 1, cz + dz, BLOCK_IDS.LAVA);
      }
    }

    // Raised dais & 12 End Portal Frames forming a 5x5 hollow ring at baseY + 2
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const onEdge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (onEdge) {
          this._setIfInChunk(chunk, cx + dx, baseY + 1, cz + dz, BLOCK_IDS.STONE_BRICKS);
          if (!isCorner) {
            this._setIfInChunk(chunk, cx + dx, baseY + 2, cz + dz, BLOCK_IDS.END_PORTAL_FRAME);
          }
        }
      }
    }

    // Approach stairs & lighting
    for (let dx = -1; dx <= 1; dx++) {
      this._setIfInChunk(chunk, cx + dx, baseY + 1, cz + 3, BLOCK_IDS.COBBLESTONE_STAIRS);
    }
    this._setIfInChunk(chunk, cx - 4, baseY + 3, cz - 4, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, cx + 4, baseY + 3, cz - 4, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, cx - 4, baseY + 3, cz + 4, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, cx + 4, baseY + 3, cz + 4, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, cx, baseY + 5, cz, BLOCK_IDS.LANTERN);

    // Stronghold supply chest
    if (this._setIfInChunk(chunk, cx - 4, baseY + 1, cz, BLOCK_IDS.CHEST)) {
      this.onStructureChestSpawn?.(cx - 4, baseY + 1, cz, 'stronghold');
    }
  }

  /**
   * Stamps a 7x5x7 oak woodland cottage with foundation, glass windows, door, crafting table,
   * red bed, torch, and loot chest.
   * @private
   */
  _stampWoodlandCottage(chunk, cx, baseY, cz) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const wx = cx + dx;
        const wz = cz + dz;
        // Cobblestone foundation + downward stilts for gentle slopes
        for (let py = baseY; py >= baseY - 3; py--) {
          const existing = this._getIfInChunk(chunk, wx, py, wz);
          if (py === baseY || existing === BLOCK_IDS.AIR || existing === BLOCK_IDS.WATER) {
            this._setIfInChunk(chunk, wx, py, wz, BLOCK_IDS.COBBLESTONE);
          }
        }

        // Clear interior & build walls (dy = 1..3)
        const isEdgeX = Math.abs(dx) === 3;
        const isEdgeZ = Math.abs(dz) === 3;
        const isCorner = isEdgeX && isEdgeZ;
        const isWall = isEdgeX || isEdgeZ;

        for (let dy = 1; dy <= 3; dy++) {
          let blockId = BLOCK_IDS.AIR;
          if (isCorner) {
            blockId = BLOCK_IDS.OAK_LOG;
          } else if (isWall) {
            // Front doorway at dz === 3, dx === 0
            if (dz === 3 && dx === 0 && dy <= 2) {
              blockId = dy === 1 ? BLOCK_IDS.OAK_DOOR_CLOSED : BLOCK_IDS.AIR;
            } else if (dy === 2 && ((isEdgeX && Math.abs(dz) <= 1) || (dz === -3 && Math.abs(dx) <= 1))) {
              blockId = BLOCK_IDS.GLASS;
            } else {
              blockId = BLOCK_IDS.OAK_PLANKS;
            }
          }
          this._setIfInChunk(chunk, wx, baseY + dy, wz, blockId);
        }

        // Pitched oak plank roof (dy = 4..5)
        this._setIfInChunk(chunk, wx, baseY + 4, wz, BLOCK_IDS.OAK_PLANKS);
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
          this._setIfInChunk(chunk, wx, baseY + 5, wz, BLOCK_IDS.OAK_PLANKS);
        }
      }
    }

    // Interior furnishings
    this._setIfInChunk(chunk, cx - 2, baseY + 1, cz - 2, BLOCK_IDS.CRAFTING_TABLE);
    this._setIfInChunk(chunk, cx + 2, baseY + 1, cz - 2, BLOCK_IDS.BED);
    this._setIfInChunk(chunk, cx, baseY + 2, cz - 2, BLOCK_IDS.TORCH);
    this._setIfInChunk(chunk, cx, baseY + 1, cz + 4, BLOCK_IDS.COBBLESTONE); // Doorstep

    if (this._setIfInChunk(chunk, cx - 2, baseY + 1, cz + 1, BLOCK_IDS.CHEST)) {
      this.onStructureChestSpawn?.(cx - 2, baseY + 1, cz + 1, 'cottage');
    }
  }

  /**
   * Stamps a classic 5x5 desert well with central water source and sandstone pillars.
   * @private
   */
  _stampDesertWell(chunk, cx, baseY, cz) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const wx = cx + dx;
        const wz = cz + dz;
        const isOuter = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        this._setIfInChunk(chunk, wx, baseY - 1, wz, BLOCK_IDS.SAND);
        if (isOuter) {
          this._setIfInChunk(chunk, wx, baseY, wz, BLOCK_IDS.COBBLESTONE);
          this._setIfInChunk(chunk, wx, baseY + 1, wz, BLOCK_IDS.AIR);
        } else {
          this._setIfInChunk(chunk, wx, baseY, wz, BLOCK_IDS.WATER);
          this._setIfInChunk(chunk, wx, baseY + 1, wz, BLOCK_IDS.AIR);
        }
        // Corner pillars & canopy roof
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
          this._setIfInChunk(chunk, wx, baseY + 1, wz, BLOCK_IDS.COBBLESTONE);
          this._setIfInChunk(chunk, wx, baseY + 2, wz, BLOCK_IDS.COBBLESTONE);
          this._setIfInChunk(chunk, wx, baseY + 3, wz, BLOCK_IDS.COBBLESTONE);
        }
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
          this._setIfInChunk(chunk, wx, baseY + 4, wz, BLOCK_IDS.SAND);
        }
      }
    }
  }

  /**
   * Stamps a 7x5x7 underground mossy-cobblestone dungeon chamber with torch & 1-2 loot chests.
   * @private
   */
  _stampMossyDungeon(chunk, cx, baseY, cz) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = 0; dy <= 4; dy++) {
          const wx = cx + dx;
          const wy = baseY + dy;
          const wz = cz + dz;
          const isBoundary =
            Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === 0 || dy === 4;
          if (isBoundary) {
            const mossy = hash2D(wx + dy * 13, wz - dy * 7, this.seed + 7121) < 0.45;
            this._setIfInChunk(
              chunk,
              wx,
              wy,
              wz,
              mossy ? BLOCK_IDS.MOSSY_COBBLESTONE : BLOCK_IDS.COBBLESTONE
            );
          } else {
            this._setIfInChunk(chunk, wx, wy, wz, BLOCK_IDS.AIR);
          }
        }
      }
    }

    this._setIfInChunk(chunk, cx, baseY + 1, cz, BLOCK_IDS.TORCH);
    if (this._setIfInChunk(chunk, cx - 2, baseY + 1, cz - 2, BLOCK_IDS.CHEST)) {
      this.onStructureChestSpawn?.(cx - 2, baseY + 1, cz - 2, 'dungeon');
    }
    if (hash2D(cx, cz, this.seed + 7159) < 0.55) {
      if (this._setIfInChunk(chunk, cx + 2, baseY + 1, cz + 2, BLOCK_IDS.CHEST)) {
        this.onStructureChestSpawn?.(cx + 2, baseY + 1, cz + 2, 'dungeon');
      }
    }
  }

  /**
   * Deterministically places oak & spruce trees whose trunk or canopy intersect this chunk.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   * @private
   */
  _generateTreesForChunk(chunk) {
    const margin = 2;
    const minWX = chunk.worldX - margin;
    const maxWX = chunk.worldX + CHUNK_WIDTH - 1 + margin;
    const minWZ = chunk.worldZ - margin;
    const maxWZ = chunk.worldZ + CHUNK_DEPTH - 1 + margin;

    for (let wz = minWZ; wz <= maxWZ; wz++) {
      for (let wx = minWX; wx <= maxWX; wx++) {
        if (!this._shouldSpawnTreeAt(wx, wz)) continue;

        const { height: groundY, biome, isRiver } = this.getColumnInfo(wx, wz);
        if (isRiver || groundY <= SEA_LEVEL + 1 || groundY >= 67) continue;
        if (biome.surfaceBlock !== BLOCK_IDS.GRASS && biome.id !== BIOMES.SNOWY_TAIGA) continue;

        const isSpruce = biome.id === BIOMES.SNOWY_TAIGA;
        const logId = isSpruce ? BLOCK_IDS.SPRUCE_LOG : BLOCK_IDS.OAK_LOG;
        const leavesId = isSpruce ? BLOCK_IDS.SPRUCE_LEAVES : BLOCK_IDS.OAK_LEAVES;

        const trunkHeight = (isSpruce ? 5 : 4) + Math.floor(hash2D(wx, wz, this.seed + 1313) * 3);
        const topY = groundY + trunkHeight;
        if (topY + 2 >= CHUNK_HEIGHT) continue;

        this._setIfInChunk(chunk, wx, groundY, wz, BLOCK_IDS.DIRT);

        if (isSpruce) {
          for (let dy = -3; dy <= 1; dy++) {
            const ly = topY + dy;
            const radius = dy === 1 ? 0 : dy === 0 ? 1 : dy === -1 ? 2 : dy === -2 ? 1 : 2;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                if (radius === 2 && Math.abs(dx) + Math.abs(dz) > 2) continue;
                if (dx === 0 && dz === 0 && dy <= 0) continue;
                const tx = wx + dx;
                const tz = wz + dz;
                if (
                  tx >= chunk.worldX &&
                  tx < chunk.worldX + CHUNK_WIDTH &&
                  tz >= chunk.worldZ &&
                  tz < chunk.worldZ + CHUNK_DEPTH
                ) {
                  const lx = tx - chunk.worldX;
                  const lz = tz - chunk.worldZ;
                  const existing = chunk.getBlock(lx, ly, lz);
                  if (existing === BLOCK_IDS.AIR || existing === BLOCK_IDS.TALL_GRASS || existing === BLOCK_IDS.FLOWER) {
                    chunk.setBlock(lx, ly, lz, leavesId, false);
                  }
                }
              }
            }
          }
        } else {
          for (let dy = -2; dy <= 1; dy++) {
            const ly = topY + dy;
            const radius = dy >= 0 ? (dy === 1 ? 1 : 2) : 2;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const distMan = Math.abs(dx) + Math.abs(dz);
                if (dy === 1 && distMan > 1) continue;
                if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
                  if (dy === 0 || hash2D(wx + dx, wz + dz, this.seed + ly) < 0.65) continue;
                }
                if (dx === 0 && dz === 0 && dy <= 0) continue;

                const tx = wx + dx;
                const tz = wz + dz;
                if (
                  tx >= chunk.worldX &&
                  tx < chunk.worldX + CHUNK_WIDTH &&
                  tz >= chunk.worldZ &&
                  tz < chunk.worldZ + CHUNK_DEPTH
                ) {
                  const lx = tx - chunk.worldX;
                  const lz = tz - chunk.worldZ;
                  const existing = chunk.getBlock(lx, ly, lz);
                  if (existing === BLOCK_IDS.AIR || existing === BLOCK_IDS.TALL_GRASS || existing === BLOCK_IDS.FLOWER) {
                    chunk.setBlock(lx, ly, lz, leavesId, false);
                  }
                }
              }
            }
          }
        }

        for (let dy = 1; dy <= trunkHeight; dy++) {
          this._setIfInChunk(chunk, wx, groundY + dy, wz, logId);
        }
      }
    }
  }

  /** @private */
  _shouldSpawnTreeAt(wx, wz) {
    const biome = this.biomeGenerator.getBiome(wx, wz);
    if (biome.treeChance <= 0) return false;

    const score = hash2D(wx, wz, this.seed + 777);
    if (score >= biome.treeChance) return false;

    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nScore = hash2D(wx + dx, wz + dz, this.seed + 777);
        if (nScore < biome.treeChance && nScore < score) {
          return false;
        }
      }
    }
    return true;
  }

  /** @private */
  _getIfInChunk(chunk, wx, wy, wz) {
    const lx = wx - chunk.worldX;
    const lz = wz - chunk.worldZ;
    if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH && wy >= 0 && wy < CHUNK_HEIGHT) {
      return chunk.getBlock(lx, wy, lz);
    }
    return -1;
  }

  /**
   * Helper to set block only if world coordinates lie inside target chunk.
   * Returns true if the block was written inside this chunk.
   * @private
   */
  _setIfInChunk(chunk, wx, wy, wz, blockId) {
    const lx = wx - chunk.worldX;
    const lz = wz - chunk.worldZ;
    if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH && wy >= 0 && wy < CHUNK_HEIGHT) {
      chunk.setBlock(lx, wy, lz, blockId, false);
      return true;
    }
    return false;
  }
}
