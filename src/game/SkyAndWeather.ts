/**
 * @file SkyAndWeather.ts
 * @description Renders the classic Minecraft celestial dome (Sun, Moon, twinkling Starfield),
 * drifting blocky volumetric clouds (InstancedMesh), and pooled Rain/Snowfall weather particles
 * with zero per-frame allocations.
 */

import * as THREE from 'three';

const CLOUD_COUNT = 44;
const PRECIP_COUNT = 340;

interface CloudSeed {
  x: number;
  z: number;
  sx: number;
  sz: number;
  yOffset: number;
}

interface DropSeed {
  ox: number;
  oy: number;
  oz: number;
  speed: number;
}

export class SkyAndWeather {
  public readonly group = new THREE.Group();

  private readonly sunMesh: THREE.Mesh;
  private readonly moonMesh: THREE.Mesh;
  private readonly starsPoints: THREE.Points;
  private readonly starsMat: THREE.PointsMaterial;
  private readonly cloudsMesh: THREE.InstancedMesh;
  private readonly cloudsMat: THREE.MeshLambertMaterial;
  private readonly precipMesh: THREE.InstancedMesh;
  private readonly precipMat: THREE.MeshBasicMaterial;

  private readonly cloudSeeds: CloudSeed[] = [];
  private readonly dropSeeds: DropSeed[] = [];
  private readonly dummy = new THREE.Object3D();
  private cloudDrift = 0;
  private cloudsEnabled = true;
  private dimension: 'overworld' | 'nether' | 'end' = 'overworld';

  constructor(isSoftwareGl = false) {
    this.group.name = 'VoxelSkyAndWeather';

    // 1. Sun & Moon celestial quads (procedural canvas textures)
    const sunTex = this.createCelestialTexture('sun');
    const moonTex = this.createCelestialTexture('moon');

    this.sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshBasicMaterial({
        map: sunTex,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      })
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({
        map: moonTex,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      })
    );
    this.group.add(this.sunMesh, this.moonMesh);

