/**
 * @file MobSkins.js
 * @description Shared procedural pixel-art mob skin textures + shared BoxGeometry cache
 * with live hot-swap support for imported Minecraft 1.21 entity PNG textures.
 */

import * as THREE from 'three';

/** @type {Map<string, THREE.BoxGeometry>} */
const sharedBoxCache = new Map();

/**
 * Returns a cached shared BoxGeometry so identical mob limbs/parts don't reallocate GPU buffers.
 * Never call .dispose() on geometries returned by this helper!
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @returns {THREE.BoxGeometry}
 */
export function getSharedBoxGeometry(w, h, d) {
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let geo = sharedBoxCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    sharedBoxCache.set(key, geo);
  }
  return geo;
}

const MOB_LIST = [
  'sheep',
  'cow',
  'pig',
  'chicken',
  'zombie',
  'creeper',
  'skeleton',
  'spider',
  'slime',
  'enderman',
  'zombified_piglin',
  'blaze',
  'villager',
  'wolf',
];

function createCanvas(size = 16) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function drawNoise(ctx, baseHex, variance, seedOffset) {
  const r0 = (baseHex >> 16) & 255;
  const g0 = (baseHex >> 8) & 255;
  const b0 = baseHex & 255;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const h = Math.sin((x + seedOffset) * 12.9898 + (y + seedOffset) * 78.233) * 43758.5453;
      const n = (h - Math.floor(h) - 0.5) * 2 * variance;
      const r = Math.max(0, Math.min(255, Math.round(r0 + n)));
      const g = Math.max(0, Math.min(255, Math.round(g0 + n)));
      const b = Math.max(0, Math.min(255, Math.round(b0 + n)));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawProceduralFace(ctx, type) {
  ctx.clearRect(0, 0, 16, 16);
  switch (type) {
    case 'sheep':
      drawNoise(ctx, 0xd8c1a4, 12, 11);
      // Wool crown
      ctx.fillStyle = '#f2f0eb';
      ctx.fillRect(0, 0, 16, 3);
      ctx.fillRect(0, 3, 2, 2);
      ctx.fillRect(14, 3, 2, 2);
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, 6, 4, 2);
      ctx.fillRect(10, 6, 4, 2);
      ctx.fillStyle = '#1f1c1a';
      ctx.fillRect(4, 6, 2, 2);
      ctx.fillRect(10, 6, 2, 2);
      // Pinkish nose & mouth
      ctx.fillStyle = '#e5a9a9';
      ctx.fillRect(5, 11, 6, 3);
      ctx.fillStyle = '#c48383';
      ctx.fillRect(6, 12, 4, 1);
      break;

    case 'cow':
      drawNoise(ctx, 0x4b3526, 14, 23);
      // White forehead blaze
      ctx.fillStyle = '#ded7cb';
      ctx.fillRect(6, 0, 4, 5);
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, 5, 3, 2);
      ctx.fillRect(12, 5, 3, 2);
      ctx.fillStyle = '#14100d';
      ctx.fillRect(2, 5, 2, 2);
      ctx.fillRect(12, 5, 2, 2);
      // Muzzle
      ctx.fillStyle = '#a89a91';
      ctx.fillRect(2, 10, 12, 6);
      ctx.fillStyle = '#40342e';
      ctx.fillRect(4, 11, 2, 2);
      ctx.fillRect(10, 11, 2, 2);
      break;

    case 'pig':
      drawNoise(ctx, 0xf29ca6, 10, 37);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, 6, 4, 2);
      ctx.fillRect(11, 6, 4, 2);
      ctx.fillStyle = '#1c1214';
      ctx.fillRect(1, 6, 2, 2);
      ctx.fillRect(13, 6, 2, 2);
      // Snout
      ctx.fillStyle = '#f8b4be';
      ctx.fillRect(4, 9, 8, 5);
      ctx.fillStyle = '#994b56';
      ctx.fillRect(5, 11, 2, 2);
      ctx.fillRect(9, 11, 2, 2);
      break;

    case 'chicken':
      drawNoise(ctx, 0xf5f7fa, 8, 41);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(2, 5, 2, 2);
      ctx.fillRect(12, 5, 2, 2);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(5, 8, 6, 3);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(6, 11, 4, 3);
      break;

    case 'zombie':
      drawNoise(ctx, 0x4c7c44, 14, 53);
      ctx.fillStyle = '#33592d';
      ctx.fillRect(0, 0, 16, 4);
      // Hollow dark eyes
      ctx.fillStyle = '#142112';
      ctx.fillRect(2, 7, 4, 2);
      ctx.fillRect(10, 7, 4, 2);
      // Nose & grimace
      ctx.fillStyle = '#3c6636';
      ctx.fillRect(6, 9, 4, 2);
      ctx.fillStyle = '#243d20';
      ctx.fillRect(5, 12, 6, 2);
      break;

    case 'creeper':
      drawNoise(ctx, 0x4db546, 26, 67);
      // Iconic black Creeper face
      ctx.fillStyle = '#111611';
      ctx.fillRect(2, 3, 4, 4);
      ctx.fillRect(10, 3, 4, 4);
      ctx.fillRect(6, 7, 4, 5);
      ctx.fillRect(4, 9, 2, 5);
      ctx.fillRect(10, 9, 2, 5);
      break;

    case 'skeleton':
      drawNoise(ctx, 0xd8d6ce, 12, 79);
      ctx.fillStyle = '#1f1f1f';
      ctx.fillRect(2, 6, 4, 3);
      ctx.fillRect(10, 6, 4, 3);
      ctx.fillStyle = '#525252';
      ctx.fillRect(7, 9, 2, 2);
      ctx.fillStyle = '#262626';
      ctx.fillRect(3, 12, 10, 2);
      break;

    case 'spider':
      drawNoise(ctx, 0x2a2428, 12, 83);
      // Glowing crimson arachnid eyes
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(2, 6, 3, 2);
      ctx.fillRect(11, 6, 3, 2);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(6, 7, 2, 2);
      ctx.fillRect(8, 7, 2, 2);
      ctx.fillRect(3, 10, 2, 1);
      ctx.fillRect(11, 10, 2, 1);
      break;

    case 'slime':
      drawNoise(ctx, 0x67c954, 16, 97);
      ctx.fillStyle = '#1d3a18';
      ctx.fillRect(3, 5, 3, 3);
      ctx.fillRect(10, 5, 3, 3);
      ctx.fillRect(7, 10, 2, 2);
      break;

    case 'enderman':
      drawNoise(ctx, 0x16161a, 8, 107);
      // Glowing magenta eyes
      ctx.fillStyle = '#f5d0fe';
      ctx.fillRect(1, 7, 5, 2);
      ctx.fillRect(10, 7, 5, 2);
      ctx.fillStyle = '#c026d3';
      ctx.fillRect(3, 7, 2, 2);
      ctx.fillRect(11, 7, 2, 2);
      break;

    case 'zombified_piglin':
      drawNoise(ctx, 0xe89ca6, 12, 119);
      // Half green decayed skull
      ctx.fillStyle = '#5b8a42';
      ctx.fillRect(8, 0, 8, 16);
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(10, 1, 5, 5);
      // Eyes
      ctx.fillStyle = '#18181b';
      ctx.fillRect(2, 6, 3, 2);
      ctx.fillStyle = '#2d4720';
      ctx.fillRect(11, 6, 3, 2);
      // Snout
      ctx.fillStyle = '#d17884';
      ctx.fillRect(4, 10, 6, 4);
      break;

    case 'blaze':
      drawNoise(ctx, 0xf59e0b, 22, 131);
      // Glowing bright eyes + dark brows
      ctx.fillStyle = '#78350f';
      ctx.fillRect(2, 5, 12, 2);
      ctx.fillStyle = '#fef9c3';
      ctx.fillRect(2, 7, 4, 3);
      ctx.fillRect(10, 7, 4, 3);
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(4, 8, 2, 2);
      ctx.fillRect(10, 8, 2, 2);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(5, 12, 6, 2);
      break;

    case 'villager':
      drawNoise(ctx, 0xb88663, 10, 143);
      // Iconic unibrow
      ctx.fillStyle = '#4a2e19';
      ctx.fillRect(2, 5, 12, 2);
      // Emerald green villager eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, 7, 4, 2);
      ctx.fillRect(10, 7, 4, 2);
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(4, 7, 2, 2);
      ctx.fillRect(10, 7, 2, 2);
      // Slight mouth under nose
      ctx.fillStyle = '#7c4f31';
      ctx.fillRect(5, 13, 6, 1);
      break;

    case 'wolf':
      drawNoise(ctx, 0xd6d3d1, 14, 157);
      // Darker forehead fur
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(0, 0, 16, 4);
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, 6, 3, 2);
      ctx.fillRect(11, 6, 3, 2);
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(3, 6, 2, 2);
      ctx.fillRect(11, 6, 2, 2);
      // Snout & black nose
      ctx.fillStyle = '#e7e5e4';
      ctx.fillRect(4, 9, 8, 6);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(6, 10, 4, 2);
      break;

    default:
      drawNoise(ctx, 0x888888, 12, 1);
      break;
  }
}

