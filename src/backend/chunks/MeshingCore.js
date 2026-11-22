/**
 * @file MeshingCore.js
 * @description Pure zero-DOM, zero-Three.js greedy meshing & cross-plant flora builder.
 * Produces raw TypedArray geometry buffers usable both synchronously on the main thread
 * and asynchronously inside Web Workers via Transferable ArrayBuffers.
 */

import { BlockFace } from '../blocks/Block.js';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from './ChunkConstants.js';

const FACE_SHADE = Object.freeze({
  [BlockFace.TOP]: 1.0,
  [BlockFace.SOUTH]: 0.88,
  [BlockFace.NORTH]: 0.86,
  [BlockFace.EAST]: 0.80,
  [BlockFace.WEST]: 0.78,
  [BlockFace.BOTTOM]: 0.62,
});

const AO_CURVE = [0.46, 0.66, 0.84, 1.0];

const DIRECTIONS = [
  {
    face: BlockFace.EAST,
    axis: 0,
    uAxis: 2,
    vAxis: 1,
    step: 1,
    flipWinding: true,
    normal: [1, 0, 0],
  },
  {
    face: BlockFace.WEST,
    axis: 0,
    uAxis: 2,
    vAxis: 1,
    step: -1,
    flipWinding: false,
    normal: [-1, 0, 0],
  },
  {
    face: BlockFace.TOP,
    axis: 1,
    uAxis: 0,
    vAxis: 2,
    step: 1,
    flipWinding: true,
    normal: [0, 1, 0],
  },
  {
    face: BlockFace.BOTTOM,
    axis: 1,
    uAxis: 0,
    vAxis: 2,
    step: -1,
    flipWinding: false,
    normal: [0, -1, 0],
  },
  {
    face: BlockFace.SOUTH,
    axis: 2,
    uAxis: 0,
    vAxis: 1,
    step: 1,
    flipWinding: false,
    normal: [0, 0, 1],
  },
  {
    face: BlockFace.NORTH,
    axis: 2,
    uAxis: 0,
    vAxis: 1,
    step: -1,
    flipWinding: true,
    normal: [0, 0, -1],
  },
];

const DIMS = [CHUNK_WIDTH, CHUNK_HEIGHT, CHUNK_DEPTH];
const INV_SQRT2 = Math.SQRT1_2;

/**
 * Builds raw typed-array buffers for both opaque (including cross-plant flora/torches)
 * and transparent water passes.
 * @param {Object} params
 * @param {(lx: number, y: number, lz: number) => number} params.getBlockAtLocal
 * @param {(lx: number, y: number, lz: number) => { sky: number, block: number }} params.getLightAtLocal
 * @param {(lx: number, y: number, lz: number) => number} [params.getFluidLevelAtLocal]
 * @param {Array<{ occludesFaces: boolean, lightEmission: number, crossPlant: boolean, textures: Record<string, string|null> }|null>} params.blockTable
 * @param {Record<string, { u0: number, v0: number, uSize: number, vSize: number }>} params.tileRects
 * @returns {{ opaque: Object|null, water: Object|null, faceCount: number, triangleCount: number }}
 */
export function buildChunkGeometryBuffers({
  getBlockAtLocal,
  getLightAtLocal,
  getFluidLevelAtLocal = () => 0,
  blockTable,
  tileRects,
  yMin = 0,
  yMax = CHUNK_HEIGHT,
}) {
  const clampedMin = Math.max(0, yMin | 0);
  const clampedMax = Math.min(CHUNK_HEIGHT, yMax | 0);

  const opaque = runGreedyPass({
    getBlockAtLocal,
    getLightAtLocal,
    getFluidLevelAtLocal,
    blockTable,
    tileRects,
    waterPass: false,
    yMin: clampedMin,
    yMax: clampedMax,
  });

  const water = runGreedyPass({
    getBlockAtLocal,
    getLightAtLocal,
    getFluidLevelAtLocal,
    blockTable,
    tileRects,
    waterPass: true,
    yMin: clampedMin,
    yMax: clampedMax,
  });

  const faceCount = (opaque?.faceCount ?? 0) + (water?.faceCount ?? 0);
  const triangleCount = (opaque?.triangleCount ?? 0) + (water?.triangleCount ?? 0);

  return { opaque, water, faceCount, triangleCount };
}