    // 2. Night Starfield
    const starCount = isSoftwareGl ? 180 : 380;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.12 + Math.random() * 0.88);
      const r = 135;
      starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      starPositions[i * 3 + 1] = Math.cos(phi) * r;
      starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xf4f8ff,
      size: 1.45,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    this.starsPoints = new THREE.Points(starGeo, this.starsMat);
    this.group.add(this.starsPoints);

    // 3. Drifting Blocky Clouds (InstancedMesh at Y ~ 108)
    const activeClouds = isSoftwareGl ? 24 : CLOUD_COUNT;
    const cloudGeo = new THREE.BoxGeometry(1, 3.2, 1);
    this.cloudsMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
      depthWrite: true,
    });
    this.cloudsMesh = new THREE.InstancedMesh(cloudGeo, this.cloudsMat, activeClouds);
    this.cloudsMesh.frustumCulled = false;
    for (let i = 0; i < activeClouds; i++) {
      this.cloudSeeds.push({
        x: (Math.random() - 0.5) * 260,
        z: (Math.random() - 0.5) * 260,
        sx: 10 + Math.floor(Math.random() * 16),
        sz: 8 + Math.floor(Math.random() * 14),
        yOffset: (Math.random() - 0.5) * 2.5,
      });
    }
    this.group.add(this.cloudsMesh);

    // 4. Pooled Rain / Snow Weather Streaks (InstancedMesh)
    const activePrecip = isSoftwareGl ? 150 : PRECIP_COUNT;
    const dropGeo = new THREE.BoxGeometry(0.055, 0.72, 0.055);
    this.precipMat = new THREE.MeshBasicMaterial({
      color: 0x89b7ff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.precipMesh = new THREE.InstancedMesh(dropGeo, this.precipMat, activePrecip);
    this.precipMesh.frustumCulled = false;
    this.precipMesh.visible = false;
    for (let i = 0; i < activePrecip; i++) {
      this.dropSeeds.push({
        ox: (Math.random() - 0.5) * 34,
        oy: Math.random() * 24,
        oz: (Math.random() - 0.5) * 34,
        speed: 14 + Math.random() * 8,
      });
    }
    this.group.add(this.precipMesh);
  }

  private createCelestialTexture(kind: 'sun' | 'moon'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32);

    if (kind === 'sun') {
      ctx.fillStyle = 'rgba(255, 245, 190, 0.25)';
      ctx.fillRect(2, 2, 28, 28);
      ctx.fillStyle = '#fff5b8';
      ctx.fillRect(5, 5, 22, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8, 8, 16, 16);
    } else {
      ctx.fillStyle = 'rgba(205, 220, 255, 0.2)';
      ctx.fillRect(3, 3, 26, 26);
      ctx.fillStyle = '#e2e8f5';
      ctx.fillRect(6, 6, 20, 20);
      ctx.fillStyle = '#b4c0d8';
      ctx.fillRect(9, 9, 5, 5);
      ctx.fillRect(17, 15, 5, 6);
      ctx.fillRect(11, 18, 4, 4);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public setCloudsEnabled(enabled: boolean): void {
    this.cloudsEnabled = enabled;
    this.cloudsMesh.visible = enabled && this.dimension === 'overworld';
  }

  public setDimension(dimension: 'overworld' | 'nether' | 'end'): void {
    const next = dimension === 'end' ? 'end' : dimension === 'nether' ? 'nether' : 'overworld';
    if (this.dimension === next) return;
    this.dimension = next;
    const isOverworld = this.dimension === 'overworld';
    const isEnd = this.dimension === 'end';
    this.sunMesh.visible = isOverworld;
    this.moonMesh.visible = isOverworld;
    this.starsPoints.visible = isOverworld || isEnd;
    this.cloudsMesh.visible = isOverworld && this.cloudsEnabled;
    this.precipMesh.visible = false;
  }

  public update(
    dt: number,
    playerPos: { x: number; y: number; z: number },
    timeOfDay: number,
    skyBrightness: number,
    weather: 'clear' | 'rain' | 'thunder',
    isColdBiome: boolean
  ): void {
    if (this.dimension === 'nether') {
      this.sunMesh.visible = false;
      this.moonMesh.visible = false;
      this.starsPoints.visible = false;
      this.cloudsMesh.visible = false;
      this.precipMesh.visible = false;
      return;
    }

    if (this.dimension === 'end') {
      this.sunMesh.visible = false;
      this.moonMesh.visible = false;
      this.cloudsMesh.visible = false;
      this.precipMesh.visible = false;
      this.starsPoints.position.set(playerPos.x, playerPos.y, playerPos.z);
      this.starsMat.color.setHex(0xd8b4fe);
      this.starsMat.opacity = 0.85;
      this.starsPoints.visible = true;
      return;
    }

    this.starsMat.color.setHex(0xf4f8ff);

    const isWet = weather === 'rain' || weather === 'thunder';

    // 1. Orbit Sun & Moon centered around player
    const angle = timeOfDay * Math.PI * 2;
    const orbitR = 128;
    const sx = Math.cos(angle) * orbitR;
    const sy = Math.sin(angle) * orbitR;
    const sz = Math.sin(angle * 0.5) * 18;

    this.sunMesh.position.set(playerPos.x + sx, playerPos.y + sy, playerPos.z + sz);
    this.sunMesh.lookAt(playerPos.x, playerPos.y, playerPos.z);
    this.sunMesh.visible = sy > -24;

    this.moonMesh.position.set(playerPos.x - sx, playerPos.y - sy, playerPos.z - sz);
    this.moonMesh.lookAt(playerPos.x, playerPos.y, playerPos.z);
    this.moonMesh.visible = -sy > -24;

    // 2. Starfield follows player & fades in at dusk/night
    this.starsPoints.position.set(playerPos.x, playerPos.y, playerPos.z);
    const nightAlpha = Math.max(0, Math.min(1, (0.48 - skyBrightness) / 0.3));
    this.starsMat.opacity = isWet ? nightAlpha * 0.2 : nightAlpha * 0.92;
    this.starsPoints.visible = this.starsMat.opacity > 0.02;

    // 3. Drifting blocky clouds wrapped cleanly around player XZ
    this.cloudsMesh.visible = this.cloudsEnabled;
    if (this.cloudsEnabled) {
      this.cloudDrift += dt * (weather === 'thunder' ? 2.4 : 1.45);
      const cloudShade = weather === 'thunder' ? 0.36 : weather === 'rain' ? 0.55 : 1.0;
      const bright = Math.max(0.22, skyBrightness * cloudShade);
      this.cloudsMat.color.setRGB(bright, bright * 0.99, Math.min(1, bright * 1.02));

      const span = 260;
      const half = span * 0.5;
      for (let i = 0; i < this.cloudSeeds.length; i++) {
        const c = this.cloudSeeds[i];
        let rx = (c.x + this.cloudDrift - playerPos.x) % span;
        if (rx > half) rx -= span;
        if (rx < -half) rx += span;
        let rz = (c.z - playerPos.z) % span;
        if (rz > half) rz -= span;
        if (rz < -half) rz += span;

        this.dummy.position.set(playerPos.x + rx, 108 + c.yOffset, playerPos.z + rz);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(c.sx, 1, c.sz);
        this.dummy.updateMatrix();
        this.cloudsMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.cloudsMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Pooled Rain or Snowfall around player
    const showPrecip = isWet;
    this.precipMesh.visible = showPrecip;
    if (showPrecip) {
      const speedScale = isColdBiome ? 0.22 : weather === 'thunder' ? 1.35 : 1.0;
      this.precipMat.color.setHex(isColdBiome ? 0xf3f7ff : 0x89b7ff);
      this.precipMat.opacity = isColdBiome ? 0.85 : weather === 'thunder' ? 0.72 : 0.55;

      for (let i = 0; i < this.dropSeeds.length; i++) {
        const d = this.dropSeeds[i];
        d.oy -= d.speed * speedScale * dt;
        if (d.oy < -4) {
          d.oy = 18 + Math.random() * 6;
          d.ox = (Math.random() - 0.5) * 34;
          d.oz = (Math.random() - 0.5) * 34;
        }
        const sway = isColdBiome ? Math.sin(this.cloudDrift * 1.8 + i) * 0.65 : 0;
        this.dummy.position.set(
          playerPos.x + d.ox + sway,
          playerPos.y + d.oy,
          playerPos.z + d.oz
        );
        this.dummy.rotation.set(0, 0, 0);
        if (isColdBiome) {
          this.dummy.scale.set(2.4, 0.22, 2.4);
        } else {
          this.dummy.scale.set(1, 1.35, 1);
        }
        this.dummy.updateMatrix();
        this.precipMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.precipMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.sunMesh.material as THREE.Material).dispose();

    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.moonMesh.material as THREE.Material).dispose();

    this.starsPoints.geometry.dispose();
    this.starsMat.dispose();

    this.cloudsMesh.geometry.dispose();
    this.cloudsMat.dispose();

    this.precipMesh.geometry.dispose();
    this.precipMat.dispose();
  }
}
