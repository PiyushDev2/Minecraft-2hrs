/**
 * @file TitleScreen.tsx
 * @description Classic Minecraft Title Screen overlaid over the live rotating 3D voxel panorama.
 * Includes Singleplayer World Picker (Play / Create New / Import JSON / Delete), Multiplayer Lobby,
 * and Quick Options.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClassicOptionsModal,
  type GameOptionsState,
  type OptionsSubPage,
} from './ClassicOptionsModal';
import type { StoredResourcePack } from '../game/ResourcePackManager';
import { normalizeWebSocketUrl } from '../backend/network/MultiplayerProtocol.js';

export type { GameOptionsState };

export interface SavedWorldMeta {
  slotName: string;
  seed: number;
  savedAt: string;
  totalModifiedBlocks: number;
  gameMode?: string;
}

interface TitleScreenProps {
  worlds: SavedWorldMeta[];
  options: GameOptionsState;
  activePackName: string | null;
  onUpdateOptions: (next: Partial<GameOptionsState>) => void;
  onApplyResourcePack: (pack: StoredResourcePack | null) => Promise<void>;
  onPlayNewWorld: (name: string, seed: string, gameMode: 'survival' | 'creative') => void;
  onLoadWorld: (slotName: string) => void;
  onDeleteWorld: (slotName: string) => void;
  onImportWorldJson: (jsonText: string) => void;
  onJoinMultiplayer: (roomId: string, playerName: string, serverUrl: string) => void;
  onTestMultiplayerServer: (serverUrl: string) => Promise<{ ok: boolean; message: string }>;
  onUiClick: () => void;
}

const SPLASH_TEXTS = [
  '100% Procedural Voxels!',
  'Enter the Nether!',
  'Supports 1.21 Resource Packs!',
  'Don\'t Stare at Endermen!',
  'Woodland Cottages & Dungeons!',
  'Press F3 for Debug HUD!',
  'Mine Diamonds at Y < 16!',
  'Classic Feel, Crisp Pixels!',
];

type SubView = 'main' | 'singleplayer' | 'create' | 'multiplayer' | 'options';

export const TitleScreen: React.FC<TitleScreenProps> = ({
  worlds,
  options,
  activePackName,
  onUpdateOptions,
  onApplyResourcePack,
  onPlayNewWorld,
  onLoadWorld,
  onDeleteWorld,
  onImportWorldJson,
  onJoinMultiplayer,
  onTestMultiplayerServer,
  onUiClick,
}) => {
  const [view, setView] = useState<SubView>('main');
  const [optionsInitialPage, setOptionsInitialPage] = useState<OptionsSubPage>('main');
  const [selectedSlot, setSelectedSlot] = useState<string>(worlds[0]?.slotName ?? '');
  const [newName, setNewName] = useState('New World');
  const [newSeed, setNewSeed] = useState('');
  const [newMode, setNewMode] = useState<'survival' | 'creative'>('survival');
  const [mpRoom, setMpRoom] = useState('lobby');
  const [mpPlayer, setMpPlayer] = useState(() => `Steve${Math.floor(100 + Math.random() * 900)}`);
  const [mpServer, setMpServer] = useState(() => {
    const configuredUrl = import.meta.env?.VITE_MULTIPLAYER_WS_URL?.trim();
    if (configuredUrl) return configuredUrl;
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  });
  const [mpError, setMpError] = useState('');
  const [serverCheck, setServerCheck] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [serverMessage, setServerMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (worlds.length === 0) {
      if (selectedSlot) setSelectedSlot('');
    } else if (!worlds.some((w) => w.slotName === selectedSlot)) {
      setSelectedSlot(worlds[0].slotName);
    }
  }, [worlds, selectedSlot]);

  const splash = useMemo(
    () => SPLASH_TEXTS[Math.floor(Math.random() * SPLASH_TEXTS.length)],
    []
  );

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImportWorldJson(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const getValidatedServerUrl = () => {
    try {
      const pageUrl = typeof window === 'undefined' ? 'https://localhost' : window.location.href;
      return normalizeWebSocketUrl(mpServer, pageUrl);
    } catch (error) {
      setMpError(error instanceof Error ? error.message : 'Enter a valid multiplayer server address.');
      setServerCheck('offline');
      setServerMessage('Server address needs attention.');
      return null;
    }
  };

  const handleTestServer = async () => {
    onUiClick();
    setMpError('');
    const serverUrl = getValidatedServerUrl();
    if (!serverUrl) return;
    setServerCheck('checking');
    setServerMessage('Checking WebSocket connection…');
    try {
      const result = await onTestMultiplayerServer(serverUrl);
      setServerCheck(result.ok ? 'online' : 'offline');
      setServerMessage(result.message);
    } catch (error) {
      setServerCheck('offline');
      setServerMessage(error instanceof Error ? error.message : 'Server check failed.');
    }
  };

  const handleJoinServer = () => {
    onUiClick();
    setMpError('');
    const roomId = mpRoom.trim();
    const playerName = mpPlayer.trim();
    if (!roomId || roomId.length > 32 || !/^[a-zA-Z0-9 _-]+$/.test(roomId)) {
      setMpError('Room IDs need 1–32 letters, numbers, spaces, dashes, or underscores.');
      return;
    }
    if (!playerName || playerName.length > 20 || !/^[a-zA-Z0-9 _-]+$/.test(playerName)) {
      setMpError('Player names need 1–20 letters, numbers, spaces, dashes, or underscores.');
      return;
    }
    const serverUrl = getValidatedServerUrl();
    if (!serverUrl) return;
    onJoinMultiplayer(roomId, playerName, serverUrl);
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center justify-between py-10 px-4 pointer-events-auto bg-gradient-to-b from-black/35 via-black/15 to-black/55">
      {/* Top Classic Logo + Animated Splash */}
      <div className="relative flex flex-col items-center mt-4 select-none">
        <h1 className="mc-title-logo text-5xl sm:text-7xl font-black tracking-widest uppercase">
          VOXELCRAFT
        </h1>
        <div className="text-xs sm:text-sm font-bold tracking-[0.28em] uppercase text-[#e6e6e6] mc-text-shadow -mt-1">
          COMPLETE EDITION
        </div>
        <div className="mc-splash absolute -right-4 sm:-right-12 -bottom-4 text-xs sm:text-base font-bold whitespace-nowrap pointer-events-none">
          {splash}
        </div>
      </div>

      {/* Center Menu Content */}
      {view === 'main' && (
        <div className="w-full max-w-md flex flex-col gap-3 my-auto">
          <button
            type="button"
            className="mc-btn w-full py-3.5 text-base font-bold"
            onClick={() => {
              onUiClick();
              if (worlds.length > 0 && !selectedSlot) {
                setSelectedSlot(worlds[0].slotName);
              }
              setView('singleplayer');
            }}
          >
            Singleplayer
          </button>

          <button
            type="button"
            className="mc-btn w-full py-3.5 text-base font-bold"
            onClick={() => {
              onUiClick();
              setView('multiplayer');
            }}
          >
            Multiplayer
          </button>

          <button
            type="button"
            className="mc-btn-green w-full py-3 text-base font-bold"
            onClick={() => {
              onUiClick();
              onPlayNewWorld(
                `Survival-${Math.floor(100 + Math.random() * 900)}`,
                String(Math.floor(Math.random() * 999999)),
                'survival'
              );
            }}
          >
            Quick Play Survival
          </button>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setOptionsInitialPage('main');
                setView('options');
              }}
            >
              Options...
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setOptionsInitialPage('packs');
                setView('options');
              }}
            >
              Resource Packs...
            </button>
          </div>
        </div>
      )}

      {view === 'singleplayer' && (
        <div className="mc-panel-dark w-full max-w-2xl p-5 flex flex-col gap-4 my-auto">
          <div className="flex items-center justify-between border-b border-white/15 pb-2">
            <h2 className="text-lg font-bold mc-text-shadow text-white">Select World</h2>
            <span className="text-xs text-neutral-400">
              {worlds.length} saved {worlds.length === 1 ? 'world' : 'worlds'}
            </span>
          </div>

          <div className="h-60 overflow-y-auto border-2 border-black bg-black/55 p-2 flex flex-col gap-1.5">
            {worlds.length === 0 ? (
              <div className="m-auto text-center text-sm text-neutral-400 py-10">
                No saved worlds yet. Click &ldquo;Create New World&rdquo; to begin!
              </div>
            ) : (
              worlds.map((w) => {
                const active = selectedSlot === w.slotName;
                return (
                  <button
                    key={w.slotName}
                    type="button"
                    onClick={() => {
                      onUiClick();
                      setSelectedSlot(w.slotName);
                    }}
                    onDoubleClick={() => {
                      onUiClick();
                      onLoadWorld(w.slotName);
                    }}
                    className={`w-full text-left px-3 py-2.5 border-2 transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#3d485d] border-white text-white'
                        : 'bg-[#1d1e22] border-neutral-800 text-neutral-200 hover:bg-[#2a2c33]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm mc-text-shadow-sm">{w.slotName}</span>
                      <span className="text-xs uppercase px-1.5 py-0.5 bg-black/50 text-amber-300">
                        {w.gameMode || 'survival'}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5 flex items-center justify-between tabular-nums">
                      <span>
                        Seed: {w.seed} • {w.totalModifiedBlocks} edited blocks
                      </span>
                      <span>{w.savedAt ? new Date(w.savedAt).toLocaleDateString() : ''}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              disabled={!selectedSlot}
              className="mc-btn-green py-2.5 text-sm font-bold"
              onClick={() => {
                if (!selectedSlot) return;
                onUiClick();
                onLoadWorld(selectedSlot);
              }}
            >
              Play Selected
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setView('create');
              }}
            >
              Create New World
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                fileInputRef.current?.click();
              }}
            >
              Import JSON
            </button>
            <button
              type="button"
              disabled={!selectedSlot}
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                if (!selectedSlot) return;
                onUiClick();
                onDeleteWorld(selectedSlot);
                setSelectedSlot('');
              }}
            >
              Delete
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />

          <div className="flex justify-center pt-1">
            <button
              type="button"
              className="mc-btn px-10 py-2 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setView('main');
              }}
            >
              Back to Title
            </button>
          </div>
        </div>
      )}

      {view === 'create' && (
        <div className="mc-panel-dark w-full max-w-lg p-5 flex flex-col gap-4 my-auto">
          <h2 className="text-lg font-bold mc-text-shadow text-center border-b border-white/15 pb-2">
            Create New World
          </h2>

          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            <span>World Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-black border-2 border-neutral-500 px-3 py-2 text-sm text-white focus:border-white outline-none"
              maxLength={32}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            <span>Seed for World Generator (leave blank for random)</span>
            <input
              type="text"
              value={newSeed}
              onChange={(e) => setNewSeed(e.target.value)}
              placeholder="e.g. 1337 or glacier"
              className="bg-black border-2 border-neutral-500 px-3 py-2 text-sm text-white focus:border-white outline-none"
              maxLength={32}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-neutral-300">Game Mode</span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className={newMode === 'survival' ? 'mc-btn-green py-2.5 text-sm font-bold' : 'mc-btn py-2.5 text-sm font-bold'}
                onClick={() => {
                  onUiClick();
                  setNewMode('survival');
                }}
              >
                Survival
              </button>
              <button
                type="button"
                className={newMode === 'creative' ? 'mc-btn-green py-2.5 text-sm font-bold' : 'mc-btn py-2.5 text-sm font-bold'}
                onClick={() => {
                  onUiClick();
                  setNewMode('creative');
                }}
              >
                Creative
              </button>
            </div>
            <p className="text-[11px] text-neutral-400">
              {newMode === 'survival'
                ? 'Gather resources, craft tools, smelt ores, wear armor, and survive monsters.'
                : 'Unlimited blocks, instant mining, flight (press F), and full item catalog.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              className="mc-btn-green py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                const finalName = newName.trim() || `World-${Math.floor(100 + Math.random() * 900)}`;
                const finalSeed = newSeed.trim() || String(Math.floor(Math.random() * 999999));
                onPlayNewWorld(finalName, finalSeed, newMode);
              }}
            >
              Create New World
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setView('singleplayer');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {view === 'multiplayer' && (
        <div className="mc-panel-dark w-full max-w-lg p-5 flex flex-col gap-3.5 my-auto max-h-[calc(100dvh-7rem)] overflow-y-auto">
          <h2 className="text-lg font-bold mc-text-shadow text-center border-b border-white/15 pb-2">
            Play Multiplayer
          </h2>
          <p className="text-xs text-neutral-300 leading-relaxed">
            Join a live WebSocket room with friends. Share the same server address and room ID to meet up.
            Server checks can confirm that the address responds before you join.
          </p>

          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            <span>Server Address</span>
            <input
              type="text"
              value={mpServer}
              onChange={(e) => {
                setMpServer(e.target.value);
                setMpError('');
                setServerCheck('idle');
                setServerMessage('');
              }}
              className="bg-black border-2 border-neutral-500 px-3 py-2 text-sm text-white focus:border-white outline-none"
              placeholder="play.example.com or wss://play.example.com/ws"
              autoCapitalize="off"
              autoComplete="url"
              spellCheck={false}
              inputMode="url"
              maxLength={255}
              aria-describedby="mp-server-help mp-server-status"
            />
            <span id="mp-server-help" className="text-[11px] text-neutral-400">
              Hostname or ws:// / wss:// address. Secure pages require wss://.
            </span>
          </label>

          <button
            type="button"
            className="mc-btn py-2 text-sm font-bold"
            onClick={handleTestServer}
            disabled={serverCheck === 'checking'}
          >
            {serverCheck === 'checking' ? 'Checking Server…' : 'Check Server'}
          </button>
          <p
            id="mp-server-status"
            role="status"
            aria-live="polite"
            className={`min-h-4 text-xs ${serverCheck === 'online' ? 'text-emerald-300' : serverCheck === 'offline' ? 'text-rose-300' : 'text-neutral-300'}`}
          >
            {serverMessage || 'A server check verifies WebSocket reachability, not whether a specific room is full.'}
          </p>

          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            <span>Player Name</span>
            <input
              type="text"
              value={mpPlayer}
              onChange={(e) => {
                setMpPlayer(e.target.value);
                setMpError('');
              }}
              className="bg-black border-2 border-neutral-500 px-3 py-2 text-sm text-white focus:border-white outline-none"
              maxLength={20}
              autoComplete="nickname"
              aria-describedby="mp-name-help"
            />
            <span id="mp-name-help" className="text-[11px] text-neutral-400">1–20 letters, numbers, spaces, dashes, or underscores.</span>
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            <span>Room ID</span>
            <input
              type="text"
              value={mpRoom}
              onChange={(e) => {
                setMpRoom(e.target.value);
                setMpError('');
              }}
              className="bg-black border-2 border-neutral-500 px-3 py-2 text-sm text-white focus:border-white outline-none"
              maxLength={32}
              aria-describedby="mp-room-help"
            />
            <span id="mp-room-help" className="text-[11px] text-neutral-400">1–32 letters, numbers, spaces, dashes, or underscores. Matching is case-insensitive.</span>
          </label>

          {mpError && <p role="alert" className="text-xs text-rose-300">{mpError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              className="mc-btn-green py-2.5 text-sm font-bold"
              onClick={handleJoinServer}
            >
              Join Server Room
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-sm font-bold"
              onClick={() => {
                onUiClick();
                setView('main');
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {view === 'options' && (
        <div className="my-auto w-full flex justify-center">
          <ClassicOptionsModal
            standalone
            options={options}
            initialPage={optionsInitialPage}
            activePackName={activePackName}
            onUpdateOptions={onUpdateOptions}
            onApplyResourcePack={onApplyResourcePack}
            onClose={() => setView('main')}
            onUiClick={onUiClick}
          />
        </div>
      )}

      {/* Classic Bottom Version Footer */}
      <div className="w-full flex items-center justify-between text-xs text-white/90 mc-text-shadow px-2">
        <span>VoxelCraft 1.21 Complete Edition</span>
        <span>Procedural WebGL Voxel Engine</span>
      </div>
    </div>
  );
};
