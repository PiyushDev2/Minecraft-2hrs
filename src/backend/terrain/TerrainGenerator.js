/**
 * @file TerrainGenerator.js
 * @description Procedural multi-biome terrain generator with mountains, plains,
 * valleys, oceans, beaches, caves, water bodies, and seamless cross-chunk oak trees.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from '../chunks/Chunk.js';
import { BiomeGenerator, BIOMES } from './BiomeGenerator.js';
import { Noise, hash2D, normalizeSeed } from './Noise.js';

export const SEA_LEVEL = 32;

/**
 * Generates deterministic 3D voxel terrain and vegetation for chunks from a seed.
 */
export class TerrainGenerator {
  /**
   * @param {number|string} [seed=1337]
   */
  constructor(seed = 1337) {
    this.seed = normalizeSeed(seed);
    this.biomeGenerator = new BiomeGenerator(this.seed);
    this.elevationNoise = new Noise(this.seed + 505);
    this.ridgeNoise = new Noise(this.seed + 606);
    this.detailNoise = new Noise(this.seed + 707);
    this.caveNoise = new Noise(this.seed + 808);
    this.riverNoise = new Noise(this.seed + 909);
    this.oreNoise = new Noise(this.seed + 1010);
  }

  /**
   * Computes deterministic terrain surface info at world (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {{ height: number, biome: Object, isRiver: boolean }}
   */
  getColumnInfo(x, z) {
    const params = this.biomeGenerator.getBlendedBiomeParams(x, z);
    const biome = params.primaryBiome;

    // Primary rolling terrain FBM
    const fbm = this.elevationNoise.fbm2D(x * 0.0075, z * 0.0075, 4, 2.0, 0.5);
    // Ridged noise for mountain crests
    const ridge = this.ridgeNoise.ridged2D(x * 0.009, z * 0.009, 3, 2.1, 0.5);
    // Fine local hills/variation
    const detail = this.detailNoise.fbm2D(x * 0.032, z * 0.032, 2, 2.0, 0.5) * 2.4;

    let height =
      params.baseHeight +
      fbm * params.heightAmplitude +
      Math.pow(ridge, 1.4) * params.ridgeStrength +
      detail;

    // Carve winding river channels across non-ocean/non-peak terrain
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
   * @returns {{ id: string, name: string, baseHeight: number, heightAmplitude: number, ridgeStrength: number, surfaceBlock: number, subsurfaceBlock: number, treeChance: number, grassColor: number }}
   */
  getBiomeAt(x, z) {
    return this.biomeGenerator.getBiome(x, z);
  }

  /**
   * Populates a Chunk's voxel array with terrain, caves, water, and cross-chunk trees.
   * @param {import('../chunks/Chunk.js').Chunk} chunk
   */
  generateChunk(chunk) {
    const blocks = chunk.blocks;
    blocks.fill(BLOCK_IDS.AIR);

    // Precompute 16x16 surface column heights and biomes
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

        // Determine surface and subsurface block types based on altitude & biome
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

          // Carve underground 3D caves (never break bedrock or breach ocean bed)
          if (y < surfaceY - 3 && y > 3) {
            const caveVal = Math.abs(this.caveNoise.noise3D(wx * 0.045, y * 0.06, wz * 0.045));
            const caveVal2 = Math.abs(this.caveNoise.noise3D(wx * 0.045 + 31.7, y * 0.06 - 12.4, wz * 0.045 + 19.2));
            if (caveVal < 0.095 && caveVal2 < 0.14 && !(surfaceY <= SEA_LEVEL + 1 && y > surfaceY - 6)) {
              continue; // Leave as AIR
            }
          }

          if (y === surfaceY) {
            blocks[idx] = surfaceBlock;
          } else if (y >= surfaceY - dirtDepth) {
            blocks[idx] = subsurfaceBlock;
          } else {
            // Deterministic Coal & Iron ore veins inside Stone strata
            let blockId = BLOCK_IDS.STONE;
            if (y <= 46 && y >= 5) {
              const ironSample = this.oreNoise.noise3D(wx * 0.19 + 41.2, y * 0.22, wz * 0.19 - 17.5);
              if (ironSample > 0.68) {
                blockId = BLOCK_IDS.IRON_ORE;
              }
            }
            if (blockId === BLOCK_IDS.STONE && y <= 62 && y >= 6) {
              const coalSample = this.oreNoise.noise3D(wx * 0.15 - 12.8, y * 0.17, wz * 0.15 + 29.1);
              if (coalSample > 0.62) {
                blockId = BLOCK_IDS.COAL_ORE;
              }
            }
            blocks[idx] = blockId;
          }
        }

        // Fill water up to SEA_LEVEL
        if (surfaceY < SEA_LEVEL) {
          for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
            const idx = (y << 8) | (lz << 4) | lx;
            if (blocks[idx] === BLOCK_IDS.AIR) {
              blocks[idx] = BLOCK_IDS.WATER;
            }
          }
        } else if (!isRiver && surfaceY > SEA_LEVEL + 1 && surfaceY < CHUNK_HEIGHT - 4) {
          // Surface flora (Tall Grass, Wildflowers, Desert Cacti)
          const aboveIdx = ((surfaceY + 1) << 8) | (lz << 4) | lx;
          if (blocks[aboveIdx] === BLOCK_IDS.AIR) {
            if (surfaceBlock === BLOCK_IDS.GRASS && (biome.id === BIOMES.PLAINS || biome.id === BIOMES.VALLEY || biome.id === BIOMES.FOREST)) {
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

    // Pass 2: Deterministic cross-chunk oak & spruce trees (2-block canopy padding around chunk)
    this._generateTreesForChunk(chunk);

    chunk.generated = true;
    chunk.dirty = true;
  }

  /**
   * Deterministically places oak trees whose trunk or canopy intersect this chunk.
   * Checking a 2-block margin outside chunk bounds prevents cut-off leaves across chunk borders.
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
        if (!this._shouldSpawnTreeAt(wx, wz)) {
          continue;
        }

        const { height: groundY, biome, isRiver } = this.getColumnInfo(wx, wz);
        if (isRiver || groundY <= SEA_LEVEL + 1 || groundY >= 67) {
          continue;
        }
        if (biome.surfaceBlock !== BLOCK_IDS.GRASS && biome.id !== BIOMES.SNOWY_TAIGA) {
          continue;
        }

        const isSpruce = biome.id === BIOMES.SNOWY_TAIGA;
        const logId = isSpruce ? BLOCK_IDS.SPRUCE_LOG : BLOCK_IDS.OAK_LOG;
        const leavesId = isSpruce ? BLOCK_IDS.SPRUCE_LEAVES : BLOCK_IDS.OAK_LEAVES;

        const trunkHeight = (isSpruce ? 5 : 4) + Math.floor(hash2D(wx, wz, this.seed + 1313) * 3);
        const topY = groundY + trunkHeight;
        if (topY + 2 >= CHUNK_HEIGHT) {
          continue;
        }

        // Replace surface beneath trunk with dirt if inside this chunk
        this._setIfInChunk(chunk, wx, groundY, wz, BLOCK_IDS.DIRT);

        if (isSpruce) {
          // Tiered conical pine canopy
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
          // Rounded oak leaf canopy (layers from topY - 2 to topY + 1)
          for (let dy = -2; dy <= 1; dy++) {
            const ly = topY + dy;
            const radius = dy >= 0 ? (dy === 1 ? 1 : 2) : 2;
            for (let dz = -radius; dz <= radius; dz++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const distMan = Math.abs(dx) + Math.abs(dz);
                if (dy === 1 && distMan > 1) continue;
                if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
                  if (dy === 0 || hash2D(wx + dx, wz + dz, this.seed + ly) < 0.65) {
                    continue;
                  }
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

        // Stamp trunk logs
        for (let dy = 1; dy <= trunkHeight; dy++) {
          this._setIfInChunk(chunk, wx, groundY + dy, wz, logId);
        }
      }
    }
  }

  /**
   * Checks deterministic local-maximum spacing so trees never spawn adjacent to each other.
   * @param {number} wx
   * @param {number} wz
   * @returns {boolean}
   * @private
   */
  _shouldSpawnTreeAt(wx, wz) {
    const biome = this.biomeGenerator.getBiome(wx, wz);
    if (biome.treeChance <= 0) return false;

    const score = hash2D(wx, wz, this.seed + 777);
    if (score >= biome.treeChance) return false;

    // Ensure no neighbor within 2 blocks also spawns a tree with higher score
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

  /**
   * Helper to set block only if world coordinates lie inside target chunk.
   * @private
   */
  _setIfInChunk(chunk, wx, wy, wz, blockId) {
    const lx = wx - chunk.worldX;
    const lz = wz - chunk.worldZ;
    if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH && wy >= 0 && wy < CHUNK_HEIGHT) {
      chunk.setBlock(lx, wy, lz, blockId, false);
    }
  }
}