function drawProceduralBody(ctx, type) {
  ctx.clearRect(0, 0, 16, 16);
  switch (type) {
    case 'sheep':
      drawNoise(ctx, 0xf2f0eb, 14, 211);
      break;
    case 'cow':
      drawNoise(ctx, 0x4f3828, 12, 223);
      // Classic mottled dairy patches
      ctx.fillStyle = '#e6dfd3';
      ctx.fillRect(2, 2, 6, 5);
      ctx.fillRect(10, 8, 5, 6);
      ctx.fillRect(0, 11, 4, 4);
      break;
    case 'pig':
      drawNoise(ctx, 0xf29ca6, 10, 233);
      break;
    case 'chicken':
      drawNoise(ctx, 0xf8fafc, 10, 241);
      break;
    case 'zombie':
      drawNoise(ctx, 0x268596, 14, 251);
      break;
    case 'creeper':
      drawNoise(ctx, 0x45a83e, 28, 263);
      break;
    case 'skeleton':
      drawNoise(ctx, 0xcac8c0, 14, 271);
      ctx.fillStyle = '#5c5b56';
      ctx.fillRect(2, 4, 12, 1);
      ctx.fillRect(2, 8, 12, 1);
      ctx.fillRect(2, 12, 12, 1);
      break;
    case 'spider':
      drawNoise(ctx, 0x282327, 14, 281);
      break;
    case 'slime':
      drawNoise(ctx, 0x5bbd49, 14, 293);
      break;
    case 'enderman':
      drawNoise(ctx, 0x15151a, 7, 307);
      break;
    case 'zombified_piglin':
      drawNoise(ctx, 0xd98a96, 16, 317);
      ctx.fillStyle = '#53823d';
      ctx.fillRect(7, 2, 7, 6);
      ctx.fillStyle = '#785134';
      ctx.fillRect(0, 11, 16, 5);
      break;
    case 'blaze':
      drawNoise(ctx, 0xd97706, 28, 331);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(3, 3, 10, 10);
      break;
    case 'villager':
      drawNoise(ctx, 0x6b4423, 14, 347);
      ctx.fillStyle = '#4a2e16';
      ctx.fillRect(0, 11, 16, 2);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(6, 11, 4, 2);
      break;
    case 'wolf':
      drawNoise(ctx, 0xd6d3d1, 16, 359);
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(0, 0, 16, 5);
      break;
    default:
      drawNoise(ctx, 0x808080, 10, 300);
      break;
  }
}

