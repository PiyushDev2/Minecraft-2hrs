/**
 * @file ChunkBorderRenderer.ts
 * @description Renders Java-style F3+G 16×128×16 chunk boundary wireframes snapped
 * around the player's current chunk (yellow vertical corners + cyan sub-chunk rings).
 */

import * as THREE from 'three';

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 128;

export class ChunkBorderRenderer {
  public readonly group = new THREE.Group();
  private readonly cornerLines: THREE.LineSegments;
  private readonly gridLines: THREE.LineSegments;
  private lastChunkX = Number.NaN;
  private lastChunkZ = Number.NaN;

  constructor() {
    this.group.name = 'ChunkBorders';
    this.group.visible = false;

    // Yellow corner verticals + surrounding chunk corners
    const cornerVerts: number[] = [];
    const pushSeg = (arr: number[], x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      arr.push(x1, y1, z1, x2, y2, z2);
    };

    const corners = [
      [0, 0],
      [CHUNK_SIZE, 0],
      [0, CHUNK_SIZE],
      [CHUNK_SIZE, CHUNK_SIZE],
    ];
    for (const [cx, cz] of corners) {
      pushSeg(cornerVerts, cx, 0, cz, cx, CHUNK_HEIGHT, cz);
    }

    const cornerGeo = new THREE.BufferGeometry();
    cornerGeo.setAttribute('position', new THREE.Float32BufferAttribute(cornerVerts, 3));
    this.cornerLines = new THREE.LineSegments(
      cornerGeo,
      new THREE.LineBasicMaterial({ color: 0xffe600 })
    );

    // Cyan sub-chunk rings every 16 Y + vertical subdivisions every 4 blocks
    const gridVerts: number[] = [];
    for (let y = 0; y <= CHUNK_HEIGHT; y += 16) {
      pushSeg(gridVerts, 0, y, 0, CHUNK_SIZE, y, 0);
      pushSeg(gridVerts, CHUNK_SIZE, y, 0, CHUNK_SIZE, y, CHUNK_SIZE);
      pushSeg(gridVerts, CHUNK_SIZE, y, CHUNK_SIZE, 0, y, CHUNK_SIZE);
      pushSeg(gridVerts, 0, y, CHUNK_SIZE, 0, y, 0);
    }
    for (let i = 4; i < CHUNK_SIZE; i += 4) {
      pushSeg(gridVerts, i, 0, 0, i, CHUNK_HEIGHT, 0);
      pushSeg(gridVerts, i, 0, CHUNK_SIZE, i, CHUNK_HEIGHT, CHUNK_SIZE);
      pushSeg(gridVerts, 0, 0, i, 0, CHUNK_HEIGHT, i);
      pushSeg(gridVerts, CHUNK_SIZE, 0, i, CHUNK_SIZE, CHUNK_HEIGHT, i);
    }

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.gridLines = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x26e8ff, transparent: true, opacity: 0.72 })
    );

    this.group.add(this.cornerLines, this.gridLines);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(playerX: number, playerZ: number): void {
    if (!this.group.visible) return;
    const cx = Math.floor(playerX / CHUNK_SIZE);
    const cz = Math.floor(playerZ / CHUNK_SIZE);
    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;
      this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    }
  }

  public dispose(): void {
    this.cornerLines.geometry.dispose();
    (this.cornerLines.material as THREE.Material).dispose();
    this.gridLines.geometry.dispose();
    (this.gridLines.material as THREE.Material).dispose();
  }
}
