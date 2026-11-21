import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLOCK_IDS,
  Chunk,
  ChunkMesher,
  TextureAtlas,
  blockRegistry,
} from '../../src/backend/index.js';

/**
 * Verifies every triangle in a BufferGeometry has outward-facing CCW winding
 * aligned with its vertex normal: dot(normal, (v1 - v0) x (v2 - v0)) > 0.
 */
function assertOutwardCCWWinding(geometry) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const idx = geometry.index;
  assert(pos && norm && idx, 'Geometry must have position, normal, and index attributes');

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < idx.count; i += 3) {
    const i0 = idx.getX(i);
    const i1 = idx.getX(i + 1);
    const i2 = idx.getX(i + 2);

    v0.fromBufferAttribute(pos, i0);
    v1.fromBufferAttribute(pos, i1);
    v2.fromBufferAttribute(pos, i2);
    n.fromBufferAttribute(norm, i0);

    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    cross.crossVectors(e1, e2);

    const alignment = cross.dot(n);
    assert(
      alignment > 0,
      `Triangle ${i / 3} has inverted winding (dot=${alignment}, normal=${n.toArray()})`
    );
  }
}

test('ChunkMesher produces outward CCW winding for all 6 faces and AO-flipped quads', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const chunk = new Chunk(0, 0);
  chunk.generated = true;

  // Isolated block + L-shaped corner blocks to trigger AO anisotropy diagonal flips
  chunk.setBlock(4, 10, 4, BLOCK_IDS.STONE);
  chunk.setBlock(5, 11, 4, BLOCK_IDS.GRASS);
  chunk.setBlock(4, 11, 5, BLOCK_IDS.DIRT);
  chunk.setBlock(4, 10, 5, BLOCK_IDS.OAK_LOG);

  const res = mesher.buildChunkMesh(chunk, (wx, wy, wz) => {
    if (wx >= 0 && wx < 16 && wz >= 0 && wz < 16) {
      return chunk.getBlock(wx, wy, wz);
    }
    return BLOCK_IDS.AIR;
  });

  assert(res.opaqueMesh, 'Opaque mesh should be generated');
  assertOutwardCCWWinding(res.opaqueMesh.geometry);
  assert(res.opaqueMesh.geometry.attributes.aTileRect, 'aTileRect attribute present');
  assert(res.opaqueMesh.geometry.boundingBox, 'Bounding box computed for frustum culling');
  assert.equal(res.opaqueMesh.frustumCulled, true);

  chunk.disposeMesh();
  mesher.dispose();
  atlas.dispose();
});

test('ChunkMesher greedy merging collapses flat slabs and culls cross-chunk hidden faces', () => {
  const atlas = new TextureAtlas();
  const mesher = new ChunkMesher(blockRegistry, atlas);
  const chunk = new Chunk(0, 0);
  chunk.generated = true;

  // Fill entire 16x16 layer at y=10 with stone
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      chunk.setBlock(x, 10, z, BLOCK_IDS.STONE);
    }
  }

  // Case 1: Empty neighbors -> 6 faces total (1 greedy top, 1 bottom, 4 sides = 12 triangles)
  const isolated = mesher.buildChunkMesh(chunk, (wx, wy, wz) =>
    wx >= 0 && wx < 16 && wz >= 0 && wz < 16 ? chunk.getBlock(wx, wy, wz) : BLOCK_IDS.AIR
  );
  assert.equal(isolated.faceCount, 6, '16x16 uniform slab should greedy-merge into exactly 6 faces');
  assert.equal(isolated.triangleCount, 12);

  // Case 2: Solid neighbor at x = -1 and x = 16 -> West & East boundary faces culled (4 faces remain)
  const culled = mesher.buildChunkMesh(chunk, (wx, wy, wz) => {
    if (wx >= 0 && wx < 16 && wz >= 0 && wz < 16) {
      return chunk.getBlock(wx, wy, wz);
    }
    if (wy === 10 && wz >= 0 && wz < 16 && (wx === -1 || wx === 16)) {
      return BLOCK_IDS.STONE;
    }
    return BLOCK_IDS.AIR;
  });
  assert.equal(culled.faceCount, 4, 'Cross-chunk solid neighbors must cull boundary faces');

  chunk.disposeMesh();
  mesher.dispose();
  atlas.dispose();
});
