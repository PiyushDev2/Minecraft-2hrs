/**
 * @file App.tsx
 * @description VoxelCraft Complete Edition main application shell.
 * Coordinates Three.js WebGL2 renderer, live 3D panorama title screen, WorldManager simulation,
 * progressive hold-to-mine with 10-stage crack overlay, hold-to-eat with crumb particles,
 * smooth Sprint FOV + view bobbing, Nether portal dwell & dimension transitions,
 * XP orbs, Enderman stare aggro, Sky & Weather, pooled particles, 3D FirstPersonHand viewmodel,
 * Web Audio + 1.21 Resource Pack hot-swapping, F3+G Chunk Borders, Classic HUD,
 * Java-style F3 Debug HUD, and classic beveled stone container modals.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  BLOCK_IDS,
  ENGINE_EVENTS,
  formatEnchantLabel,
  ITEM_CATEGORIES,
  mobSkins,
  TextureAtlas,
  WorldManager,
  WorldSave,
} from './backend/index.js';
import {
  ClassicHud,
  type AdvancementToastView,
  type ChatMessage,
  type HudSnapshot,
  type HudSlotView,
} from './components/ClassicHud';
import { ContainerModals, type ActiveModalType } from './components/ContainerModals';
import { F3DebugOverlay, type F3Telemetry } from './components/F3DebugOverlay';
import { TitleScreen, type GameOptionsState, type SavedWorldMeta } from './components/TitleScreen';
import { WorkstationModals, type WorkstationModalType } from './components/WorkstationModals';
import { ChunkBorderRenderer } from './game/ChunkBorderRenderer';
import { FirstPersonHand } from './game/FirstPersonHand';
import { ParticleSystem } from './game/ParticleSystem';
import { PlayerAvatar } from './game/PlayerAvatar.js';
import { resourcePackManager, type StoredResourcePack } from './game/ResourcePackManager';
import { MultiplayerClient } from './backend/network/MultiplayerClient.js';
import { normalizeRoomId, normalizeWebSocketUrl } from './backend/network/MultiplayerProtocol.js';
import { SkyAndWeather } from './game/SkyAndWeather';
import { SoundEngine } from './game/SoundEngine';
import { XpOrbManager } from './game/XpOrbManager';

const DEFAULT_OPTIONS: GameOptionsState = {
  viewDistance: 5,
  fov: 75,
  mouseSensitivity: 1.0,
  invertY: false,
  volume: 0.55,
  blocksVolume: 0.9,
  mobsVolume: 0.9,
  ambientVolume: 0.75,
  uiVolume: 0.85,
  graphics: 'fast',
  clouds: true,
  shadows: false,
  viewBobbing: true,
  pixelRatioCap: 1.5,
  particles: 'all',
  chunkBorders: false,
};

function getFacingLabel(yawRad: number): string {
  const deg = (((yawRad * 180) / Math.PI) % 360 + 360) % 360;
  if (deg >= 315 || deg < 45) return 'north (Towards -Z)';
  if (deg >= 45 && deg < 135) return 'west (Towards -X)';
  if (deg >= 135 && deg < 225) return 'south (Towards +Z)';
  return 'east (Towards +X)';
}

function getBlockParticleColor(blockId: number): number {
  switch (blockId) {
    case BLOCK_IDS.GRASS:
      return 0x5ca63e;
    case BLOCK_IDS.DIRT:
    case BLOCK_IDS.FARMLAND:
    case BLOCK_IDS.FARMLAND_WET:
      return 0x7c5334;
    case BLOCK_IDS.STONE:
    case BLOCK_IDS.COBBLESTONE:
    case BLOCK_IDS.FURNACE:
    case BLOCK_IDS.FURNACE_LIT:
      return 0x868686;
    case BLOCK_IDS.MOSSY_COBBLESTONE:
      return 0x5f7e4f;
    case BLOCK_IDS.SAND:
      return 0xdccb8c;
    case BLOCK_IDS.OAK_LOG:
    case BLOCK_IDS.OAK_PLANKS:
    case BLOCK_IDS.CRAFTING_TABLE:
    case BLOCK_IDS.CHEST:
    case BLOCK_IDS.OAK_DOOR_CLOSED:
    case BLOCK_IDS.OAK_DOOR_OPEN:
    case BLOCK_IDS.LADDER:
      return 0xa47c48;
    case BLOCK_IDS.OAK_LEAVES:
    case BLOCK_IDS.SPRUCE_LEAVES:
    case BLOCK_IDS.TALL_GRASS:
      return 0x3f8432;
    case BLOCK_IDS.GOLD_ORE:
    case BLOCK_IDS.GOLD_BLOCK:
    case BLOCK_IDS.GLOWSTONE:
      return 0xf5c842;
    case BLOCK_IDS.DIAMOND_ORE:
    case BLOCK_IDS.DIAMOND_BLOCK:
      return 0x4de6e2;
    case BLOCK_IDS.REDSTONE_ORE:
    case BLOCK_IDS.TNT:
    case BLOCK_IDS.BED:
    case BLOCK_IDS.FLOWER:
      return 0xd63636;
    case BLOCK_IDS.OBSIDIAN:
      return 0x26183b;
    case BLOCK_IDS.NETHERRACK:
    case BLOCK_IDS.NETHER_QUARTZ_ORE:
      return 0x7a3434;
    case BLOCK_IDS.NETHER_BRICKS:
      return 0x3b1e23;
    case BLOCK_IDS.SOUL_SAND:
      return 0x564135;
    case BLOCK_IDS.NETHER_PORTAL:
      return 0xa855f7;
    case BLOCK_IDS.WHITE_WOOL:
    case BLOCK_IDS.SNOW_BLOCK:
      return 0xeef5ff;
    case BLOCK_IDS.GLASS:
      return 0xbce6ff;
    case BLOCK_IDS.WHEAT_0:
    case BLOCK_IDS.WHEAT_1:
    case BLOCK_IDS.WHEAT_2:
    case BLOCK_IDS.WHEAT_3:
      return 0xd9b842;
    default:
      return 0x999999;
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const worldManagerRef = useRef<any>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const isSoftwareGlRef = useRef(false);
  const soundRef = useRef<SoundEngine | null>(null);
  const skyRef = useRef<SkyAndWeather | null>(null);
  const chunkBordersRef = useRef<ChunkBorderRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const handRef = useRef<FirstPersonHand | null>(null);
  const particlesRef = useRef<ParticleSystem | null>(null);
  const xpOrbsRef = useRef<XpOrbManager | null>(null);

  const [screen, setScreen] = useState<'title' | 'playing'>('title');
  const screenRef = useRef<'title' | 'playing'>('title');
  screenRef.current = screen;

  const [worlds, setWorlds] = useState<SavedWorldMeta[]>([]);
  const [currentSlotName, setCurrentSlotName] = useState<string>('Survival World');
  const currentSlotRef = useRef<string>('Survival World');
  currentSlotRef.current = currentSlotName;

  const [activePackName, setActivePackName] = useState<string | null>(null);
  const activePackNameRef = useRef<string | null>(null);
  activePackNameRef.current = activePackName;

  const [webglLost, setWebglLost] = useState(false);

  const [options, setOptions] = useState<GameOptionsState>(() => {
    try {
      const saved = localStorage.getItem('voxelcraft_options_v1');
      if (saved) return { ...DEFAULT_OPTIONS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_OPTIONS;
  });
  const optionsRef = useRef<GameOptionsState>(options);
  optionsRef.current = options;

  const [modal, setModal] = useState<ActiveModalType>(null);
  const modalRef = useRef<ActiveModalType>(null);
  modalRef.current = modal;

  const [workstationModal, setWorkstationModal] = useState<WorkstationModalType>(null);
  const workstationModalRef = useRef<WorkstationModalType>(null);
  workstationModalRef.current = workstationModal;

  const [advancementToast, setAdvancementToast] = useState<AdvancementToastView | null>(null);
  const advToastTimerRef = useRef<number | null>(null);

  const [modalRevision, setModalRevision] = useState(0);
  const [f3Open, setF3Open] = useState(false);
  const f3OpenRef = useRef(false);
  f3OpenRef.current = f3Open;

  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const nextChatIdRef = useRef(1);

  const [showHeldLabel, setShowHeldLabel] = useState(false);
  const heldLabelTimerRef = useRef<number | null>(null);

  const [hud, setHud] = useState<HudSnapshot>({
    gameMode: 'survival',
    hotbar: new Array(9).fill(null),
    selectedSlot: 0,
    health: 20,
    maxHealth: 20,
    hunger: 20,
    maxHunger: 20,
    air: 10,
    maxAir: 10,
    armorPoints: 0,
    xpLevel: 0,
    xpProgress: 0,
    burnTimer: 0,
    isDead: false,
    deathCause: '',
    submergedInWater: false,
    submergedInLava: false,
    heldItemLabel: '',
    bowCharge: 0,
    eatingProgress: 0,
    miningProgress: 0,
    portalProgress: 0,
    dimension: 'overworld',
    pointerLocked: false,
    hurtFlash: 0,
  });

  const [f3Data, setF3Data] = useState<F3Telemetry>({
    fps: 60,
    frameTimeMs: 16.7,
    frameHistory: [],
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    loadedChunks: 0,
    dirtyChunks: 0,
    workerPending: 0,
    renderDistance: 5,
    x: 0,
    y: 64,
    z: 0,
    yawDeg: 0,
    pitchDeg: 0,
    facingLabel: 'north (Towards -Z)',
    biome: 'plains',
    dimension: 'overworld',
    graphicsMode: 'Fast',
    activePackName: 'Default Procedural',
    skyLight: 15,
    blockLight: 0,
    timeOfDay: 0.25,
    weather: 'clear',
    mobsCount: 0,
    arrowsCount: 0,
    dropsCount: 0,
    particlesCount: 0,
    seed: 1337,
    gameMode: 'survival',
    chunkBorders: false,
    gpuRenderer: 'WebGL2',
    softwareGl: false,
    targetBlock: null,
  });

  // Live mutable gameplay input refs
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseDownLeftRef = useRef(false);
  const mouseDownRightRef = useRef(false);
  const pointerLockedRef = useRef(false);
  const cameraModeRef = useRef<'first' | 'third_back' | 'third_front'>('first');
  const hurtFlashRef = useRef(0);
  const f3KeyDownRef = useRef(false);
  const bobPhaseRef = useRef(0);
  const portalProgressRef = useRef(0);
  const portalCooldownRef = useRef(0);
  const stareCheckAccumRef = useRef(0);
  const packVersionRef = useRef(0);

  const miningRef = useRef<{
    active: boolean;
    x: number;
    y: number;
    z: number;
    blockId: number;
    elapsed: number;
    duration: number;
    tickSoundTimer: number;
  }>({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    blockId: 0,
    elapsed: 0,
    duration: 1,
    tickSoundTimer: 0,
  });

  const eatingRef = useRef<{
    active: boolean;
    itemId: string;
    elapsed: number;
    duration: number;
    chompTimer: number;
  }>({
    active: false,
    itemId: '',
    elapsed: 0,
    duration: 1.1,
    chompTimer: 0,
  });

  const bowChargeRef = useRef(0);
  const lastPlaceAtRef = useRef(0);

  const pushChat = useCallback((sender: string, text: string, kind: 'chat' | 'system' | 'error' = 'system') => {
    setChatMessages((prev) => [
      ...prev.slice(-30),
      { id: nextChatIdRef.current++, sender, text, timestamp: Date.now(), kind },
    ]);
  }, []);

  const flashHeldLabel = useCallback(() => {
    setShowHeldLabel(true);
    if (heldLabelTimerRef.current) window.clearTimeout(heldLabelTimerRef.current);
    heldLabelTimerRef.current = window.setTimeout(() => setShowHeldLabel(false), 2200);
  }, []);

  const refreshSavedWorlds = useCallback(async () => {
    try {
      const list = await WorldSave.listSavesAsync();
      setWorlds(list as SavedWorldMeta[]);
    } catch {
      setWorlds(WorldSave.listSaves() as SavedWorldMeta[]);
    }
  }, []);

  useEffect(() => {
    refreshSavedWorlds();
  }, [refreshSavedWorlds]);

  const buildHudSnapshot = useCallback((wm: any): HudSnapshot => {
    const hotbar: Array<HudSlotView | null> = [];
    for (let i = 0; i < 9; i++) {
      const s = wm.inventory.getSlot(i);
      if (!s) {
        hotbar.push(null);
      } else {
        const def = wm.itemRegistry.get(s.itemId);
        hotbar.push({
          itemId: s.itemId,
          name: def?.name ?? s.itemId,
          count: s.count,
          icon: wm.itemRegistry.getItemIconUrl(s.itemId, wm.world.textureAtlas),
          durability: s.durability,
          maxDurability: s.maxDurability,
          enchants: s.enchants,
          customName: s.customName,
        });
      }
    }
    const sel = hotbar[wm.inventory.selectedSlot];
    const selEnchants =
      sel?.enchants && Object.keys(sel.enchants).length > 0
        ? ` (${Object.entries(sel.enchants)
            .map(([k, v]) => formatEnchantLabel(k, v))
            .join(', ')})`
        : '';
    const heldItemLabel = sel ? `${sel.customName || sel.name}${selEnchants}` : '';

    const eye = wm.player.getEyePosition();
    const eyeBlock = wm.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const mining = miningRef.current;
    const eating = eatingRef.current;
    const fishState = wm.entities.getFishingState?.() || null;
    const dim =
      wm.world.dimension === 'end' ? 'end' : wm.world.dimension === 'nether' ? 'nether' : 'overworld';

    return {
      gameMode: wm.gameMode,
      hotbar,
      selectedSlot: wm.inventory.selectedSlot,
      health: wm.survival.health,
      maxHealth: wm.survival.maxHealth,
      hunger: wm.survival.hunger,
      maxHunger: wm.survival.maxHunger,
      air: wm.survival.air,
      maxAir: wm.survival.maxAir,
      armorPoints: wm.inventory.getArmorPoints(),
      xpLevel: wm.survival.xpLevel ?? 0,
      xpProgress: wm.survival.xpProgress ?? 0,
      burnTimer: wm.survival.burnTimer,
      isDead: wm.survival.isDead,
      deathCause: wm.survival.lastDamageSource,
      submergedInWater: eyeBlock === BLOCK_IDS.WATER,
      submergedInLava: eyeBlock === BLOCK_IDS.LAVA,
      heldItemLabel,
      bowCharge: bowChargeRef.current,
      eatingProgress: eating.active ? Math.min(1, eating.elapsed / eating.duration) : 0,
      miningProgress:
        mining.active && mining.duration > 0 && Number.isFinite(mining.duration)
          ? Math.min(1, mining.elapsed / mining.duration)
          : 0,
      portalProgress: portalProgressRef.current,
      dimension: dim,
      pointerLocked: pointerLockedRef.current,
      hurtFlash: hurtFlashRef.current,
      bossBar: wm.entities.getBossBarState?.() || null,
      activeEffects: wm.survival.getActiveEffectsList?.() || [],
      fishingCast: Boolean(fishState),
      fishingBiting: Boolean(fishState?.biting),
      ridingBoat: Boolean(wm.entities.getMountedBoat?.()),
      shieldBlocking: Boolean(wm.survival.shieldBlocking),
    };
  }, []);

  const handleApplyResourcePack = useCallback(
    async (pack: StoredResourcePack | null) => {
      const wm = worldManagerRef.current;
      if (!wm) return;

      if (pack) {
        await wm.world.textureAtlas.applyResourcePack(pack.assets.blockTextures);
        await wm.itemRegistry.applyResourcePackIcons(pack.assets.itemIcons);
        await mobSkins.applyResourcePackSkins(pack.assets.entitySkins);
        await soundRef.current?.loadSoundPack(pack.assets.sounds);
        setActivePackName(pack.name);
        pushChat('Resource Pack', `Activated "${pack.name}".`, 'system');
      } else {
        wm.world.textureAtlas.resetToDefault();
        wm.itemRegistry.clearResourcePackIcons();
        mobSkins.resetToDefault();
        soundRef.current?.clearSoundPack();
        setActivePackName(null);
        pushChat('Resource Pack', 'Switched to Built-in Procedural Textures & Audio.', 'system');
      }

      packVersionRef.current += 1;
      handRef.current?.clearTextureCache();
      setModalRevision((r) => r + 1);
      setHud(buildHudSnapshot(wm));
    },
    [buildHudSnapshot, pushChat]
  );

  const handleUpdateOptions = useCallback((patch: Partial<GameOptionsState>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('voxelcraft_options_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      const wm = worldManagerRef.current;
      if (patch.viewDistance !== undefined && wm) {
        wm.world.setViewDistance(next.viewDistance);
      }
      if (patch.fov !== undefined && cameraRef.current) {
        cameraRef.current.fov = next.fov;
        cameraRef.current.updateProjectionMatrix();
      }
      if (
        (patch.volume !== undefined ||
          patch.blocksVolume !== undefined ||
          patch.mobsVolume !== undefined ||
          patch.ambientVolume !== undefined ||
          patch.uiVolume !== undefined) &&
        soundRef.current
      ) {
        soundRef.current.setCategoryVolumes({
          master: next.volume,
          blocks: next.blocksVolume,
          mobs: next.mobsVolume,
          ambient: next.ambientVolume,
          ui: next.uiVolume,
        });
      }
      if (patch.graphics !== undefined && wm) {
        wm.world.chunkMesher.setGraphicsMode(next.graphics, wm.world.chunkManager.chunks.values());
      }
      if (patch.shadows !== undefined) {
        if (rendererRef.current) {
          rendererRef.current.shadowMap.enabled = next.shadows;
        }
        if (sunLightRef.current) {
          sunLightRef.current.castShadow = next.shadows;
        }
        if (wm) {
          wm.world.chunkMesher.setShadowsEnabled(next.shadows, wm.world.chunkManager.chunks.values());
        }
      }
      if (patch.pixelRatioCap !== undefined && rendererRef.current) {
        rendererRef.current.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, isSoftwareGlRef.current ? 1 : next.pixelRatioCap)
        );
      }
      if (patch.particles !== undefined && particlesRef.current) {
        particlesRef.current.setDensity(next.particles);
      }
      if (patch.clouds !== undefined && skyRef.current) {
        skyRef.current.setCloudsEnabled(next.clouds);
      }
      if (patch.chunkBorders !== undefined && chunkBordersRef.current) {
        chunkBordersRef.current.setVisible(next.chunkBorders);
      }
      return next;
    });
  }, []);

  const requestLock = useCallback(() => {
    soundRef.current?.unlock();
    const el = mountRef.current?.querySelector('canvas');
    if (el && document.pointerLockElement !== el) {
      try {
        const res = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {
        // Ignore pointer lock rejection in restricted contexts
      }
    }
  }, []);

  const releaseLock = useCallback(() => {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore exitPointerLock errors
      }
    }
  }, []);

  // Main Three.js + WorldManager lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    rendererRef.current = renderer;
    const gl = renderer.getContext();
    let gpuRenderer = 'WebGL2';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpuRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'WebGL2');
    } catch {
      // ignore
    }
    const isSoftwareGl = /swiftshader|llvmpipe|software|mesa offscreen/i.test(gpuRenderer);
    isSoftwareGlRef.current = isSoftwareGl;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : optionsRef.current.pixelRatioCap));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = optionsRef.current.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const onContextRestored = () => {
      setWebglLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x88bfff);
    scene.background = skyColor;
    scene.fog = new THREE.Fog(0x88bfff, 38, 92);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    const hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x4c5840, 0.85);
    const sunLight = new THREE.DirectionalLight(0xfff7e2, 0.95);
    sunLight.position.set(45, 95, 35);
    sunLight.castShadow = optionsRef.current.shadows;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLightRef.current = sunLight;
    scene.add(hemiLight, sunLight);

    const camera = new THREE.PerspectiveCamera(
      optionsRef.current.fov,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      260
    );
    cameraRef.current = camera;
    scene.add(camera);

    const hand = new FirstPersonHand();
    handRef.current = hand;
    camera.add(hand.root);

    // Local 3D Articulated Player Avatar for F5 Third-Person (Back & Front)
    const localAvatar = new PlayerAvatar({ shirtColor: 0x0ea5e9, name: null });
    localAvatar.root.visible = false;
    scene.add(localAvatar.root);

    // 3D Fishing Line from Player Hand to Bobber
    const fishLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const fishLineMat = new THREE.LineBasicMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.85 });
    const fishLine = new THREE.Line(fishLineGeo, fishLineMat);
    fishLine.visible = false;
    fishLine.frustumCulled = false;
    scene.add(fishLine);

    // In-World Sign Floating Text Sprites
    const signSprites = new Map<string, THREE.Sprite>();
    const clearSignSprites = () => {
      for (const sp of signSprites.values()) {
        scene.remove(sp);
        sp.material.map?.dispose();
        sp.material.dispose();
      }
      signSprites.clear();
    };
    const updateSignSprite = (sx: number, sy: number, sz: number, lines: string[]) => {
      const key = `${sx},${sy},${sz}`;
      const existing = signSprites.get(key);
      if (existing) {
        scene.remove(existing);
        existing.material.map?.dispose();
        existing.material.dispose();
        signSprites.delete(key);
      }
      const nonEmpty = (lines || []).filter((l) => l && l.trim().length > 0);
      if (nonEmpty.length === 0) return;

      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'rgba(145, 108, 62, 0.92)';
      ctx.fillRect(4, 4, 248, 120);
      ctx.strokeStyle = '#4e3418';
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, 248, 120);
      ctx.fillStyle = '#1b1106';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 4; i++) {
        const line = (lines[i] || '').slice(0, 20);
        if (line) ctx.fillText(line, 128, 26 + i * 25, 232);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1.15, 0.58, 1);
      sp.position.set(sx + 0.5, sy + 1.05, sz + 0.5);
      scene.add(sp);
      signSprites.set(key, sp);
    };

    const skyWeather = new SkyAndWeather(isSoftwareGl);
    skyWeather.setCloudsEnabled(optionsRef.current.clouds);
    skyRef.current = skyWeather;
    scene.add(skyWeather.group);

    const particles = new ParticleSystem(isSoftwareGl ? 160 : 280);
    particles.setDensity(optionsRef.current.particles);
    particlesRef.current = particles;
    scene.add(particles.mesh);

    const xpOrbs = new XpOrbManager();
    xpOrbs.attachScene(scene);
    xpOrbsRef.current = xpOrbs;

    const chunkBorders = new ChunkBorderRenderer();
    chunkBorders.setVisible(optionsRef.current.chunkBorders);
    chunkBordersRef.current = chunkBorders;
    scene.add(chunkBorders.group);

    const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 });
    const targetOutline = new THREE.LineSegments(outlineGeo, outlineMat);
    targetOutline.visible = false;
    scene.add(targetOutline);

    const crackTextures = TextureAtlas.createCrackStageTextures();
    const crackMat = new THREE.MeshBasicMaterial({
      map: crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), crackMat);
    crackMesh.visible = false;
    crackMesh.renderOrder = 12;
    scene.add(crackMesh);

    const sound = new SoundEngine();
    sound.setCategoryVolumes({
      master: optionsRef.current.volume,
      blocks: optionsRef.current.blocksVolume,
      mobs: optionsRef.current.mobsVolume,
      ambient: optionsRef.current.ambientVolume,
      ui: optionsRef.current.uiVolume,
    });
    soundRef.current = sound;

    const initialVd = isSoftwareGl ? Math.min(optionsRef.current.viewDistance, 4) : optionsRef.current.viewDistance;
    const wm = new WorldManager({
      seed: 202604,
      viewDistance: initialVd,
      gameMode: 'survival',
      scene,
    });
    wm.world.chunkMesher.setGraphicsMode(optionsRef.current.graphics);
    wm.world.chunkMesher.setShadowsEnabled(optionsRef.current.shadows);
    wm.initWorld(202604, { x: 8, z: 8 });
    worldManagerRef.current = wm;

    // Auto-restore active 1.21 resource pack from IndexedDB if user imported one
    let cancelled = false;
    resourcePackManager
      .getActivePack()
      .then(async (activePack) => {
        if (cancelled || !activePack) return;
        await wm.world.textureAtlas.applyResourcePack(activePack.assets.blockTextures);
        await wm.itemRegistry.applyResourcePackIcons(activePack.assets.itemIcons);
        await mobSkins.applyResourcePackSkins(activePack.assets.entitySkins);
        await sound.loadSoundPack(activePack.assets.sounds);
        packVersionRef.current += 1;
        hand.clearTextureCache();
        if (!cancelled) {
          setActivePackName(activePack.name);
          setModalRevision((r) => r + 1);
          setHud(buildHudSnapshot(wm));
        }
      })
      .catch(() => {
        // Ignore IndexedDB pack load failure
      });

    // Wire Backend Engine Events -> Audio, Particles, XP Orbs, Chat
    const unsubs = [
      wm.bus.on(ENGINE_EVENTS.BLOCK_BROKEN, (ev: any) => {
        sound.playBlockBreak(ev.soundGroup || 'stone');
        particles.spawnBlockBreak(ev.x, ev.y, ev.z, getBlockParticleColor(ev.blockId), 16);
        if (ev.xpDrop > 0 && wm.gameMode === 'survival') {
          xpOrbs.spawnXp(ev.x + 0.5, ev.y + 0.5, ev.z + 0.5, ev.xpDrop);
        }
      }),
      wm.bus.on(ENGINE_EVENTS.BLOCK_PLACED, (ev: any) => {
        sound.playBlockPlace(ev.soundGroup || 'stone');
      }),
      wm.bus.on(ENGINE_EVENTS.ENTITY_KILLED, (ev: any) => {
        if (ev.xpValue > 0 && ev.position) {
          xpOrbs.spawnXp(ev.position.x, ev.position.y + 0.6, ev.position.z, ev.xpValue);
        }
      }),
      wm.bus.on(ENGINE_EVENTS.EXPLOSION, (ev: any) => {
        sound.playExplosion();
        particles.spawnExplosion(ev.position.x, ev.position.y, ev.position.z);
      }),
      wm.bus.on(ENGINE_EVENTS.TNT_PRIMED, () => sound.playFuse()),
      wm.bus.on(ENGINE_EVENTS.CREEPER_FUSE, () => sound.playFuse()),
      wm.bus.on(ENGINE_EVENTS.DOOR_TOGGLED, () => sound.playDoor()),
      wm.bus.on(ENGINE_EVENTS.BOW_SHOT, () => sound.playBowRelease()),
      wm.bus.on(ENGINE_EVENTS.PORTAL_LIT, (ev: any) => {
        sound.playFlintAndSteel();
        if (ev) particles.spawnPortalParticles(ev.x + 0.5, ev.y + 1, ev.z + 0.5, 22);
      }),
      wm.bus.on(ENGINE_EVENTS.ENDERMAN_TELEPORT, (ev: any) => {
        sound.playEndermanTeleport();
        if (ev?.from) particles.spawnEndermanParticles(ev.from.x, ev.from.y, ev.from.z, 18);
        if (ev?.to) particles.spawnEndermanParticles(ev.to.x, ev.to.y, ev.to.z, 18);
      }),
      wm.bus.on(ENGINE_EVENTS.SHEEP_SHEARED, () => {
        sound.playShear();
      }),
      wm.bus.on(ENGINE_EVENTS.DIMENSION_CHANGED, (ev: any) => {
        const dim = ev?.dimension === 'end' ? 'end' : ev?.dimension === 'nether' ? 'nether' : 'overworld';
        skyWeather.setDimension(dim);
        xpOrbs.clear();
        clearSignSprites();
        // Rebuild signs present in this dimension
        for (const ent of wm.blockEntities.entities.values()) {
          if (ent.type === 'sign') updateSignSprite(ent.x, ent.y, ent.z, ent.lines);
        }
        sound.playPortalTravel();
        pushChat(
          'System',
          dim === 'end'
            ? 'Entered The End! Destroy the Obsidian Pillar Crystals and defeat the Ender Dragon!'
            : dim === 'nether'
            ? 'Entered The Nether. Watch out for Blazes, lava & Piglins!'
            : 'Returned to The Overworld.',
          'system'
        );
      }),
      wm.bus.on(ENGINE_EVENTS.SIGN_UPDATED, (ev: any) => {
        if (ev) updateSignSprite(ev.x, ev.y, ev.z, ev.lines || []);
      }),
      wm.bus.on(ENGINE_EVENTS.ADVANCEMENT_UNLOCKED, (ev: any) => {
        if (!ev) return;
        sound.playLevelUp();
        const iconUrl = ev.iconItem
          ? wm.itemRegistry.getItemIconUrl(ev.iconItem, wm.world.textureAtlas) || undefined
          : undefined;
        setAdvancementToast({
          title: ev.title,
          description: ev.description,
          xpReward: ev.xpReward || 0,
          iconUrl,
        });
        if (advToastTimerRef.current) window.clearTimeout(advToastTimerRef.current);
        advToastTimerRef.current = window.setTimeout(() => setAdvancementToast(null), 4600);
        pushChat('Advancement', `Unlocked "${ev.title}" — ${ev.description} (+${ev.xpReward} XP)`, 'system');
      }),
      wm.bus.on(ENGINE_EVENTS.DRAGON_DEFEATED, () => {
        sound.playExplosion();
        sound.playLevelUp();
        particles.spawnExplosion(0, 62, 0);
        pushChat(
          'System',
          'You defeated the Ender Dragon! Claim the Dragon Egg at (0, 60, 0) or leap into the End Exit Portal!',
          'system'
        );
      }),
      wm.bus.on(ENGINE_EVENTS.END_CRYSTAL_DESTROYED, (ev: any) => {
        sound.playExplosion();
        if (ev) particles.spawnExplosion(ev.x, ev.y, ev.z);
        pushChat('System', `End Crystal destroyed! (${ev?.remaining ?? 0} remaining)`, 'system');
      }),
      wm.bus.on(ENGINE_EVENTS.SHIELD_BLOCKED, () => {
        sound.playHit();
      }),
      wm.bus.on(ENGINE_EVENTS.POTION_DRUNK, () => {
        sound.playSplash();
      }),
      wm.bus.on(ENGINE_EVENTS.FISH_CAUGHT, () => {
        sound.playSplash();
        sound.playXpPickup();
      }),
      wm.bus.on(ENGINE_EVENTS.TOOL_BROKEN, (ev: any) => {
        sound.playToolBreak();
        pushChat('System', `Your ${ev.itemId.replace(/_/g, ' ')} broke!`, 'system');
      }),
      wm.bus.on(ENGINE_EVENTS.PLAYER_DAMAGED, () => {
        sound.playHurt();
        hurtFlashRef.current = 1.0;
      }),
      wm.bus.on(ENGINE_EVENTS.PLAYER_SLEPT, () => {
        pushChat('System', 'Good morning! Respawn point set.', 'system');
      }),
      wm.bus.on(ENGINE_EVENTS.MP_CHAT, (msg: any) => {
        pushChat(msg.senderName || msg.name || 'Player', msg.text || '', 'chat');
      }),
      wm.bus.on(ENGINE_EVENTS.MP_CONNECTED, (info: any) => {
        pushChat('Multiplayer', `Connected to room "${info.roomId}".`, 'system');
      }),
      wm.bus.on(ENGINE_EVENTS.MP_CONNECTION_FAILED, (info: any) => {
        pushChat(
          'Multiplayer',
          `Could not join "${info.roomId}" after ${info.attempts} attempt(s) (${info.reason || 'connection closed'}). Check that the multiplayer server is running and its WebSocket URL is configured.`,
          'error'
        );
      }),
      wm.bus.on(ENGINE_EVENTS.INVENTORY_CHANGED, () => {
        setModalRevision((r) => r + 1);
      }),
    ];

    const unsubBlockEnts = wm.blockEntities.onChange(() => {
      if (
        modalRef.current?.type === 'furnace' ||
        modalRef.current?.type === 'chest' ||
        workstationModalRef.current?.type === 'brewing_stand'
      ) {
        setModalRevision((r) => r + 1);
      }
    });

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      pointerLockedRef.current = locked;
      if (!locked) {
        mouseDownLeftRef.current = false;
        mouseDownRightRef.current = false;
        miningRef.current.active = false;
        eatingRef.current.active = false;
        bowChargeRef.current = 0;
        wm.setShieldBlocking(false);
      }
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    const handleMouseMove = (e: MouseEvent) => {
      if (!pointerLockedRef.current || screenRef.current !== 'playing') return;
      if (modalRef.current || workstationModalRef.current || chatOpenRef.current) return;
      const sens = 0.0022 * optionsRef.current.mouseSensitivity;
      const ySign = optionsRef.current.invertY ? 1 : -1;
      wm.player.rotate(-e.movementX * sens, e.movementY * sens * ySign);
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleMouseDown = (e: MouseEvent) => {
      if (
        screenRef.current !== 'playing' ||
        modalRef.current ||
        workstationModalRef.current ||
        chatOpenRef.current
      ) {
        return;
      }
      sound.unlock();
      if (!pointerLockedRef.current) {
        if (e.target === renderer.domElement) {
          requestLock();
        }
        return;
      }
      if (wm.gameMode === 'survival' && wm.survival.isDead) return;

      if (e.button === 0) {
        mouseDownLeftRef.current = true;
        hand.triggerSwing();
        localAvatar.triggerSwing();

        const eye = wm.player.getEyePosition();
        const fwd = wm.player.getForwardVector();
        const bossHit = wm.entities.raycastBoss?.(eye, fwd, 6.5) || { hit: false };
        const boatHit = wm.entities.raycastBoat?.(eye, fwd, 4.5) || { hit: false };
        const entityHit = wm.entities.raycastEntity(eye, fwd, 4.5);
        const blockHit = wm.world.raycast(eye, fwd, 6);
        const blockDist =
          blockHit.hit && blockHit.position
            ? Math.hypot(
                blockHit.position.x + 0.5 - eye.x,
                blockHit.position.y + 0.5 - eye.y,
                blockHit.position.z + 0.5 - eye.z
              )
            : Infinity;

        if (
          bossHit.hit ||
          boatHit.hit ||
          (entityHit.hit && entityHit.entity && entityHit.distance <= blockDist)
        ) {
          const res = wm.interactPrimaryAction();
          if (res.action === 'attack' || res.action === 'attack_boss') {
            sound.playHit();
            if (res.position) {
              particles.spawnHitSparks(res.position.x, res.position.y + 0.9, res.position.z, 0xff5252, 12);
            }
          } else if (res.action === 'pickup_boat') {
            sound.playBlockBreak('wood');
            pushChat('System', 'Picked up Oak Boat.', 'system');
          }
          return;
        }

        if (blockHit.hit && blockHit.position) {
          const { x, y, z } = blockHit.position;
          const bId = wm.world.getBlock(x, y, z);
          const dur = wm.getBreakDuration(bId);
          if (dur === 0) {
            wm.interactBreakBlock(x, y, z, { enforceToolTier: false });
          } else if (Number.isFinite(dur)) {
            miningRef.current = {
              active: true,
              x,
              y,
              z,
              blockId: bId,
              elapsed: 0,
              duration: dur,
              tickSoundTimer: 0,
            };
          }
        }
      } else if (e.button === 1) {
        e.preventDefault();
        const hit = wm.world.raycast(wm.player.getEyePosition(), wm.player.getForwardVector(), 6);
        if (hit.hit && hit.position) {
          const bId = wm.world.getBlock(hit.position.x, hit.position.y, hit.position.z);
          const pickedItemId = wm.itemRegistry.getItemIdForBlock(bId);
          const itemDef = pickedItemId ? wm.itemRegistry.get(pickedItemId) : null;
          if (itemDef) {
            if (wm.gameMode === 'creative') {
              wm.inventory.setSlot(wm.inventory.selectedSlot, { itemId: itemDef.id, count: 64 });
              flashHeldLabel();
            } else {
              for (let i = 0; i < 9; i++) {
                if (wm.inventory.getSlot(i)?.itemId === itemDef.id) {
                  wm.inventory.setSelectedSlot(i);
                  flashHeldLabel();
                  break;
                }
              }
            }
          }
        }
      } else if (e.button === 2) {
        mouseDownRightRef.current = true;
        const selected = wm.inventory.getSelectedStack();
        const selDef = selected ? wm.itemRegistry.get(selected.itemId) : null;

        // 0. Try entity interaction FIRST (Boat board/dismount, Villager Trade, Wolf Tame/Sit/Heal, Sheep Shear)
        const entUse = wm.interactUseEntity?.();
        if (entUse?.handled) {
          if (entUse.action === 'villager_trade' && typeof entUse.entityId === 'number') {
            releaseLock();
            setWorkstationModal({
              type: 'villager',
              entityId: entUse.entityId,
              profession: entUse.profession || 'farmer',
            });
            return;
          }
          hand.triggerSwing();
          localAvatar.triggerSwing();
          if (entUse.message) pushChat('System', entUse.message, 'system');
          return;
        }

        // Start drawing bow if holding a bow
        if (selected?.itemId === 'bow') {
          bowChargeRef.current = 0.05;
          return;
        }

        // Raise Shield directly if holding shield in main hand
        if (selected?.itemId === 'shield') {
          wm.setShieldBlocking(true);
          return;
        }

        const hit = wm.world.raycast(wm.player.getEyePosition(), wm.player.getForwardVector(), 6);
        // 1. Try block interaction (Workstations, Signs, Redstone, End Portal Frame, Campfire, Bed, Door, TNT)
        if (hit.hit && hit.position) {
          const useRes = wm.interactUseBlock(hit.position.x, hit.position.y, hit.position.z);
          if (useRes.type === 'crafting_table') {
            releaseLock();
            setModal({ type: 'crafting_table' });
            return;
          }
          if (useRes.type === 'furnace') {
            releaseLock();
            setModal({ type: 'furnace', x: useRes.x!, y: useRes.y!, z: useRes.z! });
            return;
          }
          if (useRes.type === 'chest') {
            releaseLock();
            setModal({ type: 'chest', x: useRes.x!, y: useRes.y!, z: useRes.z! });
            return;
          }
          if (
            useRes.type === 'enchanting_table' ||
            useRes.type === 'anvil' ||
            useRes.type === 'brewing_stand' ||
            useRes.type === 'sign'
          ) {
            releaseLock();
            setWorkstationModal({ type: useRes.type, x: useRes.x!, y: useRes.y!, z: useRes.z! });
            return;
          }
          if (
            useRes.type === 'bed' ||
            useRes.type === 'door' ||
            useRes.type === 'tnt' ||
            useRes.type === 'lever' ||
            useRes.type === 'button' ||
            useRes.type === 'end_portal_frame' ||
            useRes.type === 'campfire'
          ) {
            hand.triggerSwing();
            localAvatar.triggerSwing();
            if (useRes.type === 'lever' || useRes.type === 'button') sound.playUiClick();
            else if (useRes.type === 'campfire') sound.playEat();
            else if (useRes.type === 'end_portal_frame') sound.playXpPickup();
            if (useRes.message) pushChat('System', useRes.message, 'system');
            return;
          }
        }

        // 2a. Tactile Hold-to-Eat for Food items (1.1s chomp cycle)
        if (
          selDef &&
          (selDef.category as string) === ITEM_CATEGORIES.FOOD &&
          (wm.gameMode === 'creative' || wm.survival.hunger < wm.survival.maxHunger)
        ) {
          eatingRef.current = {
            active: true,
            itemId: selDef.id,
            elapsed: 0,
            duration: 1.1,
            chompTimer: 0.16,
          };
          sound.playEatChomp();
          return;
        }

        // 2b. Try special held item (Armor, Potions, Fishing Rod, Eye of Ender, Boat, Bottle, Flint & Steel, Hoe, Seeds, Buckets)
        const itemRes = wm.useSelectedToolOrItem(hit);
        if (itemRes.used) {
          hand.triggerSwing();
          localAvatar.triggerSwing();
          if (itemRes.action === 'eat') sound.playEat();
          else if (
            itemRes.action === 'scoop_fluid' ||
            itemRes.action === 'pour_fluid' ||
            itemRes.action === 'fill_bottle' ||
            itemRes.action === 'fish_cast'
          ) {
            sound.playSplash();
          } else if (itemRes.action === 'till' || itemRes.action === 'plant') {
            sound.playBlockPlace('dirt');
          } else if (itemRes.action === 'ignite_tnt' || itemRes.action === 'light_portal') {
            sound.playFlintAndSteel();
          } else if (itemRes.action === 'eye_thrown') {
            sound.playEndermanTeleport();
          } else if (itemRes.action === 'place_boat') {
            sound.playBlockPlace('wood');
          }
          if (itemRes.message) pushChat('System', itemRes.message, 'system');
          return;
        }

        // 3. Place block
        if (hit.hit && hit.adjacent && selDef && selDef.blockId !== null) {
          const now = performance.now();
          if (now - lastPlaceAtRef.current > 110) {
            if (wm.interactPlaceSelectedBlock(hit.adjacent.x, hit.adjacent.y, hit.adjacent.z)) {
              lastPlaceAtRef.current = now;
              hand.triggerSwing();
              localAvatar.triggerSwing();
              return;
            }
          }
        }

        // 4. Offhand Shield Block fallback if player carries a Shield in hotbar
        if (wm.inventory.hasShield()) {
          wm.setShieldBlocking(true);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseDownLeftRef.current = false;
        miningRef.current.active = false;
      } else if (e.button === 2) {
        mouseDownRightRef.current = false;
        eatingRef.current.active = false;
        wm.setShieldBlocking(false);
        if (bowChargeRef.current > 0.04) {
          const charge = bowChargeRef.current;
          bowChargeRef.current = 0;
          const res = wm.firePlayerBow(charge);
          if (!res.fired && res.reason) {
            pushChat('System', res.reason, 'error');
          } else if (res.fired) {
            hand.triggerSwing();
            localAvatar.triggerSwing();
          }
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (screenRef.current === 'playing' && !modalRef.current && !workstationModalRef.current) {
        e.preventDefault();
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (
        screenRef.current !== 'playing' ||
        modalRef.current ||
        workstationModalRef.current ||
        chatOpenRef.current
      ) {
        return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = (wm.inventory.selectedSlot + dir + 9) % 9;
      wm.inventory.setSelectedSlot(next);
      eatingRef.current.active = false;
      flashHeldLabel();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (screenRef.current !== 'playing') return;

      const activeTag = document.activeElement?.tagName;
      if (chatOpenRef.current || activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        if (e.code === 'Escape' && workstationModalRef.current) {
          e.preventDefault();
          setWorkstationModal(null);
        }
        return;
      }

      if (e.code === 'F3') {
        e.preventDefault();
        f3KeyDownRef.current = true;
        setF3Open((prev) => !prev);
        return;
      }

      if (e.code === 'KeyG' && (f3KeyDownRef.current || e.altKey)) {
        e.preventDefault();
        const nextVal = !optionsRef.current.chunkBorders;
        handleUpdateOptions({ chunkBorders: nextVal });
        pushChat('Debug', `Chunk borders: ${nextVal ? 'shown' : 'hidden'}`, 'system');
        return;
      }

      if (e.code === 'F5') {
        e.preventDefault();
        const nextMode =
          cameraModeRef.current === 'first'
            ? 'third_back'
            : cameraModeRef.current === 'third_back'
            ? 'third_front'
            : 'first';
        cameraModeRef.current = nextMode;
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (workstationModalRef.current) {
          setWorkstationModal(null);
        } else if (modalRef.current) {
          setModal(null);
        } else {
          releaseLock();
          setModal({ type: 'pause' });
        }
        return;
      }

      if (e.code === 'KeyE') {
        e.preventDefault();
        if (workstationModalRef.current) {
          setWorkstationModal(null);
        } else if (modalRef.current) {
          setModal(null);
        } else {
          releaseLock();
          setModal({ type: 'inventory' });
        }
        return;
      }

      if (e.code === 'KeyL') {
        e.preventDefault();
        if (workstationModalRef.current?.type === 'advancements') {
          setWorkstationModal(null);
        } else if (!modalRef.current) {
          releaseLock();
          setWorkstationModal({ type: 'advancements' });
        }
        return;
      }

      if (modalRef.current || workstationModalRef.current) return;

      if (e.code === 'KeyT' || e.key === '/') {
        e.preventDefault();
        releaseLock();
        setChatDraft(e.key === '/' ? '/' : '');
        setChatOpen(true);
        return;
      }

      if (e.code === 'KeyQ') {
        e.preventDefault();
        if (wm.dropSelectedItem()) {
          hand.triggerSwing();
        }
        return;
      }

      if (e.code === 'KeyF' && wm.gameMode === 'creative') {
        wm.player.setFlyMode(!wm.player.flyMode);
        pushChat('System', `Flight ${wm.player.flyMode ? 'enabled' : 'disabled'}.`, 'system');
        return;
      }

      if (e.code.startsWith('Digit')) {
        const digit = Number(e.code.slice(5));
        if (digit >= 1 && digit <= 9) {
          wm.inventory.setSelectedSlot(digit - 1);
          eatingRef.current.active = false;
          flashHeldLabel();
        }
      }

      keysRef.current[e.code] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        f3KeyDownRef.current = false;
      }
      keysRef.current[e.code] = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    let running = true;
    let rafId = 0;
    let timerId = 0;
    let lastTime = performance.now();
    let panoramaAngle = 0;
    let hudSyncAccum = 0;
    let f3SyncAccum = 0;
    let fpsSmooth = 60;
    const frameHistory: number[] = [];

    const dayColor = new THREE.Color(0x88bfff);
    const duskColor = new THREE.Color(0xe68452);
    const nightColor = new THREE.Color(0x0b1224);
    const rainTint = new THREE.Color(0x5d6e82);
    const thunderTint = new THREE.Color(0x313c4b);
    const waterFogColor = new THREE.Color(0x164a94);
    const lavaFogColor = new THREE.Color(0xa63308);
    const netherFogColor = new THREE.Color(0x2e0b0b);
    const endFogColor = new THREE.Color(0x090414);
    const tmpSky = new THREE.Color();

    let lastCrackStage = 0;
    let lastHeldItemId: string | null = null;
    let lastHeldIconUrl: string | null = null;
    let lastPackVersion = -1;

    const afterSoftwareDraw = (cb: () => void) => {
      const gl2 = renderer.getContext() as WebGL2RenderingContext;
      const sync = typeof gl2.fenceSync === 'function' ? gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (!sync) {
        timerId = window.setTimeout(cb, 80);
        return;
      }
      gl2.flush();
      const poll = () => {
        if (!running) {
          gl2.deleteSync(sync);
          return;
        }
        const state = gl2.getSyncParameter(sync, gl2.SYNC_STATUS);
        if (state === gl2.UNSIGNALED) {
          timerId = window.setTimeout(poll, 5);
        } else {
          gl2.deleteSync(sync);
          timerId = window.setTimeout(cb, 80);
        }
      };
      timerId = window.setTimeout(poll, 5);
    };

    const scheduleNext = () => {
      if (!running) return;
      if (isSoftwareGl) {
        afterSoftwareDraw(tick);
      } else {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (!running) return;
      const now = performance.now();
      const rawDt = Math.max(0.001, (now - lastTime) / 1000);
      const dt = Math.min(rawDt, 0.05);
      lastTime = now;

      const frameMs = rawDt * 1000;
      fpsSmooth = fpsSmooth * 0.9 + (1000 / Math.max(1, frameMs)) * 0.1;
      frameHistory.push(frameMs);
      if (frameHistory.length > 60) frameHistory.shift();

      if (hurtFlashRef.current > 0) {
        hurtFlashRef.current = Math.max(0, hurtFlashRef.current - dt * 2.8);
      }
      if (portalCooldownRef.current > 0) {
        portalCooldownRef.current = Math.max(0, portalCooldownRef.current - dt);
      }

      const inTitle = screenRef.current === 'title';
      const pausedModal = modalRef.current?.type === 'pause' || modalRef.current?.type === 'options';
      wm.engine.paused = !inTitle && pausedModal;

      if (inTitle) {
        panoramaAngle += dt * 0.14;
        const focus = wm.player.getPosition();
        const camX = focus.x + Math.cos(panoramaAngle) * 26;
        const camZ = focus.z + Math.sin(panoramaAngle) * 26;
        const camY = Math.max(focus.y + 14, 78);
        camera.position.set(camX, camY, camZ);
        camera.lookAt(focus.x, focus.y + 2, focus.z);
        hand.root.visible = false;
        localAvatar.root.visible = false;
        fishLine.visible = false;
        targetOutline.visible = false;
        crackMesh.visible = false;
        wm.world.update({ x: focus.x, y: focus.y, z: focus.z }, dt * 0.35);
        wm.entities.update(dt, wm.player, wm.survival, 'creative');
      } else {
        const keys = keysRef.current;
        const inputBlocked =
          Boolean(modalRef.current) ||
          Boolean(workstationModalRef.current) ||
          chatOpenRef.current ||
          !pointerLockedRef.current;
        const isSprinting = Boolean(keys['ControlLeft'] || keys['ControlRight']) && Boolean(keys['KeyW'] || keys['ArrowUp']);
        const playerInput = inputBlocked
          ? {}
          : {
              forward: Boolean(keys['KeyW'] || keys['ArrowUp']),
              backward: Boolean(keys['KeyS'] || keys['ArrowDown']),
              left: Boolean(keys['KeyA'] || keys['ArrowLeft']),
              right: Boolean(keys['KeyD'] || keys['ArrowRight']),
              jump: Boolean(keys['Space']),
              sneak: Boolean(keys['ShiftLeft'] || keys['ShiftRight']),
              sprint: isSprinting,
            };

        wm.update(dt, playerInput);

        const pPos = wm.player.getPosition();
        const speedHoriz = Math.hypot(wm.player.velocity.x, wm.player.velocity.z);
        const isMovingGrounded = wm.player.isGrounded() && speedHoriz > 0.6 && !inputBlocked;

        // Footstep SFX while moving on ground
        if (wm.player.isGrounded() && speedHoriz > 1.8 && !inputBlocked && !wm.entities.getMountedBoat?.()) {
          const underId = wm.world.getBlock(Math.floor(pPos.x), Math.floor(pPos.y - 0.2), Math.floor(pPos.z));
          const underDef = wm.world.blockRegistry.getById(underId);
          sound.playStep(underDef?.soundGroup || 'grass');
        }

        // XP Orb Simulation & Magnetic Pickup
        const pickedXp = xpOrbs.update(dt, pPos, (bx, by, bz) => wm.world.isSolidAt(bx, by, bz));
        if (pickedXp > 0) {
          const res = wm.awardXp(pickedXp);
          sound.playXpPickup();
          if (res?.leveledUp) {
            sound.playLevelUp();
          }
        }

        // Camera Positioning (3-Mode F5: First / Third-Back / Third-Front with Wall Pull-In) + View Bobbing
        const eye = wm.player.getEyePosition();
        const rot = wm.player.getRotation();
        const camMode = cameraModeRef.current;

        if (camMode !== 'first') {
          const fwd = wm.player.getForwardVector();
          const sign = camMode === 'third_back' ? -1 : 1;
          const dirX = fwd.x * sign;
          const dirY = fwd.y * sign + 0.12;
          const dirZ = fwd.z * sign;
          const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
          const nx = dirX / dirLen;
          const ny = dirY / dirLen;
          const nz = dirZ / dirLen;

          let camDist = 4.2;
          const wallHit = wm.world.raycast(eye, { x: nx, y: ny, z: nz }, camDist);
          if (wallHit.hit && wallHit.position) {
            const hitDist = Math.hypot(
              wallHit.position.x + 0.5 - eye.x,
              wallHit.position.y + 0.5 - eye.y,
              wallHit.position.z + 0.5 - eye.z
            );
            camDist = Math.max(0.85, Math.min(camDist, hitDist - 0.65));
          }

          camera.position.set(eye.x + nx * camDist, eye.y + ny * camDist, eye.z + nz * camDist);
          camera.lookAt(eye.x, eye.y - 0.15, eye.z);
          hand.root.visible = false;
          localAvatar.root.visible = !wm.survival.isDead;
        } else {
          camera.rotation.order = 'YXZ';
          camera.rotation.y = rot.yaw;
          camera.rotation.x = rot.pitch;
          camera.rotation.z = 0;

          let bobY = 0;
          let bobSide = 0;
          if (optionsRef.current.viewBobbing && !prefersReducedMotion && isMovingGrounded) {
            bobPhaseRef.current += dt * Math.min(14, speedHoriz * 2.1);
            bobY = Math.abs(Math.sin(bobPhaseRef.current)) * 0.055;
            bobSide = Math.cos(bobPhaseRef.current) * 0.032;
          } else {
            bobPhaseRef.current = 0;
          }
          const rightX = Math.cos(rot.yaw);
          const rightZ = -Math.sin(rot.yaw);
          camera.position.set(eye.x + rightX * bobSide, eye.y + bobY, eye.z + rightZ * bobSide);
          hand.root.visible = !wm.survival.isDead;
          localAvatar.root.visible = false;
        }

        // Bow Charge, Hold-to-Eat & Smooth Sprint + Bow FOV Zoom
        const selectedStack = wm.inventory.getSelectedStack();
        if (mouseDownRightRef.current && selectedStack?.itemId === 'bow' && pointerLockedRef.current) {
          bowChargeRef.current = Math.min(1, bowChargeRef.current + dt / 0.85);
        } else if (bowChargeRef.current > 0 && !mouseDownRightRef.current) {
          bowChargeRef.current = 0;
        }

        const eating = eatingRef.current;
        if (
          eating.active &&
          mouseDownRightRef.current &&
          pointerLockedRef.current &&
          selectedStack?.itemId === eating.itemId
        ) {
          eating.elapsed += dt;
          eating.chompTimer += dt;
          if (eating.chompTimer >= 0.24) {
            eating.chompTimer = 0;
            sound.playEatChomp();
            const fwd = wm.player.getForwardVector();
            particles.spawnFoodCrumbs(
              eye.x + fwd.x * 0.65,
              eye.y - 0.16 + fwd.y * 0.5,
              eye.z + fwd.z * 0.65,
              0xd4944e,
              5
            );
          }
          if (eating.elapsed >= eating.duration) {
            eating.active = false;
            const ate = wm.consumeSelectedFood();
            if (ate.consumed) {
              sound.playEat();
            }
          }
        } else {
          eating.active = false;
        }

        const sprintFovBoost = !inputBlocked && isSprinting && speedHoriz > 2.2 ? 10 : 0;
        const targetFov = optionsRef.current.fov + sprintFovBoost - bowChargeRef.current * 14;
        if (Math.abs(camera.fov - targetFov) > 0.08) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
          camera.updateProjectionMatrix();
        }

        // Nether Portal Dwell Transition (2.2s inside NETHER_PORTAL block)
        const bodyBlock = wm.world.getBlock(Math.floor(pPos.x), Math.floor(pPos.y + 0.7), Math.floor(pPos.z));
        if (bodyBlock === BLOCK_IDS.NETHER_PORTAL && portalCooldownRef.current <= 0 && !wm.survival.isDead) {
          portalProgressRef.current = Math.min(1, portalProgressRef.current + dt / 2.2);
          if (Math.random() < 0.35) {
            particles.spawnPortalParticles(pPos.x, pPos.y + 1.0, pPos.z, 2);
          }
          if (portalProgressRef.current >= 1) {
            portalProgressRef.current = 0;
            portalCooldownRef.current = 3.2;
            const targetDim = wm.world.dimension === 'nether' ? 'overworld' : 'nether';
            wm.switchDimension(targetDim);
          }
        } else {
          portalProgressRef.current = Math.max(0, portalProgressRef.current - dt * 1.8);
        }

        // Enderman Stare Aggro Check (throttled ~7 Hz in Survival)
        if (wm.gameMode === 'survival' && !wm.survival.isDead && !inputBlocked) {
          stareCheckAccumRef.current += dt;
          if (stareCheckAccumRef.current >= 0.15) {
            stareCheckAccumRef.current = 0;
            wm.entities.checkEndermanStare(eye, wm.player.getForwardVector());
          }
        }

        // Raycast Targeted Block & Progressive Hold-to-Mine
        const hit = wm.world.raycast(eye, wm.player.getForwardVector(), 6);
        if (hit.hit && hit.position) {
          targetOutline.visible = true;
          targetOutline.position.set(hit.position.x + 0.5, hit.position.y + 0.5, hit.position.z + 0.5);
        } else {
          targetOutline.visible = false;
        }

        const mining = miningRef.current;
        if (
          mouseDownLeftRef.current &&
          pointerLockedRef.current &&
          hit.hit &&
          hit.position &&
          !modalRef.current &&
          !workstationModalRef.current
        ) {
          const { x, y, z } = hit.position;
          const bId = wm.world.getBlock(x, y, z);
          const dur = wm.getBreakDuration(bId);
          if (dur === 0) {
            wm.interactBreakBlock(x, y, z, { enforceToolTier: false });
            mining.active = false;
          } else if (Number.isFinite(dur)) {
            if (!mining.active || mining.x !== x || mining.y !== y || mining.z !== z || mining.blockId !== bId) {
              mining.active = true;
              mining.x = x;
              mining.y = y;
              mining.z = z;
              mining.blockId = bId;
              mining.elapsed = 0;
              mining.duration = dur;
              mining.tickSoundTimer = 0;
            }
            mining.elapsed += dt;
            mining.tickSoundTimer += dt;
            if (mining.tickSoundTimer >= 0.18) {
              mining.tickSoundTimer = 0;
              const bDef = wm.world.blockRegistry.getById(bId);
              sound.playMineTick(bDef?.soundGroup || 'stone');
              particles.spawnBlockBreak(x, y, z, getBlockParticleColor(bId), 3);
            }
            const progress = Math.min(0.999, mining.elapsed / mining.duration);
            const stage = Math.min(9, Math.floor(progress * 10));
            crackMesh.visible = true;
            crackMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            if (stage !== lastCrackStage) {
              lastCrackStage = stage;
              crackMat.map = crackTextures[stage];
            }

            if (mining.elapsed >= mining.duration) {
              wm.interactBreakBlock(x, y, z, { enforceToolTier: true });
              mining.active = false;
              crackMesh.visible = false;
            }
          } else {
            mining.active = false;
            crackMesh.visible = false;
          }
        } else {
          mining.active = false;
          crackMesh.visible = false;
        }

        // Update 3D First-Person Hand Viewmodel, Local F5 Avatar, and 3D Fishing Line
        const heldItemId = selectedStack?.itemId ?? null;
        if (heldItemId !== lastHeldItemId || packVersionRef.current !== lastPackVersion) {
          lastHeldItemId = heldItemId;
          lastPackVersion = packVersionRef.current;
          lastHeldIconUrl = heldItemId
            ? wm.itemRegistry.getItemIconUrl(heldItemId, wm.world.textureAtlas)
            : null;
        }
        const heldDef = heldItemId ? wm.itemRegistry.get(heldItemId) : null;
        const hasShield = wm.inventory.hasShield();
        const isShieldBlocking = Boolean(wm.survival.shieldBlocking);
        hand.setHeldItem(heldItemId, Boolean(heldDef && heldDef.blockId !== null), lastHeldIconUrl);
        hand.update(
          dt,
          isMovingGrounded,
          mining.active,
          bowChargeRef.current,
          eating.active ? Math.min(1, eating.elapsed / eating.duration) : 0,
          hasShield,
          isShieldBlocking
        );

        // Update 3D Local Player Avatar (visible in F5 Third-Person Back & Front)
        if (localAvatar.root.visible) {
          localAvatar.setArmor(wm.inventory.getArmorIds());
          localAvatar.setHeldItem(heldItemId, wm.itemRegistry);
          localAvatar.update(dt, {
            x: pPos.x,
            y: pPos.y,
            z: pPos.z,
            yaw: rot.yaw,
            pitch: rot.pitch,
            speed: speedHoriz,
            sneaking: Boolean(playerInput.sneak),
            swinging: mining.active,
            shielding: isShieldBlocking,
            hasShield,
            inWater: wm.world.isLiquidAt(Math.floor(pPos.x), Math.floor(pPos.y + 0.5), Math.floor(pPos.z)),
            ridingBoat: Boolean(wm.entities.getMountedBoat?.()),
          });
        }

        // Update 3D Fishing Line when bobber is cast
        const fishState = wm.entities.getFishingState?.();
        if (fishState && fishState.position) {
          const rightX = Math.cos(rot.yaw);
          const rightZ = -Math.sin(rot.yaw);
          const fwd = wm.player.getForwardVector();
          const linePos = fishLineGeo.attributes.position as THREE.BufferAttribute;
          linePos.setXYZ(0, eye.x + rightX * 0.35 + fwd.x * 0.55, eye.y - 0.25 + fwd.y * 0.4, eye.z + rightZ * 0.35 + fwd.z * 0.55);
          linePos.setXYZ(1, fishState.position.x, fishState.position.y + 0.08, fishState.position.z);
          linePos.needsUpdate = true;
          fishLine.visible = true;
        } else {
          fishLine.visible = false;
        }

        chunkBorders.update(pPos.x, pPos.z);
      }

      // Dynamic Sky, Fog, Nether Crimson, The End Void Atmosphere & Weather
      const isNether = wm.world.dimension === 'nether';
      const isEnd = wm.world.dimension === 'end';
      const hasNightVision = Boolean(wm.survival.hasEffect?.('night_vision'));
      const skyBright = wm.world.getSkyBrightness();
      const tod = wm.world.getTimeOfDay();
      const sunElev = Math.sin(tod * Math.PI * 2);
      const isTwilight = Math.abs(sunElev) < 0.22;

      if (isEnd) {
        tmpSky.copy(endFogColor);
      } else if (isNether) {
        tmpSky.copy(netherFogColor);
      } else {
        if (skyBright > 0.55) {
          tmpSky.copy(dayColor);
        } else if (isTwilight) {
          tmpSky.copy(duskColor).lerp(dayColor, Math.max(0, (skyBright - 0.35) / 0.25));
        } else {
          tmpSky.copy(nightColor).lerp(duskColor, Math.max(0, (skyBright - 0.16) / 0.25));
        }
        if (wm.weather === 'thunder') {
          tmpSky.lerp(thunderTint, 0.72);
        } else if (wm.weather === 'rain') {
          tmpSky.lerp(rainTint, 0.55);
        }
      }

      const eyePos = wm.player.getEyePosition();
      const eyeBlock = !inTitle
        ? wm.world.getBlock(Math.floor(eyePos.x), Math.floor(eyePos.y), Math.floor(eyePos.z))
        : BLOCK_IDS.AIR;

      if (eyeBlock === BLOCK_IDS.WATER) {
        scene.background = waterFogColor;
        (scene.fog as THREE.Fog).color.copy(waterFogColor);
        (scene.fog as THREE.Fog).near = 2;
        (scene.fog as THREE.Fog).far = 22;
      } else if (eyeBlock === BLOCK_IDS.LAVA) {
        scene.background = lavaFogColor;
        (scene.fog as THREE.Fog).color.copy(lavaFogColor);
        (scene.fog as THREE.Fog).near = 0.5;
        (scene.fog as THREE.Fog).far = 8;
      } else if (isEnd) {
        scene.background = endFogColor;
        (scene.fog as THREE.Fog).color.copy(endFogColor);
        (scene.fog as THREE.Fog).near = 26;
        (scene.fog as THREE.Fog).far = Math.max(72, wm.world.viewDistance * 18);
      } else if (isNether) {
        scene.background = netherFogColor;
        (scene.fog as THREE.Fog).color.copy(netherFogColor);
        (scene.fog as THREE.Fog).near = 14;
        (scene.fog as THREE.Fog).far = Math.max(36, wm.world.viewDistance * 13);
      } else {
        scene.background = tmpSky;
        (scene.fog as THREE.Fog).color.copy(tmpSky);
        const maxDist = Math.max(40, wm.world.viewDistance * 16);
        const wetFactor = wm.weather === 'thunder' ? 0.26 : wm.weather === 'rain' ? 0.32 : 0.5;
        const farFactor = wm.weather === 'thunder' ? 0.74 : wm.weather === 'rain' ? 0.85 : 1.08;
        (scene.fog as THREE.Fog).near = maxDist * wetFactor;
        (scene.fog as THREE.Fog).far = maxDist * farFactor;
      }

      if (isEnd) {
        sunLight.color.setHex(0xd8b4fe);
        sunLight.intensity = hasNightVision ? 1.15 : 0.68;
        hemiLight.color.setHex(0xc084fc);
        hemiLight.groundColor.setHex(0x2e1065);
        hemiLight.intensity = hasNightVision ? 1.25 : 0.82;
      } else if (isNether) {
        sunLight.color.setHex(0xff8a65);
        sunLight.intensity = hasNightVision ? 1.0 : 0.52;
        hemiLight.color.setHex(0xb84a39);
        hemiLight.groundColor.setHex(0x3a1414);
        hemiLight.intensity = hasNightVision ? 1.2 : 0.75;
      } else {
        sunLight.color.setHex(0xfff7e2);
        hemiLight.color.setHex(0xd9ecff);
        hemiLight.groundColor.setHex(0x4c5840);
        const weatherLightScale = wm.weather === 'thunder' ? 0.3 : wm.weather === 'rain' ? 0.45 : 0.85;
        sunLight.intensity = (hasNightVision ? 0.95 : 0.25) + skyBright * weatherLightScale;
        hemiLight.intensity = (hasNightVision ? 1.05 : 0.3) + skyBright * 0.65;
      }

      const sunAngle = tod * Math.PI * 2;
      sunLight.position.set(
        camera.position.x + Math.cos(sunAngle) * 80,
        camera.position.y + Math.max(15, Math.sin(sunAngle) * 80),
        camera.position.z + 25
      );

      const pPos = wm.player.getPosition();
      const biomeObj = isEnd
        ? { id: 'the_end' }
        : isNether
        ? { id: 'nether_wastes' }
        : wm.world.terrainGenerator.biomeGenerator.getBiome(Math.floor(pPos.x), Math.floor(pPos.z));
      const biome = biomeObj?.id ?? 'plains';
      const isColdBiome = !isNether && !isEnd && (biome === 'snowy_taiga' || (biome === 'mountains' && pPos.y > 74));
      skyWeather.setDimension(isEnd ? 'end' : isNether ? 'nether' : 'overworld');
      skyWeather.update(dt, inTitle ? camera.position : pPos, tod, skyBright, wm.weather, isColdBiome);
      particles.update(dt);

      renderer.render(scene, camera);

      hudSyncAccum += dt;
      if (!inTitle && hudSyncAccum >= 0.1) {
        hudSyncAccum = 0;
        setHud(buildHudSnapshot(wm));
      }

      f3SyncAccum += dt;
      if (!inTitle && f3OpenRef.current && f3SyncAccum >= 0.25) {
        f3SyncAccum = 0;
        const pos = wm.player.getPosition();
        const rot = wm.player.getRotation();
        const light = wm.world.getLight(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z));
        const hit = wm.world.raycast(wm.player.getEyePosition(), wm.player.getForwardVector(), 6);
        let targetBlock: F3Telemetry['targetBlock'] = null;
        if (hit.hit && hit.position) {
          const tid = wm.world.getBlock(hit.position.x, hit.position.y, hit.position.z);
          const tdef = wm.world.blockRegistry.getById(tid);
          targetBlock = {
            name: tdef?.name ?? 'Unknown',
            id: tid,
            x: hit.position.x,
            y: hit.position.y,
            z: hit.position.z,
            hardness: tdef?.hardness ?? 0,
            fluidLevel: wm.world.getFluidLevel(hit.position.x, hit.position.y, hit.position.z),
          };
        }

        const streamStats = wm.world.chunkManager.getStreamingProgress(pos.x, pos.z);
        setF3Data({
          fps: Math.round(fpsSmooth),
          frameTimeMs: frameMs,
          frameHistory: [...frameHistory],
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          loadedChunks: wm.world.chunkManager.chunks.size,
          dirtyChunks: streamStats.dirtyChunks,
          workerPending: wm.world.chunkManager._inFlightSignatures?.size ?? 0,
          renderDistance: wm.world.viewDistance,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          yawDeg: (rot.yaw * 180) / Math.PI,
          pitchDeg: (rot.pitch * 180) / Math.PI,
          facingLabel: getFacingLabel(rot.yaw),
          biome,
          dimension: wm.world.dimension,
          graphicsMode: optionsRef.current.graphics === 'fancy' ? 'Fancy' : 'Fast',
          activePackName: activePackNameRef.current || 'Default Procedural',
          skyLight: light.sky,
          blockLight: light.block,
          timeOfDay: tod,
          weather:
            wm.weather === 'thunder'
              ? 'thunder'
              : wm.weather === 'rain'
              ? isColdBiome
                ? 'snow'
                : 'rain'
              : 'clear',
          mobsCount: wm.entities.entities.length,
          arrowsCount: wm.entities.arrows.length,
          dropsCount: wm.itemDrops.drops.length,
          particlesCount: particles.activeCount,
          seed: wm.world.seed,
          gameMode: wm.gameMode,
          chunkBorders: optionsRef.current.chunkBorders,
          gpuRenderer,
          softwareGl: isSoftwareGl,
          targetBlock,
        });
      }

      scheduleNext();
    };

    scheduleNext();

    return () => {
      cancelled = true;
      running = false;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      unsubs.forEach((fn) => fn());
      unsubBlockEnts();

      outlineGeo.dispose();
      outlineMat.dispose();
      crackMesh.geometry.dispose();
      crackMat.dispose();
      crackTextures.forEach((t: THREE.Texture) => t.dispose());
      fishLineGeo.dispose();
      fishLineMat.dispose();
      clearSignSprites();
      localAvatar.dispose();
      hand.dispose();
      skyWeather.dispose();
      particles.dispose();
      xpOrbs.dispose();
      chunkBorders.dispose();
      sound.dispose();
      envTarget.dispose();
      wm.dispose();
      renderer.dispose();
    };
  }, [buildHudSnapshot, flashHeldLabel, handleUpdateOptions, pushChat, releaseLock, requestLock]);

  const handlePlayNewWorld = useCallback(
    async (name: string, seed: string, gameMode: 'survival' | 'creative') => {
      const wm = worldManagerRef.current;
      if (!wm) return;
      soundRef.current?.unlock();
      xpOrbsRef.current?.clear();
      portalProgressRef.current = 0;
      wm.setGameMode(gameMode);
      wm.inventory.loadStarterKit();
      wm.initWorld(seed, { x: 8, z: 8 });
      skyRef.current?.setDimension('overworld');
      setCurrentSlotName(name);
      setModal(null);
      setScreen('playing');
      setHud(buildHudSnapshot(wm));
      pushChat('System', `Created "${name}" (Seed: ${wm.world.seed}, ${gameMode}). Type /help for commands.`, 'system');
      try {
        await wm.saveAsync(name);
        refreshSavedWorlds();
      } catch {
        // ignore save error on initial create
      }
    },
    [buildHudSnapshot, pushChat, refreshSavedWorlds]
  );

  const handleLoadWorld = useCallback(
    async (slotName: string) => {
      const wm = worldManagerRef.current;
      if (!wm) return;
      soundRef.current?.unlock();
      xpOrbsRef.current?.clear();
      portalProgressRef.current = 0;
      try {
        const loaded = await wm.loadAsync(slotName);
        if (loaded) {
          skyRef.current?.setDimension(
            wm.world.dimension === 'end' ? 'end' : wm.world.dimension === 'nether' ? 'nether' : 'overworld'
          );
          setCurrentSlotName(slotName);
          setModal(null);
          setWorkstationModal(null);
          setScreen('playing');
          setHud(buildHudSnapshot(wm));
          pushChat('System', `Loaded world "${slotName}".`, 'system');
        } else {
          pushChat('System', `Could not find saved world "${slotName}".`, 'error');
        }
      } catch {
        pushChat('System', `Failed to load world "${slotName}".`, 'error');
      }
    },
    [buildHudSnapshot, pushChat]
  );

  const handleDeleteWorld = useCallback(
    async (slotName: string) => {
      try {
        await WorldSave.deleteSaveAsync(slotName);
      } catch {
        // Ignore storage errors on delete
      }
      refreshSavedWorlds();
    },
    [refreshSavedWorlds]
  );

  const handleImportWorldJson = useCallback(
    async (jsonText: string) => {
      const wm = worldManagerRef.current;
      if (!wm) return;
      xpOrbsRef.current?.clear();
      portalProgressRef.current = 0;
      try {
        wm.importWorldJSON(jsonText);
        skyRef.current?.setDimension(
          wm.world.dimension === 'end' ? 'end' : wm.world.dimension === 'nether' ? 'nether' : 'overworld'
        );
        const name = `Imported-${Math.floor(100 + Math.random() * 900)}`;
        setCurrentSlotName(name);
        setModal(null);
        setWorkstationModal(null);
        setScreen('playing');
        setHud(buildHudSnapshot(wm));
        try {
          await wm.saveAsync(name);
          refreshSavedWorlds();
        } catch {
          // ignore storage quota errors
        }
        pushChat('System', `Imported world as "${name}".`, 'system');
      } catch {
        pushChat('System', 'Failed to import JSON save file.', 'error');
      }
    },
    [buildHudSnapshot, pushChat, refreshSavedWorlds]
  );

  const handleTestMultiplayerServer = useCallback(async (serverAddress: string) => {
    try {
      const serverUrl = normalizeWebSocketUrl(serverAddress, window.location.href);
      return await MultiplayerClient.testServerConnection(serverUrl);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not validate the multiplayer server address.',
      };
    }
  }, []);

  const handleJoinMultiplayer = useCallback(
    (roomId: string, playerName: string, serverAddress: string) => {
      const wm = worldManagerRef.current;
      if (!wm) return;
      let wsUrl: string;
      try {
        wsUrl = normalizeWebSocketUrl(serverAddress, window.location.href);
      } catch (error) {
        pushChat('Multiplayer', error instanceof Error ? error.message : 'Invalid server address.', 'error');
        return;
      }
      const normalizedRoomId = normalizeRoomId(roomId);
      soundRef.current?.unlock();
      xpOrbsRef.current?.clear();
      portalProgressRef.current = 0;
      wm.setGameMode('survival');
      wm.inventory.loadStarterKit();
      wm.initWorld(1337, { x: 8, z: 8 });
      skyRef.current?.setDimension('overworld');
      wm.network.connect({ url: wsUrl, roomId: normalizedRoomId, playerName });
      setCurrentSlotName(`MP:${normalizedRoomId}`);
      setModal(null);
      setScreen('playing');
      setHud(buildHudSnapshot(wm));
      pushChat('Multiplayer', `Joining room "${normalizedRoomId}" as ${playerName}...`, 'system');
    },
    [buildHudSnapshot, pushChat]
  );

  const handleSaveWorld = useCallback(async () => {
    const wm = worldManagerRef.current;
    if (!wm) return;
    try {
      await wm.saveAsync(currentSlotRef.current);
      refreshSavedWorlds();
      pushChat('System', `Saved world "${currentSlotRef.current}".`, 'system');
    } catch {
      pushChat('System', 'Unable to save world.', 'error');
    }
  }, [pushChat, refreshSavedWorlds]);

  const handleExportJson = useCallback(() => {
    const wm = worldManagerRef.current;
    if (!wm) return;
    const json = wm.exportWorldJSON(currentSlotRef.current);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSlotRef.current.replace(/[^a-z0-9_-]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushChat('System', 'Exported world save JSON.', 'system');
  }, [pushChat]);

  const handleSaveAndQuit = useCallback(async () => {
    const wm = worldManagerRef.current;
    if (wm) {
      try {
        if (!currentSlotRef.current.startsWith('MP:')) {
          await wm.saveAsync(currentSlotRef.current);
        }
      } catch {
        // ignore
      }
      wm.network?.disconnect();
    }
    releaseLock();
    setModal(null);
    setWorkstationModal(null);
    setChatOpen(false);
    setScreen('title');
    refreshSavedWorlds();
  }, [refreshSavedWorlds, releaseLock]);

  const handleSubmitChat = useCallback(() => {
    const wm = worldManagerRef.current;
    const text = chatDraft.trim();
    setChatDraft('');
    setChatOpen(false);
    if (!text || !wm) return;

    if (text.startsWith('/')) {
      const res = wm.executeSlashCommand(text);
      pushChat('Command', res.message, res.ok ? 'system' : 'error');
      setHud(buildHudSnapshot(wm));
    } else if (wm.network?.status === 'connected') {
      wm.network.sendChat(text);
    } else {
      pushChat('You', text, 'chat');
    }
  }, [buildHudSnapshot, chatDraft, pushChat]);

  const playUiClick = useCallback(() => {
    soundRef.current?.unlock();
    soundRef.current?.playUiClick();
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* Live WebGL2 3D Viewport */}
      <div ref={mountRef} className="w-full h-full" />

      {/* WebGL Context Lost Recovery Banner */}
      {webglLost && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="mc-panel-dark p-6 max-w-sm text-center flex flex-col gap-3">
            <h2 className="text-lg font-bold text-amber-300 mc-text-shadow">Graphics Context Interrupted</h2>
            <p className="text-xs text-neutral-300">
              Your browser temporarily paused the WebGL2 renderer. Reload to restore your session safely.
            </p>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => window.location.reload()}
            >
              Reload Viewport
            </button>
          </div>
        </div>
      )}

      {/* Title Screen Overlay */}
      {screen === 'title' && (
        <TitleScreen
          worlds={worlds}
          options={options}
          activePackName={activePackName}
          onUpdateOptions={handleUpdateOptions}
          onApplyResourcePack={handleApplyResourcePack}
          onPlayNewWorld={handlePlayNewWorld}
          onLoadWorld={handleLoadWorld}
          onDeleteWorld={handleDeleteWorld}
          onImportWorldJson={handleImportWorldJson}
          onJoinMultiplayer={handleJoinMultiplayer}
          onTestMultiplayerServer={handleTestMultiplayerServer}
          onUiClick={playUiClick}
        />
      )}

      {/* Playing HUD + F3 Debug + Classic Stone Modals */}
      {screen === 'playing' && (
        <>
          <ClassicHud
            hud={hud}
            showHeldLabel={showHeldLabel}
            advancementToast={advancementToast}
            chatMessages={chatMessages}
            chatOpen={chatOpen}
            chatDraft={chatDraft}
            onChatDraftChange={setChatDraft}
            onSubmitChat={handleSubmitChat}
            onCloseChat={() => setChatOpen(false)}
            onSelectHotbar={(idx) => {
              worldManagerRef.current?.inventory.setSelectedSlot(idx);
              eatingRef.current.active = false;
              flashHeldLabel();
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
            }}
            onRespawn={() => {
              playUiClick();
              worldManagerRef.current?.respawnPlayer();
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
              requestLock();
            }}
            onQuitToTitle={() => {
              playUiClick();
              handleSaveAndQuit();
            }}
            onRequestResume={requestLock}
          />

          {f3Open && <F3DebugOverlay data={f3Data} />}

          <ContainerModals
            modal={modal}
            worldManager={worldManagerRef.current}
            revision={modalRevision}
            options={options}
            activePackName={activePackName}
            currentSlotName={currentSlotName}
            onUpdateOptions={handleUpdateOptions}
            onApplyResourcePack={handleApplyResourcePack}
            onRefresh={() => {
              setModalRevision((r) => r + 1);
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
            }}
            onClose={() => {
              setModal(null);
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
            }}
            onOpenOptions={() => setModal({ type: 'options' })}
            onSaveWorld={handleSaveWorld}
            onExportJson={handleExportJson}
            onSaveAndQuit={handleSaveAndQuit}
            onUiClick={playUiClick}
          />

          <WorkstationModals
            modal={workstationModal}
            worldManager={worldManagerRef.current}
            revision={modalRevision}
            onRefresh={() => {
              setModalRevision((r) => r + 1);
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
            }}
            onClose={() => {
              setWorkstationModal(null);
              if (worldManagerRef.current) setHud(buildHudSnapshot(worldManagerRef.current));
            }}
            onUiClick={playUiClick}
            onNotify={(msg) => pushChat('System', msg, 'system')}
          />
        </>
      )}
    </div>
  );
}
