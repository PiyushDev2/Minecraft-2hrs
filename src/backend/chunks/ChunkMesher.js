/**
 * @file ChunkMesher.js
 * @description Coordinates Three.js BufferGeometry & PBR material creation from
 * MeshingCore TypedArray buffers (supports both synchronous meshing and Web Worker results).
 */

import * as THREE from 'three';
import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { CHUNK_DEPTH, CHUNK_HEIGHT, CHUNK_SECTIONS, CHUNK_WIDTH, SECTION_HEIGHT } from './Chunk.js';
import { buildChunkGeometryBuffers } from './MeshingCore.js';

/**
 * Builds greedy-meshed Three.js geometries and meshes for chunks and 16x16x16 vertical sections.
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
    /** @type {'fast' | 'fancy'} */
    this.graphicsMode = 'fast';
    /** @type {boolean} */
    this.shadowsEnabled = true;

    /** @private */
    this._tileRects = this.textureAtlas.exportTileRects();
    /** @private */
    this._blockTable = this.blockRegistry.exportMesherTable();

    this._materialsByMode = {
      fast: this._createMaterials('fast'),
      fancy: this._createMaterials('fancy'),
    };
    /** @type {THREE.Material} */
    this.opaqueMaterial = this._materialsByMode.fast.opaqueMaterial;
    /** @type {THREE.Material} */
    this.waterMaterial = this._materialsByMode.fast.waterMaterial;
  }

  /**
   * Updates the global sky brightness uniform (0.12 night .. 1.0 noon) in O(1) without remeshing.
   * @param {number} value
   */
  setSkyBrightness(value) {
    this.skyBrightnessUniform.value = Math.max(0.12, Math.min(1.0, Number(value) || 0.12));
  }

  /**
   * Switches between Fast (MeshLambertMaterial, lightweight fragment shader) and Fancy (PBR MeshStandardMaterial).
   * Updates all existing loaded chunk meshes in-place without rebuilding geometry.
   * @param {'fast'|'fancy'} mode
   * @param {Iterable<import('./Chunk.js').Chunk>} [loadedChunks]
   */
  setGraphicsMode(mode, loadedChunks) {
    const next = mode === 'fancy' ? 'fancy' : 'fast';
    this.graphicsMode = next;
    this.opaqueMaterial = this._materialsByMode[next].opaqueMaterial;
    this.waterMaterial = this._materialsByMode[next].waterMaterial;
    if (loadedChunks) {
      for (const chunk of loadedChunks) {
        this._syncChunkMaterials(chunk);
      }
    }
  }

  /**
   * Toggles cast/receive shadows on chunk meshes.
   * @param {boolean} enabled
   * @param {Iterable<import('./Chunk.js').Chunk>} [loadedChunks]
   */
  setShadowsEnabled(enabled, loadedChunks) {
    this.shadowsEnabled = Boolean(enabled);
    if (loadedChunks) {
      for (const chunk of loadedChunks) {
        this._syncChunkMaterials(chunk);
      }
    }
  }

  /** @private */
  _syncChunkMaterials(chunk) {
    if (chunk.opaqueMesh) {
      chunk.opaqueMesh.material = this.opaqueMaterial;
      chunk.opaqueMesh.castShadow = this.shadowsEnabled;
      chunk.opaqueMesh.receiveShadow = this.shadowsEnabled;
    }
    if (chunk.waterMesh) {
      chunk.waterMesh.material = this.waterMaterial;
      chunk.waterMesh.receiveShadow = this.shadowsEnabled;
    }
    for (let s = 0; s < CHUNK_SECTIONS; s++) {
      const om = chunk.opaqueSections?.[s];
      if (om) {
        om.material = this.opaqueMaterial;
        om.castShadow = this.shadowsEnabled;
        om.receiveShadow = this.shadowsEnabled;
      }
      const wm = chunk.waterSections?.[s];
      if (wm) {
        wm.material = this.waterMaterial;
        wm.receiveShadow = this.shadowsEnabled;
      }
    }
  }

  /**
   * Creates shared materials extending MeshLambertMaterial (Fast) or MeshStandardMaterial (Fancy)
   * with atlas UV tiling and dual-bank GPU day/night + torch lighting.
   * @private
   */
  _createMaterials(mode) {
    const skyUniform = this.skyBrightnessUniform;

    const injectAtlasTiling = (material, isWater = false) => {
      material.customProgramCacheKey = () =>
        `voxel-atlas-lit-${mode}-${isWater ? 'water' : 'opaque'}-v3`;

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

    const MatClass = mode === 'fancy' ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial;
    const opaqueOpts = {
      map: this.textureAtlas.texture,
      vertexColors: true,
      alphaTest: 0.4,
      side: THREE.FrontSide,
      ...(mode === 'fancy' ? { roughness: 0.88, metalness: 0.02 } : {}),
    };
    const waterOpts = {
      map: this.textureAtlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(mode === 'fancy' ? { roughness: 0.14, metalness: 0.06 } : {}),
    };

    const opaqueMaterial = injectAtlasTiling(new MatClass(opaqueOpts), false);
    const waterMaterial = injectAtlasTiling(new MatClass(waterOpts), true);
    return { opaqueMaterial, waterMaterial };
  }

  /** @private */
  _makeLookups(chunk, getWorldBlock, getWorldLight, getWorldFluidLevel) {
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

    return { getBlockAtLocal, getLightAtLocal, getFluidLevelAtLocal };
  }

  /**
   * Synchronously builds dirty 16x16x16 sub-chunk sections (or all 8 sections on first build)
   * so interactive block breaks/placements only remesh a single 16x16x16 slice!
   * @param {import('./Chunk.js').Chunk} chunk
   * @param {(wx: number, wy: number, wz: number) => number} getWorldBlock
   * @param {(wx: number, wy: number, wz: number) => { sky: number, block: number }} [getWorldLight]
   * @param {(wx: number, wy: number, wz: number) => number} [getWorldFluidLevel]
   */
  buildChunkMesh(chunk, getWorldBlock, getWorldLight, getWorldFluidLevel) {
    const lookups = this._makeLookups(chunk, getWorldBlock, getWorldLight, getWorldFluidLevel);

    // If switching from monolithic worker mesh to per-section meshes, clear old monolithic meshes and rebuild all 8 sections
    if (!chunk.usingSectionMeshes) {
      chunk.disposeMesh(true);
      chunk.dirtySectionsMask = 0xff;
      chunk.usingSectionMeshes = true;
    }

    const group = chunk.meshGroup ?? new THREE.Group();
    group.name = `chunk_${chunk.chunkX}_${chunk.chunkZ}`;
    group.position.set(chunk.worldX, 0, chunk.worldZ);
    chunk.meshGroup = group;

    let totalFaces = 0;
    let totalTriangles = 0;
    const mask = chunk.dirtySectionsMask || 0xff;

    for (let sec = 0; sec < CHUNK_SECTIONS; sec++) {
      if ((mask & (1 << sec)) === 0) continue;
      const yMin = sec * SECTION_HEIGHT;
      const yMax = yMin + SECTION_HEIGHT;

      // Fast empty-section skip (check if all 4096 voxels in section are AIR)
      const startIdx = yMin << 8;
      const endIdx = yMax << 8;
      let hasBlock = false;
      for (let i = startIdx; i < endIdx; i++) {
        if (chunk.blocks[i] !== BLOCK_IDS.AIR) {
          hasBlock = true;
          break;
        }
      }

      if (!hasBlock) {
        chunk.disposeSectionMesh(sec);
        continue;
      }

      const built = buildChunkGeometryBuffers({
        ...lookups,
        blockTable: this._blockTable,
        tileRects: this._tileRects,
        yMin,
        yMax,
      });

      this.applySectionBuffers(chunk, sec, built);
      totalFaces += built.faceCount ?? 0;
      totalTriangles += built.triangleCount ?? 0;
    }

    chunk.dirtySectionsMask = 0;
    chunk.dirty = false;

    return {
      group,
      opaqueMesh: chunk.opaqueMesh,
      waterMesh: chunk.waterMesh,
      faceCount: totalFaces,
      triangleCount: totalTriangles,
    };
  }

  /**
   * Attaches newly built TypedArray buffers to a single 16x16x16 vertical section mesh.
   * @param {import('./Chunk.js').Chunk} chunk
   * @param {number} secY 0..7
   * @param {{ opaque: any, water: any }} built
   */
  applySectionBuffers(chunk, secY, built) {
    chunk.disposeSectionMesh(secY);
    const group = chunk.meshGroup;
    if (!group) return;

    if (built.opaque) {
      const geo = this._toBufferGeometry(built.opaque);
      const mesh = new THREE.Mesh(geo, this.opaqueMaterial);
      mesh.name = `${group.name}_sec${secY}_opaque`;
      mesh.castShadow = this.shadowsEnabled;
      mesh.receiveShadow = this.shadowsEnabled;
      mesh.frustumCulled = true;
      group.add(mesh);
      chunk.opaqueSections[secY] = mesh;
    }

    if (built.water) {
      const geo = this._toBufferGeometry(built.water);
      const mesh = new THREE.Mesh(geo, this.waterMaterial);
      mesh.name = `${group.name}_sec${secY}_water`;
      mesh.castShadow = false;
      mesh.receiveShadow = this.shadowsEnabled;
      mesh.frustumCulled = true;
      mesh.renderOrder = 2;
      group.add(mesh);
      chunk.waterSections[secY] = mesh;
    }
  }

  /**
   * Uploads raw full-chunk TypedArray buffers (from Web Worker) into Three.js BufferGeometry
   * and attaches meshes to the chunk.
   * @param {import('./Chunk.js').Chunk} chunk
   * @param {{ opaque: any, water: any, faceCount: number, triangleCount: number }} built
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
      opaqueMesh.castShadow = this.shadowsEnabled;
      opaqueMesh.receiveShadow = this.shadowsEnabled;
      opaqueMesh.frustumCulled = true;
      group.add(opaqueMesh);
    }

    if (built.water) {
      const geo = this._toBufferGeometry(built.water);
      waterMesh = new THREE.Mesh(geo, this.waterMaterial);
      waterMesh.name = `${group.name}_water`;
      waterMesh.castShadow = false;
      waterMesh.receiveShadow = this.shadowsEnabled;
      waterMesh.frustumCulled = true;
      waterMesh.renderOrder = 2;
      group.add(waterMesh);
    }

    chunk.meshGroup = group;
    chunk.opaqueMesh = opaqueMesh;
    chunk.waterMesh = waterMesh;
    chunk.usingSectionMeshes = false;
    chunk.dirtySectionsMask = 0;
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
    this._materialsByMode.fast.opaqueMaterial?.dispose();
    this._materialsByMode.fast.waterMaterial?.dispose();
    this._materialsByMode.fancy.opaqueMaterial?.dispose();
    this._materialsByMode.fancy.waterMaterial?.dispose();
  }
}