/**
 * Computes classic 0..3 voxel ambient occlusion for a single quad's 4 corners.
 */
function computeFaceAO(neighborCoord, uAxis, vAxis, getBlockAtLocal, blockTable) {
  const isOccluder = (du, dv) => {
    const sample = [neighborCoord[0], neighborCoord[1], neighborCoord[2]];
    sample[uAxis] += du;
    sample[vAxis] += dv;
    const id = getBlockAtLocal(sample[0], sample[1], sample[2]);
    return Boolean(blockTable[id]?.occludesFaces);
  };

  const vertexAO = (side1, side2, corner) => {
    if (side1 && side2) return 0;
    return 3 - (side1 + side2 + corner);
  };

  const sNegU = isOccluder(-1, 0) ? 1 : 0;
  const sPosU = isOccluder(1, 0) ? 1 : 0;
  const sNegV = isOccluder(0, -1) ? 1 : 0;
  const sPosV = isOccluder(0, 1) ? 1 : 0;

  const cNegUNegV = isOccluder(-1, -1) ? 1 : 0;
  const cPosUNegV = isOccluder(1, -1) ? 1 : 0;
  const cPosUPosV = isOccluder(1, 1) ? 1 : 0;
  const cNegUPosV = isOccluder(-1, 1) ? 1 : 0;

  return [
    vertexAO(sNegU, sNegV, cNegUNegV),
    vertexAO(sPosU, sNegV, cPosUNegV),
    vertexAO(sPosU, sPosV, cPosUPosV),
    vertexAO(sNegU, sPosV, cNegUPosV),
  ];
}

/**
 * Executes 3D greedy meshing + cross-plant flora emission and returns TypedArrays.
 */
