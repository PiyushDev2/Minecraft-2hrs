/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Backpack,
  Compass,
  Dices,
  Download,
  Droplets,
  Flame,
  Hammer,
  Heart,
  Layers,
  MessageSquare,
  Moon,
  RefreshCw,
  Save,
  Settings2,
  Skull,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import {
  BLOCK_IDS,
  MOB_TYPES,
  WorldManager,
  WorldSave,
  blockRegistry,
} from './backend/index.js';

interface HudSnapshot {
  x: number;
  y: number;
  z: number;
  biome: string;
  grounded: boolean;
  inWater: boolean;
  flyMode: boolean;
  gameMode: 'creative' | 'survival';
  loadedChunks: number;
  loadedInRadius: number;
  targetChunks: number;
  dirtyChunks: number;
  seed: number;
  targetBlock: string | null;
  targetBlockId: number | null;
  targetMob: string | null;
  pointerLocked: boolean;
  skyLight: number;
  blockLight: number;
  timeLabel: string;
  activeDrops: number;
  entityCount: number;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  air: number;
  maxAir: number;
  isDead: boolean;
  hurtFlash: boolean;
  lastDamageSource: string | null;
}

interface SlotView {
  itemId: string;
  name: string;
  count: number;
  iconUrl: string | null;
  hexColor: string;
  category: string;
}

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  iconUrl: string | null;
  hexColor: string;
  blockId: number | null;
}

interface SavedSlotMeta {
  slotName: string;
  seed: number;
  savedAt: string;
  totalModifiedBlocks: number;
  gameMode?: string;
  byteSize?: number;
}

interface ChatEntry {
  id: string;
  senderId: string;
  senderName: string;
  color: number;
  text: string;
  timestamp: number;
}