class MobSkinManager {
  constructor() {
    /** @type {Map<string, { canvas: HTMLCanvasElement|null, texture: THREE.CanvasTexture|null }>} */
    this._faces = new Map();
    /** @type {Map<string, { canvas: HTMLCanvasElement|null, texture: THREE.CanvasTexture|null }>} */
    this._bodies = new Map();
    this._initialized = false;
  }

  _ensureInit() {
    if (this._initialized || typeof document === 'undefined') return;
    this._initialized = true;
    for (const type of MOB_LIST) {
      const fCanvas = createCanvas(16);
      const bCanvas = createCanvas(16);
      if (fCanvas && bCanvas) {
        drawProceduralFace(fCanvas.getContext('2d'), type);
        drawProceduralBody(bCanvas.getContext('2d'), type);

        const fTex = new THREE.CanvasTexture(fCanvas);
        fTex.magFilter = THREE.NearestFilter;
        fTex.minFilter = THREE.NearestFilter;
        fTex.generateMipmaps = false;
        fTex.colorSpace = THREE.SRGBColorSpace;
        fTex.needsUpdate = true;

        const bTex = new THREE.CanvasTexture(bCanvas);
        bTex.magFilter = THREE.NearestFilter;
        bTex.minFilter = THREE.NearestFilter;
        bTex.generateMipmaps = false;
        bTex.colorSpace = THREE.SRGBColorSpace;
        bTex.needsUpdate = true;

        this._faces.set(type, { canvas: fCanvas, texture: fTex });
        this._bodies.set(type, { canvas: bCanvas, texture: bTex });
      }
    }
  }

  /**
   * @param {string} type
   * @returns {THREE.CanvasTexture|null}
   */
  getFaceTexture(type) {
    this._ensureInit();
    return this._faces.get(type)?.texture ?? null;
  }

