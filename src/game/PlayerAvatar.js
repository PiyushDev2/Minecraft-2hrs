/**
 * @file PlayerAvatar.js
 * @description Reusable articulated Three.js Minecraft-style Steve/Alex 3D Player Avatar
 * with head pitch, shoulder/hip limb pivots, Leather/Iron/Diamond armor shell overlays,
 * right-hand held block/tool, left-hand 3D Shield (raises across chest when blocking),
 * walk/sprint/sneak/swim/boat/arm-swing poses, and crisp floating canvas nametag sprite.
 */

import * as THREE from 'three';

const ARMOR_COLORS = {
  leather: 0x8b5a2b,
  iron: 0xd6dbe0,
  diamond: 0x38e2d5,
  gold: 0xfacc15,
};

function getArmorTierColor(itemId) {
  if (!itemId) return null;
  if (itemId.startsWith('diamond_')) return ARMOR_COLORS.diamond;
  if (itemId.startsWith('iron_')) return ARMOR_COLORS.iron;
  if (itemId.startsWith('gold_') || itemId.startsWith('golden_')) return ARMOR_COLORS.gold;
  if (itemId.startsWith('leather_')) return ARMOR_COLORS.leather;
  return ARMOR_COLORS.iron;
}

function createSteveFaceTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  // Skin base
  ctx.fillStyle = '#c99672';
  ctx.fillRect(0, 0, 16, 16);
  // Subtle skin shading
  ctx.fillStyle = '#bd8964';
  ctx.fillRect(0, 12, 16, 4);
  // Classic Steve brown hair fringe
  ctx.fillStyle = '#3b2416';
  ctx.fillRect(0, 0, 16, 4);
  ctx.fillRect(0, 4, 2, 2);
  ctx.fillRect(14, 4, 2, 2);
  // Eyes (white + indigo pupils)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 7, 4, 2);
  ctx.fillRect(10, 7, 4, 2);
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(4, 7, 2, 2);
  ctx.fillRect(10, 7, 2, 2);
  // Nose & goatee/mouth
  ctx.fillStyle = '#a87452';
  ctx.fillRect(6, 9, 4, 2);
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(5, 12, 6, 3);
  ctx.fillStyle = '#9c6644';
  ctx.fillRect(6, 12, 4, 1);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createNametagSprite(name) {
  if (typeof document === 'undefined' || !name) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 26px monospace';
  const textW = Math.min(236, Math.max(76, ctx.measureText(name).width + 26));
  const boxX = (256 - textW) / 2;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fillRect(boxX, 12, textW, 40);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, 12, textW, 40);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33, 224);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.38, 1);
  sprite.position.set(0, 2.18, 0);
  return sprite;
}

