/**
 * @file ClassicOptionsModal.tsx
 * @description Classic Minecraft Java-style stone-bevel Options suite:
 * - Main Options Hub (FOV, Video Settings, Music & Sounds, Resource Packs, Controls)
 * - Video Settings (Graphics Fast/Fancy, Render Distance, Clouds, Shadows, View Bobbing, Pixel Ratio, Particles, Chunk Borders)
 * - Music & Sounds (Master, Blocks, Mobs, Ambient, UI volume buses)
 * - Resource Packs (Zero-OOM streaming 1.21 ZIP/JAR & Folder importer with progress bar, pack toggling & deletion)
 * - Controls (Mouse Sensitivity, Invert Y, keybind reference)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  resourcePackManager,
  type PackImportProgress,
  type ResourcePackSummary,
  type StoredResourcePack,
} from '../game/ResourcePackManager';

export interface GameOptionsState {
  viewDistance: number;
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  volume: number;
  blocksVolume: number;
  mobsVolume: number;
  ambientVolume: number;
  uiVolume: number;
  graphics: 'fast' | 'fancy';
  clouds: boolean;
  shadows: boolean;
  viewBobbing: boolean;
  pixelRatioCap: number;
  particles: 'all' | 'decreased' | 'minimal';
  chunkBorders: boolean;
}

export type OptionsSubPage = 'main' | 'video' | 'audio' | 'packs' | 'controls';

interface ClassicOptionsModalProps {
  options: GameOptionsState;
  initialPage?: OptionsSubPage;
  activePackName: string | null;
  onUpdateOptions: (next: Partial<GameOptionsState>) => void;
  onApplyResourcePack: (pack: StoredResourcePack | null) => Promise<void>;
  onClose: () => void;
  onUiClick: () => void;
  standalone?: boolean;
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ClassicOptionsModal: React.FC<ClassicOptionsModalProps> = ({
  options,
  initialPage = 'main',
  activePackName,
  onUpdateOptions,
  onApplyResourcePack,
  onClose,
  onUiClick,
  standalone = false,
}) => {
  const [page, setPage] = useState<OptionsSubPage>(initialPage);
  const [packs, setPacks] = useState<ResourcePackSummary[]>([]);
  const [importProgress, setImportProgress] = useState<PackImportProgress | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packMessage, setPackMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const loadPackList = async () => {
    const list = await resourcePackManager.listPacks();
    setPacks(list);
  };

  useEffect(() => {
    setPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    if (page === 'packs') {
      void loadPackList();
      folderInputRef.current?.setAttribute('webkitdirectory', '');
    }
  }, [page]);

  const handleZipSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPackBusy(true);
    setPackMessage(null);
    setImportProgress({ phase: 'scanning', scanned: 0, matched: 0, extracted: 0, extractedBytes: 0 });
    try {
      const stored = await resourcePackManager.importFromZip(file, (p) => setImportProgress({ ...p }));
      await onApplyResourcePack(stored);
      await loadPackList();
      setPackMessage({
        kind: 'info',
        text: `Applied "${stored.name}" (${stored.blockCount} blocks, ${stored.itemCount} items, ${stored.entityCount} mobs, ${stored.soundCount} sounds — ${formatMB(stored.extractedBytes)} stored).`,
      });
    } catch (err: any) {
      setPackMessage({
        kind: 'error',
        text: err?.message || 'Failed to read ZIP/JAR archive.',
      });
    } finally {
      setPackBusy(false);
      setImportProgress(null);
    }
  };

  const handleFolderSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPackBusy(true);
    setPackMessage(null);
    setImportProgress({ phase: 'scanning', scanned: 0, matched: 0, extracted: 0, extractedBytes: 0 });
    try {
      const stored = await resourcePackManager.importFromFolder(files, (p) => setImportProgress({ ...p }));
      await onApplyResourcePack(stored);
      await loadPackList();
      setPackMessage({
        kind: 'info',
        text: `Applied "${stored.name}" (${stored.blockCount} blocks, ${stored.itemCount} items, ${stored.entityCount} mobs, ${stored.soundCount} sounds — ${formatMB(stored.extractedBytes)} stored).`,
      });
    } catch (err: any) {
      setPackMessage({
        kind: 'error',
        text: err?.message || 'Failed to import folder.',
      });
    } finally {
      e.target.value = '';
      setPackBusy(false);
      setImportProgress(null);
    }
  };

  const handleSelectPack = async (id: string | null) => {
    onUiClick();
    setPackBusy(true);
    setPackMessage(null);
    try {
      const active = await resourcePackManager.setActivePack(id);
      await onApplyResourcePack(active);
      await loadPackList();
      setPackMessage({
        kind: 'info',
        text: active ? `Activated "${active.name}".` : 'Switched back to Default Procedural Pack.',
      });
    } catch {
      setPackMessage({ kind: 'error', text: 'Could not switch resource pack.' });
    } finally {
      setPackBusy(false);
    }
  };

  const handleDeletePack = async (id: string, wasEnabled: boolean) => {
    onUiClick();
    setPackBusy(true);
    try {
      await resourcePackManager.deletePack(id);
      if (wasEnabled) {
        await onApplyResourcePack(null);
      }
      await loadPackList();
    } finally {
      setPackBusy(false);
    }
  };

  const content = (
    <div className="mc-panel-dark w-full max-w-2xl p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/15 pb-2">
        <h2 className="text-lg font-bold text-white mc-text-shadow">
          {page === 'main' && 'Options'}
          {page === 'video' && 'Video Settings'}
          {page === 'audio' && 'Music & Sounds'}
          {page === 'packs' && 'Resource Packs (1.21 Compatible)'}
          {page === 'controls' && 'Controls'}
        </h2>
        {page !== 'main' && (
          <button
            type="button"
            className="mc-btn px-3 py-1 text-xs font-bold"
            onClick={() => {
              onUiClick();
              setPage('main');
            }}
          >
            Back
          </button>
        )}
      </div>

      {/* MAIN OPTIONS HUB */}
      {page === 'main' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="flex flex-col gap-1.5 bg-black/45 p-3 border border-white/15">
              <div className="flex justify-between">
                <span>Field of View (FOV)</span>
                <span className="text-amber-300 tabular-nums">{options.fov}°</span>
              </div>
              <input
                type="range"
                min={55}
                max={105}
                step={1}
                value={options.fov}
                onChange={(e) => onUpdateOptions({ fov: Number(e.target.value) })}
              />
            </label>

            <label className="flex flex-col gap-1.5 bg-black/45 p-3 border border-white/15">
              <div className="flex justify-between">
                <span>Master Volume</span>
                <span className="text-amber-300 tabular-nums">{Math.round(options.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={options.volume}
                onChange={(e) => onUpdateOptions({ volume: Number(e.target.value) })}
              />
            </label>

            <button
              type="button"
              className="mc-btn py-3 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setPage('video');
              }}
            >
              Video Settings...
            </button>
            <button
              type="button"
              className="mc-btn py-3 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setPage('audio');
              }}
            >
              Music &amp; Sounds...
            </button>
            <button
              type="button"
              className="mc-btn py-3 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setPage('packs');
              }}
            >
              Resource Packs...
            </button>
            <button
              type="button"
              className="mc-btn py-3 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setPage('controls');
              }}
            >
              Controls...
            </button>
          </div>

          <div className="text-[11px] text-neutral-300 bg-black/40 border border-white/10 px-3 py-2 flex items-center justify-between">
            <span>Active Resource Pack:</span>
            <span className="text-emerald-300 font-bold truncate ml-2">
              {activePackName || 'Default Procedural (Crisp 16px)'}
            </span>
          </div>
        </>
      )}

      {/* VIDEO SETTINGS */}
      {page === 'video' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              onUpdateOptions({ graphics: options.graphics === 'fast' ? 'fancy' : 'fast' });
            }}
          >
            Graphics: {options.graphics === 'fast' ? 'Fast (Lambert)' : 'Fancy (PBR)'}
          </button>

          <label className="flex flex-col gap-1.5 bg-black/45 p-3 border border-white/15">
            <div className="flex justify-between">
              <span>Render Distance</span>
              <span className="text-amber-300 tabular-nums">{options.viewDistance} chunks</span>
            </div>
            <input
              type="range"
              min={2}
              max={10}
              step={1}
              value={options.viewDistance}
              onChange={(e) => onUpdateOptions({ viewDistance: Number(e.target.value) })}
            />
          </label>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              onUpdateOptions({ clouds: !options.clouds });
            }}
          >
            Clouds: {options.clouds ? 'Fancy' : 'OFF'}
          </button>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              onUpdateOptions({ shadows: !options.shadows });
            }}
          >
            Shadows: {options.shadows ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              onUpdateOptions({ viewBobbing: !options.viewBobbing });
            }}
          >
            View Bobbing: {options.viewBobbing ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              const next = options.pixelRatioCap <= 1 ? 1.5 : options.pixelRatioCap <= 1.5 ? 2 : 1;
              onUpdateOptions({ pixelRatioCap: next });
            }}
          >
            Pixel Ratio Cap: {options.pixelRatioCap}x
          </button>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              const order: Array<'all' | 'decreased' | 'minimal'> = ['all', 'decreased', 'minimal'];
              const next = order[(order.indexOf(options.particles) + 1) % order.length];
              onUpdateOptions({ particles: next });
            }}
          >
            Particles: {options.particles.toUpperCase()}
          </button>

          <button
            type="button"
            className="mc-btn py-2.5 text-xs font-bold"
            onClick={() => {
              onUiClick();
              onUpdateOptions({ chunkBorders: !options.chunkBorders });
            }}
          >
            Chunk Borders (F3+G): {options.chunkBorders ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {/* MUSIC & SOUNDS */}
      {page === 'audio' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {(
            [
              ['Master Volume', 'volume'],
              ['Blocks & Mining', 'blocksVolume'],
              ['Mobs & Combat', 'mobsVolume'],
              ['Ambient & Portals', 'ambientVolume'],
              ['UI & Pickups', 'uiVolume'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="flex flex-col gap-1.5 bg-black/45 p-3 border border-white/15">
              <div className="flex justify-between">
                <span>{label}</span>
                <span className="text-amber-300 tabular-nums">{Math.round(options[key] * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={options[key]}
                onChange={(e) => onUpdateOptions({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      )}

      {/* RESOURCE PACKS (STREAMING 1.21 ZIP/JAR & FOLDER IMPORTER) */}
      {page === 'packs' && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="bg-black/45 border border-white/15 p-3 text-neutral-300 leading-relaxed">
            Select a full Minecraft 1.21 <span className="text-white font-bold">.zip / .jar</span> (even 700+ MB) or an extracted <span className="text-white font-bold">assets/</span> folder. Only the ~150 block, item, mob, and sound files used by VoxelCraft are streamed and cached in IndexedDB (~5–12 MB).
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={packBusy}
              className="mc-btn-green py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                zipInputRef.current?.click();
              }}
            >
              Import 1.21 ZIP / JAR...
            </button>
            <button
              type="button"
              disabled={packBusy}
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                folderInputRef.current?.click();
              }}
            >
              Import 1.21 Folder...
            </button>
          </div>

          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,.jar,application/zip,application/java-archive"
            onChange={handleZipSelected}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={handleFolderSelected}
            className="hidden"
          />

          {importProgress && (
            <div className="bg-black/70 border border-amber-400/50 p-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] text-amber-200 tabular-nums">
                <span>
                  {importProgress.phase === 'scanning' && `Scanning archive (${importProgress.scanned.toLocaleString()} entries)...`}
                  {importProgress.phase === 'extracting' && `Extracting ${importProgress.extracted} / ${importProgress.matched} matched assets...`}
                  {importProgress.phase === 'saving' && 'Caching pack in IndexedDB...'}
                  {importProgress.phase === 'done' && 'Applying textures & sounds...'}
                </span>
                <span>{formatMB(importProgress.extractedBytes)}</span>
              </div>
              <div className="w-full h-2 bg-neutral-800 border border-black overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{
                    width:
                      importProgress.phase === 'scanning'
                        ? '30%'
                        : importProgress.matched > 0
                        ? `${Math.max(10, Math.round((importProgress.extracted / importProgress.matched) * 100))}%`
                        : '100%',
                  }}
                />
              </div>
            </div>
          )}

          {packMessage && (
            <div
              className={`px-3 py-2 border text-[11px] ${
                packMessage.kind === 'error'
                  ? 'bg-red-950/75 border-red-400/60 text-red-200'
                  : 'bg-emerald-950/70 border-emerald-400/50 text-emerald-200'
              }`}
            >
              {packMessage.text}
            </div>
          )}

          {/* Classic Available / Active Pack List */}
          <div className="border-2 border-black bg-black/55 p-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {/* Built-in Procedural Fallback */}
            <div
              className={`flex items-center justify-between gap-2 px-3 py-2 border ${
                !activePackName
                  ? 'bg-[#2e4429] border-emerald-400 text-white'
                  : 'bg-[#1d1e22] border-neutral-800 text-neutral-300'
              }`}
            >
              <div className="min-w-0">
                <div className="font-bold text-xs">Default Procedural Pack</div>
                <div className="text-[10px] text-neutral-400">Built-in crisp 16×16 voxel textures &amp; Web Audio SFX</div>
              </div>
              <button
                type="button"
                disabled={!activePackName || packBusy}
                className="mc-btn px-3 py-1 text-[11px] font-bold shrink-0"
                onClick={() => handleSelectPack(null)}
              >
                {!activePackName ? 'Active' : 'Use Default'}
              </button>
            </div>

            {packs.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-2 px-3 py-2 border ${
                  p.enabled
                    ? 'bg-[#2e4429] border-emerald-400 text-white'
                    : 'bg-[#1d1e22] border-neutral-800 text-neutral-200'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs truncate">{p.name}</div>
                  <div className="text-[10px] text-neutral-400 tabular-nums">
                    {p.blockCount} blocks · {p.itemCount} items · {p.entityCount} mobs · {p.soundCount} sounds · {formatMB(p.extractedBytes)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={packBusy || p.enabled}
                    className="mc-btn px-2.5 py-1 text-[11px] font-bold"
                    onClick={() => handleSelectPack(p.id)}
                  >
                    {p.enabled ? 'Active' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={packBusy}
                    className="mc-btn px-2 py-1 text-[11px] font-bold text-red-200"
                    onClick={() => handleDeletePack(p.id, p.enabled)}
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONTROLS */}
      {page === 'controls' && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 bg-black/45 p-3 border border-white/15">
              <div className="flex justify-between">
                <span>Mouse Sensitivity</span>
                <span className="text-amber-300 tabular-nums">{Math.round(options.mouseSensitivity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={2.2}
                step={0.05}
                value={options.mouseSensitivity}
                onChange={(e) => onUpdateOptions({ mouseSensitivity: Number(e.target.value) })}
              />
            </label>

            <button
              type="button"
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                onUpdateOptions({ invertY: !options.invertY });
              }}
            >
              Invert Mouse Y: {options.invertY ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="bg-black/50 border border-white/15 p-3 grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] text-neutral-300">
            <div><span className="text-white font-bold">W A S D</span> — Move</div>
            <div><span className="text-white font-bold">Space</span> — Jump / Swim</div>
            <div><span className="text-white font-bold">Ctrl</span> — Sprint (+FOV)</div>
            <div><span className="text-white font-bold">Shift</span> — Sneak</div>
            <div><span className="text-white font-bold">LMB Hold</span> — Mine / Attack</div>
            <div><span className="text-white font-bold">RMB Hold</span> — Place / Eat / Bow / Light Portal</div>
            <div><span className="text-white font-bold">E</span> — Inventory &amp; 2×2 Craft</div>
            <div><span className="text-white font-bold">Q</span> — Drop Held Item</div>
            <div><span className="text-white font-bold">T / Slash</span> — Chat &amp; Commands</div>
            <div><span className="text-white font-bold">F3 / F3+G</span> — Debug / Chunk Borders</div>
            <div><span className="text-white font-bold">F5</span> — Third-Person Camera</div>
            <div><span className="text-white font-bold">F</span> — Toggle Fly (Creative)</div>
          </div>
        </div>
      )}

      {/* Footer Done Button */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          className="mc-btn px-12 py-2.5 text-sm font-bold"
          onClick={() => {
            onUiClick();
            onClose();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );

  if (standalone) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4 pointer-events-auto">
      {content}
    </div>
  );
};
