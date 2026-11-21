/**
 * @file TextureAtlas.js
 * @description Zero-dependency procedural 16x16 pixel-art texture atlas built on HTML5 Canvas.
 * Eliminates external PNG dependencies and provides crisp nearest-neighbor voxel textures.
 */

import * as THREE from 'three';
import { hash2D } from '../terrain/Noise.js';

const TILE_SIZE = 16;
const GRID_COLS = 8;
const GRID_ROWS = 4;
const ATLAS_WIDTH = TILE_SIZE * GRID_COLS;  // 128px
const ATLAS_HEIGHT = TILE_SIZE * GRID_ROWS; // 64px

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
];

/**
 * Generates and caches a procedural voxel texture atlas and normalized UV tile rectangles.
 */
export class TextureAtlas {
  constructor() {
    /** @type {Map<string, { u0: number, v0: number, uSize: number, vSize: number }>} */
    this.rects = new Map();
    /** @type {THREE.CanvasTexture|null} */
    this.texture = null;
    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;

    this._buildAtlas();
  }

  /**
   * Builds the procedural pixel-art atlas onto an offscreen canvas.
   * @private
   */
  _buildAtlas() {
    if (typeof document === 'undefined') {
      // Headless / Node environment fallback: populate UV rects without DOM canvas
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

      // Canvas Y=0 is top, WebGL texture V=1 is top (flipY = true default)
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

  /**
   * Populates UV rect table for non-DOM unit tests.
   * @private
   */
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

  /**
   * Draws a 16x16 procedural pixel tile at (ox, oy).
   * @private
   */
  _drawTile(ctx, key, ox, oy) {
    const putPixel = (x, y, r, g, b, a = 255) => {
      ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${(a / 255).toFixed(3)})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    };

    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const n = hash2D(x, y, key.length * 97 + key.charCodeAt(0) * 13);
        const n2 = hash2D(x >> 1, y >> 1, key.charCodeAt(key.length - 1) * 41);

        switch (key) {
          case 'grass_top': {
            const shade = (n - 0.5) * 24 + (n2 - 0.5) * 16;
            putPixel(x, y, 88 + shade, 152 + shade, 62 + shade * 0.7);
            break;
          }
          case 'grass_side': {
            const overhang = 3 + Math.floor(hash2D(x, 0, 511) * 3);
            if (y < overhang) {
              const shade = (n - 0.5) * 24;
              putPixel(x, y, 88 + shade, 152 + shade, 62 + shade * 0.7);
            } else if (y === overhang) {
              putPixel(x, y, 72, 118, 48);
            } else {
              const d = (n - 0.5) * 26 + (n2 - 0.5) * 14;
              putPixel(x, y, 132 + d, 94 + d * 0.8, 63 + d * 0.6);
            }
            break;
          }
          case 'dirt': {
            const d = (n - 0.5) * 28 + (n2 - 0.5) * 16;
            const pebble = n > 0.9 ? -22 : 0;
            putPixel(x, y, 134 + d + pebble, 96 + d * 0.8 + pebble, 64 + d * 0.6 + pebble);
            break;
          }
          case 'stone': {
            const strata = Math.sin(y * 0.7 + x * 0.2) * 8;
            const d = (n - 0.5) * 24 + (n2 - 0.5) * 20 + strata;
            const c = 128 + d;
            putPixel(x, y, c, c, c + 2);
            break;
          }
          case 'bedrock': {
            const d = (n - 0.5) * 52 + (n2 - 0.5) * 36;
            const c = Math.max(20, Math.min(95, 52 + d));
            putPixel(x, y, c, c, c);
            break;
          }
          case 'sand': {
            const ripple = Math.sin((x + y) * 0.5) * 5;
            const d = (n - 0.5) * 18 + ripple;
            putPixel(x, y, 222 + d, 206 + d, 148 + d * 0.8);
            break;
          }
          case 'gravel': {
            const pebble = hash2D(x >> 1, y >> 1, 919);
            const d = (pebble - 0.5) * 44 + (n - 0.5) * 18;
            putPixel(x, y, 130 + d, 125 + d, 123 + d);
            break;
          }
          case 'water': {
            const wave = Math.sin(x * 0.7 + y * 0.5) * 12;
            const d = (n - 0.5) * 14 + wave;
            putPixel(x, y, 42 + d * 0.5, 118 + d, 208 + d, 205);
            break;
          }
          case 'oak_log_top': {
            const dx = x - 7.5;
            const dy = y - 7.5;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const isBark = x === 0 || x === 15 || y === 0 || y === 15;
            if (isBark) {
              const d = (n - 0.5) * 20;
              putPixel(x, y, 94 + d, 68 + d * 0.8, 42 + d * 0.6);
            } else {
              const ring = Math.sin(dist * 2.1) > 0.25 ? -14 : 8;
              const d = (n - 0.5) * 12 + ring;
              putPixel(x, y, 174 + d, 138 + d * 0.85, 88 + d * 0.7);
            }
            break;
          }
          case 'oak_log_side': {
            const ridge = Math.sin(x * 1.45) * 14 + (hash2D(x, y >> 2, 333) - 0.5) * 18;
            const d = (n - 0.5) * 12 + ridge;
            putPixel(x, y, 102 + d, 74 + d * 0.8, 46 + d * 0.6);
            break;
          }
          case 'oak_leaves': {
            if (n < 0.16) {
              // Alpha-tested leaf gap for airy canopy silhouette
              putPixel(x, y, 36, 78, 28, 0);
            } else {
              const d = (n - 0.5) * 26 + (n2 - 0.5) * 18;
              putPixel(x, y, 62 + d * 0.7, 126 + d, 46 + d * 0.6, 255);
            }
            break;
          }
          case 'torch': {
            const dx = Math.abs(x - 7.5);
            if (dx <= 1.5 && y >= 5) {
              if (y === 5 || y === 6) {
                putPixel(x, y, 255, 225, 110, 255);
              } else {
                const d = (n - 0.5) * 20;
                putPixel(x, y, 128 + d, 88 + d * 0.8, 52 + d * 0.6, 255);
              }
            } else if (dx <= 2.5 && y >= 2 && y <= 5) {
              const glow = y <= 3 ? 255 : 230;
              putPixel(x, y, glow, 175 + n * 65, 45, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'glowstone': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const vein = n2 > 0.68 ? -42 : 24;
            const d = (n - 0.5) * 28 + vein + (border ? -25 : 0);
            putPixel(x, y, Math.min(255, 238 + d), Math.min(245, 194 + d), Math.max(40, 96 + d * 0.6));
            break;
          }
          case 'coal_ore': {
            const vein = hash2D(x >> 1, y >> 1, 1411) > 0.74 && x > 1 && x < 14 && y > 1 && y < 14;
            if (vein) {
              const c = 28 + (n - 0.5) * 18;
              putPixel(x, y, c, c, c + 4);
            } else {
              const d = (n - 0.5) * 24 + (n2 - 0.5) * 18;
              const c = 128 + d;
              putPixel(x, y, c, c, c + 2);
            }
            break;
          }
          case 'iron_ore': {
            const vein = hash2D(x >> 1, y >> 1, 1523) > 0.76 && x > 1 && x < 14 && y > 1 && y < 14;
            if (vein) {
              const d = (n - 0.5) * 22;
              putPixel(x, y, 206 + d, 168 + d, 134 + d);
            } else {
              const d = (n - 0.5) * 24 + (n2 - 0.5) * 18;
              const c = 128 + d;
              putPixel(x, y, c, c, c + 2);
            }
            break;
          }
          case 'snow': {
            const d = (n - 0.5) * 14 + (n2 - 0.5) * 10;
            putPixel(x, y, Math.min(255, 238 + d), Math.min(255, 244 + d), Math.min(255, 250 + d));
            break;
          }
          case 'cactus_top': {
            const dx = Math.abs(x - 7.5);
            const dy = Math.abs(y - 7.5);
            const ring = Math.max(dx, dy);
            const spine = (x % 4 === 1 && y % 4 === 1) ? 34 : 0;
            const d = (n - 0.5) * 16 + (ring > 5.5 ? -18 : 8) + spine;
            putPixel(x, y, 64 + d * 0.6, 134 + d, 54 + d * 0.6);
            break;
          }
          case 'cactus_side': {
            const rib = x % 3 === 0 ? -24 : 8;
            const spine = (x % 3 === 0 && y % 4 === 2) ? 48 : 0;
            const d = (n - 0.5) * 14 + rib + spine;
            putPixel(x, y, 66 + d * 0.7, 136 + d, 56 + d * 0.6);
            break;
          }
          case 'tall_grass': {
            const blade = (x % 3 === 1 || x % 4 === 2) && y > 3 + (hash2D(x, 0, 881) * 5);
            if (blade) {
              const shade = (15 - y) * 3 + (n - 0.5) * 20;
              putPixel(x, y, 72 + shade * 0.6, 146 + shade, 48 + shade * 0.5, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'flower': {
            const stem = (x === 7 || x === 8) && y >= 7;
            const petalDist = Math.hypot(x - 7.5, y - 4.5);
            if (petalDist <= 1.3) {
              putPixel(x, y, 252, 214, 64, 255);
            } else if (petalDist <= 3.1 && y <= 7) {
              const d = (n - 0.5) * 20;
              putPixel(x, y, 232 + d, 74 + d * 0.5, 68 + d * 0.5, 255);
            } else if (stem || ((x === 6 || x === 9) && y === 11)) {
              putPixel(x, y, 58, 128, 44, 255);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'spruce_log_top': {
            const dx = x - 7.5;
            const dy = y - 7.5;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const isBark = x === 0 || x === 15 || y === 0 || y === 15;
            if (isBark) {
              const d = (n - 0.5) * 16;
              putPixel(x, y, 64 + d, 44 + d * 0.8, 28 + d * 0.6);
            } else {
              const ring = Math.sin(dist * 2.2) > 0.2 ? -12 : 6;
              const d = (n - 0.5) * 10 + ring;
              putPixel(x, y, 134 + d, 102 + d * 0.85, 66 + d * 0.7);
            }
            break;
          }
          case 'spruce_log_side': {
            const ridge = Math.sin(x * 1.55) * 12 + (hash2D(x, y >> 2, 449) - 0.5) * 14;
            const d = (n - 0.5) * 10 + ridge;
            putPixel(x, y, 68 + d, 48 + d * 0.8, 30 + d * 0.6);
            break;
          }
          case 'spruce_leaves': {
            if (n < 0.14) {
              putPixel(x, y, 28, 64, 42, 0);
            } else {
              const d = (n - 0.5) * 22 + (n2 - 0.5) * 14;
              putPixel(x, y, 42 + d * 0.6, 88 + d, 56 + d * 0.7, 255);
            }
            break;
          }
          case 'planks_oak': {
            const seam = y % 4 === 0 || (x === 8 && (y >> 2) % 2 === 0) || (x === 0 && (y >> 2) % 2 === 1);
            const grain = Math.sin(x * 0.8 + (y >> 2) * 2.1) * 7;
            const d = (n - 0.5) * 14 + grain + (seam ? -28 : 0);
            putPixel(x, y, 178 + d, 138 + d * 0.85, 86 + d * 0.65);
            break;
          }
          case 'cobblestone': {
            const grid = ((x + (y >> 2) * 3) % 5 === 0) || (y % 4 === 0);
            const c = (grid ? 82 : 122) + (n - 0.5) * 24 + (n2 - 0.5) * 18;
            putPixel(x, y, c, c, c + 2);
            break;
          }
          case 'crafting_table_top': {
            const border = x < 2 || x > 13 || y < 2 || y > 13;
            const grid = !border && ((x - 2) % 4 === 0 || (y - 2) % 4 === 0);
            if (border) {
              const d = (n - 0.5) * 14;
              putPixel(x, y, 118 + d, 78 + d * 0.8, 44 + d * 0.6);
            } else if (grid) {
              putPixel(x, y, 76, 50, 28);
            } else {
              const d = (n - 0.5) * 12;
              putPixel(x, y, 184 + d, 142 + d * 0.85, 90 + d * 0.65);
            }
            break;
          }
          case 'crafting_table_side': {
            if (y < 4) {
              const d = (n - 0.5) * 14;
              putPixel(x, y, 118 + d, 78 + d * 0.8, 44 + d * 0.6);
            } else if ((x >= 4 && x <= 5 && y >= 6 && y <= 11) || (x >= 10 && x <= 11 && y >= 6 && y <= 11)) {
              putPixel(x, y, 82, 86, 94);
            } else {
              const seam = y % 4 === 0;
              const d = (n - 0.5) * 14 + (seam ? -22 : 0);
              putPixel(x, y, 168 + d, 128 + d * 0.85, 78 + d * 0.65);
            }
            break;
          }
          case 'glass': {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const glint = (x + y === 6 || x + y === 7 || x + y === 22) && x > 2 && x < 13;
            if (border) {
              putPixel(x, y, 182, 224, 240, 255);
            } else if (glint) {
              putPixel(x, y, 238, 250, 255, 210);
            } else {
              putPixel(x, y, 0, 0, 0, 0);
            }
            break;
          }
          case 'bricks': {
            const mortar = y % 4 === 0 || ((x + (y >> 2) * 4) % 8 === 0);
            if (mortar) {
              const c = 198 + (n - 0.5) * 16;
              putPixel(x, y, c, c - 4, c - 10);
            } else {
              const d = (n - 0.5) * 24 + (n2 - 0.5) * 16;
              putPixel(x, y, 162 + d, 76 + d * 0.6, 58 + d * 0.5);
            }
            break;
          }
          default: {
            putPixel(x, y, 255, 0, 255, 255);
          }
        }
      }
    }
  }

  /**
   * Returns UV rectangle for a tile key.
   * @param {string} key
   * @returns {{ u0: number, v0: number, uSize: number, vSize: number }}
   */
  getTileRect(key) {
    return this.rects.get(key) ?? this.rects.get('stone');
  }

  /**
   * Exports a plain serializable map of all tile UV rectangles for Web Workers.
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
   * Returns a CSS data URL preview of a single tile for HUD hotbar swatches.
   * @param {string} key
   * @returns {string|null}
   */
  getTileDataURL(key) {
    if (!this.canvas || typeof document === 'undefined') return null;
    const index = TILE_KEYS.indexOf(key);
    if (index === -1) return null;

    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_SIZE;
    tileCanvas.height = TILE_SIZE;
    const tctx = tileCanvas.getContext('2d');
    tctx.drawImage(
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
    return tileCanvas.toDataURL();
  }

  /**
   * Releases GPU texture resources.
   */
  dispose() {
    this.texture?.dispose();
    this.texture = null;
  }
}