export class PlayerAvatar {
  /**
   * @param {Object} [options]
   * @param {number} [options.shirtColor=0x0ea5e9]
   * @param {string|null} [options.name=null]
   */
  constructor({ shirtColor = 0x0ea5e9, name = null } = {}) {
    this.root = new THREE.Group();
    this.root.name = 'PlayerAvatar';

    this.bodyRoot = new THREE.Group();
    this.root.add(this.bodyRoot);

    this._disposables = [];
    this._shirtColor = shirtColor;
    this._walkPhase = 0;
    this._swingTimer = 0;
    this._heldItemKey = '';
    this._armorKey = '';
    this._hasShield = false;
    this._isShielding = false;

    const track = (geo, mat) => {
      this._disposables.push(geo);
      if (Array.isArray(mat)) mat.forEach((m) => this._disposables.push(m));
      else this._disposables.push(mat);
    };

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc99672 });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x3b2416 });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtColor });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a3b6e });
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x3f3f46 });
    this._disposables.push(skinMat, hairMat, shirtMat, pantsMat, shoeMat);

    // 1. Head Pivot (at neck y = 1.38)
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 1.38, 0);
    this.bodyRoot.add(this.headPivot);

    const headGeo = new THREE.BoxGeometry(0.46, 0.46, 0.46);
    const faceTex = createSteveFaceTexture();
    let headMat;
    if (faceTex) {
      this._disposables.push(faceTex);
      const faceMat = new THREE.MeshLambertMaterial({ map: faceTex, color: 0xffffff });
      this._disposables.push(faceMat);
      // +X, -X, +Y, -Y, +Z, -Z (front is -Z)
      headMat = [hairMat, hairMat, hairMat, skinMat, hairMat, faceMat];
    } else {
      headMat = skinMat;
    }
    this._disposables.push(headGeo);
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.set(0, 0.23, 0);
    headMesh.castShadow = true;
    this.headPivot.add(headMesh);

    // Helmet armor overlay
    const helmetGeo = new THREE.BoxGeometry(0.52, 0.52, 0.52);
    this._helmetMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe0 });
    track(helmetGeo, this._helmetMat);
    this._helmetMesh = new THREE.Mesh(helmetGeo, this._helmetMat);
    this._helmetMesh.position.set(0, 0.24, 0);
    this._helmetMesh.visible = false;
    this.headPivot.add(this._helmetMesh);

    // 2. Torso
    const torsoGeo = new THREE.BoxGeometry(0.48, 0.7, 0.24);
    this._disposables.push(torsoGeo);
    this.torsoMesh = new THREE.Mesh(torsoGeo, shirtMat);
    this.torsoMesh.position.set(0, 1.03, 0);
    this.torsoMesh.castShadow = true;
    this.bodyRoot.add(this.torsoMesh);

    const chestGeo = new THREE.BoxGeometry(0.54, 0.74, 0.3);
    this._chestMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe0 });
    track(chestGeo, this._chestMat);
    this._chestMesh = new THREE.Mesh(chestGeo, this._chestMat);
    this._chestMesh.position.set(0, 1.03, 0);
    this._chestMesh.visible = false;
    this.bodyRoot.add(this._chestMesh);

    // 3. Arms (pivoted at shoulders y = 1.32)
    const armGeo = new THREE.BoxGeometry(0.2, 0.68, 0.2);
    const sleeveGeo = new THREE.BoxGeometry(0.21, 0.28, 0.21);
    const shoulderArmorGeo = new THREE.BoxGeometry(0.24, 0.34, 0.24);
    this._disposables.push(armGeo, sleeveGeo, shoulderArmorGeo);

    // Right arm (player's right is +X when facing -Z)
    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.34, 1.32, 0);
    this.bodyRoot.add(this.rightArmPivot);

    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.set(0, -0.3, 0);
    rightArm.castShadow = true;
    const rightSleeve = new THREE.Mesh(sleeveGeo, shirtMat);
    rightSleeve.position.set(0, -0.1, 0);
    this._rightShoulderArmor = new THREE.Mesh(shoulderArmorGeo, this._chestMat);
    this._rightShoulderArmor.position.set(0, -0.12, 0);
    this._rightShoulderArmor.visible = false;
    this.rightArmPivot.add(rightArm, rightSleeve, this._rightShoulderArmor);

    // Right hand held item mount
    this.heldItemMount = new THREE.Group();
    this.heldItemMount.position.set(0, -0.58, -0.18);
    this.rightArmPivot.add(this.heldItemMount);

    const heldBlockGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this._heldBlockMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
    track(heldBlockGeo, this._heldBlockMat);
    this._heldBlockMesh = new THREE.Mesh(heldBlockGeo, this._heldBlockMat);
    this._heldBlockMesh.rotation.set(0.2, Math.PI * 0.25, 0);
    this._heldBlockMesh.visible = false;
    this.heldItemMount.add(this._heldBlockMesh);

    const heldToolGeo = new THREE.BoxGeometry(0.08, 0.56, 0.14);
    this._heldToolMat = new THREE.MeshLambertMaterial({ color: 0xd1d5db });
    track(heldToolGeo, this._heldToolMat);
    this._heldToolMesh = new THREE.Mesh(heldToolGeo, this._heldToolMat);
    this._heldToolMesh.position.set(0, 0.14, -0.14);
    this._heldToolMesh.rotation.x = -0.85;
    this._heldToolMesh.visible = false;
    this.heldItemMount.add(this._heldToolMesh);

    // Left arm (player's left is -X when facing -Z)
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.34, 1.32, 0);
    this.bodyRoot.add(this.leftArmPivot);

    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.set(0, -0.3, 0);
    leftArm.castShadow = true;
    const leftSleeve = new THREE.Mesh(sleeveGeo, shirtMat);
    leftSleeve.position.set(0, -0.1, 0);
    this._leftShoulderArmor = new THREE.Mesh(shoulderArmorGeo, this._chestMat);
    this._leftShoulderArmor.position.set(0, -0.12, 0);
    this._leftShoulderArmor.visible = false;
    this.leftArmPivot.add(leftArm, leftSleeve, this._leftShoulderArmor);

    // Left hand 3D Shield
    this.shieldGroup = new THREE.Group();
    this.shieldGroup.position.set(-0.14, -0.42, -0.12);
    const shieldWoodGeo = new THREE.BoxGeometry(0.08, 0.62, 0.42);
    const shieldWoodMat = new THREE.MeshLambertMaterial({ color: 0x9c7244 });
    const shieldRimGeo = new THREE.BoxGeometry(0.1, 0.66, 0.46);
    const shieldRimMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    const shieldBossGeo = new THREE.BoxGeometry(0.12, 0.18, 0.14);
    track(shieldWoodGeo, shieldWoodMat);
    track(shieldRimGeo, shieldRimMat);
    this._disposables.push(shieldBossGeo);
    const shieldRim = new THREE.Mesh(shieldRimGeo, shieldRimMat);
    const shieldWood = new THREE.Mesh(shieldWoodGeo, shieldWoodMat);
    shieldWood.position.x = -0.015;
    const shieldBoss = new THREE.Mesh(shieldBossGeo, shieldRimMat);
    this.shieldGroup.add(shieldRim, shieldWood, shieldBoss);
    this.shieldGroup.visible = false;
    this.leftArmPivot.add(this.shieldGroup);

    // 4. Legs (pivoted at hips y = 0.68)
    const legGeo = new THREE.BoxGeometry(0.22, 0.68, 0.22);
    const shoeGeo = new THREE.BoxGeometry(0.23, 0.14, 0.23);
    const legArmorGeo = new THREE.BoxGeometry(0.26, 0.44, 0.26);
    const bootArmorGeo = new THREE.BoxGeometry(0.27, 0.22, 0.27);
    this._disposables.push(legGeo, shoeGeo, legArmorGeo, bootArmorGeo);

    this._legsMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe0 });
    this._bootsMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe0 });
    this._disposables.push(this._legsMat, this._bootsMat);

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.12, 0.68, 0);
    this.bodyRoot.add(this.leftLegPivot);
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.set(0, -0.34, 0);
    leftLeg.castShadow = true;
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(0, -0.61, 0);
    this._leftLegArmor = new THREE.Mesh(legArmorGeo, this._legsMat);
    this._leftLegArmor.position.set(0, -0.22, 0);
    this._leftLegArmor.visible = false;
    this._leftBootArmor = new THREE.Mesh(bootArmorGeo, this._bootsMat);
    this._leftBootArmor.position.set(0, -0.57, 0);
    this._leftBootArmor.visible = false;
    this.leftLegPivot.add(leftLeg, leftShoe, this._leftLegArmor, this._leftBootArmor);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.12, 0.68, 0);
    this.bodyRoot.add(this.rightLegPivot);
    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.set(0, -0.34, 0);
    rightLeg.castShadow = true;
    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0, -0.61, 0);
    this._rightLegArmor = new THREE.Mesh(legArmorGeo, this._legsMat);
    this._rightLegArmor.position.set(0, -0.22, 0);
    this._rightLegArmor.visible = false;
    this._rightBootArmor = new THREE.Mesh(bootArmorGeo, this._bootsMat);
    this._rightBootArmor.position.set(0, -0.57, 0);
    this._rightBootArmor.visible = false;
    this.rightLegPivot.add(rightLeg, rightShoe, this._rightLegArmor, this._rightBootArmor);

    // 5. Optional floating nametag
    this._nametag = null;
    if (name) {
      this.setName(name);
    }
  }

  /**
   * Sets or updates the floating nametag above the avatar's head.
   * @param {string|null} name
   */
  setName(name) {
    if (this._nametag) {
      this.root.remove(this._nametag);
      this._nametag.material.map?.dispose();
      this._nametag.material.dispose();
      this._nametag = null;
    }
    if (name) {
      const sprite = createNametagSprite(name);
      if (sprite) {
        this._nametag = sprite;
        this.root.add(sprite);
      }
    }
  }

  /**
   * Updates visible Leather / Iron / Diamond armor overlays on the avatar.
   * @param {{ helmet?: string|null, chestplate?: string|null, leggings?: string|null, boots?: string|null }|Array<string|null>|null} armorIds
   */
  setArmor(armorIds) {
    const isArr = Array.isArray(armorIds);
    const h = (isArr ? armorIds[0] : armorIds?.helmet) || '';
    const c = (isArr ? armorIds[1] : armorIds?.chestplate) || '';
    const l = (isArr ? armorIds[2] : armorIds?.leggings) || '';
    const b = (isArr ? armorIds[3] : armorIds?.boots) || '';
    const key = `${h}|${c}|${l}|${b}`;
    if (key === this._armorKey) return;
    this._armorKey = key;

    const hCol = getArmorTierColor(h);
    this._helmetMesh.visible = Boolean(hCol);
    if (hCol) this._helmetMat.color.setHex(hCol);

    const cCol = getArmorTierColor(c);
    this._chestMesh.visible = Boolean(cCol);
    this._leftShoulderArmor.visible = Boolean(cCol);
    this._rightShoulderArmor.visible = Boolean(cCol);
    if (cCol) this._chestMat.color.setHex(cCol);

    const lCol = getArmorTierColor(l);
    this._leftLegArmor.visible = Boolean(lCol);
    this._rightLegArmor.visible = Boolean(lCol);
    if (lCol) this._legsMat.color.setHex(lCol);

    const bCol = getArmorTierColor(b);
    this._leftBootArmor.visible = Boolean(bCol);
    this._rightBootArmor.visible = Boolean(bCol);
    if (bCol) this._bootsMat.color.setHex(bCol);
  }

  /**
   * Updates the right-hand held block or tool/weapon mesh.
   * @param {string|null} itemId
   * @param {any} [itemRegistry]
   */
  setHeldItem(itemId, itemRegistry = null) {
    const key = itemId || '';
    if (key === this._heldItemKey) return;
    this._heldItemKey = key;

    if (!itemId || itemId === 'shield') {
      this._heldBlockMesh.visible = false;
      this._heldToolMesh.visible = false;
      return;
    }

    const def = itemRegistry?.get?.(itemId) || null;
    const isBlock = Boolean(def && def.blockId !== null && def.blockId !== undefined);
    const tint = def?.iconColor || '#cbd5e1';

    if (isBlock) {
      this._heldBlockMesh.visible = true;
      this._heldToolMesh.visible = false;
      this._heldBlockMat.color.set(tint);
    } else {
      this._heldBlockMesh.visible = false;
      this._heldToolMesh.visible = true;
      this._heldToolMat.color.set(tint);
    }
  }

  /**
   * Controls left-hand 3D Shield visibility and raised blocking stance.
   */
  setShield(hasShield, isBlocking = false) {
    this._hasShield = Boolean(hasShield);
    this._isShielding = Boolean(hasShield && isBlocking);
    this.shieldGroup.visible = this._hasShield;
  }

  /**
   * Triggers a crisp right-arm swing animation (mining/attacking/placing).
   */
  triggerSwing() {
    this._swingTimer = 0.26;
  }

  /**
   * Animates head pitch, walk/sprint gait, sneak crouch, swim, boat seating, shield block, and arm swing.
   * @param {number} dt
   * @param {Object} state
   */
  update(dt, state = {}) {
    const {
      x = this.root.position.x,
      y = this.root.position.y,
      z = this.root.position.z,
      yaw = this.root.rotation.y,
      pitch = 0,
      speed = 0,
      sneaking = false,
      swinging = false,
      shielding = false,
      hasShield = this._hasShield,
      inWater = false,
      ridingBoat = false,
    } = state;

    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.setShield(hasShield, shielding);

    if (swinging && this._swingTimer <= 0.05) {
      this._swingTimer = 0.26;
    }
    if (this._swingTimer > 0) {
      this._swingTimer = Math.max(0, this._swingTimer - dt);
    }

    if (speed > 0.08 && !ridingBoat) {
      this._walkPhase += dt * Math.min(14, 4.5 + speed * 1.45);
    } else {
      this._walkPhase *= Math.max(0, 1 - dt * 6);
    }

    // Head tracks pitch smoothly
    this.headPivot.rotation.x = Math.max(-1.25, Math.min(1.25, pitch));

    // Crouch / Boat / Swim body offsets
    if (ridingBoat) {
      this.bodyRoot.position.y = -0.34;
      this.bodyRoot.rotation.x = 0;
    } else if (sneaking) {
      this.bodyRoot.position.y = -0.18;
      this.bodyRoot.rotation.x = 0.24;
    } else if (inWater) {
      this.bodyRoot.position.y = -0.08;
      this.bodyRoot.rotation.x = 0.22;
    } else {
      this.bodyRoot.position.y = 0;
      this.bodyRoot.rotation.x = 0;
    }

    const walkAmp = Math.min(0.85, speed * 0.14);
    const gait = Math.sin(this._walkPhase) * walkAmp;
    const swingArc = this._swingTimer > 0 ? Math.sin((this._swingTimer / 0.26) * Math.PI) : 0;

    // Legs
    if (ridingBoat) {
      this.leftLegPivot.rotation.x = 1.25;
      this.rightLegPivot.rotation.x = 1.25;
    } else {
      this.leftLegPivot.rotation.x = gait;
      this.rightLegPivot.rotation.x = -gait;
    }

    // Right arm (walk swing + mining/attack swing + subtle held item lift)
    const heldLift = this._heldItemKey ? 0.24 : 0;
    this.rightArmPivot.rotation.x = gait * 0.85 + heldLift + swingArc * 1.45;
    this.rightArmPivot.rotation.z = -swingArc * 0.25;

    // Left arm & Shield blocking pose
    if (this._isShielding) {
      this.leftArmPivot.rotation.x = 0.92;
      this.leftArmPivot.rotation.y = 0.65;
      this.shieldGroup.position.set(0.06, -0.32, -0.26);
      this.shieldGroup.rotation.set(0, Math.PI * 0.5, 0);
    } else {
      this.leftArmPivot.rotation.x = -gait * 0.85 + (this._hasShield ? 0.22 : 0);
      this.leftArmPivot.rotation.y = 0;
      this.shieldGroup.position.set(-0.14, -0.42, -0.12);
      this.shieldGroup.rotation.set(0, 0, 0);
    }
  }

  dispose() {
    if (this._nametag) {
      this._nametag.material.map?.dispose();
      this._nametag.material.dispose();
      this._nametag = null;
    }
    for (const d of this._disposables) {
      d.dispose?.();
    }
    this._disposables = [];
  }
}
