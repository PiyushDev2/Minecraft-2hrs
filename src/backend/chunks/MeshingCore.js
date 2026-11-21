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
}) {
  const opaque = runGreedyPass({
    getBlockAtLocal,
    getLightAtLocal,
    getFluidLevelAtLocal,
    blockTable,
    tileRects,
    waterPass: false,
  });

  const water = runGreedyPass({
    getBlockAtLocal,
    getLightAtLocal,
    getFluidLevelAtLocal,
    blockTable,
    tileRects,
    waterPass: true,
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
    const sliceCount = DIMS[axis];
    const uSize = DIMS[uAxis];
    const vSize = DIMS[vAxis];

    const mask = new Array(uSize * vSize);

    for (let s = 0; s < sliceCount; s++) {
      coord[axis] = s;
      neighborCoord[axis] = s + step;

      let hasAnyFace = false;

      for (let v = 0; v < vSize; v++) {
        coord[vAxis] = v;
        neighborCoord[vAxis] = v;

        for (let u = 0; u < uSize; u++) {
          coord[uAxis] = u;
          neighborCoord[uAxis] = u;

          const blockId = getBlockAtLocal(coord[0], coord[1], coord[2]);
          const maskIdx = v * uSize + u;

          if (blockId === BLOCK_IDS.AIR) {
            mask[maskIdx] = null;
            continue;
          }

          const def = blockTable[blockId];
          if (!def || def.crossPlant) {
            mask[maskIdx] = null;
            continue;
          }

          const isWater = blockId === BLOCK_IDS.WATER;
          if (waterPass !== isWater) {
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

          if (waterPass) {
            if (nBlockId === BLOCK_IDS.WATER || nOccludes) {
              mask[maskIdx] = null;
              continue;
            }
          } else if (nOccludes) {
            mask[maskIdx] = null;
            continue;
          }

          const ao = waterPass
            ? [3, 3, 3, 3]
            : computeFaceAO(neighborCoord, uAxis, vAxis, getBlockAtLocal, blockTable);

          const nLight = getLightAtLocal(neighborCoord[0], neighborCoord[1], neighborCoord[2]);
          const skyLight = nLight.sky;
          const blockLight = Math.max(nLight.block, def.lightEmission || 0);

          let waterTopOffset = 0;
          if (waterPass) {
            const aboveId = getBlockAtLocal(coord[0], coord[1] + 1, coord[2]);
            if (aboveId !== BLOCK_IDS.WATER && face !== BlockFace.BOTTOM) {
              const meta = getFluidLevelAtLocal(coord[0], coord[1], coord[2]);
              const isFalling = (meta & 0x10) !== 0;
              const dist = isFalling ? 0 : meta & 0x0f;
              waterTopOffset = dist === 0 ? -0.12 : -Math.min(0.86, 0.12 + dist * 0.105);
            }
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

          c0[axis] = planePos; c0[uAxis] = u;     c0[vAxis] = v;
          c1[axis] = planePos; c1[uAxis] = u + w; c1[vAxis] = v;
          c2[axis] = planePos; c2[uAxis] = u + w; c2[vAxis] = v + h;
          c3[axis] = planePos; c3[uAxis] = u;     c3[vAxis] = v + h;

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

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
        for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
          const blockId = getBlockAtLocal(lx, y, lz);
          if (blockId === BLOCK_IDS.AIR) continue;
          const def = blockTable[blockId];
          if (!def || !def.crossPlant) continue;

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
