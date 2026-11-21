/**
 * @file meshWorker.js
 * @description Dedicated ES Module Web Worker running greedy chunk meshing off the main thread
 * using Transferable ArrayBuffers for zero-copy geometry upload.
 */

import { buildChunkGeometryBuffers } from './MeshingCore.js';
import { VoxelRegion } from './VoxelRegion.js';

let cachedBlockTable = null;
let cachedTileRects = null;

function collectTransferables(passResult, list) {
  if (!passResult) return;
  list.push(
    passResult.positions.buffer,
    passResult.normals.buffer,
    passResult.uvs.buffer,
    passResult.colors.buffer,
    passResult.tileRects.buffer,
    passResult.lights.buffer,
    passResult.indices.buffer
  );
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    cachedBlockTable = msg.blockTable;
    cachedTileRects = msg.tileRects;
    return;
  }

  if (msg.type === 'mesh') {
    if (!cachedBlockTable || !cachedTileRects) {
      self.postMessage({
        type: 'error',
        jobId: msg.jobId,
        epoch: msg.epoch,
        chunkX: msg.chunkX,
        chunkZ: msg.chunkZ,
        error: 'Worker not initialized with blockTable and tileRects.',
      });
      return;
    }

    const region = new VoxelRegion({
      chunkX: msg.chunkX,
      chunkZ: msg.chunkZ,
      blocks: msg.blocks,
      lightData: msg.lightData,
      fluidData: msg.fluidData,
      centerEditVersion: msg.centerEditVersion,
      versionSignature: msg.versionSignature,
    });

    const built = buildChunkGeometryBuffers({
      getBlockAtLocal: (lx, y, lz) => region.getBlock(lx, y, lz),
      getLightAtLocal: (lx, y, lz) => region.getLight(lx, y, lz),
      getFluidLevelAtLocal: (lx, y, lz) => region.getFluidLevel(lx, y, lz),
      blockTable: cachedBlockTable,
      tileRects: cachedTileRects,
    });

    const transferables = [];
    collectTransferables(built.opaque, transferables);
    collectTransferables(built.water, transferables);

    self.postMessage(
      {
        type: 'result',
        jobId: msg.jobId,
        epoch: msg.epoch,
        chunkX: msg.chunkX,
        chunkZ: msg.chunkZ,
        centerEditVersion: msg.centerEditVersion,
        versionSignature: msg.versionSignature,
        opaque: built.opaque,
        water: built.water,
        faceCount: built.faceCount,
        triangleCount: built.triangleCount,
      },
      transferables
    );
  }
};