  /**
   * @param {string} type
   * @returns {THREE.CanvasTexture|null}
   */
  getBodyTexture(type) {
    this._ensureInit();
    return this._bodies.get(type)?.texture ?? null;
  }

  /**
   * Resets all mob skin canvases back to crisp procedural pixel-art.
   */
  resetToDefault() {
    this._ensureInit();
    for (const type of MOB_LIST) {
      const f = this._faces.get(type);
      const b = this._bodies.get(type);
      if (f?.canvas && f.texture) {
        drawProceduralFace(f.canvas.getContext('2d'), type);
        f.texture.needsUpdate = true;
      }
      if (b?.canvas && b.texture) {
        drawProceduralBody(b.canvas.getContext('2d'), type);
        b.texture.needsUpdate = true;
      }
    }
  }

  /**
   * Applies imported Minecraft 1.21 entity PNG skin sheets onto live mob face/body textures.
   * Uses standard Minecraft UV coordinates (64x32 or 64x64 entity texture atlases) so existing
   * mobs in the scene hot-update immediately without rebuilding meshes.
   * @param {Record<string, Blob>} entitySkinBlobs
   */
  async applyResourcePackSkins(entitySkinBlobs) {
    this._ensureInit();
    this.resetToDefault();
    if (!entitySkinBlobs || typeof document === 'undefined') return 0;

    let applied = 0;
    // Standard MC UV crops [faceX, faceY, faceW, faceH, bodyX, bodyY, bodyW, bodyH] in 64px UV space
    const UV_CROPS = {
      zombie: [8, 8, 8, 8, 20, 20, 8, 12],
      creeper: [8, 8, 8, 8, 20, 20, 8, 12],
      skeleton: [8, 8, 8, 8, 20, 20, 8, 12],
      zombified_piglin: [8, 8, 8, 8, 20, 20, 8, 12],
      enderman: [8, 8, 8, 8, 40, 20, 8, 12],
      sheep: [8, 8, 6, 6, 36, 16, 8, 12],
      cow: [6, 6, 8, 8, 28, 14, 12, 16],
      pig: [8, 8, 8, 8, 36, 16, 8, 12],
      chicken: [2, 2, 4, 6, 6, 15, 6, 8],
      spider: [40, 12, 8, 8, 12, 12, 10, 10],
      slime: [8, 8, 8, 8, 0, 16, 8, 8],
      blaze: [8, 8, 8, 8, 0, 16, 8, 8],
      villager: [8, 8, 8, 10, 20, 20, 8, 12],
      wolf: [4, 4, 6, 6, 18, 14, 8, 10],
    };

    const entries = Object.entries(entitySkinBlobs);
    for (const [mobKey, blob] of entries) {
      const f = this._faces.get(mobKey);
      const b = this._bodies.get(mobKey);
      if (!f?.canvas || !b?.canvas || !blob) continue;

      try {
        const url = URL.createObjectURL(blob);
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = url;
        });
        URL.revokeObjectURL(url);

        const scaleX = img.naturalWidth / 64;
        const scaleY = img.naturalHeight / (img.naturalHeight === img.naturalWidth ? 64 : 32);
        const crop = UV_CROPS[mobKey] || [8, 8, 8, 8, 20, 20, 8, 12];

        const fCtx = f.canvas.getContext('2d');
        fCtx.imageSmoothingEnabled = false;
        fCtx.clearRect(0, 0, 16, 16);
        fCtx.drawImage(
          img,
          Math.floor(crop[0] * scaleX),
          Math.floor(crop[1] * scaleY),
          Math.max(1, Math.floor(crop[2] * scaleX)),
          Math.max(1, Math.floor(crop[3] * scaleY)),
          0,
          0,
          16,
          16
        );
        f.texture.needsUpdate = true;

        const bCtx = b.canvas.getContext('2d');
        bCtx.imageSmoothingEnabled = false;
        bCtx.clearRect(0, 0, 16, 16);
        bCtx.drawImage(
          img,
          Math.floor(crop[4] * scaleX),
          Math.floor(crop[5] * scaleY),
          Math.max(1, Math.floor(crop[6] * scaleX)),
          Math.max(1, Math.floor(crop[7] * scaleY)),
          0,
          0,
          16,
          16
        );
        b.texture.needsUpdate = true;
        applied++;
      } catch {
        // Keep procedural fallback if an entity PNG fails to decode
      }
    }
    return applied;
  }
}

export const mobSkins = new MobSkinManager();