function runGreedyPass({
  getBlockAtLocal,
  getLightAtLocal,
  getFluidLevelAtLocal,
  blockTable,
  tileRects,
  waterPass,
  yMin = 0,
  yMax = CHUNK_HEIGHT,
}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const tileRectArr = [];
  const lights = [];
  const indices = [];

  let vertexCount = 0;
  let faceCount = 0;

  const coord = [0, 0, 0];
  const neighborCoord = [0, 0, 0];
  const fallbackRect = tileRects.stone || { u0: 0, v0: 0, uSize: 0.125, vSize: 0.25 };

  for (let d = 0; d < DIRECTIONS.length; d++) {
    const dir = DIRECTIONS[d];
    const { axis, uAxis, vAxis, step, normal, face, flipWinding } = dir;
    const sStart = axis === 1 ? yMin : 0;
    const sEnd = axis === 1 ? yMax : DIMS[axis];
    const uStart = uAxis === 1 ? yMin : 0;
    const uEnd = uAxis === 1 ? yMax : DIMS[uAxis];
    const vStart = vAxis === 1 ? yMin : 0;
    const vEnd = vAxis === 1 ? yMax : DIMS[vAxis];
    const uSize = uEnd - uStart;
    const vSize = vEnd - vStart;

    const mask = new Array(uSize * vSize);

    for (let s = sStart; s < sEnd; s++) {
      coord[axis] = s;
      neighborCoord[axis] = s + step;

      let hasAnyFace = false;

      for (let v = 0; v < vSize; v++) {
        coord[vAxis] = vStart + v;
        neighborCoord[vAxis] = vStart + v;

        for (let u = 0; u < uSize; u++) {
          coord[uAxis] = uStart + u;
          neighborCoord[uAxis] = uStart + u;

          const blockId = getBlockAtLocal(coord[0], coord[1], coord[2]);
          const maskIdx = v * uSize + u;

          if (blockId === BLOCK_IDS.AIR) {
            mask[maskIdx] = null;
            continue;
          }

          const def = blockTable[blockId];
          const shape = def?.renderShape || 'cube';
          if (
            !def ||
            def.crossPlant ||
            (shape !== 'cube' && shape !== 'half' && shape !== 'portal' && shape !== 'end_portal')
          ) {
            mask[maskIdx] = null;
            continue;
          }

          const isWater = blockId === BLOCK_IDS.WATER;
          const isPortal = blockId === BLOCK_IDS.NETHER_PORTAL || blockId === BLOCK_IDS.END_PORTAL;
          const isTranslucent = isWater || isPortal;
          const isLava = blockId === BLOCK_IDS.LAVA;
          if (waterPass !== isTranslucent) {
            mask[maskIdx] = null;
            continue;
          }

          const nBlockId = getBlockAtLocal(
            neighborCoord[0],
            neighborCoord[1],
            neighborCoord[2]
          );
          const nDef = blockTable[nBlockId];
          const nOccludes = Boolean(nDef?.occludesFaces);

          if (isWater) {
            if (nBlockId === BLOCK_IDS.WATER || nOccludes) {
              mask[maskIdx] = null;
              continue;
            }
          } else if (isPortal) {
            if (nBlockId === blockId || nOccludes) {
              mask[maskIdx] = null;
              continue;
            }
          } else if (isLava) {
            if (nBlockId === BLOCK_IDS.LAVA || nOccludes) {
              mask[maskIdx] = null;
              continue;
            }
          } else if (nOccludes) {
            mask[maskIdx] = null;
            continue;
          }

          const ao =
            waterPass || isLava
              ? [3, 3, 3, 3]
              : computeFaceAO(neighborCoord, uAxis, vAxis, getBlockAtLocal, blockTable);

          const nLight = getLightAtLocal(neighborCoord[0], neighborCoord[1], neighborCoord[2]);
          const skyLight = nLight.sky;
          const blockLight = Math.max(nLight.block, def.lightEmission || 0);

          let waterTopOffset = 0;
          if (isWater || isLava) {
            const aboveId = getBlockAtLocal(coord[0], coord[1] + 1, coord[2]);
            if (aboveId !== blockId && face !== BlockFace.BOTTOM) {
              const meta = getFluidLevelAtLocal(coord[0], coord[1], coord[2]);
              const isFalling = (meta & 0x10) !== 0;
              const dist = isFalling ? 0 : meta & 0x0f;
              waterTopOffset = dist === 0 ? -0.12 : -Math.min(0.86, 0.12 + dist * 0.14);
            }
          } else if (def.renderShape === 'half' && face !== BlockFace.BOTTOM) {
            waterTopOffset = -0.45;
          } else if (def.renderShape === 'end_portal' && face !== BlockFace.BOTTOM) {
            waterTopOffset = -0.25;
          }

          mask[maskIdx] = {
            blockId,
            ao0: ao[0],
            ao1: ao[1],
            ao2: ao[2],
            ao3: ao[3],
            skyLight,
            blockLight,
            waterTopOffset,
            key: `${blockId}|${ao[0]}${ao[1]}${ao[2]}${ao[3]}|${skyLight}|${blockLight}|${waterTopOffset}`,
          };
          hasAnyFace = true;
        }
      }

      if (!hasAnyFace) continue;

      for (let v = 0; v < vSize; v++) {
        for (let u = 0; u < uSize; ) {
          const cell = mask[v * uSize + u];
          if (!cell) {
            u++;
            continue;
          }

          let w = 1;
          while (u + w < uSize) {
            const next = mask[v * uSize + (u + w)];
            if (!next || next.key !== cell.key) break;
            w++;
          }

          let h = 1;
          outer: while (v + h < vSize) {
            for (let k = 0; k < w; k++) {
              const next = mask[(v + h) * uSize + (u + k)];
              if (!next || next.key !== cell.key) {
                break outer;
              }
            }
            h++;
          }

          const planePos = s + (step > 0 ? 1 : 0);
          const def = blockTable[cell.blockId];
          const tileKey = def?.textures?.[face] || 'stone';
          const rect = tileRects[tileKey] || fallbackRect;
          const faceShade = FACE_SHADE[face] ?? 1.0;
          const waterTopOffset = cell.waterTopOffset;

          const c0 = [0, 0, 0];
          const c1 = [0, 0, 0];
          const c2 = [0, 0, 0];
          const c3 = [0, 0, 0];

          const wu = uStart + u;
          const wv = vStart + v;
          c0[axis] = planePos; c0[uAxis] = wu;     c0[vAxis] = wv;
          c1[axis] = planePos; c1[uAxis] = wu + w; c1[vAxis] = wv;
          c2[axis] = planePos; c2[uAxis] = wu + w; c2[vAxis] = wv + h;
          c3[axis] = planePos; c3[uAxis] = wu;     c3[vAxis] = wv + h;

          if (waterTopOffset !== 0) {
            if (face === BlockFace.TOP) {
              c0[1] += waterTopOffset;
              c1[1] += waterTopOffset;
              c2[1] += waterTopOffset;
              c3[1] += waterTopOffset;
            } else if (axis !== 1) {
              // Lower only the top edge (vAxis === 1 -> c2 & c3) of surface-layer side walls
              c2[1] += waterTopOffset;
              c3[1] += waterTopOffset;
            }
          }

          positions.push(
            c0[0], c0[1], c0[2],
            c1[0], c1[1], c1[2],
            c2[0], c2[1], c2[2],
            c3[0], c3[1], c3[2]
          );

          const skyNorm = cell.skyLight / 15;
          const blockNorm = cell.blockLight / 15;
          for (let i = 0; i < 4; i++) {
            normals.push(normal[0], normal[1], normal[2]);
            tileRectArr.push(rect.u0, rect.v0, rect.uSize, rect.vSize);
            lights.push(skyNorm, blockNorm);
          }

          uvs.push(0, 0, w, 0, w, h, 0, h);

          const aoVals = [cell.ao0, cell.ao1, cell.ao2, cell.ao3];
          for (let i = 0; i < 4; i++) {
            const shade = faceShade * AO_CURVE[aoVals[i]];
            colors.push(shade, shade, shade);
          }

          const flipAO = cell.ao0 + cell.ao2 < cell.ao1 + cell.ao3;

          if (!flipWinding) {
            if (flipAO) {
              indices.push(
                vertexCount + 1, vertexCount + 2, vertexCount + 3,
                vertexCount + 1, vertexCount + 3, vertexCount + 0
              );
            } else {
              indices.push(
                vertexCount + 0, vertexCount + 1, vertexCount + 2,
                vertexCount + 0, vertexCount + 2, vertexCount + 3
              );
            }
          } else {
            if (flipAO) {
              indices.push(
                vertexCount + 1, vertexCount + 3, vertexCount + 2,
                vertexCount + 1, vertexCount + 0, vertexCount + 3
              );
            } else {
              indices.push(
                vertexCount + 0, vertexCount + 2, vertexCount + 1,
                vertexCount + 0, vertexCount + 3, vertexCount + 2
              );
            }
          }

          vertexCount += 4;
          faceCount++;

          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) {
              mask[(v + dv) * uSize + (u + du)] = null;
            }
          }

          u += w;
        }
      }
    }
  }

  // Emit X-crossed flora & torch billboards inside the opaque alpha-tested pass
  if (!waterPass) {
    const emitQuad = (p0, p1, p2, p3, nrm, rect, skyNorm, blockNorm, doubleSided = true) => {
      // Front face (CCW matching nrm)
      positions.push(
        p0[0], p0[1], p0[2],
        p1[0], p1[1], p1[2],
        p2[0], p2[1], p2[2],
        p3[0], p3[1], p3[2]
      );
      for (let i = 0; i < 4; i++) {
        normals.push(nrm[0], nrm[1], nrm[2]);
        tileRectArr.push(rect.u0, rect.v0, rect.uSize, rect.vSize);
        lights.push(skyNorm, blockNorm);
        colors.push(0.95, 0.95, 0.95);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(
        vertexCount, vertexCount + 1, vertexCount + 2,
        vertexCount, vertexCount + 2, vertexCount + 3
      );
      vertexCount += 4;
      faceCount++;

      if (doubleSided) {
        positions.push(
          p0[0], p0[1], p0[2],
          p1[0], p1[1], p1[2],
          p2[0], p2[1], p2[2],
          p3[0], p3[1], p3[2]
        );
        for (let i = 0; i < 4; i++) {
          normals.push(-nrm[0], -nrm[1], -nrm[2]);
          tileRectArr.push(rect.u0, rect.v0, rect.uSize, rect.vSize);
          lights.push(skyNorm, blockNorm);
          colors.push(0.9, 0.9, 0.9);
        }
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(
          vertexCount, vertexCount + 2, vertexCount + 1,
          vertexCount, vertexCount + 3, vertexCount + 2
        );
        vertexCount += 4;
        faceCount++;
      }
    };

    const emitBox = (x0, y0, z0, x1, y1, z1, rects, skyNorm, blockNorm) => {
      const rTop = rects.top || rects.all || fallbackRect;
      const rBot = rects.bottom || rects.all || rTop;
      const rNorth = rects.north || rects.side || rects.all || rTop;
      const rSouth = rects.south || rects.side || rects.all || rTop;
      const rEast = rects.east || rects.side || rects.all || rTop;
      const rWest = rects.west || rects.side || rects.all || rTop;

      const emitFace = (p0, p1, p2, p3, nrm, rect, shade) => {
        positions.push(
          p0[0], p0[1], p0[2],
          p1[0], p1[1], p1[2],
          p2[0], p2[1], p2[2],
          p3[0], p3[1], p3[2]
        );
        for (let i = 0; i < 4; i++) {
          normals.push(nrm[0], nrm[1], nrm[2]);
          tileRectArr.push(rect.u0, rect.v0, rect.uSize, rect.vSize);
          lights.push(skyNorm, blockNorm);
          colors.push(shade, shade, shade);
        }
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(
          vertexCount, vertexCount + 1, vertexCount + 2,
          vertexCount, vertexCount + 2, vertexCount + 3
        );
        vertexCount += 4;
        faceCount++;
      };

      // +Y Top
      emitFace([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], rTop, 1.0);
      // -Y Bottom
      emitFace([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], rBot, 0.62);
      // +Z South
      emitFace([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], rSouth, 0.88);
      // -Z North
      emitFace([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], rNorth, 0.86);
      // +X East
      emitFace([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], rEast, 0.80);
      // -X West
      emitFace([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], rWest, 0.78);
    };

    const getRect = (key) => tileRects[key] || fallbackRect;
    const isFenceConnectable = (nx, ny, nz) => {
      const nid = getBlockAtLocal(nx, ny, nz);
      if (nid === BLOCK_IDS.AIR) return false;
      const ndef = blockTable[nid];
      return Boolean(ndef && (ndef.renderShape === 'fence' || ndef.occludesFaces));
    };

    for (let y = yMin; y < yMax; y++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
          const blockId = getBlockAtLocal(lx, y, lz);
          if (blockId === BLOCK_IDS.AIR) continue;
          const def = blockTable[blockId];
          if (!def) continue;

          const shape = def.renderShape || 'cube';
          if (shape !== 'cube' && shape !== 'half' && shape !== 'portal' && shape !== 'end_portal') {
            const selfLight = getLightAtLocal(lx, y, lz);
            const skyNorm = selfLight.sky / 15;
            const blockNorm = Math.max(selfLight.block, def.lightEmission || 0) / 15;
            const rTop = getRect(def.textures?.top || def.textures?.north || 'stone');
            const rBot = getRect(def.textures?.bottom || def.textures?.top || 'stone');
            const rSide = getRect(def.textures?.north || def.textures?.east || def.textures?.top || 'stone');
            const defaultRects = { top: rTop, bottom: rBot, side: rSide };

            if (shape === 'door_open') {
              const xEdge = lx + 0.08;
              emitQuad(
                [xEdge, y, lz],
                [xEdge, y, lz + 1],
                [xEdge, y + 1, lz + 1],
                [xEdge, y + 1, lz],
                [1, 0, 0],
                rSide,
                skyNorm,
                blockNorm,
                true
              );
            } else if (shape === 'slab') {
              emitBox(lx, y, lz, lx + 1, y + 0.5, lz + 1, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'stairs') {
              emitBox(lx, y, lz, lx + 1, y + 0.5, lz + 1, defaultRects, skyNorm, blockNorm);
              emitBox(lx, y + 0.5, lz + 0.5, lx + 1, y + 1, lz + 1, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'fence') {
              emitBox(lx + 0.375, y, lz + 0.375, lx + 0.625, y + 1, lz + 0.625, defaultRects, skyNorm, blockNorm);
              if (isFenceConnectable(lx + 1, y, lz)) {
                emitBox(lx + 0.625, y + 0.72, lz + 0.43, lx + 1, y + 0.90, lz + 0.57, defaultRects, skyNorm, blockNorm);
                emitBox(lx + 0.625, y + 0.32, lz + 0.43, lx + 1, y + 0.50, lz + 0.57, defaultRects, skyNorm, blockNorm);
              }
              if (isFenceConnectable(lx - 1, y, lz)) {
                emitBox(lx, y + 0.72, lz + 0.43, lx + 0.375, y + 0.90, lz + 0.57, defaultRects, skyNorm, blockNorm);
                emitBox(lx, y + 0.32, lz + 0.43, lx + 0.375, y + 0.50, lz + 0.57, defaultRects, skyNorm, blockNorm);
              }
              if (isFenceConnectable(lx, y, lz + 1)) {
                emitBox(lx + 0.43, y + 0.72, lz + 0.625, lx + 0.57, y + 0.90, lz + 1, defaultRects, skyNorm, blockNorm);
                emitBox(lx + 0.43, y + 0.32, lz + 0.625, lx + 0.57, y + 0.50, lz + 1, defaultRects, skyNorm, blockNorm);
              }
              if (isFenceConnectable(lx, y, lz - 1)) {
                emitBox(lx + 0.43, y + 0.72, lz, lx + 0.57, y + 0.90, lz + 0.375, defaultRects, skyNorm, blockNorm);
                emitBox(lx + 0.43, y + 0.32, lz, lx + 0.57, y + 0.50, lz + 0.375, defaultRects, skyNorm, blockNorm);
              }
            } else if (shape === 'lantern') {
              emitBox(lx + 0.31, y, lz + 0.31, lx + 0.69, y + 0.48, lz + 0.69, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.38, y + 0.48, lz + 0.38, lx + 0.62, y + 0.60, lz + 0.62, { all: rTop }, skyNorm, blockNorm);
              emitBox(lx + 0.46, y + 0.60, lz + 0.46, lx + 0.54, y + 0.82, lz + 0.54, { all: rTop }, skyNorm, blockNorm);
            } else if (shape === 'campfire') {
              const logRect = { all: getRect('campfire_log') };
              emitBox(lx + 0.05, y, lz + 0.12, lx + 0.95, y + 0.25, lz + 0.38, logRect, skyNorm, blockNorm);
              emitBox(lx + 0.05, y, lz + 0.62, lx + 0.95, y + 0.25, lz + 0.88, logRect, skyNorm, blockNorm);
              emitBox(lx + 0.12, y + 0.16, lz + 0.05, lx + 0.38, y + 0.38, lz + 0.95, logRect, skyNorm, blockNorm);
              emitBox(lx + 0.62, y + 0.16, lz + 0.05, lx + 0.88, y + 0.38, lz + 0.95, logRect, skyNorm, blockNorm);
              const fireRect = getRect('campfire_fire');
              emitQuad([lx + 0.18, y + 0.22, lz + 0.18], [lx + 0.82, y + 0.22, lz + 0.82], [lx + 0.82, y + 0.98, lz + 0.82], [lx + 0.18, y + 0.98, lz + 0.18], [-INV_SQRT2, 0, INV_SQRT2], fireRect, skyNorm, 1.0, true);
              emitQuad([lx + 0.82, y + 0.22, lz + 0.18], [lx + 0.18, y + 0.22, lz + 0.82], [lx + 0.18, y + 0.98, lz + 0.82], [lx + 0.82, y + 0.98, lz + 0.18], [-INV_SQRT2, 0, -INV_SQRT2], fireRect, skyNorm, 1.0, true);
            } else if (shape === 'redstone_dust') {
              emitBox(lx + 0.06, y, lz + 0.06, lx + 0.94, y + 0.06, lz + 0.94, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'pressure_plate' || shape === 'pressure_plate_on') {
              const topH = shape === 'pressure_plate_on' ? 0.04 : 0.09;
              emitBox(lx + 0.06, y, lz + 0.06, lx + 0.94, y + topH, lz + 0.94, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'button' || shape === 'button_on') {
              const topH = shape === 'button_on' ? 0.07 : 0.14;
              emitBox(lx + 0.32, y, lz + 0.38, lx + 0.68, y + topH, lz + 0.62, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'lever' || shape === 'lever_on') {
              emitBox(lx + 0.30, y, lz + 0.25, lx + 0.70, y + 0.18, lz + 0.75, { all: getRect('cobblestone') }, skyNorm, blockNorm);
              const tipZ = shape === 'lever_on' ? 0.62 : 0.30;
              emitBox(lx + 0.44, y + 0.16, lz + tipZ, lx + 0.56, y + 0.66, lz + tipZ + 0.12, { all: rTop }, skyNorm, blockNorm);
            } else if (shape === 'sign') {
              const woodRect = { all: getRect('planks_oak') };
              emitBox(lx + 0.44, y, lz + 0.44, lx + 0.56, y + 0.56, lz + 0.56, woodRect, skyNorm, blockNorm);
              emitBox(lx + 0.06, y + 0.52, lz + 0.43, lx + 0.94, y + 0.98, lz + 0.57, { all: getRect('oak_sign') }, skyNorm, blockNorm);
            } else if (shape === 'enchanting_table') {
              emitBox(lx, y, lz, lx + 1, y + 0.75, lz + 1, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.32, y + 0.86, lz + 0.36, lx + 0.68, y + 0.96, lz + 0.64, { all: getRect('bookshelf') }, skyNorm, Math.max(blockNorm, 0.7));
            } else if (shape === 'anvil') {
              emitBox(lx + 0.12, y, lz + 0.12, lx + 0.88, y + 0.25, lz + 0.88, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.28, y + 0.25, lz + 0.22, lx + 0.72, y + 0.62, lz + 0.78, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.18, y + 0.62, lz + 0.04, lx + 0.82, y + 1.0, lz + 0.96, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'brewing_stand') {
              emitBox(lx + 0.12, y, lz + 0.12, lx + 0.88, y + 0.14, lz + 0.88, { all: getRect('cobblestone') }, skyNorm, blockNorm);
              emitBox(lx + 0.44, y + 0.14, lz + 0.44, lx + 0.56, y + 0.92, lz + 0.56, { all: getRect('brewing_stand') }, skyNorm, blockNorm);
              emitBox(lx + 0.20, y + 0.52, lz + 0.46, lx + 0.80, y + 0.62, lz + 0.54, { all: getRect('brewing_stand') }, skyNorm, blockNorm);
              emitBox(lx + 0.46, y + 0.52, lz + 0.20, lx + 0.54, y + 0.62, lz + 0.80, { all: getRect('brewing_stand') }, skyNorm, blockNorm);
            } else if (shape === 'end_portal_frame' || shape === 'end_portal_frame_filled') {
              emitBox(lx, y, lz, lx + 1, y + 0.8125, lz + 1, defaultRects, skyNorm, blockNorm);
              if (shape === 'end_portal_frame_filled') {
                emitBox(lx + 0.26, y + 0.8125, lz + 0.26, lx + 0.74, y + 1.0, lz + 0.74, { all: getRect('end_portal_frame_top_filled') }, skyNorm, 1.0);
              }
            } else if (shape === 'dragon_egg') {
              emitBox(lx + 0.16, y, lz + 0.16, lx + 0.84, y + 0.55, lz + 0.84, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.26, y + 0.55, lz + 0.26, lx + 0.74, y + 0.85, lz + 0.74, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.36, y + 0.85, lz + 0.36, lx + 0.64, y + 1.0, lz + 0.64, defaultRects, skyNorm, blockNorm);
            } else if (shape === 'piston_extended') {
              emitBox(lx, y, lz + 0.25, lx + 1, y + 1, lz + 1, defaultRects, skyNorm, blockNorm);
              emitBox(lx + 0.36, y + 0.36, lz - 0.55, lx + 0.64, y + 0.64, lz + 0.25, { all: getRect('planks_oak') }, skyNorm, blockNorm);
              emitBox(lx, y, lz - 0.80, lx + 1, y + 1, lz - 0.55, { all: getRect('piston_head') }, skyNorm, blockNorm);
            }
            continue;
          }

          if (!def.crossPlant) continue;

          const tileKey = def.textures?.north || def.textures?.top || 'tall_grass';
          const rect = tileRects[tileKey] || fallbackRect;
          const selfLight = getLightAtLocal(lx, y, lz);
          const skyNorm = selfLight.sky / 15;
          const blockNorm = Math.max(selfLight.block, def.lightEmission || 0) / 15;

          const pad = 0.15;
          const x0 = lx + pad;
          const x1 = lx + 1 - pad;
          const z0 = lz + pad;
          const z1 = lz + 1 - pad;
          const y0 = y;
          const y1 = y + 1;

          // Diagonal 1: (x0,y0,z0) -> (x1,y0,z1) -> (x1,y1,z1) -> (x0,y1,z0)
          emitQuad(
            [x0, y0, z0],
            [x1, y0, z1],
            [x1, y1, z1],
            [x0, y1, z0],
            [-INV_SQRT2, 0, INV_SQRT2],
            rect,
            skyNorm,
            blockNorm
          );

          // Diagonal 2: (x1,y0,z0) -> (x0,y0,z1) -> (x0,y1,z1) -> (x1,y1,z0)
          emitQuad(
            [x1, y0, z0],
            [x0, y0, z1],
            [x0, y1, z1],
            [x1, y1, z0],
            [-INV_SQRT2, 0, -INV_SQRT2],
            rect,
            skyNorm,
            blockNorm
          );
        }
      }
    }
  }

  if (faceCount === 0) {
    return null;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    tileRects: new Float32Array(tileRectArr),
    lights: new Float32Array(lights),
    indices: new Uint32Array(indices),
    faceCount,
    triangleCount: faceCount * 2,
  };
}
