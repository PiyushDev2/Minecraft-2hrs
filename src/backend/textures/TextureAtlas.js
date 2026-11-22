/**
 * @file TextureAtlas.js
 * @description Zero-dependency modern crisp procedural 16x16 pixel-art texture atlas
 * built on HTML5 Canvas, plus 10-stage mining crack overlay textures.
 */

import * as THREE from 'three';
import { hash2D } from '../terrain/Noise.js';

const TILE_SIZE = 16;
const GRID_COLS = 16;
const GRID_ROWS = 8;
const ATLAS_WIDTH = TILE_SIZE * GRID_COLS;  // 256px
const ATLAS_HEIGHT = TILE_SIZE * GRID_ROWS; // 128px

const TILE_KEYS = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'bedrock',
  'sand',
  'gravel',
  'water',
  'oak_log_top',
  'oak_log_side',
  'oak_leaves',
  'torch',
  'glowstone',
  'coal_ore',
  'iron_ore',
  'snow',
  'cactus_top',
  'cactus_side',
  'tall_grass',
  'flower',
  'spruce_log_top',
  'spruce_log_side',
  'spruce_leaves',
  'planks_oak',
  'cobblestone',
  'crafting_table_top',
  'crafting_table_side',
  'glass',
  'bricks',
  // New complete Minecraft tiles
  'gold_ore',
  'diamond_ore',
  'redstone_ore',
  'obsidian',
  'lava',
  'furnace_front',
  'furnace_front_lit',
  'furnace_side',
  'furnace_top',
  'chest_front',
  'chest_side',
  'chest_top',
  'bed_top',
  'bed_side',
  'tnt_top',
  'tnt_side',
  'tnt_bottom',
  'oak_door',
  'ladder',
  'farmland_dry',
  'farmland_wet',
  'wheat_0',
  'wheat_1',
  'wheat_2',
  'wheat_3',
  'iron_block',
  'gold_block',
  'diamond_block',
  'netherrack',
  'soul_sand',
  'nether_bricks',
  'nether_quartz_ore',
  'nether_portal',
  'mossy_cobblestone',
  'white_wool',
  // Expansion tiles (30 new tiles -> 94 total, fits inside 16x8 = 128 grid)
  'lapis_ore',
  'bookshelf',
  'enchanting_top',
  'enchanting_side',
  'anvil_top',
  'anvil_side',
  'brewing_stand',
  'end_stone',
  'end_portal_frame_top',
  'end_portal_frame_top_filled',
  'end_portal_frame_side',
  'end_portal',
  'dragon_egg',
  'stone_bricks',
  'nether_wart_block',
  'redstone_wire_off',
  'redstone_wire_on',
  'redstone_torch',
  'lever_wood',
  'redstone_lamp_off',
  'redstone_lamp_on',
  'piston_top',
  'piston_side',
  'piston_bottom',
  'piston_head',
  'lantern_side',
  'lantern_top',
  'campfire_log',
  'campfire_fire',
  'oak_sign',
];

/**
 * Generates and caches a crisp modern procedural voxel texture atlas and UV rects.
 */
export class TextureAtlas {
  constructor() {
    /** @type {Map<string, { u0: number, v0: number, uSize: number, vSize: number }>} */
    this.rects = new Map();
    /** @type {THREE.CanvasTexture|null} */
    this.texture = null;
    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    /** @type {Map<string, string>} */
    this._tileDataUrlCache = new Map();

    this._buildAtlas();
  }

