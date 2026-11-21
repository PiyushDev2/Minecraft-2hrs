/**
 * @file BiomeGenerator.js
 * @description Climate-driven biome classification and smooth elevation parameter
 * blending (Plains, Forest, Desert, Mountains, Ocean, Beach, Valley).
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { Noise, normalizeSeed } from './Noise.js';

/**
 * Supported biome identifiers.
 * @readonly
 * @enum {string}
 */
export const BIOMES = Object.freeze({
  OCEAN: 'ocean',
  BEACH: 'beach',
  PLAINS: 'plains',
  FOREST: 'forest',
  DESERT: 'desert',
  MOUNTAINS: 'mountains',
  VALLEY: 'valley',
  SNOWY_TAIGA: 'snowy_taiga',
});

/**
 * Biome configuration profiles governing terrain shape, surface blocks, and vegetation.
 * @type {Record<string, Object>}
 */
export const BIOME_PROFILES = Object.freeze({
  [BIOMES.OCEAN]: {
    id: BIOMES.OCEAN,
    name: 'Ocean',
    baseHeight: 19,
    heightAmplitude: 7,
    ridgeStrength: 0,
    surfaceBlock: BLOCK_IDS.SAND,
    subsurfaceBlock: BLOCK_IDS.GRAVEL,
    treeChance: 0,
    grassColor: 0x4f9143,
  },
  [BIOMES.BEACH]: {
    id: BIOMES.BEACH,
    name: 'Beach',
    baseHeight: 33,
    heightAmplitude: 3,
    ridgeStrength: 0,
    surfaceBlock: BLOCK_IDS.SAND,
    subsurfaceBlock: BLOCK_IDS.SAND,
    treeChance: 0.001,
    grassColor: 0x6ca144,
  },
  [BIOMES.VALLEY]: {
    id: BIOMES.VALLEY,
    name: 'River Valley',
    baseHeight: 34,
    heightAmplitude: 5,
    ridgeStrength: 1,
    surfaceBlock: BLOCK_IDS.GRASS,
    subsurfaceBlock: BLOCK_IDS.DIRT,
    treeChance: 0.008,
    grassColor: 0x5aa340,
  },
  [BIOMES.PLAINS]: {
    id: BIOMES.PLAINS,
    name: 'Plains',
    baseHeight: 38,
    heightAmplitude: 8,
    ridgeStrength: 2,
    surfaceBlock: BLOCK_IDS.GRASS,
    subsurfaceBlock: BLOCK_IDS.DIRT,
    treeChance: 0.004,
    grassColor: 0x66a844,
  },
  [BIOMES.FOREST]: {
    id: BIOMES.FOREST,
    name: 'Oak Forest',
    baseHeight: 41,
    heightAmplitude: 12,
    ridgeStrength: 4,
    surfaceBlock: BLOCK_IDS.GRASS,
    subsurfaceBlock: BLOCK_IDS.DIRT,
    treeChance: 0.038,
    grassColor: 0x4e943a,
  },
  [BIOMES.DESERT]: {
    id: BIOMES.DESERT,
    name: 'Desert',
    baseHeight: 37,
    heightAmplitude: 9,
    ridgeStrength: 3,
    surfaceBlock: BLOCK_IDS.SAND,
    subsurfaceBlock: BLOCK_IDS.SAND,
    treeChance: 0,
    grassColor: 0xa0a653,
  },
  [BIOMES.MOUNTAINS]: {
    id: BIOMES.MOUNTAINS,
    name: 'Highlands & Mountains',
    baseHeight: 52,
    heightAmplitude: 24,
    ridgeStrength: 26,
    surfaceBlock: BLOCK_IDS.GRASS,
    subsurfaceBlock: BLOCK_IDS.STONE,
    treeChance: 0.006,
    grassColor: 0x568d4a,
  },
  [BIOMES.SNOWY_TAIGA]: {
    id: BIOMES.SNOWY_TAIGA,
    name: 'Snowy Taiga',
    baseHeight: 42,
    heightAmplitude: 11,
    ridgeStrength: 6,
    surfaceBlock: BLOCK_IDS.SNOW_BLOCK,
    subsurfaceBlock: BLOCK_IDS.DIRT,
    treeChance: 0.032,
    grassColor: 0x567d62,
  },
});