const DEFAULT_SEED = 'alpine-valley-2026';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldManager | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const modalOpenRef = useRef<boolean>(false);

  const [slots, setSlots] = useState<Array<SlotView | null>>(new Array(36).fill(null));
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [gameMode, setGameMode] = useState<'creative' | 'survival'>('creative');

  const [activeModal, setActiveModal] = useState<'none' | 'inventory' | 'world' | 'multiplayer'>('none');
  const [craftingTableMode, setCraftingTableMode] = useState<boolean>(false);
  const [craftGrid, setCraftGrid] = useState<Array<string | null>>(new Array(9).fill(null));
  const [pickedInventoryIdx, setPickedInventoryIdx] = useState<number | null>(null);
  const [invTab, setInvTab] = useState<'craft' | 'catalog'>('craft');

  const [seedInput, setSeedInput] = useState<string>(DEFAULT_SEED);
  const [viewDistance, setViewDistance] = useState<number>(5);
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [invRevision, setInvRevision] = useState<number>(0);

  const [saveSlotInput, setSaveSlotInput] = useState<string>('default');
  const [savedSlots, setSavedSlots] = useState<SavedSlotMeta[]>([]);

  const [mpRoomInput, setMpRoomInput] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || 'public-valley';
    } catch {
      return 'public-valley';
    }
  });
  const [mpNameInput, setMpNameInput] = useState<string>('Explorer');
  const [mpStatus, setMpStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mpPeers, setMpPeers] = useState<Array<{ id: string; name: string; color: number; x: number; y: number; z: number }>>([]);
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState<string>('');

  const [hud, setHud] = useState<HudSnapshot>({
    x: 8,
    y: 42,
    z: 8,
    biome: 'Plains',
    grounded: false,
    inWater: false,
    flyMode: false,
    gameMode: 'creative',
    loadedChunks: 0,
    loadedInRadius: 0,
    targetChunks: 0,
    dirtyChunks: 0,
    seed: 0,
    targetBlock: null,
    targetBlockId: null,
    targetMob: null,
    pointerLocked: false,
    skyLight: 15,
    blockLight: 0,
    timeLabel: 'Day',
    activeDrops: 0,
    entityCount: 0,
    health: 20,
    maxHealth: 20,
    hunger: 20,
    maxHunger: 20,
    air: 10,
    maxAir: 10,
    isDead: false,
    hurtFlash: false,
    lastDamageSource: null,
  });

  useEffect(() => {
    modalOpenRef.current = activeModal !== 'none';
    if (activeModal !== 'none' && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }, [activeModal]);

  const formatTimeLabel = (t: number) => {
    const wrapped = ((t % 1) + 1) % 1;
    if (wrapped < 0.12 || wrapped >= 0.88) return 'Dawn';
    if (wrapped < 0.42) return 'Day';
    if (wrapped < 0.62) return 'Dusk';
    return 'Night';
  };

  const showNotice = (msg: string) => {
    setStatusNotice(msg);
    window.setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  const syncInventoryState = (engine: WorldManager) => {
    const nextSlots: Array<SlotView | null> = engine.inventory.slots.map((s) => {
      if (!s) return null;
      const def = engine.itemRegistry.get(s.itemId);
      return {
        itemId: s.itemId,
        name: def?.name ?? s.itemId,
        count: s.count,
        iconUrl: engine.itemRegistry.getItemIconUrl(s.itemId, engine.world.textureAtlas),
        hexColor: `#${(def?.color ?? 0xffffff).toString(16).padStart(6, '0')}`,
        category: def?.category ?? 'block',
      };
    });
    setSlots(nextSlots);
    setSelectedSlot(engine.inventory.selectedSlot);
    setGameMode(engine.gameMode);
    setInvRevision((r) => r + 1);
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Detect software WebGL (SwiftShader / llvmpipe) to pace render cost gracefully
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Initialize Three.js Renderer, Scene & Camera
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const daySkyColor = new THREE.Color(0x9bc7f0);
    const duskSkyColor = new THREE.Color(0xd9896c);
    const nightSkyColor = new THREE.Color(0x0b1222);
    const currentSkyColor = daySkyColor.clone();

    const scene = new THREE.Scene();
    scene.background = currentSkyColor;
    const fog = new THREE.FogExp2(0x9bc7f0, 0.0085);
    scene.fog = fog;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.1,
      400
    );
    camera.rotation.order = 'YXZ';

    const hemiLight = new THREE.HemisphereLight(0xcbe5ff, 0x546848, 0.85);
    hemiLight.position.set(0, 120, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
    sunLight.position.set(60, 110, 45);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 260;
    const shadowBound = 68;
    sunLight.shadow.camera.left = -shadowBound;
    sunLight.shadow.camera.right = shadowBound;
    sunLight.shadow.camera.top = shadowBound;
    sunLight.shadow.camera.bottom = -shadowBound;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.025;
    scene.add(sunLight);
    scene.add(sunLight.target);
    sunLightRef.current = sunLight;

    // 3. Initialize Backend WorldManager & bind to Three.js Scene
    const engine = new WorldManager({
      seed: DEFAULT_SEED,
      viewDistance: 5,
      gameMode: 'creative',
      scene,
    });
    engine.initWorld(DEFAULT_SEED, { x: 8, z: 8 });
    engineRef.current = engine;

    // Populate item catalog with procedural swatches
    const allItems: CatalogItem[] = engine.itemRegistry.getAll().map((def) => ({
      id: def.id,
      name: def.name,
      category: def.category,
      blockId: def.blockId,
      iconUrl: engine.itemRegistry.getItemIconUrl(def.id, engine.world.textureAtlas),
      hexColor: `#${def.color.toString(16).padStart(6, '0')}`,
    }));
    setCatalog(allItems);
    syncInventoryState(engine);

    const unsubInv = engine.inventory.onChange(() => syncInventoryState(engine));
    const unsubPickup = engine.bus.on('inventory:picked_up', (picked: Array<{ itemId: string; count: number }>) => {
      if (picked.length > 0) {
        const def = engine.itemRegistry.get(picked[0].itemId);
        showNotice(`+${picked[0].count} ${def?.name ?? picked[0].itemId}`);
      }
    });
    const unsubMpConn = engine.bus.on('mp:connected', (ev: { roomId: string }) => {
      setMpStatus('connected');
      setMpPeers(engine.network.getPeers());
      showNotice(`Joined room "${ev.roomId}"`);
    });
    const unsubMpDisc = engine.bus.on('mp:disconnected', () => {
      setMpStatus('disconnected');
      setMpPeers([]);
    });
    const unsubMpJoin = engine.bus.on('mp:player_joined', (p: { name: string }) => {
      setMpPeers(engine.network.getPeers());
      showNotice(`${p.name} joined the world`);
    });
    const unsubMpLeave = engine.bus.on('mp:player_left', (p: { name: string }) => {
      setMpPeers(engine.network.getPeers());
      showNotice(`${p.name} left the world`);
    });
    const unsubMpChat = engine.bus.on('mp:chat', () => {
      setChatLog([...engine.network.chatLog]);
    });

    WorldSave.listSavesAsync().then((list) => setSavedSlots(list)).catch(() => {});

    // 4. Target block selection wireframe indicator
    const highlightGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    const highlightMat = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.8,
    });
    const highlightBox = new THREE.LineSegments(highlightGeo, highlightMat);
    highlightBox.visible = false;
    scene.add(highlightBox);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 5. Input & Pointer Controls
    let isDraggingLook = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let didDrag = false;
    let hudSyncTimer = 0;
    let contextLost = false;

    const handleBreakAction = () => {
      const res = engine.interactPrimaryAction();
      if (res.action === 'attack' && res.killed) {
        showNotice(`Defeated ${res.mobType}`);
      }
    };

    const handlePlaceOrUseAction = () => {
      const eatRes = engine.consumeSelectedFood();
      if (eatRes.consumed) {
        syncInventoryState(engine);
        showNotice(`Ate food · Hunger ${eatRes.hunger}/20`);
        return;
      }

      const hit = engine.world.raycast(
        engine.player.getEyePosition(),
        engine.player.getForwardVector(),
        6
      );
      if (hit.hit && hit.blockId === BLOCK_IDS.CRAFTING_TABLE && !keysRef.current.ShiftLeft) {
        setCraftingTableMode(true);
        setInvTab('craft');
        setActiveModal('inventory');
        return;
      }
      if (hit.hit && hit.adjacent) {
        engine.interactPlaceSelectedBlock(hit.adjacent.x, hit.adjacent.y, hit.adjacent.z);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        return;
      }

      if (e.code === 'Escape') {
        if (modalOpenRef.current) {
          setActiveModal('none');
          setPickedInventoryIdx(null);
        }
        return;
      }

      if (e.code === 'KeyI') {
        e.preventDefault();
        setCraftingTableMode(false);
        setActiveModal((prev) => (prev === 'inventory' ? 'none' : 'inventory'));
        setPickedInventoryIdx(null);
        return;
      }

      if (e.code === 'KeyO') {
        e.preventDefault();
        setActiveModal((prev) => (prev === 'world' ? 'none' : 'world'));
        return;
      }

      if (e.code === 'KeyP') {
        e.preventDefault();
        setActiveModal((prev) => (prev === 'multiplayer' ? 'none' : 'multiplayer'));
        return;
      }

      if (modalOpenRef.current) return;

      keysRef.current[e.code] = true;

      if (e.code === 'KeyF') {
        engine.player.setFlyMode(!engine.player.flyMode);
      } else if (e.code === 'KeyH') {
        setHudCollapsed((v) => !v);
      } else if (e.code === 'KeyT') {
        const nextPhase = (Math.floor(((engine.world.getTimeOfDay() + 0.05) % 1) * 4) + 1) % 4;
        engine.setTimeOfDay(nextPhase * 0.25);
      } else if (e.code === 'KeyB') {
        setInvTab('catalog');
        setActiveModal('inventory');
      } else if (e.code === 'KeyM') {
        const nextMode = engine.gameMode === 'creative' ? 'survival' : 'creative';
        engine.setGameMode(nextMode);
        syncInventoryState(engine);
        showNotice(`Switched to ${nextMode === 'creative' ? 'Creative' : 'Survival'} mode`);
      } else if (e.code === 'KeyX') {
        handleBreakAction();
      } else if (e.code === 'KeyE') {
        handlePlaceOrUseAction();
      } else if (e.code.startsWith('Digit')) {
        const rawDigit = Number(e.code.replace('Digit', ''));
        if (rawDigit >= 1 && rawDigit <= 9) {
          engine.inventory.setSelectedSlot(rawDigit - 1);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== renderer.domElement || modalOpenRef.current) return;
      if (document.pointerLockElement === renderer.domElement) {
        if (e.button === 0) handleBreakAction();
        else if (e.button === 2) handlePlaceOrUseAction();
      } else {
        if (e.button === 0) {
          isDraggingLook = true;
          didDrag = false;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;
        } else if (e.button === 2) {
          handlePlaceOrUseAction();
        }
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (e.target !== renderer.domElement || modalOpenRef.current) return;
      renderer.domElement.requestPointerLock?.();
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isDraggingLook && e.button === 0 && !didDrag && !modalOpenRef.current) {
        // Short click without dragging breaks the targeted block immediately
        handleBreakAction();
      }
      isDraggingLook = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (modalOpenRef.current) return;
      if (document.pointerLockElement === renderer.domElement) {
        engine.player.rotate(-e.movementX * 0.0022, -e.movementY * 0.0022);
      } else if (isDraggingLook) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 4) {
          didDrag = true;
        }
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        engine.player.rotate(-dx * 0.004, -dy * 0.004);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      if (e.target === renderer.domElement) {
        e.preventDefault();
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (modalOpenRef.current) return;
      const next = (engine.inventory.selectedSlot + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      engine.inventory.setSelectedSlot(next);
    };

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };

    const onContextRestored = () => {
      contextLost = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // 6. Main Simulation & Render Loop
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const keys = keysRef.current;
      const controlsActive = !modalOpenRef.current;

      engine.update(delta, {
        forward: controlsActive && Boolean(keys.KeyW || keys.ArrowUp),
        backward: controlsActive && Boolean(keys.KeyS || keys.ArrowDown),
        left: controlsActive && Boolean(keys.KeyA || keys.ArrowLeft),
        right: controlsActive && Boolean(keys.KeyD || keys.ArrowRight),
        jump: controlsActive && Boolean(keys.Space),
        sprint: controlsActive && Boolean(keys.ShiftLeft || keys.ShiftRight),
        sneak: controlsActive && Boolean(keys.ControlLeft || keys.KeyC),
      });

      const eye = engine.player.getEyePosition();
      const rot = engine.player.getRotation();
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.y = rot.yaw;
      camera.rotation.x = rot.pitch;

      const pos = engine.player.getPosition();
      const skyBright = engine.world.getSkyBrightness();
      const tod = engine.world.getTimeOfDay();
      const dayBlend = Math.max(0, Math.min(1, (skyBright - 0.16) / 0.84));
      const horizonFactor = Math.max(0, 1 - Math.abs(Math.sin(tod * Math.PI * 2)) * 3.2);

      currentSkyColor.copy(nightSkyColor).lerp(daySkyColor, dayBlend);
      if (horizonFactor > 0.01) {
        currentSkyColor.lerp(duskSkyColor, horizonFactor * 0.45);
      }
      fog.color.copy(currentSkyColor);
      hemiLight.intensity = 0.2 + 0.65 * dayBlend;
      scene.environmentIntensity = 0.08 + 0.27 * dayBlend;

      if (sunLightRef.current) {
        const sunAngle = tod * Math.PI * 2;
        const sunX = Math.cos(sunAngle) * 75;
        const sunY = Math.max(12, Math.sin(sunAngle) * 110);
        sunLightRef.current.position.set(pos.x + sunX, sunY, pos.z + 40);
        sunLightRef.current.target.position.set(pos.x, 36, pos.z);
        sunLightRef.current.intensity = 0.12 + 1.73 * dayBlend;
      }

      const forwardVec = engine.player.getForwardVector();
      const entityHit = engine.entities.raycastEntity(eye, forwardVec, 4.5);
      const hit = engine.world.raycast(eye, forwardVec, 6);
      const blockHitDist =
        hit.hit && hit.position
          ? Math.hypot(
              hit.position.x + 0.5 - eye.x,
              hit.position.y + 0.5 - eye.y,
              hit.position.z + 0.5 - eye.z
            )
          : Infinity;
      const showMobTarget = Boolean(
        entityHit.hit && entityHit.entity && entityHit.distance <= blockHitDist
      );

      if (!showMobTarget && hit.hit && hit.position) {
        highlightBox.visible = true;
        highlightBox.position.set(
          hit.position.x + 0.5,
          hit.position.y + 0.5,
          hit.position.z + 0.5
        );
      } else {
        highlightBox.visible = false;
      }

      if (!contextLost) {
        renderer.render(scene, camera);
      }

      hudSyncTimer += delta;
      if (hudSyncTimer >= 0.1) {
        hudSyncTimer = 0;
        const stats = engine.world.getStats(pos);
        const biome = engine.world.getBiomeAt(pos.x, pos.z);
        const playerLight = engine.world.getLight(eye.x, eye.y, eye.z);
        const hitBlockDef =
          !showMobTarget && hit.hit && hit.blockId !== undefined
            ? blockRegistry.getById(hit.blockId)
            : null;
        const targetMobLabel =
          showMobTarget && entityHit.entity
            ? `${entityHit.entity.def.name} (${entityHit.entity.health}/${entityHit.entity.maxHealth})`
            : null;

        setHud({
          x: Number(pos.x.toFixed(1)),
          y: Number(pos.y.toFixed(1)),
          z: Number(pos.z.toFixed(1)),
          biome: biome.name,
          grounded: engine.player.isGrounded(),
          inWater: engine.player.isInWater(),
          flyMode: engine.player.flyMode,
          gameMode: engine.gameMode,
          loadedChunks: stats.loadedChunks,
          loadedInRadius: stats.streaming?.loadedInRadius ?? stats.loadedChunks,
          targetChunks: stats.streaming?.targetChunks ?? stats.loadedChunks,
          dirtyChunks: stats.streaming?.dirtyChunks ?? 0,
          seed: stats.seed,
          targetBlock: hitBlockDef?.name ?? null,
          targetBlockId: hitBlockDef?.id ?? null,
          targetMob: targetMobLabel,
          pointerLocked: document.pointerLockElement === renderer.domElement,
          skyLight: playerLight.sky,
          blockLight: playerLight.block,
          timeLabel: formatTimeLabel(stats.timeOfDay),
          activeDrops: engine.itemDrops.drops.length,
          entityCount: engine.entities.entities.length,
          health: engine.survival.health,
          maxHealth: engine.survival.maxHealth,
          hunger: engine.survival.hunger,
          maxHunger: engine.survival.maxHunger,
          air: Math.ceil(engine.survival.air),
          maxAir: engine.survival.maxAir,
          isDead: engine.survival.isDead && engine.gameMode === 'survival',
          hurtFlash: engine.survival.hurtFlashTimer > 0 && engine.gameMode === 'survival',
          lastDamageSource: engine.survival.lastDamageSource,
        });
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      unsubInv();
      unsubPickup();
      unsubMpConn();
      unsubMpDisc();
      unsubMpJoin();
      unsubMpLeave();
      unsubMpChat();

      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      highlightGeo.dispose();
      highlightMat.dispose();
      engine.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const recipeBook = useMemo(() => {
    const engine = engineRef.current;
    if (!engine) return [];
    const maxGrid = craftingTableMode ? 3 : 2;
    return engine.crafting.getRecipeBook(engine.inventory, maxGrid);
  }, [craftingTableMode, activeModal, invRevision, gameMode]);

  const gridMatch = useMemo(() => {
    const engine = engineRef.current;
    if (!engine) return null;
    const size = craftingTableMode ? 3 : 2;
    const sliced = size === 3
      ? craftGrid
      : [craftGrid[0], craftGrid[1], craftGrid[3], craftGrid[4]];
    return engine.crafting.findMatchingRecipe(sliced, size);
  }, [craftGrid, craftingTableMode, invRevision]);

  const handleRegenerate = (customSeed?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const trimmed = (customSeed ?? seedInput).trim() || DEFAULT_SEED;
    setSeedInput(trimmed);
    engine.initWorld(trimmed, { x: 8, z: 8 });
    showNotice(`Generated world "${trimmed}"`);
  };

  const handleRandomSeed = () => {
    const randomWords = ['nordic', 'canyon', 'emerald', 'glacier', 'cedar', 'mesa', 'haven'];
    const word = randomWords[Math.floor(Math.random() * randomWords.length)];
    const num = Math.floor(100 + Math.random() * 900);
    const next = `${word}-${num}`;
    setSeedInput(next);
    handleRegenerate(next);
  };

  const handleViewDistance = (vd: number) => {
    setViewDistance(vd);
    engineRef.current?.world.setViewDistance(vd);
    showNotice(`Chunk view distance set to ${vd}`);
  };

  const handleToggleFly = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.player.setFlyMode(!engine.player.flyMode);
    setHud((prev) => ({ ...prev, flyMode: engine.player.flyMode }));
  };

  const handleSwitchGameMode = (mode: 'creative' | 'survival') => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setGameMode(mode);
    syncInventoryState(engine);
    showNotice(`Mode: ${mode === 'creative' ? 'Creative (Infinite)' : 'Survival (Drops & Crafting)'}`);
  };

  const refreshSavedSlots = async () => {
    try {
      const list = await WorldSave.listSavesAsync();
      setSavedSlots(list);
    } catch {
      // Ignore storage listing errors
    }
  };

  const handleSave = async (targetSlot?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const slot = (targetSlot ?? saveSlotInput).trim() || 'default';
    setSaveSlotInput(slot);
    const meta = await engine.saveAsync(slot);
    await refreshSavedSlots();
    showNotice(`Saved "${meta.slotName}" (${meta.totalModifiedBlocks} edited blocks)`);
  };

  const handleLoad = async (targetSlot?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const slot = (targetSlot ?? saveSlotInput).trim() || 'default';
    const ok = await engine.loadAsync(slot);
    if (ok) {
      setViewDistance(engine.world.viewDistance);
      syncInventoryState(engine);
      showNotice(`Loaded "${slot}"`);
    } else {
      showNotice(`No saved slot "${slot}"`);
    }
  };

  const handleDeleteSlot = async (slot: string) => {
    await WorldSave.deleteSaveAsync(slot);
    await refreshSavedSlots();
    showNotice(`Deleted "${slot}"`);
  };

  const handleExportWorldJson = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const slot = saveSlotInput.trim() || 'default';
    const json = engine.exportWorldJSON(slot);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voxelcraft-${slot}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice(`Exported "${slot}.json"`);
  };

  const handleImportWorldJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const engine = engineRef.current;
    e.target.value = '';
    if (!file || !engine) return;
    try {
      const text = await file.text();
      engine.importWorldJSON(text);
      setViewDistance(engine.world.viewDistance);
      syncInventoryState(engine);
      showNotice(`Imported "${file.name}"`);
    } catch {
      showNotice('Invalid world JSON file');
    }
  };

  const handleConnectMultiplayer = () => {
    const engine = engineRef.current;
    if (!engine) return;
    setMpStatus('connecting');
    try {
      engine.network.connect({
        roomId: mpRoomInput,
        playerName: mpNameInput,
      });
    } catch {
      setMpStatus('disconnected');
      showNotice('Failed to connect to multiplayer server');
    }
  };

  const handleDisconnectMultiplayer = () => {
    engineRef.current?.network.disconnect();
    setMpStatus('disconnected');
    setMpPeers([]);
    showNotice('Disconnected from room');
  };

  const handleSendChat = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.network.sendChat(chatInput)) {
      setChatInput('');
    }
  };

  const handleCycleTime = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const nextPhase = (Math.floor(((engine.world.getTimeOfDay() + 0.05) % 1) * 4) + 1) % 4;
    const nextTod = engine.setTimeOfDay(nextPhase * 0.25);
    engine.network.broadcastTimeOfDay(nextTod);
    const label = formatTimeLabel(nextTod);
    setHud((prev) => ({ ...prev, timeLabel: label }));
    showNotice(`Time: ${label}`);
  };

  const handleResetToSurface = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const p = engine.player.getPosition();
    const sy = engine.world.getSurfaceY(p.x, p.z);
    engine.player.setPosition(p.x, sy + 1.5, p.z);
    showNotice('Teleported to terrain surface');
  };

  const handleSlotClick = (idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (pickedInventoryIdx === null) {
      if (engine.inventory.getSlot(idx)) {
        setPickedInventoryIdx(idx);
      }
    } else {
      if (pickedInventoryIdx !== idx) {
        engine.inventory.moveOrSwap(pickedInventoryIdx, idx);
      }
      setPickedInventoryIdx(null);
    }
  };

  const handleCraftSlotClick = (gridIdx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (pickedInventoryIdx !== null) {
      const src = engine.inventory.getSlot(pickedInventoryIdx);
      if (src) {
        setCraftGrid((prev) => {
          const next = [...prev];
          next[gridIdx] = src.itemId;
          return next;
        });
      }
      setPickedInventoryIdx(null);
      return;
    }

    const selected = engine.inventory.getSelectedStack();
    setCraftGrid((prev) => {
      const next = [...prev];
      if (next[gridIdx]) {
        next[gridIdx] = null;
      } else if (selected) {
        next[gridIdx] = selected.itemId;
      }
      return next;
    });
  };

  const handleExecuteGridCraft = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const size = craftingTableMode ? 3 : 2;
    const sliced = size === 3
      ? craftGrid
      : [craftGrid[0], craftGrid[1], craftGrid[3], craftGrid[4]];
    const res = engine.crafting.craftFromGrid(sliced, size, engine.inventory);
    if (res.crafted && res.result) {
      const def = engine.itemRegistry.get(res.result.itemId);
      showNotice(`Crafted ${res.result.count}× ${def?.name ?? res.result.itemId}`);
      syncInventoryState(engine);
    } else {
      showNotice('Missing ingredients for recipe');
    }
  };

  const handleOneClickCraft = (recipeId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const res = engine.crafting.craftById(recipeId, engine.inventory);
    if (res.crafted && res.result) {
      const def = engine.itemRegistry.get(res.result.itemId);
      showNotice(`Crafted ${res.result.count}× ${def?.name ?? res.result.itemId}`);
      syncInventoryState(engine);
    }
  };

  const handleEquipCatalogItem = (itemId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.inventory.equipInSelectedSlot(itemId, 64);
    syncInventoryState(engine);
    const def = engine.itemRegistry.get(itemId);
    showNotice(`Equipped ${def?.name ?? itemId}`);
  };

  const handleSpawnMobInFront = (mobType: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const pos = engine.player.getPosition();
    const fwd = engine.player.getForwardVector();
    const wx = Math.floor(pos.x + fwd.x * 5);
    const wz = Math.floor(pos.z + fwd.z * 5);
    const sy = engine.world.getSurfaceY(wx, wz);
    const spawnY = Math.max(sy + 1.05, Math.floor(pos.y) + 0.5);
    const ent = engine.entities.spawnMob(mobType, wx + 0.5, spawnY, wz + 0.5);
    showNotice(`Spawned ${ent.def.name}`);
  };

  const handleRespawn = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.respawnPlayer();
    showNotice('Respawned on terrain surface');
  };

  const selectedView = slots[selectedSlot];
  const isStreamingChunks =
    hud.loadedInRadius < hud.targetChunks || hud.dirtyChunks > 0;
  const chunkProgressPct =
    hud.targetChunks > 0
      ? Math.min(
          100,
          Math.round(((hud.loadedInRadius - hud.dirtyChunks * 0.5) / hud.targetChunks) * 100)
        )
      : 100;

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Full-Viewport 3D WebGL Canvas */}
      <div ref={mountRef} className="h-full w-full cursor-crosshair" />

      {/* Hurt Vignette Flash */}
      {hud.hurtFlash && (
        <div className="pointer-events-none fixed inset-0 z-10 border-[12px] border-red-600/45 bg-red-600/15 transition-opacity duration-150" />
      )}

      {/* Top-Left Clean Floating Telemetry */}
      {!hudCollapsed && (
        <div className="pointer-events-none absolute top-4 left-5 z-10 flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
            <span>VoxelCraft</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span className="font-medium text-sky-200">{hud.biome}</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span className="text-xs font-medium text-amber-200">
              {hud.gameMode === 'creative' ? 'Creative' : 'Survival'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-xs tabular-nums text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            <span>XYZ {hud.x} / {hud.y} / {hud.z}</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span>
              Chunks {hud.loadedInRadius}/{hud.targetChunks}
            </span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span>Mobs {hud.entityCount}</span>
            {mpStatus === 'connected' && (
              <>
                <span className="text-white/40" aria-hidden="true">·</span>
                <span className="text-emerald-300">
                  Online ({mpPeers.length + 1} in {mpRoomInput})
                </span>
              </>
            )}
            <span className="text-white/40" aria-hidden="true">·</span>
            <span>{hud.timeLabel}</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span>Light {hud.skyLight}/{hud.blockLight}</span>
            <span className="text-white/40" aria-hidden="true">·</span>
            <span>
              {hud.flyMode
                ? 'Fly'
                : hud.inWater
                ? 'Swimming'
                : hud.grounded
                ? 'Grounded'
                : 'Airborne'}
            </span>
            {hud.targetMob ? (
              <>
                <span className="text-white/40" aria-hidden="true">·</span>
                <span className="text-rose-200 font-semibold">Target: {hud.targetMob}</span>
              </>
            ) : (
              hud.targetBlock && (
                <>
                  <span className="text-white/40" aria-hidden="true">·</span>
                  <span className="text-amber-200 font-semibold">Target: {hud.targetBlock}</span>
                </>
              )
            )}
          </div>

          {isStreamingChunks && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-sky-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-900/75 border border-white/15">
                <div
                  className="h-full bg-sky-400 transition-all duration-150"
                  style={{ width: `${Math.max(8, chunkProgressPct)}%` }}
                />
              </div>
              <span>Streaming terrain ({chunkProgressPct}%)</span>
            </div>
          )}
        </div>
      )}

      {/* Top-Right Compact Toolbar */}
      <div className="absolute top-4 right-5 z-20 flex items-center gap-2">
        {statusNotice && (
          <div className="pointer-events-none rounded-md border border-white/15 bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-lg">
            {statusNotice}
          </div>
        )}

        <div className="flex items-center gap-1 rounded-lg border border-white/15 bg-slate-950/85 p-1 backdrop-blur-sm shadow-lg">
          <button
            type="button"
            onClick={() => handleSwitchGameMode(gameMode === 'creative' ? 'survival' : 'creative')}
            title="Toggle Creative / Survival mode (M)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              gameMode === 'survival'
                ? 'bg-amber-500/25 text-amber-200'
                : 'bg-sky-500/20 text-sky-100 hover:bg-sky-500/30'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{gameMode === 'creative' ? 'Creative' : 'Survival'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleFly}
            title="Toggle Fly mode (F)"
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              hud.flyMode
                ? 'bg-amber-500/25 text-amber-200'
                : 'text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Fly</span>
          </button>

          <button
            type="button"
            onClick={handleCycleTime}
            title="Cycle time of day (T)"
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800/80 transition-colors whitespace-nowrap"
          >
            {hud.timeLabel === 'Night' ? (
              <Moon className="h-3.5 w-3.5 text-indigo-300" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-300" />
            )}
            <span>{hud.timeLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCraftingTableMode(false);
              setActiveModal((m) => (m === 'inventory' ? 'none' : 'inventory'));
            }}
            title="Inventory & Crafting (I)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeModal === 'inventory'
                ? 'bg-emerald-500/25 text-emerald-200'
                : 'text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Backpack className="h-3.5 w-3.5" />
            <span>Bag & Craft (I)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal((m) => (m === 'multiplayer' ? 'none' : 'multiplayer'))}
            title="Multiplayer Rooms & Chat (P)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mpStatus === 'connected'
                ? 'bg-emerald-500/25 text-emerald-200'
                : activeModal === 'multiplayer'
                ? 'bg-sky-500/25 text-sky-200'
                : 'text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>{mpStatus === 'connected' ? `Room (${mpPeers.length + 1})` : 'Online (P)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              refreshSavedSlots();
              setActiveModal((m) => (m === 'world' ? 'none' : 'world'));
            }}
            title="World Seed, IndexedDB Saves & Spawner (O)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeModal === 'world'
                ? 'bg-sky-500/25 text-sky-200'
                : 'text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>World (O)</span>
          </button>
        </div>
      </div>

      {/* Center Crosshair */}
      {activeModal === 'none' && !hud.isDead && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <div className="relative h-4 w-4">
            <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.85)]" />
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.85)]" />
          </div>
        </div>
      )}

      {/* Bottom Clean Hotbar & Survival Vitals */}
      <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {selectedView && (
          <div className="pointer-events-none rounded bg-slate-950/75 px-2.5 py-0.5 text-[11px] font-medium text-amber-100 drop-shadow">
            {selectedView.name}
          </div>
        )}

        {gameMode === 'survival' && (
          <div className="pointer-events-none flex w-full max-w-[440px] items-center justify-between gap-4 rounded-md border border-white/10 bg-slate-950/80 px-3 py-1 backdrop-blur-sm text-xs font-mono tabular-nums">
            <div className="flex items-center gap-1.5 text-rose-300">
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-400" />
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-rose-500 transition-all duration-150"
                  style={{ width: `${Math.round((hud.health / hud.maxHealth) * 100)}%` }}
                />
              </div>
              <span>{hud.health}/{hud.maxHealth}</span>
            </div>

            {hud.air < hud.maxAir && (
              <div className="flex items-center gap-1 text-sky-300">
                <Droplets className="h-3.5 w-3.5 text-sky-400" />
                <span>{hud.air}/{hud.maxAir}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-amber-300">
              <Flame className="h-3.5 w-3.5 text-amber-400" />
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-amber-400 transition-all duration-150"
                  style={{ width: `${Math.round((hud.hunger / hud.maxHunger) * 100)}%` }}
                />
              </div>
              <span>{hud.hunger}/{hud.maxHunger}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-slate-950/88 p-1.5 backdrop-blur-sm shadow-2xl">
          {slots.slice(0, 9).map((slot, idx) => {
            const active = idx === selectedSlot;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => engineRef.current?.inventory.setSelectedSlot(idx)}
                title={slot ? `${idx + 1}: ${slot.name}` : `Slot ${idx + 1}`}
                className={`relative flex h-11 w-11 items-center justify-center rounded-md border transition-all ${
                  active
                    ? 'border-amber-400 bg-slate-800 scale-105 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]'
                    : 'border-white/10 bg-slate-900/90 hover:border-white/30'
                }`}
              >
                {slot ? (
                  slot.iconUrl ? (
                    <img
                      src={slot.iconUrl}
                      alt={slot.name}
                      className="h-7 w-7 rounded-[2px]"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <span
                      className="h-6 w-6 rounded-[2px]"
                      style={{ backgroundColor: slot.hexColor }}
                    />
                  )
                ) : null}

                <span className="absolute top-0.5 left-1 font-mono text-[9px] tabular-nums text-white/55">
                  {idx + 1}
                </span>

                {slot && gameMode === 'survival' && slot.count > 1 && (
                  <span className="absolute right-1 bottom-0.5 font-mono text-[10px] font-bold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                    {slot.count}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setInvTab('catalog');
              setActiveModal('inventory');
            }}
            title="Open full block & item catalog (B)"
            className="ml-0.5 flex h-11 items-center gap-1 rounded-md border border-white/15 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <Layers className="h-3.5 w-3.5 text-sky-300" />
            <span>Blocks</span>
          </button>
        </div>

        {!hudCollapsed && (
          <div className="pointer-events-none text-[11px] text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            Click/X break · Drag look · Right-Click/E place · Double-click FPS lock · I Bag/Craft · H hide HUD
          </div>
        )}
      </div>

      {/* Inventory & Crafting Modal */}
      {activeModal === 'inventory' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="flex w-full max-w-4xl flex-col gap-4 rounded-xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <Backpack className="h-5 w-5 text-emerald-400" />
                <h2 className="text-base font-semibold text-white">
                  {craftingTableMode ? 'Crafting Table & Inventory' : 'Backpack & Crafting'}
                </h2>
                <div className="flex items-center rounded-md bg-slate-950 p-0.5 border border-white/10 text-xs">
                  <button
                    type="button"
                    onClick={() => setInvTab('craft')}
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${
                      invTab === 'craft'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Crafting & Recipes
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvTab('catalog')}
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${
                      invTab === 'catalog'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All Blocks & Tools ({catalog.length})
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveModal('none');
                  setPickedInventoryIdx(null);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {invTab === 'craft' ? (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
                {/* Left: 36-Slot Inventory */}
                <div className="md:col-span-6 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Inventory (click two slots to move/swap)</span>
                    <button
                      type="button"
                      onClick={() => engineRef.current?.inventory.loadStarterKit()}
                      className="text-sky-300 hover:underline"
                    >
                      Refill Starter Kit
                    </button>
                  </div>

                  {/* Backpack 27 slots (9..35) */}
                  <div className="grid grid-cols-9 gap-1.5">
                    {slots.slice(9, 36).map((slot, offset) => {
                      const idx = offset + 9;
                      const picked = pickedInventoryIdx === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSlotClick(idx)}
                          title={slot ? `${slot.name} (${slot.count})` : 'Empty slot'}
                          className={`relative flex aspect-square items-center justify-center rounded border transition-colors ${
                            picked
                              ? 'border-emerald-400 bg-emerald-950/60'
                              : 'border-white/10 bg-slate-950/80 hover:border-white/30'
                          }`}
                        >
                          {slot?.iconUrl && (
                            <img
                              src={slot.iconUrl}
                              alt={slot.name}
                              className="h-6 w-6"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          )}
                          {slot && slot.count > 1 && (
                            <span className="absolute right-0.5 bottom-0 font-mono text-[10px] font-bold text-white drop-shadow">
                              {slot.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Hotbar 9 slots (0..8) */}
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="mb-1 text-[11px] text-slate-400">Hotbar</div>
                    <div className="grid grid-cols-9 gap-1.5">
                      {slots.slice(0, 9).map((slot, idx) => {
                        const picked = pickedInventoryIdx === idx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSlotClick(idx)}
                            title={slot ? `${slot.name} (${slot.count})` : 'Empty hotbar slot'}
                            className={`relative flex aspect-square items-center justify-center rounded border transition-colors ${
                              picked
                                ? 'border-emerald-400 bg-emerald-950/60'
                                : idx === selectedSlot
                                ? 'border-amber-400/70 bg-slate-800'
                                : 'border-white/15 bg-slate-950/90 hover:border-white/30'
                            }`}
                          >
                            {slot?.iconUrl && (
                              <img
                                src={slot.iconUrl}
                                alt={slot.name}
                                className="h-6 w-6"
                                style={{ imageRendering: 'pixelated' }}
                              />
                            )}
                            {slot && slot.count > 1 && (
                              <span className="absolute right-0.5 bottom-0 font-mono text-[10px] font-bold text-white drop-shadow">
                                {slot.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right: Crafting Grid + One-Click Recipe Book */}
                <div className="md:col-span-6 flex flex-col gap-3 border-t border-white/10 pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                      <Hammer className="h-3.5 w-3.5 text-amber-300" />
                      <span>{craftingTableMode ? '3×3 Workbench Grid' : '2×2 Hand Grid'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCraftingTableMode((v) => !v)}
                      className="rounded border border-white/15 bg-slate-950 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-slate-800"
                    >
                      Switch to {craftingTableMode ? '2×2' : '3×3'}
                    </button>
                  </div>

                  {/* Interactive Grid -> Output */}
                  <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-slate-950/75 p-3">
                    <div
                      className={`grid gap-1.5 ${
                        craftingTableMode ? 'grid-cols-3' : 'grid-cols-2'
                      }`}
                    >
                      {(craftingTableMode ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 3, 4]).map((gIdx) => {
                        const itemId = craftGrid[gIdx];
                        const def = itemId ? engineRef.current?.itemRegistry.get(itemId) : null;
                        const icon = itemId
                          ? engineRef.current?.itemRegistry.getItemIconUrl(
                              itemId,
                              engineRef.current.world.textureAtlas
                            )
                          : null;
                        return (
                          <button
                            key={gIdx}
                            type="button"
                            onClick={() => handleCraftSlotClick(gIdx)}
                            title={def ? `${def.name} (click to clear)` : 'Click to place selected item'}
                            className="flex h-10 w-10 items-center justify-center rounded border border-white/15 bg-slate-900 hover:border-amber-400/60"
                          >
                            {icon && (
                              <img
                                src={icon}
                                alt={def?.name ?? ''}
                                className="h-6 w-6"
                                style={{ imageRendering: 'pixelated' }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <span className="text-slate-400 text-lg">→</span>

                    <button
                      type="button"
                      onClick={handleExecuteGridCraft}
                      disabled={!gridMatch}
                      className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {gridMatch ? (
                        <>
                          {(() => {
                            const outIcon = engineRef.current?.itemRegistry.getItemIconUrl(
                              gridMatch.result.itemId,
                              engineRef.current.world.textureAtlas
                            );
                            const outDef = engineRef.current?.itemRegistry.get(gridMatch.result.itemId);
                            return (
                              <>
                                {outIcon && (
                                  <img
                                    src={outIcon}
                                    alt={outDef?.name ?? ''}
                                    className="h-7 w-7"
                                    style={{ imageRendering: 'pixelated' }}
                                  />
                                )}
                                <div className="text-left">
                                  <div>{outDef?.name ?? gridMatch.result.itemId}</div>
                                  <div className="font-mono text-[10px] text-amber-300">
                                    Craft ×{gridMatch.result.count}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </>
                      ) : (
                        <span className="text-slate-400">No Recipe Match</span>
                      )}
                    </button>
                  </div>

                  {/* Quick-Craft Recipe Book */}
                  <div className="text-xs font-medium text-slate-300">
                    Quick-Craft Recipe Book
                  </div>
                  <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {recipeBook.map(({ recipe, costs, craftable }) => {
                      const outIcon = engineRef.current?.itemRegistry.getItemIconUrl(
                        recipe.result.itemId,
                        engineRef.current.world.textureAtlas
                      );
                      const outDef = engineRef.current?.itemRegistry.get(recipe.result.itemId);
                      return (
                        <button
                          key={recipe.id}
                          type="button"
                          onClick={() => handleOneClickCraft(recipe.id)}
                          disabled={!craftable}
                          className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors ${
                            craftable
                              ? 'border-emerald-500/35 bg-slate-950/90 hover:bg-slate-800'
                              : 'border-white/5 bg-slate-950/40 opacity-50 pointer-events-none'
                          }`}
                        >
                          {outIcon && (
                            <img
                              src={outIcon}
                              alt={outDef?.name ?? ''}
                              className="h-6 w-6 shrink-0"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-white">
                              {recipe.result.count}× {outDef?.name ?? recipe.result.itemId}
                            </div>
                            <div className="truncate text-[10px] text-slate-400">
                              {costs
                                .map(
                                  (c) =>
                                    `${c.count} ${
                                      engineRef.current?.itemRegistry.get(c.itemId)?.name ?? c.itemId
                                    }`
                                )
                                .join(' + ')}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Full Block & Tool Catalog */
              <div className="flex flex-col gap-2">
                <div className="text-xs text-slate-300">
                  Click any block or tool below to equip it into Hotbar Slot {selectedSlot + 1}.
                </div>
                <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 md:grid-cols-6">
                  {catalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleEquipCatalogItem(item.id)}
                      className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/85 p-2 text-left hover:border-sky-400/60 hover:bg-slate-800 transition-colors"
                    >
                      {item.iconUrl ? (
                        <img
                          src={item.iconUrl}
                          alt={item.name}
                          className="h-6 w-6 shrink-0"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : (
                        <span
                          className="h-5 w-5 shrink-0 rounded"
                          style={{ backgroundColor: item.hexColor }}
                        />
                      )}
                      <span className="truncate text-xs text-slate-100">{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* World Seed, Chunks, Save/Load & Controls Modal */}
      {activeModal === 'world' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-sky-400" />
                <h2 className="text-base font-semibold text-white">World & Chunk Engine</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Seed Generator */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="world-seed-input" className="text-xs font-medium text-slate-300">
                World Seed
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="world-seed-input"
                  type="text"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRegenerate();
                  }}
                  className="flex-1 rounded-md border border-white/15 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleRandomSeed}
                  title="Random seed"
                  className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <Dices className="h-3.5 w-3.5" />
                  <span>Random</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRegenerate()}
                  className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Generate</span>
                </button>
              </div>
            </div>

            {/* View Distance */}
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2.5">
              <div>
                <div className="text-xs font-medium text-slate-200">Chunk View Distance</div>
                <div className="text-[11px] text-slate-400">
                  Loaded {hud.loadedInRadius} / {hud.targetChunks} chunks around player
                </div>
              </div>
              <div className="flex items-center gap-1">
                {[3, 5, 7, 9].map((vd) => (
                  <button
                    key={vd}
                    type="button"
                    onClick={() => handleViewDistance(vd)}
                    className={`rounded px-2.5 py-1 font-mono text-xs tabular-nums transition-colors ${
                      viewDistance === vd
                        ? 'bg-sky-600 text-white font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {vd}
                  </button>
                ))}
              </div>
            </div>

            {/* Persistence & IndexedDB Multi-Slot Manager */}
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-slate-950/75 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">IndexedDB World Saves</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportWorldJson}
                    className="flex items-center gap-1 rounded border border-white/15 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                  >
                    <Download className="h-3 w-3 text-sky-400" />
                    <span>Export JSON</span>
                  </button>
                  <label className="flex cursor-pointer items-center gap-1 rounded border border-white/15 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">
                    <Upload className="h-3 w-3 text-emerald-400" />
                    <span>Import</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleImportWorldJson}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={saveSlotInput}
                  onChange={(e) => setSaveSlotInput(e.target.value)}
                  placeholder="Save slot name"
                  className="flex-1 rounded-md border border-white/15 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSave()}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetToSurface}
                  className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                >
                  <Compass className="h-3.5 w-3.5 text-amber-300" />
                  <span>Surface</span>
                </button>
              </div>

              {savedSlots.length > 0 && (
                <div className="max-h-28 space-y-1 overflow-y-auto pt-1">
                  {savedSlots.map((slot) => (
                    <div
                      key={slot.slotName}
                      className="flex items-center justify-between rounded border border-white/10 bg-slate-900/90 px-2.5 py-1.5 text-[11px]"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <span className="font-mono font-semibold text-white">{slot.slotName}</span>
                        <span className="ml-2 text-slate-400">
                          {slot.totalModifiedBlocks} edits · Seed {slot.seed}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleLoad(slot.slotName)}
                          className="rounded bg-sky-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-500"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(slot.slotName)}
                          title="Delete save"
                          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mob Spawner */}
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2">
              <span className="text-xs font-medium text-slate-300">Spawn Mob Ahead</span>
              <div className="flex items-center gap-1.5">
                {[
                  { id: MOB_TYPES.SHEEP, label: 'Sheep' },
                  { id: MOB_TYPES.COW, label: 'Cow' },
                  { id: MOB_TYPES.ZOMBIE, label: 'Zombie' },
                  { id: MOB_TYPES.SLIME, label: 'Slime' },
                ].map((mob) => (
                  <button
                    key={mob.id}
                    type="button"
                    onClick={() => handleSpawnMobInFront(mob.id)}
                    className="rounded border border-white/10 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700"
                  >
                    {mob.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Controls Reference */}
            <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3 text-[11px] text-slate-300 grid grid-cols-2 gap-y-1 gap-x-4">
              <div><span className="font-mono text-white">WASD / Arrows</span> — Move</div>
              <div><span className="font-mono text-white">Space / Ctrl</span> — Jump / Crouch</div>
              <div><span className="font-mono text-white">Click / X</span> — Attack or Break</div>
              <div><span className="font-mono text-white">Right-Click / E</span> — Place / Eat / Table</div>
              <div><span className="font-mono text-white">Drag / Dbl-Click</span> — Look / FPS Lock</div>
              <div><span className="font-mono text-white">1–9 / Wheel</span> — Select Hotbar</div>
              <div><span className="font-mono text-white">I / P / O</span> — Bag / Online / World</div>
              <div><span className="font-mono text-white">F / M / T</span> — Fly / Mode / Time</div>
            </div>
          </div>
        </div>
      )}

      {/* Multiplayer Room & Live Chat Modal */}
      {activeModal === 'multiplayer' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-400" />
                <h2 className="text-base font-semibold text-white">Multiplayer World Sync</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="mp-name-input" className="text-xs font-medium text-slate-300">
                  Player Name
                </label>
                <input
                  id="mp-name-input"
                  type="text"
                  value={mpNameInput}
                  onChange={(e) => setMpNameInput(e.target.value)}
                  className="rounded-md border border-white/15 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="mp-room-input" className="text-xs font-medium text-slate-300">
                  Room ID
                </label>
                <input
                  id="mp-room-input"
                  type="text"
                  value={mpRoomInput}
                  onChange={(e) => setMpRoomInput(e.target.value)}
                  className="rounded-md border border-white/15 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs">
                <Wifi className={`h-4 w-4 ${mpStatus === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className="text-slate-200">
                  {mpStatus === 'connected'
                    ? `Connected · ${mpPeers.length + 1} player(s) in "${mpRoomInput}"`
                    : mpStatus === 'connecting'
                    ? 'Connecting to server...'
                    : 'Not connected to a multiplayer room'}
                </span>
              </div>

              {mpStatus === 'connected' ? (
                <button
                  type="button"
                  onClick={handleDisconnectMultiplayer}
                  className="rounded-md border border-rose-500/40 bg-rose-950/60 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/70"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectMultiplayer}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Join Room
                </button>
              )}
            </div>

            {mpPeers.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                {mpPeers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex items-center gap-1.5 rounded border border-white/10 bg-slate-950 px-2.5 py-1 font-mono text-[11px]"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-xs"
                      style={{ backgroundColor: `#${peer.color.toString(16).padStart(6, '0')}` }}
                    />
                    <span className="text-white">{peer.name}</span>
                    <span className="text-slate-400">
                      ({peer.x}, {peer.z})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Room Chat */}
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-slate-950/75 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>Room Chat</span>
              </div>
              <div className="h-32 overflow-y-auto space-y-1 rounded border border-white/5 bg-slate-900/70 p-2 text-xs">
                {chatLog.length === 0 ? (
                  <div className="text-slate-500">Join a room to sync block edits and chat with nearby players.</div>
                ) : (
                  chatLog.map((msg) => (
                    <div key={msg.id} className="leading-relaxed">
                      <span
                        className="font-semibold"
                        style={{ color: `#${msg.color.toString(16).padStart(6, '0')}` }}
                      >
                        {msg.senderName}:
                      </span>{' '}
                      <span className="text-slate-200">{msg.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendChat();
                  }}
                  disabled={mpStatus !== 'connected'}
                  placeholder={mpStatus === 'connected' ? 'Type a message and press Enter...' : 'Connect to chat...'}
                  className="flex-1 rounded-md border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={mpStatus !== 'connected' || !chatInput.trim()}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-45 disabled:pointer-events-none"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Survival Respawn Overlay */}
      {hud.isDead && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-red-950/65 p-4 backdrop-blur-xs">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-red-400/30 bg-slate-900/95 p-6 text-center shadow-2xl">
            <Skull className="h-10 w-10 text-rose-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">You Died</h2>
              <p className="mt-1 text-xs text-slate-300">
                Cause: {hud.lastDamageSource ?? 'unknown'}
              </p>
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={handleRespawn}
                className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Respawn
              </button>
              <button
                type="button"
                onClick={() => handleSwitchGameMode('creative')}
                className="flex-1 rounded-md border border-white/15 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Creative Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
