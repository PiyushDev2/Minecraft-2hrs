/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Download,
  Moon,
  RefreshCw,
  Save,
  Sun,
} from 'lucide-react';
import {
  BLOCK_IDS,
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
  loadedChunks: number;
  seed: number;
  targetBlock: string | null;
  pointerLocked: boolean;
  skyLight: number;
  blockLight: number;
  timeLabel: string;
}

interface HotbarItem {
  id: number;
  key: string;
  name: string;
  iconUrl: string | null;
  hexColor: string;
}

const DEFAULT_SEED = 'alpine-valley-2026';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldManager | null>(null);
  const selectedBlockRef = useRef<number>(BLOCK_IDS.GRASS);
  const hotbarPageRef = useRef<number>(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);

  const [selectedBlockId, setSelectedBlockId] = useState<number>(BLOCK_IDS.GRASS);
  const [hotbarItems, setHotbarItems] = useState<HotbarItem[]>([]);
  const [hotbarPage, setHotbarPage] = useState<number>(0);
  const [seedInput, setSeedInput] = useState<string>(DEFAULT_SEED);
  const [viewDistance, setViewDistance] = useState<number>(5);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [hasSavedWorld, setHasSavedWorld] = useState<boolean>(() => {
    try {
      return WorldSave.listSaves().some((s) => s.slotName === 'default');
    } catch {
      return false;
    }
  });

  const [hud, setHud] = useState<HudSnapshot>({
    x: 8,
    y: 42,
    z: 8,
    biome: 'Plains',
    grounded: false,
    inWater: false,
    flyMode: false,
    loadedChunks: 0,
    seed: 0,
    targetBlock: null,
    pointerLocked: false,
    skyLight: 15,
    blockLight: 0,
    timeLabel: 'Noon',
  });

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
    const fog = new THREE.FogExp2(0x9bc7f0, 0.0095);
    scene.fog = fog;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.1,
      360
    );
    camera.rotation.order = 'YXZ';

    // Three-point outdoor sky/sun lighting rig
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
      scene,
    });
    engine.initWorld(DEFAULT_SEED, { x: 8, z: 8 });
    engineRef.current = engine;

    // Build hotbar items with procedural pixel-art previews from backend TextureAtlas
    const placeable = blockRegistry.getPlaceableBlocks(true).filter((b) => b.id !== BLOCK_IDS.WATER);
    const items: HotbarItem[] = placeable.map((block) => {
      const tileKey = block.getTextureForFace('top') || block.getTextureForFace('north') || 'stone';
      return {
        id: block.id,
        key: block.key,
        name: block.name,
        iconUrl: engine.world.textureAtlas.getTileDataURL(tileKey),
        hexColor: `#${block.color.toString(16).padStart(6, '0')}`,
      };
    });
    setHotbarItems(items);

    // 4. Target block selection wireframe indicator
    const highlightGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    const highlightMat = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.78,
    });
    const highlightBox = new THREE.LineSegments(highlightGeo, highlightMat);
    highlightBox.visible = false;
    scene.add(highlightBox);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 5. Input & Pointer Controls (PointerLock + drag-look fallback)
    let isDraggingLook = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let hudSyncTimer = 0;
    let contextLost = false;

    const handleBreakAction = () => {
      const hit = engine.world.raycast(
        engine.player.getEyePosition(),
        engine.player.getForwardVector(),
        6
      );
      if (hit.hit && hit.position) {
        engine.world.breakBlock(hit.position.x, hit.position.y, hit.position.z);
      }
    };

    const handlePlaceAction = () => {
      const hit = engine.world.raycast(
        engine.player.getEyePosition(),
        engine.player.getForwardVector(),
        6
      );
      if (hit.hit && hit.adjacent) {
        engine.world.placeBlock(
          hit.adjacent.x,
          hit.adjacent.y,
          hit.adjacent.z,
          selectedBlockRef.current,
          (bx, by, bz) => engine.player.wouldBlockCollide(bx, by, bz)
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        document.activeElement.tagName === 'INPUT'
      ) {
        return;
      }

      keysRef.current[e.code] = true;

      if (e.code === 'KeyF') {
        engine.player.setFlyMode(!engine.player.flyMode);
      } else if (e.code === 'KeyH') {
        setDockCollapsed((v) => !v);
      } else if (e.code === 'KeyT') {
        const nextPhase = (Math.floor(((engine.world.getTimeOfDay() + 0.05) % 1) * 4) + 1) % 4;
        engine.setTimeOfDay(nextPhase * 0.25);
      } else if (e.code === 'KeyB') {
        const totalPages = Math.max(1, Math.ceil(items.length / 9));
        const nextPage = (hotbarPageRef.current + 1) % totalPages;
        hotbarPageRef.current = nextPage;
        setHotbarPage(nextPage);
      } else if (e.code === 'KeyX') {
        handleBreakAction();
      } else if (e.code === 'KeyE') {
        handlePlaceAction();
      } else if (e.code.startsWith('Digit')) {
        const rawDigit = Number(e.code.replace('Digit', ''));
        if (rawDigit >= 1 && rawDigit <= 9) {
          const slotIndex = hotbarPageRef.current * 9 + (rawDigit - 1);
          if (slotIndex < items.length) {
            const item = items[slotIndex];
            selectedBlockRef.current = item.id;
            setSelectedBlockId(item.id);
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== renderer.domElement) return;
      if (document.pointerLockElement === renderer.domElement) {
        if (e.button === 0) handleBreakAction();
        else if (e.button === 2) handlePlaceAction();
      } else {
        if (e.button === 0) {
          isDraggingLook = true;
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;
        } else if (e.button === 2) {
          handlePlaceAction();
        }
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (e.target !== renderer.domElement) return;
      renderer.domElement.requestPointerLock?.();
    };

    const onMouseUp = () => {
      isDraggingLook = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === renderer.domElement) {
        engine.player.rotate(-e.movementX * 0.0022, -e.movementY * 0.0022);
      } else if (isDraggingLook) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
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
      if (items.length === 0) return;
      const idx = items.findIndex((i) => i.id === selectedBlockRef.current);
      const next = (idx + (e.deltaY > 0 ? 1 : -1) + items.length) % items.length;
      selectedBlockRef.current = items[next].id;
      setSelectedBlockId(items[next].id);
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

    // 6. Main Simulation & Render Loop (Software-WebGL paced via afterDraw)
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

      // Advance backend physics & chunk streaming
      engine.update(delta, {
        forward: Boolean(keys.KeyW || keys.ArrowUp),
        backward: Boolean(keys.KeyS || keys.ArrowDown),
        left: Boolean(keys.KeyA || keys.ArrowLeft),
        right: Boolean(keys.KeyD || keys.ArrowRight),
        jump: Boolean(keys.Space),
        sprint: Boolean(keys.ShiftLeft || keys.ShiftRight),
        sneak: Boolean(keys.ControlLeft || keys.KeyC),
      });

      // Sync Three.js camera with backend player state
      const eye = engine.player.getEyePosition();
      const rot = engine.player.getRotation();
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.y = rot.yaw;
      camera.rotation.x = rot.pitch;

      // Keep shadow frustum & outdoor sky/sun lighting synced with world timeOfDay
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

      // Raycast target block for highlight outline
      const hit = engine.world.raycast(eye, engine.player.getForwardVector(), 6);
      if (hit.hit && hit.position) {
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

      // Throttled HUD snapshot update (10Hz) so React doesn't re-render every frame
      hudSyncTimer += delta;
      if (hudSyncTimer >= 0.1) {
        hudSyncTimer = 0;
        const stats = engine.world.getStats();
        const biome = engine.world.getBiomeAt(pos.x, pos.z);
        const playerLight = engine.world.getLight(eye.x, eye.y, eye.z);
        const hitBlockName =
          hit.hit && hit.blockId !== undefined
            ? blockRegistry.getById(hit.blockId)?.name ?? null
            : null;

        setHud({
          x: Number(pos.x.toFixed(1)),
          y: Number(pos.y.toFixed(1)),
          z: Number(pos.z.toFixed(1)),
          biome: biome.name,
          grounded: engine.player.isGrounded(),
          inWater: engine.player.isInWater(),
          flyMode: engine.player.flyMode,
          loadedChunks: stats.loadedChunks,
          seed: stats.seed,
          targetBlock: hitBlockName,
          pointerLocked: document.pointerLockElement === renderer.domElement,
          skyLight: playerLight.sky,
          blockLight: playerLight.block,
          timeLabel: formatTimeLabel(stats.timeOfDay),
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

  const handleRegenerate = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const trimmed = seedInput.trim() || DEFAULT_SEED;
    engine.initWorld(trimmed, { x: 8, z: 8 });
    showNotice(`Generated world "${trimmed}"`);
  };

  const handleViewDistance = (vd: number) => {
    setViewDistance(vd);
    engineRef.current?.world.setViewDistance(vd);
  };

  const handleToggleFly = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.player.setFlyMode(!engine.player.flyMode);
    setHud((prev) => ({ ...prev, flyMode: engine.player.flyMode }));
  };

  const handleSave = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const saved = engine.save('default');
    setHasSavedWorld(true);
    showNotice(`Saved ${saved.totalModifiedBlocks} edited blocks`);
  };

  const handleLoad = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const ok = engine.load('default');
    if (ok) {
      setViewDistance(engine.world.viewDistance);
      showNotice('Loaded saved world');
    } else {
      showNotice('No saved world found');
    }
  };

  const handleCycleTime = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const nextPhase = (Math.floor(((engine.world.getTimeOfDay() + 0.05) % 1) * 4) + 1) % 4;
    const nextTod = engine.setTimeOfDay(nextPhase * 0.25);
    const label = formatTimeLabel(nextTod);
    setHud((prev) => ({ ...prev, timeLabel: label }));
    showNotice(`Time set to ${label}`);
  };

  const handleSelectHotbar = (id: number) => {
    selectedBlockRef.current = id;
    setSelectedBlockId(id);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Isolated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full cursor-crosshair" />

      {/* Top-Left Compact World Readout (unboxed clean typography, tabular numerals) */}
      <div className="pointer-events-none absolute top-4 left-5 z-10 flex flex-col gap-1">
        <div className="flex items-center gap-3 text-sm font-semibold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
          <span>VoxelCraft Engine</span>
          <span className="text-white/50" aria-hidden="true">·</span>
          <span className="font-medium text-sky-100">{hud.biome}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-xs tabular-nums text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
          <span>
            XYZ {hud.x} / {hud.y} / {hud.z}
          </span>
          <span className="text-white/45" aria-hidden="true">·</span>
          <span>{hud.loadedChunks} chunks</span>
          <span className="text-white/45" aria-hidden="true">·</span>
          <span>{hud.timeLabel}</span>
          <span className="text-white/45" aria-hidden="true">·</span>
          <span>Light {hud.skyLight}/{hud.blockLight}</span>
          <span className="text-white/45" aria-hidden="true">·</span>
          <span>{hud.flyMode ? 'Fly' : hud.inWater ? 'Swimming' : hud.grounded ? 'Grounded' : 'Airborne'}</span>
          {hud.targetBlock && (
            <>
              <span className="text-white/45" aria-hidden="true">·</span>
              <span className="text-amber-200">Target: {hud.targetBlock}</span>
            </>
          )}
        </div>
      </div>

      {/* Top-Right Brief Notification Banner (only when active) */}
      {statusNotice && (
        <div className="pointer-events-none absolute top-4 right-5 z-10 rounded-md bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-slate-100 border border-white/15">
          {statusNotice}
        </div>
      )}

      {/* Center Crosshair */}
      <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
        <div className="relative h-4 w-4">
          <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/85 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/85 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
        </div>
      </div>

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
      <div
        className={`fixed bottom-4 left-1/2 z-20 -translate-x-1/2 transition-transform duration-200 ease-out ${
          dockCollapsed ? 'translate-y-[calc(100%-26px)]' : 'translate-y-0'
        }`}
        style={{ width: 'min(920px, 94vw)' }}
      >
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="flex items-center gap-1.5 rounded-t-md border border-b-0 border-white/15 bg-slate-950/90 px-3 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {dockCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span>{dockCollapsed ? 'Show Controls (H)' : 'Hide Controls (H)'}</span>
          </button>
        </div>

        <div className="rounded-lg border border-white/15 bg-slate-950/92 px-3.5 py-2.5 shadow-xl">
          {/* Row 1: Paged 9-Slot Block Hotbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
            <div className="flex items-center gap-1.5">
              {hotbarItems.slice(hotbarPage * 9, hotbarPage * 9 + 9).map((item, idx) => {
                const active = item.id === selectedBlockId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectHotbar(item.id)}
                    title={`${idx + 1}: ${item.name}`}
                    className={`group relative flex h-10 w-10 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      active
                        ? 'border-amber-400 bg-slate-800'
                        : 'border-white/10 bg-slate-900/90 hover:border-white/30'
                    }`}
                  >
                    {item.iconUrl ? (
                      <img
                        src={item.iconUrl}
                        alt={item.name}
                        className="h-6 w-6 rounded-[2px]"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span
                        className="h-5 w-5 rounded-[2px]"
                        style={{ backgroundColor: item.hexColor }}
                      />
                    )}
                    <span className="absolute top-0.5 left-1 font-mono text-[9px] tabular-nums text-white/60">
                      {idx + 1}
                    </span>
                  </button>
                );
              })}

              {hotbarItems.length > 9 && (
                <button
                  type="button"
                  onClick={() => {
                    const totalPages = Math.max(1, Math.ceil(hotbarItems.length / 9));
                    const nextPage = (hotbarPage + 1) % totalPages;
                    hotbarPageRef.current = nextPage;
                    setHotbarPage(nextPage);
                  }}
                  title="Switch block palette page (B)"
                  className="ml-1 flex h-10 items-center rounded-md border border-white/15 bg-slate-900 px-2.5 font-mono text-[11px] tabular-nums text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                >
                  {hotbarPage + 1}/{Math.ceil(hotbarItems.length / 9)} (B)
                </button>
              )}
            </div>

            <div className="text-[11px] text-slate-300">
              WASD move · Space jump · Drag/Click look · X/LMB break · E/RMB place · T time
            </div>
          </div>

          {/* Row 2: World Seed, View Distance, Physics Mode & Save/Load */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <label htmlFor="world-seed-input" className="text-slate-400 whitespace-nowrap">
                Seed
              </label>
              <input
                id="world-seed-input"
                type="text"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRegenerate();
                }}
                className="w-36 rounded-md border border-white/15 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleRegenerate}
                className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Generate</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md bg-slate-900 p-0.5 border border-white/10">
                <span className="px-2 text-[11px] text-slate-400 whitespace-nowrap">Chunks</span>
                {[3, 5, 7].map((vd) => (
                  <button
                    key={vd}
                    type="button"
                    onClick={() => handleViewDistance(vd)}
                    className={`rounded px-2 py-1 font-mono text-xs tabular-nums transition-colors ${
                      viewDistance === vd
                        ? 'bg-slate-700 text-white font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {vd}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCycleTime}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                {hud.timeLabel === 'Night' ? (
                  <Moon className="h-3.5 w-3.5 text-indigo-300" />
                ) : (
                  <Sun className="h-3.5 w-3.5 text-amber-300" />
                )}
                <span>{hud.timeLabel} (T)</span>
              </button>

              <button
                type="button"
                onClick={handleToggleFly}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  hud.flyMode
                    ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                    : 'border-white/15 bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Compass className="h-3.5 w-3.5" />
                <span>{hud.flyMode ? 'Fly Mode (F)' : 'Walk Mode (F)'}</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save</span>
              </button>

              <button
                type="button"
                onClick={handleLoad}
                disabled={!hasSavedWorld}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Load</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
