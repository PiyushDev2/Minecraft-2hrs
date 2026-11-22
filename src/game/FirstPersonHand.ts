/**
 * @file FirstPersonHand.ts
 * @description Camera-attached 3D first-person viewmodel rendering Steve's blocky forearm,
 * a miniature 3D textured block cube when holding a block, or an angled 3D pixel-textured
 * item blade/tool when holding a tool, weapon, bow, or food — with walk bob, swing arc,
 * and bow pullback animation.
 */

import * as THREE from 'three';

export class FirstPersonHand {
  public readonly root = new THREE.Group();

  private readonly armMesh: THREE.Mesh;
  private readonly blockMesh: THREE.Mesh;
  private readonly blockMat: THREE.MeshLambertMaterial;
  private readonly itemMesh: THREE.Mesh;
  private readonly itemMat: THREE.MeshBasicMaterial;
  private readonly shieldGroup = new THREE.Group();
  private readonly shieldDisposables: Array<{ dispose: () => void }> = [];
  private readonly textureCache = new Map<string, { texture: THREE.Texture; ready: boolean }>();

  private currentKey = '';
  private disposed = false;
  private swingProgress = 0;
  private bobPhase = 0;
  private shieldRaise = 0;

  constructor() {
    this.root.name = 'FirstPersonHand';
    this.root.position.set(0.56, -0.52, -0.78);

    // Classic Steve forearm
    const armGeo = new THREE.BoxGeometry(0.24, 0.64, 0.24);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xc99672 });
    this.armMesh = new THREE.Mesh(armGeo, armMat);
    this.armMesh.rotation.set(0.45, -0.35, 0.25);
    this.armMesh.position.set(0.06, -0.1, 0.05);
    this.armMesh.renderOrder = 20;

    // Miniature 3D block in hand
    const blockGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    this.blockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.blockMesh = new THREE.Mesh(blockGeo, this.blockMat);
    this.blockMesh.position.set(-0.04, 0.04, -0.06);
    this.blockMesh.rotation.set(0.22, Math.PI * 0.25, -0.12);
    this.blockMesh.visible = false;
    this.blockMesh.renderOrder = 21;

    // Angled 3D pixel-tool / item plane
    const itemGeo = new THREE.BoxGeometry(0.42, 0.42, 0.045);
    this.itemMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.35,
    });
    this.itemMesh = new THREE.Mesh(itemGeo, this.itemMat);
    this.itemMesh.position.set(-0.04, 0.14, -0.05);
    this.itemMesh.rotation.set(0.08, -0.58, 0.16);
    this.itemMesh.visible = false;
    this.itemMesh.renderOrder = 21;

    // 3D Shield viewmodel (rendered on left/center when player carries or raises Shield)
    const rimGeo = new THREE.BoxGeometry(0.46, 0.64, 0.08);
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    const woodGeo = new THREE.BoxGeometry(0.38, 0.56, 0.09);
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x9c7244 });
    const bossGeo = new THREE.BoxGeometry(0.14, 0.2, 0.11);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const wood = new THREE.Mesh(woodGeo, woodMat);
    const boss = new THREE.Mesh(bossGeo, rimMat);
    rim.renderOrder = 22;
    wood.renderOrder = 22;
    boss.renderOrder = 22;
    this.shieldGroup.add(rim, wood, boss);
    this.shieldGroup.position.set(-1.02, -0.06, 0.08);
    this.shieldGroup.rotation.set(0.08, 0.32, -0.06);
    this.shieldGroup.visible = false;
    this.shieldDisposables.push(rimGeo, rimMat, woodGeo, woodMat, bossGeo);

    this.root.add(this.armMesh, this.blockMesh, this.itemMesh, this.shieldGroup);
  }

  private applyTextureFromDataUrl(
    cacheKey: string,
    heldKey: string,
    dataUrl: string,
    mat: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial,
    fallbackTint: string
  ): void {
    const existing = this.textureCache.get(cacheKey);
    if (existing) {
      if (existing.ready) {
        mat.map = existing.texture;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
      return;
    }

    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const entry = { texture: tex, ready: false };
    this.textureCache.set(cacheKey, entry);

    // Temporary tint while image decodes so WebGL never uploads a 0x0 image
    mat.map = null;
    mat.color.set(fallbackTint);
    mat.needsUpdate = true;

    img.onload = () => {
      if (this.disposed) {
        tex.dispose();
        return;
      }
      entry.ready = true;
      tex.needsUpdate = true;
      if (this.currentKey === heldKey) {
        mat.map = tex;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
    };
    img.src = dataUrl;
  }

  public setHeldItem(
    itemId: string | null,
    isBlock: boolean,
    iconDataUrl: string | null,
    tintHex?: string
  ): void {
    const key = `${itemId ?? 'empty'}|${isBlock ? 'b' : 'i'}`;
    if (key === this.currentKey) return;
    this.currentKey = key;

    if (!itemId) {
      this.armMesh.visible = true;
      this.blockMesh.visible = false;
      this.itemMesh.visible = false;
      return;
    }

    if (isBlock) {
      this.armMesh.visible = false;
      this.itemMesh.visible = false;
      this.blockMesh.visible = true;
      if (iconDataUrl) {
        this.applyTextureFromDataUrl(`blk:${itemId}`, key, iconDataUrl, this.blockMat, tintHex || '#9e9e9e');
      } else {
        this.blockMat.map = null;
        this.blockMat.color.set(tintHex || '#9e9e9e');
        this.blockMat.needsUpdate = true;
      }
    } else {
      this.armMesh.visible = false;
      this.blockMesh.visible = false;
      this.itemMesh.visible = true;
      if (iconDataUrl) {
        this.applyTextureFromDataUrl(`itm:${itemId}`, key, iconDataUrl, this.itemMat, tintHex || '#d7ccc8');
      } else {
        this.itemMat.map = null;
        this.itemMat.color.set(tintHex || '#d7ccc8');
        this.itemMat.needsUpdate = true;
      }
    }
  }

  public clearTextureCache(): void {
    for (const entry of this.textureCache.values()) {
      entry.texture.dispose();
    }
    this.textureCache.clear();
    this.currentKey = '';
  }

  public triggerSwing(): void {
    this.swingProgress = 1.0;
  }

  public update(
    dt: number,
    isMoving: boolean,
    isMining: boolean,
    bowCharge01: number,
    eatingProgress01 = 0,
    hasShield = false,
    isShieldBlocking = false
  ): void {
    if (isMoving) {
      this.bobPhase += dt * 9.5;
    } else {
      this.bobPhase += dt * 1.4;
    }

    if (isMining && this.swingProgress <= 0.15) {
      this.swingProgress = 1.0;
    }
    if (this.swingProgress > 0) {
      this.swingProgress = Math.max(0, this.swingProgress - dt * 5.2);
    }

    const bobAmp = isMoving ? 0.032 : 0.006;
    const bobX = Math.cos(this.bobPhase * 0.5) * bobAmp;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmp * 1.15;

    const swingArc = Math.sin(this.swingProgress * Math.PI);
    const bowPull = Math.max(0, Math.min(1, bowCharge01));
    const eat = Math.max(0, Math.min(1, eatingProgress01));
    const chomp = eat > 0 ? Math.abs(Math.sin(eat * Math.PI * 6)) : 0;

    this.root.position.set(
      0.56 + bobX - swingArc * 0.22 - bowPull * 0.08 - eat * 0.22,
      -0.52 - bobY + swingArc * 0.09 + bowPull * 0.04 + eat * 0.18 - chomp * 0.06,
      -0.78 - swingArc * 0.24 + bowPull * 0.14 + eat * 0.14
    );
    this.root.rotation.set(
      -swingArc * 0.92 + bowPull * 0.15 + eat * 0.35 + chomp * 0.12,
      swingArc * 0.35 + eat * 0.28,
      swingArc * 0.42
    );

    // Offhand 3D Shield animation (smoothly raises across center-left when blocking)
    this.shieldGroup.visible = hasShield;
    if (hasShield) {
      const targetRaise = isShieldBlocking ? 1 : 0;
      this.shieldRaise += (targetRaise - this.shieldRaise) * Math.min(1, dt * 14);
      this.shieldGroup.position.set(
        -1.02 + this.shieldRaise * 0.36,
        -0.12 + this.shieldRaise * 0.28 - bobY * 0.5,
        0.08 - this.shieldRaise * 0.08
      );
      this.shieldGroup.rotation.set(
        0.08 - this.shieldRaise * 0.05,
        0.32 - this.shieldRaise * 0.22,
        -0.06 + this.shieldRaise * 0.1
      );
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.armMesh.geometry.dispose();
    (this.armMesh.material as THREE.Material).dispose();
    this.blockMesh.geometry.dispose();
    this.blockMat.dispose();
    this.itemMesh.geometry.dispose();
    this.itemMat.dispose();
    for (const d of this.shieldDisposables) {
      d.dispose();
    }
    for (const entry of this.textureCache.values()) {
      entry.texture.dispose();
    }
    this.textureCache.clear();
  }
}