/**
 * Generates deterministic climate maps and blended biome parameters for any (x, z).
 */
export class BiomeGenerator {
  /**
   * @param {number|string} [seed=1337]
   */
  constructor(seed = 1337) {
    const base = normalizeSeed(seed);
    this.seed = base;
    this.continentalNoise = new Noise(base + 101);
    this.temperatureNoise = new Noise(base + 202);
    this.moistureNoise = new Noise(base + 303);
    this.erosionNoise = new Noise(base + 404);
  }

  /**
   * Samples raw climate values at world coordinates (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {{ continentalness: number, temperature: number, moisture: number, erosion: number }}
   */
  sampleClimate(x, z) {
    const scale = 0.0028;
    const continentalness = this.continentalNoise.fbm2D(x * scale * 0.85, z * scale * 0.85, 3, 2.0, 0.5);
    const temperature = this.temperatureNoise.fbm2D(x * scale, z * scale, 3, 2.0, 0.5);
    const moisture = this.moistureNoise.fbm2D(x * scale, z * scale, 3, 2.0, 0.5);
    const erosion = this.erosionNoise.fbm2D(x * scale * 1.3, z * scale * 1.3, 3, 2.0, 0.5);

    return { continentalness, temperature, moisture, erosion };
  }

  /**
   * Classifies a single (x, z) coordinate into a discrete biome profile.
   * @param {number} x
   * @param {number} z
   * @returns {{ id: string, name: string, baseHeight: number, heightAmplitude: number, ridgeStrength: number, surfaceBlock: number, subsurfaceBlock: number, treeChance: number, grassColor: number }}
   */
  getBiome(x, z) {
    const { continentalness, temperature, moisture, erosion } = this.sampleClimate(x, z);

    if (continentalness < -0.22) {
      return BIOME_PROFILES[BIOMES.OCEAN];
    }
    if (continentalness < -0.14) {
      return BIOME_PROFILES[BIOMES.BEACH];
    }
    if (temperature < -0.22) {
      return BIOME_PROFILES[BIOMES.SNOWY_TAIGA];
    }
    if (erosion < -0.26 && continentalness < 0.25) {
      return BIOME_PROFILES[BIOMES.VALLEY];
    }
    if (continentalness > 0.30 || erosion > 0.34) {
      return BIOME_PROFILES[BIOMES.MOUNTAINS];
    }
    if (temperature > 0.24 && moisture < -0.05) {
      return BIOME_PROFILES[BIOMES.DESERT];
    }
    if (moisture > 0.08) {
      return BIOME_PROFILES[BIOMES.FOREST];
    }
    return BIOME_PROFILES[BIOMES.PLAINS];
  }

  /**
   * Computes smoothly blended terrain parameters across a 5-point kernel
   * so biome height transitions remain natural without sudden vertical walls.
   * @param {number} x
   * @param {number} z
   * @returns {{ primaryBiome: Object, baseHeight: number, heightAmplitude: number, ridgeStrength: number, treeChance: number }}
   */
  getBlendedBiomeParams(x, z) {
    const primaryBiome = this.getBiome(x, z);
    const step = 12;

    const samples = [
      primaryBiome,
      primaryBiome,
      this.getBiome(x + step, z),
      this.getBiome(x - step, z),
      this.getBiome(x, z + step),
      this.getBiome(x, z - step),
    ];

    let baseHeight = 0;
    let heightAmplitude = 0;
    let ridgeStrength = 0;
    const count = samples.length;

    for (let i = 0; i < count; i++) {
      const b = samples[i];
      baseHeight += b.baseHeight;
      heightAmplitude += b.heightAmplitude;
      ridgeStrength += b.ridgeStrength;
    }

    return {
      primaryBiome,
      baseHeight: baseHeight / count,
      heightAmplitude: heightAmplitude / count,
      ridgeStrength: ridgeStrength / count,
      treeChance: primaryBiome.treeChance,
    };
  }
}
