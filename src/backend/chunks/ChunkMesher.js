/**
 * @file ChunkMesher.js
 * @description Coordinates Three.js BufferGeometry & PBR material creation from
 * MeshingCore TypedArray buffers (supports both synchronous meshing and Web Worker results).
 */

import * as THREE from 'three';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_WIDTH } from './Chunk.js';
import { buildChunkGeometryBuffers } from './MeshingCore.js';

/**
 * Builds greedy-meshed Three.js geometries and meshes for chunks.
 */
export class ChunkMesher {
  /**
   * @param {import('../blocks/BlockRegistry.js').BlockRegistry} blockRegistry
   * @param {import('../textures/TextureAtlas.js').TextureAtlas} textureAtlas
   */
  constructor(blockRegistry, textureAtlas) {
    this.blockRegistry = blockRegistry;
    this.textureAtlas = textureAtlas;

    /** @type {{ value: number }} */
    this.skyBrightnessUniform = { value: 1.0 };

    /** @private */
    this._tileRects = this.textureAtlas.exportTileRects();

    const materials = this._createMaterials();
    /** @type {THREE.MeshStandardMaterial} */
    this.opaqueMaterial = materials.opaqueMaterial;
    /** @type {THREE.MeshStandardMaterial} */
    this.waterMaterial = materials.waterMaterial;
  }

  /**
   * Updates the global sky brightness uniform (0.12 night .. 1.0 noon) in O(1) without remeshing.
   * @param {number} value
   */
  setSkyBrightness(value) {
    this.skyBrightnessUniform.value = Math.max(0.12, Math.min(1.0, Number(value) || 0.12));
  }