  /** @private */
  _buildAtlas() {
    if (typeof document === 'undefined') {
      this._populateRectsOnly();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

    TILE_KEYS.forEach((key, index) => {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      const px = col * TILE_SIZE;
      const py = row * TILE_SIZE;

      this._drawTile(ctx, key, px, py);

      const u0 = px / ATLAS_WIDTH;
      const v0 = 1 - (py + TILE_SIZE) / ATLAS_HEIGHT;
      const uSize = TILE_SIZE / ATLAS_WIDTH;
      const vSize = TILE_SIZE / ATLAS_HEIGHT;

      this.rects.set(key, { u0, v0, uSize, vSize });
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    this.canvas = canvas;
    this.texture = texture;
  }

  /** @private */
  _populateRectsOnly() {
    TILE_KEYS.forEach((key, index) => {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      const px = col * TILE_SIZE;
      const py = row * TILE_SIZE;
      this.rects.set(key, {
        u0: px / ATLAS_WIDTH,
        v0: 1 - (py + TILE_SIZE) / ATLAS_HEIGHT,
        uSize: TILE_SIZE / ATLAS_WIDTH,
        vSize: TILE_SIZE / ATLAS_HEIGHT,
      });
    });
  }

  /** @private */
  _drawTile(ctx, key, ox, oy) {
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    const putPixel = (x, y, r, g, b, a = 255) => {
      ctx.fillStyle = `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${(a / 255).toFixed(3)})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    };

    const drawOre = (x, y, n, n2, veinColor, highlightColor, seedOffset) => {
      const strata = Math.sin(y * 0.65 + x * 0.18) * 6;
      const d = (n - 0.5) * 18 + (n2 - 0.5) * 14 + strata;
      const base = 128 + d;
      const v = hash2D(x >> 1, y >> 1, seedOffset);
      const vDetail = hash2D(x, y, seedOffset + 7);
      if (v > 0.78 && x > 1 && x < 14 && y > 1 && y < 14) {
        if (vDetail > 0.65) {
          putPixel(x, y, highlightColor[0], highlightColor[1], highlightColor[2]);
        } else {
          putPixel(x, y, veinColor[0], veinColor[1], veinColor[2]);
        }
      } else {
        putPixel(x, y, base, base, base + 3);
      }
    };

    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const n = hash2D(x, y, key.length * 97 + key.charCodeAt(0) * 13);
        const n2 = hash2D(x >> 1, y >> 1, key.charCodeAt(key.length - 1) * 41);

        switch (key) {
          case 'grass_top': {
            const blade = (n - 0.5) * 20 + (n2 - 0.5) * 14;
            const lush = n > 0.82 ? 12 : n < 0.15 ? -10 : 0;
            putPixel(x, y, 86 + blade + lush * 0.4, 158 + blade + lush, 58 + blade * 0.6);
            break;
          }
          case 'grass_side': {
            const overhang = 3 + Math.floor(hash2D(x, 0, 511) * 3);
            if (y < overhang) {
              const shade = (n - 0.5) * 20;
              putPixel(x, y, 86 + shade, 158 + shade, 58 + shade * 0.6);
            } else if (y === overhang) {
              putPixel(x, y, 66, 118, 44);
            } else {
              const d = (n - 0.5) * 24 + (n2 - 0.5) * 14;
              const pebble = n > 0.91 ? -18 : 0;
              putPixel(x, y, 134 + d + pebble, 96 + d * 0.8 + pebble, 64 + d * 0.6 + pebble);
            }
            break;
          }
          case 'dirt': {
            const d = (n - 0.5) * 24 + (n2 - 0.5) * 16;
            const pebble = n > 0.9 ? -22 : n < 0.08 ? 14 : 0;
            putPixel(x, y, 134 + d + pebble, 96 + d * 0.8 + pebble, 64 + d * 0.6 + pebble);
            break;
          }
          case 'stone': {
            const strata = Math.sin(y * 0.65 + x * 0.18) * 7;
            const d = (n - 0.5) * 20 + (n2 - 0.5) * 16 + strata;
            const c = 129 + d;
            putPixel(x, y, c, c, c + 3);
            break;
          }
          case 'bedrock': {
            const d = (n - 0.5) * 50 + (n2 - 0.5) * 34;
            const c = Math.max(18, Math.min(96, 52 + d));
            putPixel(x, y, c, c, c + 2);
            break;
          }
          case 'sand': {
            const wave = Math.sin(y * 0.9 + x * 0.25) * 5;
            const d = (n - 0.5) * 18 + wave;
            putPixel(x, y, 224 + d, 208 + d * 0.9, 154 + d * 0.75);
            break;
          }
          case 'gravel': {
            const d = (n - 0.5) * 38 + (n2 - 0.5) * 22;
            const c = 132 + d;
            putPixel(x, y, c + 2, c, c - 1);
            break;
          }
          case 'water': {
            const ripple = Math.sin(x * 0.65 + y * 0.45) * 10 + (n - 0.5) * 12;
            putPixel(x, y, 42 + ripple * 0.5, 118 + ripple * 0.8, 218 + ripple * 0.5, 220);
            break;
          }
          case 'lava': {
            const swirl = Math.sin(x * 0.55 + y * 0.4) * 18 + Math.cos(y * 0.7 - x * 0.25) * 14;
            const bright = n2 > 0.68 || swirl > 14;
            if (bright) {
              putPixel(x, y, 255, 205 + (n - 0.5) * 30, 56);
            } else if (n > 0.35) {
              putPixel(x, y, 232 + swirl * 0.5, 96 + swirl * 0.7, 24);
            } else {
              putPixel(x, y, 168, 42, 16);
            }
            break;
          }
          case 'oak_log_top': {
            const dx = x - 7.5;
            const dy = y - 7.5;
            const dist = Math.hypot(dx, dy);
            if (dist > 6.6) {
              const b = (n - 0.5) * 16;
              putPixel(x, y, 92 + b, 68 + b, 42 + b);
            } else {
              const ring = Math.sin(dist * 2.6) * 12 + (n - 0.5) * 10;
              putPixel(x, y, 174 + ring, 140 + ring * 0.85, 94 + ring * 0.65);
            }
            break;
          }
          case 'oak_log_side': {
            const groove = hash2D(x, 0, 913) > 0.68 ? -16 : 0;
            const knot = Math.abs(Math.sin(y * 0.75 + x * 0.3)) * 10;
            const d = (n - 0.5) * 16 + groove + knot * 0.5;
            putPixel(x, y, 108 + d, 80 + d * 0.8, 49 + d * 0.6);
            break;
          }
          case 'oak_leaves': {
            if (n < 0.22 && (x + y) % 2 === 0) {
              putPixel(x, y, 36, 76, 26, 0);
            } else {
              const d = (n - 0.5) * 24 + (n2 - 0.5) * 18;
              putPixel(x, y, 56 + d * 0.7, 128 + d, 42 + d * 0.6, 255);
            }
            break;
          }
          case 'spruce_log_top': {
            const dx = x - 7.5;
            const dy = y - 7.5;
            const dist = Math.hypot(dx, dy);
            if (dist > 6.6) {
              putPixel(x, y, 58, 40, 26);
            } else {
              const ring = Math.sin(dist * 2.8) * 10 + (n - 0.5) * 8;
              putPixel(x, y, 128 + ring, 96 + ring * 0.8, 64 + ring * 0.6);
            }
            break;
          }
          case 'spruce_log_side': {
            const groove = hash2D(x, 0, 317) > 0.62 ? -14 : 0;
            const d = (n - 0.5) * 14 + groove;
            putPixel(x, y, 66 + d, 47 + d * 0.8, 30 + d * 0.6);
            break;
          }
          case 'spruce_leaves': {
            if (n < 0.18 && (x + y) % 2 === 0) {
              putPixel(x, y, 28, 60, 36, 0);
            } else {
              const d = (n - 0.5) * 20 + (n2 - 0.5) * 14;
              putPixel(x, y, 40 + d * 0.6, 86 + d, 52 + d * 0.7, 255);
            }
            break;
          }
          case 'torch': {
            if (x >= 7 && x <= 8 && y >= 6 && y <= 15) {
              const wood = (n - 0.5) * 14;
              putPixel(x, y, 134 + wood, 94 + wood, 54 + wood, 255);
            } else if (x >= 7 && x <= 8 && y >= 4 && y <= 5) {
              putPixel(x, y, 255, 224, 96, 255);
            } else if (x >= 6 && x <= 9 && y >= 2 && y <= 5) {
              const hot = y <= 3;
              putPixel(x, y, 255, hot ? 165 : 210, hot ? 48 : 80, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'glowstone': {
            const cell = (n2 - 0.5) * 42 + (n - 0.5) * 22;
            const crack = n < 0.16 ? -48 : 0;
            putPixel(x, y, 244 + cell + crack, 206 + cell * 0.8 + crack, 114 + cell * 0.6 + crack);
            break;
          }
          case 'coal_ore': {
            drawOre(x, y, n, n2, [34, 36, 42], [58, 62, 70], 111);
            break;
          }
          case 'iron_ore': {
            drawOre(x, y, n, n2, [198, 162, 134], [228, 198, 172], 222);
            break;
          }
          case 'gold_ore': {
            drawOre(x, y, n, n2, [232, 188, 42], [255, 238, 122], 333);
            break;
          }
          case 'diamond_ore': {
            drawOre(x, y, n, n2, [58, 212, 222], [164, 250, 255], 444);
            break;
          }
          case 'redstone_ore': {
            drawOre(x, y, n, n2, [196, 32, 32], [255, 92, 82], 555);
            break;
          }
          case 'obsidian': {
            const d = (n - 0.5) * 20 + (n2 - 0.5) * 16;
            const glint = n2 > 0.82 && n > 0.55 ? 28 : 0;
            putPixel(x, y, 24 + d * 0.5 + glint, 16 + d * 0.4 + glint * 0.4, 42 + d * 0.8 + glint * 1.4);
            break;
          }
          case 'snow': {
            const d = (n - 0.5) * 10;
            putPixel(x, y, 238 + d, 246 + d, 254 + d);
            break;
          }
          case 'cactus_top': {
            const d = (n - 0.5) * 16;
            const border = x === 0 || x === 15 || y === 0 || y === 15 ? -18 : 0;
            putPixel(x, y, 68 + d + border, 134 + d + border, 54 + d + border);
            break;
          }
          case 'cactus_side': {
            const ridge = x % 4 === 0 ? -18 : x % 4 === 2 ? 12 : 0;
            const spine = x % 4 === 0 && y % 4 === 1 ? -42 : 0;
            const d = (n - 0.5) * 14 + ridge + spine;
            putPixel(x, y, 62 + d, 130 + d, 48 + d);
            break;
          }
          case 'tall_grass': {
            const stalk =
              (x === 3 && y >= 7) ||
              (x === 5 && y >= 4) ||
              (x === 8 && y >= 3) ||
              (x === 10 && y >= 6) ||
              (x === 12 && y >= 8) ||
              (x === 6 && y >= 9) ||
              (x === 9 && y >= 8);
            if (stalk) {
              const tip = y < 6 ? 22 : 0;
              putPixel(x, y, 68 + tip * 0.5, 146 + tip, 46 + tip * 0.4, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'flower': {
            const stem = x === 8 && y >= 8 && y <= 15;
            const leaf = (x === 7 && y === 12) || (x === 9 && y === 11);
            const petal = Math.hypot(x - 8, y - 5.5) <= 2.6;
            const center = Math.hypot(x - 8, y - 5.5) <= 1.1;
            if (center) putPixel(x, y, 252, 212, 64, 255);
            else if (petal) putPixel(x, y, 232, 62, 58, 255);
            else if (stem || leaf) putPixel(x, y, 62, 138, 48, 255);
            else putPixel(x, y, 0, 0, 0, 0);
            break;
          }
          case 'planks_oak': {
            const seamH = y % 4 === 0;
            const seamV = (x === 0 && (y >> 2) % 2 === 0) || (x === 8 && (y >> 2) % 2 === 1);
            const grain = (n - 0.5) * 14 + Math.sin(x * 0.6 + (y >> 2)) * 5;
            const dark = seamH || seamV ? -28 : 0;
            putPixel(x, y, 182 + grain + dark, 142 + grain * 0.8 + dark, 88 + grain * 0.6 + dark);
            break;
          }
          case 'cobblestone': {
            const mortar = (x + (y >> 2) * 3) % 5 === 0 || y % 4 === 0;
            const d = (n - 0.5) * 26 + (n2 - 0.5) * 22;
            const c = mortar ? 86 + (n - 0.5) * 12 : 128 + d;
            putPixel(x, y, c, c, c + 2);
            break;
          }
          case 'crafting_table_top': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const grid = x === 5 || x === 10 || y === 5 || y === 10;
            const grain = (n - 0.5) * 14;
            if (border) putPixel(x, y, 102 + grain, 68 + grain, 38 + grain);
            else if (grid) putPixel(x, y, 78, 52, 28);
            else putPixel(x, y, 174 + grain, 126 + grain, 74 + grain);
            break;
          }
          case 'crafting_table_side': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const saw = y >= 5 && y <= 11 && (x === 4 || x === 5 || x === 11);
            const grain = (n - 0.5) * 14;
            if (border) putPixel(x, y, 106, 72, 42);
            else if (saw) putPixel(x, y, 194, 202, 212);
            else putPixel(x, y, 160 + grain, 114 + grain, 66 + grain);
            break;
          }
          case 'glass': {
            const frame = x === 0 || x === 15 || y === 0 || y === 15;
            const glint = (x === 3 && y === 3) || (x === 4 && y === 2) || (x === 12 && y === 11);
            if (frame) putPixel(x, y, 186, 224, 236, 255);
            else if (glint) putPixel(x, y, 240, 252, 255, 220);
            else putPixel(x, y, 200, 236, 248, 0);
            break;
          }
          case 'bricks': {
            const rowIdx = y >> 2;
            const offset = (rowIdx % 2) * 4;
            const mortar = y % 4 === 0 || (x + offset) % 8 === 0;
            const d = (n - 0.5) * 18;
            if (mortar) putPixel(x, y, 198 + d * 0.4, 192 + d * 0.4, 184 + d * 0.4);
            else putPixel(x, y, 158 + d, 76 + d * 0.6, 58 + d * 0.5);
            break;
          }
          case 'furnace_top': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const d = (n - 0.5) * 18;
            const c = border ? 94 : 132 + d;
            putPixel(x, y, c, c, c + 3);
            break;
          }
          case 'furnace_side': {
            const mortar = y === 0 || y === 15 || y === 8 || (x === 0 || x === 15);
            const d = (n - 0.5) * 20;
            const c = mortar ? 90 : 126 + d;
            putPixel(x, y, c, c, c + 3);
            break;
          }
          case 'furnace_front':
          case 'furnace_front_lit': {
            const isLit = key === 'furnace_front_lit';
            const upperOpening = x >= 3 && x <= 12 && y >= 3 && y <= 7;
            const lowerOpening = x >= 4 && x <= 11 && y >= 10 && y <= 14;
            if (upperOpening) {
              putPixel(x, y, 36 + (n - 0.5) * 14, 36, 40);
            } else if (lowerOpening) {
              if (isLit) {
                const hot = y >= 12 || (x >= 6 && x <= 9);
                putPixel(x, y, 255, hot ? 210 : 118, hot ? 64 : 24);
              } else {
                putPixel(x, y, 28, 28, 32);
              }
            } else {
              const border = x === 0 || x === 15 || y === 0 || y === 15;
              const d = (n - 0.5) * 18;
              const c = border ? 86 : 126 + d;
              putPixel(x, y, c, c, c + 2);
            }
            break;
          }
          case 'chest_top': {
            const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
            const grain = (n - 0.5) * 12;
            if (frame) putPixel(x, y, 92, 62, 32);
            else putPixel(x, y, 174 + grain, 124 + grain, 58 + grain);
            break;
          }
          case 'chest_side':
          case 'chest_front': {
            const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
            const lidSeam = y === 5;
            const latch = key === 'chest_front' && x >= 7 && x <= 8 && y >= 4 && y <= 7;
            const grain = (n - 0.5) * 12;
            if (latch) putPixel(x, y, 214, 218, 224);
            else if (frame || lidSeam) putPixel(x, y, 86, 56, 28);
            else putPixel(x, y, 168 + grain, 118 + grain, 54 + grain);
            break;
          }
          case 'bed_top': {
            const pillow = y <= 4 && x >= 1 && x <= 14;
            const trim = y === 5 || y === 6;
            const d = (n - 0.5) * 12;
            if (pillow) putPixel(x, y, 236 + d, 236 + d, 240 + d);
            else if (trim) putPixel(x, y, 224, 224, 228);
            else putPixel(x, y, 192 + d, 42 + d * 0.4, 42 + d * 0.4);
            break;
          }
          case 'bed_side': {
            const wood = y >= 11;
            const d = (n - 0.5) * 12;
            if (wood) putPixel(x, y, 148 + d, 106 + d, 62 + d);
            else if (y <= 3) putPixel(x, y, 230, 230, 235);
            else putPixel(x, y, 186 + d, 42, 42);
            break;
          }
          case 'tnt_top':
          case 'tnt_bottom': {
            const fuse = key === 'tnt_top' && x >= 7 && x <= 8 && y >= 7 && y <= 8;
            const ring = x % 4 === 0 || y % 4 === 0;
            if (fuse) putPixel(x, y, 42, 42, 46);
            else if (ring) putPixel(x, y, 156, 46, 36);
            else putPixel(x, y, 198 + (n - 0.5) * 16, 62, 46);
            break;
          }
          case 'tnt_side': {
            const band = y >= 5 && y <= 10;
            if (band) {
              // Crisp pixel "TNT" lettering
              const t1 = (y === 6 && x >= 2 && x <= 4) || (x === 3 && y >= 6 && y <= 9);
              const nChar =
                (x === 6 && y >= 6 && y <= 9) ||
                (x === 9 && y >= 6 && y <= 9) ||
                (x === 7 && y === 7) ||
                (x === 8 && y === 8);
              const t2 = (y === 6 && x >= 11 && x <= 13) || (x === 12 && y >= 6 && y <= 9);
              if (t1 || nChar || t2) putPixel(x, y, 24, 24, 28);
              else putPixel(x, y, 236, 232, 224);
            } else {
              const stripe = x % 4 === 0 ? -24 : 0;
              putPixel(x, y, 204 + stripe + (n - 0.5) * 14, 52 + stripe * 0.4, 40 + stripe * 0.4);
            }
            break;
          }
          case 'oak_door': {
            const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14 || y === 8;
            const win = y >= 3 && y <= 6 && x >= 3 && x <= 12 && x !== 7 && x !== 8;
            const knob = x === 12 && (y === 9 || y === 10);
            const grain = (n - 0.5) * 14;
            if (win) putPixel(x, y, 0, 0, 0, 0);
            else if (knob) putPixel(x, y, 214, 186, 86, 255);
            else if (frame) putPixel(x, y, 118 + grain, 84 + grain, 46 + grain, 255);
            else putPixel(x, y, 162 + grain, 120 + grain, 72 + grain, 255);
            break;
          }
          case 'ladder': {
            const rail = x === 2 || x === 3 || x === 12 || x === 13;
            const rung = (y === 2 || y === 6 || y === 10 || y === 14) && x >= 2 && x <= 13;
            if (rail || rung) {
              const grain = (n - 0.5) * 14;
              putPixel(x, y, 162 + grain, 120 + grain, 70 + grain, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'farmland_dry':
          case 'farmland_wet': {
            const wet = key === 'farmland_wet';
            const furrow = y % 4 === 1 || y % 4 === 2;
            const d = (n - 0.5) * 14 + (furrow ? -16 : 8);
            if (wet) putPixel(x, y, 76 + d, 50 + d * 0.8, 30 + d * 0.6);
            else putPixel(x, y, 128 + d, 88 + d * 0.8, 56 + d * 0.6);
            break;
          }
          case 'wheat_0':
          case 'wheat_1':
          case 'wheat_2':
          case 'wheat_3': {
            const stage = Number(key.split('_')[1]);
            const topY = 12 - stage * 3;
            const isStalk = (x === 3 || x === 6 || x === 9 || x === 12) && y >= topY;
            const isHead = stage >= 2 && (x === 2 || x === 4 || x === 7 || x === 10 || x === 13) && y >= topY && y <= topY + 3;
            if (isStalk || isHead) {
              if (stage === 0) putPixel(x, y, 86, 162, 54, 255);
              else if (stage === 1) putPixel(x, y, 118, 178, 56, 255);
              else if (stage === 2) putPixel(x, y, 184, 174, 58, 255);
              else putPixel(x, y, 228 + (n - 0.5) * 16, 194 + (n - 0.5) * 14, 68, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'iron_block': {
            const bevel = x === 0 || y === 0 ? 18 : x === 15 || y === 15 ? -22 : 0;
            const d = (n - 0.5) * 10 + bevel;
            putPixel(x, y, 216 + d, 220 + d, 226 + d);
            break;
          }
          case 'gold_block': {
            const bevel = x === 0 || y === 0 ? 22 : x === 15 || y === 15 ? -26 : 0;
            const d = (n - 0.5) * 12 + bevel;
            putPixel(x, y, 246 + d, 208 + d, 58 + d * 0.5);
            break;
          }
          case 'diamond_block': {
            const bevel = x === 0 || y === 0 ? 24 : x === 15 || y === 15 ? -24 : 0;
            const d = (n - 0.5) * 12 + bevel;
            putPixel(x, y, 78 + d * 0.8, 228 + d, 224 + d);
            break;
          }
          case 'netherrack': {
            const vein = Math.sin(x * 0.7 + y * 0.5) * 10 + (n2 - 0.5) * 26;
            const d = (n - 0.5) * 24 + vein;
            const dark = n < 0.2 ? -24 : 0;
            putPixel(x, y, 118 + d + dark, 44 + d * 0.45 + dark * 0.5, 44 + d * 0.45 + dark * 0.5);
            break;
          }
          case 'soul_sand': {
            const face =
              ((x === 4 || x === 5 || x === 10 || x === 11) && (y === 4 || y === 5)) ||
              (x >= 5 && x <= 10 && y >= 9 && y <= 11);
            const d = (n - 0.5) * 20 + (n2 - 0.5) * 14;
            if (face) {
              putPixel(x, y, 48 + d * 0.4, 34 + d * 0.3, 28 + d * 0.3);
            } else {
              putPixel(x, y, 86 + d, 64 + d * 0.8, 52 + d * 0.7);
            }
            break;
          }
          case 'nether_bricks': {
            const rowIdx = y >> 2;
            const offset = (rowIdx % 2) * 4;
            const mortar = y % 4 === 0 || (x + offset) % 8 === 0;
            const d = (n - 0.5) * 14;
            if (mortar) putPixel(x, y, 30 + d * 0.3, 14 + d * 0.2, 18 + d * 0.2);
            else putPixel(x, y, 64 + d, 30 + d * 0.5, 36 + d * 0.5);
            break;
          }
          case 'nether_quartz_ore': {
            const q = hash2D(x >> 1, y >> 1, 777);
            const qDetail = hash2D(x, y, 784);
            if (q > 0.74 && x > 1 && x < 14 && y > 1 && y < 14) {
              const b = qDetail > 0.5 ? 242 : 212;
              putPixel(x, y, b, b - 8, b - 16);
            } else {
              const d = (n - 0.5) * 22 + (n2 - 0.5) * 20;
              putPixel(x, y, 114 + d, 42 + d * 0.4, 42 + d * 0.4);
            }
            break;
          }
          case 'nether_portal': {
            const dx = x - 7.5;
            const dy = y - 7.5;
            const angle = Math.atan2(dy, dx);
            const dist = Math.hypot(dx, dy);
            const swirl = Math.sin(dist * 1.15 - angle * 2.0) * 0.5 + 0.5;
            const glow = swirl * 90 + (n - 0.5) * 28;
            putPixel(x, y, 110 + glow * 0.85, 24 + glow * 0.35, 190 + glow * 0.65, 205);
            break;
          }
          case 'mossy_cobblestone': {
            const mortar = (x + (y >> 2) * 3) % 5 === 0 || y % 4 === 0;
            const moss = n2 > 0.58 || (mortar && n > 0.42);
            const d = (n - 0.5) * 24 + (n2 - 0.5) * 18;
            if (moss) {
              putPixel(x, y, 64 + d * 0.5, 118 + d * 0.9, 52 + d * 0.4);
            } else {
              const c = mortar ? 82 + (n - 0.5) * 10 : 124 + d;
              putPixel(x, y, c, c, c + 2);
            }
            break;
          }
          case 'white_wool': {
            const weave = ((x + y) % 2 === 0 ? 6 : -6) + (n - 0.5) * 14 + (n2 - 0.5) * 10;
            putPixel(x, y, 232 + weave, 232 + weave, 236 + weave);
            break;
          }
          case 'lapis_ore': {
            drawOre(x, y, n, n2, [28, 66, 178], [76, 128, 242], 666);
            break;
          }
          case 'bookshelf': {
            if (y <= 1 || y >= 14 || y === 7 || y === 8) {
              const g = (n - 0.5) * 14;
              putPixel(x, y, 176 + g, 136 + g * 0.8, 84 + g * 0.6);
            } else {
              const spineIdx = Math.floor(x / 3) + (y > 8 ? 5 : 0);
              const gap = x % 3 === 0 && (y === 2 || y === 9);
              if (gap) {
                putPixel(x, y, 52, 34, 22);
              } else {
                const palette = [
                  [178, 42, 42],
                  [46, 98, 168],
                  [56, 134, 62],
                  [194, 148, 46],
                  [124, 58, 152],
                  [148, 72, 46],
                ];
                const col = palette[spineIdx % palette.length];
                const band = y === 4 || y === 11 ? 36 : (n - 0.5) * 14;
                putPixel(x, y, col[0] + band, col[1] + band, col[2] + band);
              }
            }
            break;
          }
          case 'enchanting_top': {
            const border = x <= 1 || x >= 14 || y <= 1 || y >= 14;
            const corner = (x <= 2 || x >= 13) && (y <= 2 || y >= 13);
            const rune = (x === 4 || x === 11) && (y === 4 || y === 11);
            if (corner) putPixel(x, y, 86, 226, 232);
            else if (border) putPixel(x, y, 26, 18, 44);
            else if (rune) putPixel(x, y, 238, 206, 98);
            else putPixel(x, y, 168 + (n - 0.5) * 14, 26, 38);
            break;
          }
          case 'enchanting_side': {
            if (y <= 3) {
              const trim = y === 3 && x % 2 === 0;
              putPixel(x, y, trim ? 236 : 168, trim ? 196 : 26, trim ? 78 : 38);
            } else if (y === 5 && (x === 2 || x === 13)) {
              putPixel(x, y, 86, 228, 236);
            } else {
              const d = (n - 0.5) * 18;
              putPixel(x, y, 28 + d * 0.5, 18 + d * 0.4, 46 + d * 0.8);
            }
            break;
          }
          case 'anvil_top':
          case 'anvil_side': {
            const edge = x === 0 || x === 15 || y === 0 || y === 15;
            const d = (n - 0.5) * 14 + (edge ? -18 : 6);
            const c = (key === 'anvil_top' ? 84 : 68) + d;
            putPixel(x, y, c, c, c + 4);
            break;
          }
          case 'brewing_stand': {
            const d = (n - 0.5) * 16;
            const rod = x >= 6 && x <= 9;
            if (rod) putPixel(x, y, 224 + d, 174 + d * 0.8, 56);
            else putPixel(x, y, 118 + d, 118 + d, 122 + d);
            break;
          }
          case 'end_stone': {
            const crater = n2 > 0.72 ? -22 : n < 0.18 ? 14 : 0;
            const d = (n - 0.5) * 20 + crater;
            putPixel(x, y, 222 + d, 224 + d, 164 + d * 0.8);
            break;
          }
          case 'end_portal_frame_top':
          case 'end_portal_frame_top_filled': {
            const inner = x >= 4 && x <= 11 && y >= 4 && y <= 11;
            const rim = x === 0 || x === 15 || y === 0 || y === 15;
            const d = (n - 0.5) * 14;
            if (inner && key === 'end_portal_frame_top_filled') {
              const pupil = x >= 7 && x <= 8 && y >= 6 && y <= 9;
              putPixel(x, y, pupil ? 18 : 42 + d, pupil ? 46 : 206 + d, pupil ? 34 : 148 + d);
            } else if (inner) {
              putPixel(x, y, 26 + d * 0.4, 52 + d * 0.5, 48 + d * 0.5);
            } else if (rim) {
              putPixel(x, y, 198 + d, 202 + d, 148 + d);
            } else {
              putPixel(x, y, 62 + d, 122 + d, 106 + d);
            }
            break;
          }
          case 'end_portal_frame_side': {
            const d = (n - 0.5) * 16;
            if (y <= 4) putPixel(x, y, 62 + d, 122 + d, 108 + d);
            else putPixel(x, y, 214 + d, 216 + d, 158 + d);
            break;
          }
          case 'end_portal': {
            const star = hash2D(x, y, 991) > 0.91;
            const nebula = Math.sin(x * 0.45 + y * 0.35) * 12;
            if (star) putPixel(x, y, 148, 228, 255, 240);
            else putPixel(x, y, 10 + nebula * 0.4, 6 + nebula * 0.3, 28 + nebula, 232);
            break;
          }
          case 'dragon_egg': {
            const spot = n2 > 0.78 && n > 0.5;
            const d = (n - 0.5) * 14;
            if (spot) putPixel(x, y, 184, 52, 226);
            else putPixel(x, y, 26 + d * 0.5, 16 + d * 0.4, 38 + d * 0.6);
            break;
          }
          case 'stone_bricks': {
            const rowIdx = y >> 3;
            const mortar = y === 0 || y === 8 || (rowIdx === 0 ? x === 0 || x === 8 : x === 4 || x === 12);
            const crack = (x === 3 && y === 4) || (x === 11 && y === 12);
            const d = (n - 0.5) * 16;
            const c = mortar || crack ? 86 + d * 0.4 : 132 + d;
            putPixel(x, y, c, c, c + 3);
            break;
          }
          case 'nether_wart_block': {
            const bulb = y >= 5 && y <= 11 && (x === 3 || x === 4 || x === 7 || x === 8 || x === 11 || x === 12);
            const stalk = y >= 11 && (x === 4 || x === 8 || x === 12);
            if (bulb) putPixel(x, y, 178 + (n - 0.5) * 24, 24, 38, 255);
            else if (stalk) putPixel(x, y, 118, 26, 28, 255);
            else putPixel(x, y, 0, 0, 0, 0);
            break;
          }
          case 'redstone_wire_off':
          case 'redstone_wire_on': {
            const on = key === 'redstone_wire_on';
            const cross = (x >= 6 && x <= 9) || (y >= 6 && y <= 9);
            if (cross) {
              const glow = (n - 0.5) * 26;
              putPixel(x, y, (on ? 248 : 112) + glow, (on ? 42 : 12) + glow * 0.2, (on ? 28 : 12), 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'redstone_torch': {
            if (x >= 7 && x <= 8 && y >= 6 && y <= 15) {
              putPixel(x, y, 128, 88, 50, 255);
            } else if (x >= 6 && x <= 9 && y >= 2 && y <= 5) {
              const core = x >= 7 && x <= 8 && y >= 3 && y <= 4;
              putPixel(x, y, 255, core ? 186 : 36, core ? 148 : 28, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'lever_wood': {
            const d = (n - 0.5) * 14;
            putPixel(x, y, 146 + d, 104 + d, 62 + d);
            break;
          }
          case 'redstone_lamp_off':
          case 'redstone_lamp_on': {
            const on = key === 'redstone_lamp_on';
            const grid = x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8;
            const d = (n - 0.5) * 18;
            if (grid) putPixel(x, y, on ? 128 : 68, on ? 82 : 42, on ? 42 : 24);
            else if (on) putPixel(x, y, 255, 224 + d * 0.5, 132 + d);
            else putPixel(x, y, 118 + d, 74 + d * 0.7, 46 + d * 0.5);
            break;
          }
          case 'piston_top':
          case 'piston_head': {
            const rim = x <= 1 || x >= 14 || y <= 1 || y >= 14;
            const d = (n - 0.5) * 14;
            if (rim) putPixel(x, y, 116 + d, 118 + d, 122 + d);
            else putPixel(x, y, 184 + d, 144 + d * 0.8, 92 + d * 0.6);
            break;
          }
          case 'piston_side': {
            const d = (n - 0.5) * 16;
            if (y <= 3) putPixel(x, y, 182 + d, 142 + d * 0.8, 88 + d * 0.6);
            else if (y === 4) putPixel(x, y, 68, 68, 72);
            else putPixel(x, y, 122 + d, 122 + d, 126 + d);
            break;
          }
          case 'piston_bottom': {
            const border = x <= 1 || x >= 14 || y <= 1 || y >= 14;
            const d = (n - 0.5) * 16;
            const c = (border ? 86 : 114) + d;
            putPixel(x, y, c, c, c + 3);
            break;
          }
          case 'lantern_side': {
            const bar = x <= 1 || x >= 14 || y <= 2 || y >= 13;
            const d = (n - 0.5) * 14;
            if (bar) putPixel(x, y, 52 + d * 0.5, 58 + d * 0.5, 68 + d * 0.5);
            else putPixel(x, y, 255, 204 + d, 92 + d);
            break;
          }
          case 'lantern_top': {
            const d = (n - 0.5) * 12;
            putPixel(x, y, 58 + d, 64 + d, 76 + d);
            break;
          }
          case 'campfire_log': {
            const ember = y <= 3 && (x % 3 === 1 || n > 0.72);
            const d = (n - 0.5) * 16;
            if (ember) putPixel(x, y, 255, 134 + d, 32);
            else putPixel(x, y, 104 + d, 74 + d * 0.8, 44 + d * 0.6);
            break;
          }
          case 'campfire_fire': {
            const dist = Math.abs(x - 7.5) + (15 - y) * 0.45;
            if (dist < 5.2 && y >= 2) {
              const hot = y >= 10 || dist < 2.2;
              putPixel(x, y, 255, hot ? 228 : 132, hot ? 84 : 26, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'oak_sign': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const line = (y === 4 || y === 7 || y === 10) && x >= 3 && x <= 12;
            const g = (n - 0.5) * 12;
            if (border) putPixel(x, y, 128, 94, 52);
            else if (line) putPixel(x, y, 152 + g, 114 + g, 66 + g);
            else putPixel(x, y, 182 + g, 140 + g, 86 + g);
            break;
          }
          default:
            putPixel(x, y, 255, 0, 255);
        }
      }
    }
  }

  /**
   * Returns normalized UV rectangle for a named texture tile.
   * @param {string} key
   * @returns {{ u0: number, v0: number, uSize: number, vSize: number }}
   */
  getTileRect(key) {
    return (
      this.rects.get(key) ||
      this.rects.get('stone') || {
        u0: 0,
        v0: 0,
        uSize: 1 / GRID_COLS,
        vSize: 1 / GRID_ROWS,
      }
    );
  }

  /**
   * Exports all UV tile rects as a plain JSON-serializable object for Web Workers.
   * @returns {Record<string, { u0: number, v0: number, uSize: number, vSize: number }>}
   */
  exportTileRects() {
    /** @type {Record<string, { u0: number, v0: number, uSize: number, vSize: number }>} */
    const out = {};
    for (const [k, v] of this.rects.entries()) {
      out[k] = { ...v };
    }
    return out;
  }

  /**
   * Returns a cached CSS dataURL of a single 16x16 tile for UI icons.
   * @param {string} key
   * @returns {string|null}
   */
  getTileDataURL(key) {
    if (!this.canvas || typeof document === 'undefined') return null;
    if (this._tileDataUrlCache.has(key)) {
      return this._tileDataUrlCache.get(key);
    }
    const idx = TILE_KEYS.indexOf(key);
    if (idx === -1) return null;
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_SIZE;
    tileCanvas.height = TILE_SIZE;
    const ctx = tileCanvas.getContext('2d');
    ctx.drawImage(
      this.canvas,
      col * TILE_SIZE,
      row * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE
    );
    const url = tileCanvas.toDataURL();
    this._tileDataUrlCache.set(key, url);
    return url;
  }

  /**
   * Generates 10 procedural pixel-art mining crack textures (stages 0..9) for block breaking overlay.
   * @returns {THREE.CanvasTexture[]}
   */
  static createCrackStageTextures() {
    if (typeof document === 'undefined') return [];
    const textures = [];
    for (let stage = 0; stage < 10; stage++) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 16, 16);

      // Progressive branching dark fractures radiating from center
      const branches = 2 + Math.floor(stage * 0.9);
      const maxSteps = 2 + Math.floor(stage * 1.15);
      for (let b = 0; b < branches; b++) {
        let cx = 7 + ((b % 2) === 0 ? 0 : 1);
        let cy = 7 + ((b % 3) === 0 ? 0 : 1);
        const angle = (b / branches) * Math.PI * 2 + 0.35;
        for (let s = 0; s < maxSteps; s++) {
          const jitter = (hash2D(b * 13 + s, stage * 7, 919) - 0.5) * 1.1;
          cx += Math.cos(angle + jitter) * 0.9;
          cy += Math.sin(angle + jitter) * 0.9;
          const px = Math.max(0, Math.min(15, Math.round(cx)));
          const py = Math.max(0, Math.min(15, Math.round(cy)));
          ctx.fillStyle = `rgba(12, 12, 16, ${(0.5 + stage * 0.045).toFixed(2)})`;
          ctx.fillRect(px, py, 1, 1);
          if (stage >= 6 && s % 2 === 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
            ctx.fillRect(Math.min(15, px + 1), py, 1, 1);
          }
        }
      }

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      textures.push(tex);
    }
    return textures;
  }

  /**
   * Resets all atlas tiles back to built-in procedural defaults.
   */
  resetToDefault() {
    if (!this.canvas || typeof document === 'undefined') return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    TILE_KEYS.forEach((key, index) => {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      this._drawTile(ctx, key, col * TILE_SIZE, row * TILE_SIZE);
    });
    this._tileDataUrlCache.clear();
    if (this.texture) {
      this.texture.needsUpdate = true;
    }
  }

  /**
   * Overlays matched Minecraft 1.21 resource pack block textures onto the procedural atlas.
   * Any tiles missing from the pack automatically keep their built-in procedural fallback.
   * @param {Record<string, Blob>} blockTextureBlobs Map of tileKey -> PNG Blob
   * @returns {Promise<number>} Count of applied block tiles
   */
  async applyResourcePack(blockTextureBlobs) {
    if (!this.canvas || typeof document === 'undefined') return 0;
    this.resetToDefault();
    if (!blockTextureBlobs) return 0;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.imageSmoothingEnabled = false;

    let applied = 0;
    const entries = Object.entries(blockTextureBlobs);
    for (const [tileKey, blob] of entries) {
      const idx = TILE_KEYS.indexOf(tileKey);
      if (idx === -1 || !blob) continue;
      const col = idx % GRID_COLS;
      const row = Math.floor(idx / GRID_COLS);
      const px = col * TILE_SIZE;
      const py = row * TILE_SIZE;

      try {
        const bitmap = await createImageBitmap(blob);
        ctx.clearRect(px, py, TILE_SIZE, TILE_SIZE);
        // Handle animated vertical strip textures (e.g. water_still, lava_still, nether_portal) by taking frame 0 (square top)
        const srcSize = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, 0, 0, srcSize, srcSize, px, py, TILE_SIZE, TILE_SIZE);
        bitmap.close();
        // Tint grayscale grass_top / oak_leaves / spruce_leaves / tall_grass if pack uses Minecraft biome grayscale
        if (
          tileKey === 'grass_top' ||
          tileKey === 'oak_leaves' ||
          tileKey === 'spruce_leaves' ||
          tileKey === 'tall_grass'
        ) {
          const img = ctx.getImageData(px, py, TILE_SIZE, TILE_SIZE);
          const data = img.data;
          let satSum = 0;
          let opaqueCount = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 20) {
              satSum += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
              opaqueCount++;
            }
          }
          // Grayscale foliage texture detected -> apply lush biome tint
          if (opaqueCount > 0 && satSum / opaqueCount < 14) {
            const tint =
              tileKey === 'spruce_leaves'
                ? [0.46, 0.72, 0.52]
                : tileKey === 'oak_leaves'
                ? [0.54, 0.85, 0.42]
                : [0.58, 0.88, 0.44];
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] > 0) {
                data[i] = Math.min(255, Math.round(data[i] * tint[0]));
                data[i + 1] = Math.min(255, Math.round(data[i + 1] * tint[1]));
                data[i + 2] = Math.min(255, Math.round(data[i + 2] * tint[2]));
              }
            }
            ctx.putImageData(img, px, py);
          }
        }
        applied++;
      } catch {
        // Ignore malformed image and keep procedural fallback
      }
    }

    this._tileDataUrlCache.clear();
    if (this.texture) {
      this.texture.needsUpdate = true;
    }
    return applied;
  }

  /**
   * Releases GPU resources for the procedural texture.
   */
  dispose() {
    this.texture?.dispose();
    this.texture = null;
    this.canvas = null;
    this._tileDataUrlCache.clear();
  }
}