  /**
   * Creates shared PBR materials extending MeshStandardMaterial with atlas UV tiling
   * and dual-bank GPU day/night + torch lighting.
   * @private
   */
  _createMaterials() {
    const skyUniform = this.skyBrightnessUniform;

    const injectAtlasTiling = (material, isWater = false) => {
      material.customProgramCacheKey = () =>
        isWater ? 'voxel-atlas-lit-water-v2' : 'voxel-atlas-lit-opaque-v2';

      material.onBeforeCompile = (shader) => {
        shader.uniforms.uSkyBrightness = skyUniform;

        shader.vertexShader =
          `attribute vec4 aTileRect;\nattribute vec2 aLight;\nvarying vec4 vTileRect;\nvarying vec2 vLight;\n` +
          shader.vertexShader.replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>\nvTileRect = aTileRect;\nvLight = aLight;`
          );

        shader.fragmentShader =
          `varying vec4 vTileRect;\nvarying vec2 vLight;\nuniform float uSkyBrightness;\n` +
          shader.fragmentShader
            .replace(
              '#include <map_fragment>',
              `#ifdef USE_MAP
              vec2 atlasUv = vTileRect.xy + clamp(fract(vMapUv), 0.002, 0.998) * vTileRect.zw;
              vec4 sampledDiffuseColor = texture2D( map, atlasUv );
              diffuseColor *= sampledDiffuseColor;
            #endif`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
              float skyL = clamp(vLight.x, 0.0, 1.0) * uSkyBrightness;
              float blockL = clamp(vLight.y, 0.0, 1.0);
              float combinedL = max(skyL, blockL);
              float lightFactor = mix(0.08, 1.0, pow(combinedL, 1.35));
              float torchShare = blockL > skyL ? clamp((blockL - skyL) * 1.4, 0.0, 1.0) : 0.0;
              vec3 lightTint = mix(vec3(1.0), vec3(1.0, 0.84, 0.62), torchShare);
              diffuseColor.rgb *= lightFactor * lightTint;`
            );
      };
      return material;
    };

    const opaqueMaterial = injectAtlasTiling(
      new THREE.MeshStandardMaterial({
        map: this.textureAtlas.texture,
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.02,
        alphaTest: 0.4,
        side: THREE.FrontSide,
      }),
      false
    );

    const waterMaterial = injectAtlasTiling(
      new THREE.MeshStandardMaterial({
        map: this.textureAtlas.texture,
        vertexColors: true,
        roughness: 0.14,
        metalness: 0.06,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      true
    );

    return { opaqueMaterial, waterMaterial };
  }

  /**
   * Synchronously builds and attaches Three.js meshes onto the given chunk.
   * @param {import('./Chunk.js').Chunk} chunk
   * @param {(wx: number, wy: number, wz: number) => number} getWorldBlock
   * @param {(wx: number, wy: number, wz: number) => { sky: number, block: number }} [getWorldLight]
   * @param {(wx: number, wy: number, wz: number) => number} [getWorldFluidLevel]
   * @returns {{ group: THREE.Group, opaqueMesh: THREE.Mesh|null, waterMesh: THREE.Mesh|null, faceCount: number, triangleCount: number }}
   */
  buildChunkMesh(chunk, getWorldBlock, getWorldLight, getWorldFluidLevel) {
    const lightLookup =
      typeof getWorldLight === 'function' ? getWorldLight : () => ({ sky: 15, block: 0 });
    const fluidLookup =
      typeof getWorldFluidLevel === 'function' ? getWorldFluidLevel : () => 0;

    const getBlockAtLocal = (lx, y, lz) => {
      if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK_IDS.AIR;
      if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH) {
        return chunk.blocks[(y << 8) | (lz << 4) | lx];
      }
      return getWorldBlock(chunk.worldX + lx, y, chunk.worldZ + lz);
    };

    const getLightAtLocal = (lx, y, lz) => {
      if (y >= CHUNK_HEIGHT) return { sky: 15, block: 0 };
      if (y < 0) return { sky: 0, block: 0 };
      if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH) {
        const byte = chunk.lightData[(y << 8) | (lz << 4) | lx];
        return { sky: (byte >> 4) & 0x0f, block: byte & 0x0f };
      }
      return lightLookup(chunk.worldX + lx, y, chunk.worldZ + lz);
    };

    const getFluidLevelAtLocal = (lx, y, lz) => {
      if (y < 0 || y >= CHUNK_HEIGHT) return 0;
      if (lx >= 0 && lx < CHUNK_WIDTH && lz >= 0 && lz < CHUNK_DEPTH) {
        return chunk.fluidData[(y << 8) | (lz << 4) | lx];
      }
      return fluidLookup(chunk.worldX + lx, y, chunk.worldZ + lz);
    };

    const built = buildChunkGeometryBuffers({
      getBlockAtLocal,
      getLightAtLocal,
      getFluidLevelAtLocal,
      blockTable: this.blockRegistry.exportMesherTable(),
      tileRects: this._tileRects,
    });

    return this.applyMeshBuffers(chunk, built);
  }

  /**
   * Uploads raw TypedArray buffers (from main thread or Web Worker) into Three.js BufferGeometry
   * and attaches meshes to the chunk.
   * @param {import('./Chunk.js').Chunk} chunk
   * @param {{ opaque: any, water: any, faceCount: number, triangleCount: number }} built
   * @returns {{ group: THREE.Group, opaqueMesh: THREE.Mesh|null, waterMesh: THREE.Mesh|null, faceCount: number, triangleCount: number }}
   */
  applyMeshBuffers(chunk, built) {
    chunk.disposeMesh(true);

    const group = chunk.meshGroup ?? new THREE.Group();
    group.name = `chunk_${chunk.chunkX}_${chunk.chunkZ}`;
    group.position.set(chunk.worldX, 0, chunk.worldZ);

    let opaqueMesh = null;
    let waterMesh = null;

    if (built.opaque) {
      const geo = this._toBufferGeometry(built.opaque);
      opaqueMesh = new THREE.Mesh(geo, this.opaqueMaterial);
      opaqueMesh.name = `${group.name}_opaque`;
      opaqueMesh.castShadow = true;
      opaqueMesh.receiveShadow = true;
      opaqueMesh.frustumCulled = true;
      group.add(opaqueMesh);
    }

    if (built.water) {
      const geo = this._toBufferGeometry(built.water);
      waterMesh = new THREE.Mesh(geo, this.waterMaterial);
      waterMesh.name = `${group.name}_water`;
      waterMesh.castShadow = false;
      waterMesh.receiveShadow = true;
      waterMesh.frustumCulled = true;
      waterMesh.renderOrder = 2;
      group.add(waterMesh);
    }

    chunk.meshGroup = group;
    chunk.opaqueMesh = opaqueMesh;
    chunk.waterMesh = waterMesh;
    chunk.dirty = false;

    return {
      group,
      opaqueMesh,
      waterMesh,
      faceCount: built.faceCount ?? 0,
      triangleCount: built.triangleCount ?? 0,
    };
  }

  /**
   * Converts raw TypedArrays into an indexed Three.js BufferGeometry.
   * @private
   */
  _toBufferGeometry(pass) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pass.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(pass.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(pass.uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(pass.colors, 3));
    geometry.setAttribute('aTileRect', new THREE.BufferAttribute(pass.tileRects, 4));
    geometry.setAttribute('aLight', new THREE.BufferAttribute(pass.lights, 2));
    geometry.setIndex(new THREE.BufferAttribute(pass.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Releases shared material GPU resources.
   */
  dispose() {
    this.opaqueMaterial?.dispose();
    this.waterMaterial?.dispose();
  }
}
