/**
 * @file ClassicHud.tsx
 * @description Authentic classic Minecraft HUD overlay:
 * - Pixel crosshair, bow draw bar, eating progress bar, and mining bar
 * - Bottom-center 9-slot stone hotbar with pixel icons, tabular counts, active white frame & durability bars
 * - Survival bars above hotbar: Armor chestplates, Hearts, Hunger drumsticks, Oxygen bubbles, and classic green XP bar + level numeral
 * - Underwater blue tint, fire/lava burn vignette, Nether portal purple swirl, red damage flash
 * - Bottom-left chat / slash command input with interactive autocomplete suggestions
 * - Classic "You Died!" screen
 */

import React, { useEffect, useMemo, useRef } from 'react';

export interface HudSlotView {
  itemId: string;
  name: string;
  count: number;
  icon: string | null;
  durability?: number;
  maxDurability?: number;
  enchants?: Record<string, number>;
  customName?: string;
}

export interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  timestamp: number;
  kind?: 'chat' | 'system' | 'error';
}

export interface AdvancementToastView {
  title: string;
  description: string;
  xpReward: number;
  iconUrl?: string;
}

export interface HudSnapshot {
  gameMode: 'survival' | 'creative';
  hotbar: Array<HudSlotView | null>;
  selectedSlot: number;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  air: number;
  maxAir: number;
  armorPoints: number;
  xpLevel: number;
  xpProgress: number;
  burnTimer: number;
  isDead: boolean;
  deathCause: string;
  submergedInWater: boolean;
  submergedInLava: boolean;
  heldItemLabel: string;
  bowCharge: number;
  eatingProgress: number;
  miningProgress: number;
  portalProgress: number;
  dimension: 'overworld' | 'nether' | 'end';
  pointerLocked: boolean;
  hurtFlash: number;
  bossBar?: {
    name: string;
    health: number;
    maxHealth: number;
    crystalsRemaining: number;
  } | null;
  activeEffects?: Array<{
    id: string;
    level: number;
    remaining: number;
  }>;
  fishingCast?: boolean;
  fishingBiting?: boolean;
  ridingBoat?: boolean;
  shieldBlocking?: boolean;
}

interface ClassicHudProps {
  hud: HudSnapshot;
  showHeldLabel: boolean;
  advancementToast?: AdvancementToastView | null;
  chatMessages: ChatMessage[];
  chatOpen: boolean;
  chatDraft: string;
  onChatDraftChange: (v: string) => void;
  onSubmitChat: () => void;
  onCloseChat: () => void;
  onSelectHotbar: (idx: number) => void;
  onRespawn: () => void;
  onQuitToTitle: () => void;
  onRequestResume: () => void;
}

const EFFECT_META: Record<string, { label: string; color: string }> = {
  speed: { label: 'Speed', color: '#38bdf8' },
  strength: { label: 'Strength', color: '#f87171' },
  fire_resistance: { label: 'Fire Res', color: '#fb923c' },
  night_vision: { label: 'Night Vision', color: '#818cf8' },
  regeneration: { label: 'Regeneration', color: '#f472b6' },
};

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

const SLASH_SUGGESTIONS = [
  '/time set day',
  '/time set night',
  '/weather clear',
  '/weather rain',
  '/weather thunder',
  '/gamemode creative',
  '/gamemode survival',
  '/dimension nether',
  '/dimension end',
  '/dimension overworld',
  '/locate stronghold',
  '/enchant sharpness 3',
  '/enchant efficiency 3',
  '/enchant fortune 3',
  '/effect night_vision 180',
  '/effect speed 180',
  '/xp add 50',
  '/give eye_of_ender 12',
  '/give shield 1',
  '/give fishing_rod 1',
  '/give oak_boat 1',
  '/give flint_and_steel 1',
  '/give obsidian 16',
  '/give diamond_pickaxe 1',
  '/spawn blaze',
  '/spawn villager',
  '/spawn wolf',
  '/spawn enderman',
  '/spawn sheep',
  '/spawn cow',
  '/tp 0 80 0',
  '/kill @e',
  '/seed',
  '/help',
];

function PixelHeart({ state }: { state: 'full' | 'half' | 'empty' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 9 9" className="mc-pixel shrink-0">
      <path
        d="M2 1h2v1h1V1h2v1h1v3H7v1H6v1H5v1H4V7H3V6H2V5H1V2h1V1z"
        fill="#191919"
      />
      <path
        d="M2 2h2v1h1V2h2v3H6v1H5v1H4V6H3V5H2V2z"
        fill="#3a1919"
      />
      {state === 'full' && (
        <>
          <path d="M2 2h2v1h1V2h2v3H6v1H5v1H4V6H3V5H2V2z" fill="#e11d24" />
          <rect x="2" y="2" width="1" height="1" fill="#ff8f92" />
        </>
      )}
      {state === 'half' && (
        <>
          <path d="M2 2h2v5H4V6H3V5H2V2z" fill="#e11d24" />
          <rect x="2" y="2" width="1" height="1" fill="#ff8f92" />
        </>
      )}
    </svg>
  );
}

function PixelHunger({ state }: { state: 'full' | 'half' | 'empty' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 9 9" className="mc-pixel shrink-0">
      <path d="M4 1h3v1h1v3H7v1H5v1H3v1H1V6h1V5h1V3h1V1z" fill="#1b140d" />
      <path d="M4 2h3v3H5v1H4V4h1V2z" fill="#3a291a" />
      {state !== 'empty' && (
        <>
          <path
            d={state === 'full' ? 'M4 2h3v3H5v1H4V2z' : 'M4 2h1v4H4V2z'}
            fill="#b86b2d"
          />
          <rect x="5" y="2" width="1" height="1" fill="#e5a66c" />
          <rect x="2" y="6" width="2" height="1" fill="#f2e6cf" />
        </>
      )}
    </svg>
  );
}

function PixelArmor({ state }: { state: 'full' | 'half' | 'empty' }) {
  return (
    <svg width="15" height="15" viewBox="0 0 9 9" className="mc-pixel shrink-0">
      <path d="M1 1h2v1h3V1h2v3H7v4H2V4H1V1z" fill="#181b20" />
      <path d="M2 2h1v1h3V2h1v5H2V2z" fill="#464b54" />
      {state === 'full' && (
        <>
          <path d="M2 2h1v1h3V2h1v5H2V2z" fill="#cfd8e3" />
          <rect x="2" y="2" width="1" height="2" fill="#ffffff" />
        </>
      )}
      {state === 'half' && (
        <path d="M2 2h1v1h1v4H2V2z" fill="#cfd8e3" />
      )}
    </svg>
  );
}

function PixelBubble({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 9 9" className="mc-pixel shrink-0">
      <circle cx="4.5" cy="4.5" r="3.5" fill={filled ? '#3da2ff' : 'rgba(120,170,220,0.2)'} stroke="#0f3e75" strokeWidth="1" />
      {filled && <rect x="3" y="2.5" width="1.5" height="1.5" fill="#d8f2ff" />}
    </svg>
  );
}

export const ClassicHud: React.FC<ClassicHudProps> = ({
  hud,
  showHeldLabel,
  advancementToast,
  chatMessages,
  chatOpen,
  chatDraft,
  onChatDraftChange,
  onSubmitChat,
  onCloseChat,
  onSelectHotbar,
  onRespawn,
  onQuitToTitle,
  onRequestResume,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [chatOpen]);

  const now = Date.now();
  const visibleMessages = chatOpen
    ? chatMessages.slice(-10)
    : chatMessages.filter((m) => now - m.timestamp < 9000).slice(-5);

  const commandSuggestions = useMemo(() => {
    if (!chatOpen || !chatDraft.startsWith('/')) return [];
    const q = chatDraft.trim().toLowerCase();
    return SLASH_SUGGESTIONS.filter((cmd) => cmd.toLowerCase().startsWith(q) && cmd.toLowerCase() !== q).slice(0, 5);
  }, [chatDraft, chatOpen]);

  const xpPercent = Math.max(0, Math.min(100, Math.round(hud.xpProgress * 100)));

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Underwater Blue Vignette */}
      {hud.submergedInWater && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at center, rgba(22, 82, 178, 0.28) 35%, rgba(10, 42, 108, 0.62) 100%)',
          }}
        />
      )}

      {/* Lava / Fire Burn Vignette */}
      {(hud.submergedInLava || hud.burnTimer > 0) && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: hud.submergedInLava
              ? 'rgba(210, 65, 10, 0.52)'
              : 'linear-gradient(0deg, rgba(255, 92, 0, 0.55) 0%, rgba(255, 165, 0, 0.12) 28%, transparent 55%)',
          }}
        />
      )}

      {/* Nether Portal Shimmering Swirl Vignette */}
      {hud.portalProgress > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            opacity: Math.min(0.88, 0.18 + hud.portalProgress * 0.72),
            background:
              'radial-gradient(circle at center, rgba(168, 85, 247, 0.28) 12%, rgba(126, 34, 206, 0.72) 60%, rgba(59, 7, 100, 0.92) 100%)',
          }}
        />
      )}

      {/* Red Damage Flash */}
      {hud.hurtFlash > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{ backgroundColor: `rgba(215, 25, 25, ${Math.min(0.45, hud.hurtFlash * 0.45)})` }}
        />
      )}

      {/* Center Classic Crosshair + Bow / Eating / Mining Bars */}
      {!hud.isDead && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="relative w-6 h-6">
            <div className="absolute left-1/2 top-0.5 bottom-0.5 w-[2px] -translate-x-1/2 bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)]" />
            <div className="absolute top-1/2 left-0.5 right-0.5 h-[2px] -translate-y-1/2 bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)]" />
          </div>

          {hud.bowCharge > 0.02 && (
            <div className="mt-2 w-12 h-1.5 bg-black/75 border border-white/40">
              <div
                className="h-full bg-amber-300"
                style={{ width: `${Math.round(hud.bowCharge * 100)}%` }}
              />
            </div>
          )}

          {hud.eatingProgress > 0.02 && (
            <div className="mt-2 w-14 h-1.5 bg-black/75 border border-amber-200/50">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.round(hud.eatingProgress * 100)}%` }}
              />
            </div>
          )}

          {hud.miningProgress > 0.02 && hud.miningProgress < 1 && (
            <div className="mt-2 w-14 h-1 bg-black/70 border border-white/25">
              <div
                className="h-full bg-white"
                style={{ width: `${Math.round(hud.miningProgress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Top-Center Ender Dragon Boss Health Bar */}
      {hud.bossBar && !hud.isDead && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[360px] max-w-[90vw] flex flex-col items-center gap-1 z-20">
          <div className="flex items-center justify-between w-full px-1">
            <span className="text-sm font-bold text-fuchsia-100 mc-text-shadow">
              {hud.bossBar.name}
            </span>
            {hud.bossBar.crystalsRemaining > 0 && (
              <span className="text-[11px] font-bold text-fuchsia-300 mc-text-shadow-sm">
                Crystals: {hud.bossBar.crystalsRemaining}
              </span>
            )}
          </div>
          <div className="w-full h-3 bg-[#1e0a24] border-2 border-[#4a175e] shadow-lg overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#a21caf] via-[#d946ef] to-[#c026d3] transition-all duration-150"
              style={{
                width: `${Math.max(0, Math.min(100, (hud.bossBar.health / Math.max(1, hud.bossBar.maxHealth)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Top-Right Advancement Unlocked Toast */}
      {advancementToast && (
        <div className="fixed top-4 right-4 z-30 w-72 bg-[#232323] border-2 border-amber-400 shadow-2xl px-3 py-2.5 flex items-center gap-2.5">
          {advancementToast.iconUrl && (
            <div className="w-9 h-9 bg-amber-600/30 border border-amber-300 flex items-center justify-center shrink-0">
              <img src={advancementToast.iconUrl} alt="" className="w-7 h-7 mc-pixel" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold text-amber-300 mc-text-shadow-sm">
              Advancement Made!
            </div>
            <div className="text-xs font-bold text-white truncate mc-text-shadow-sm">
              {advancementToast.title}
            </div>
            <div className="text-[10px] text-neutral-300 truncate">
              {advancementToast.description} (+{advancementToast.xpReward} XP)
            </div>
          </div>
        </div>
      )}

      {/* Top-Right Active Potion Effects */}
      {hud.activeEffects && hud.activeEffects.length > 0 && !hud.isDead && (
        <div
          className={`fixed right-4 flex flex-col gap-1.5 z-20 ${
            advancementToast ? 'top-24' : 'top-4'
          }`}
        >
          {hud.activeEffects.map((ef) => {
            const meta = EFFECT_META[ef.id] || { label: ef.id, color: '#e5e7eb' };
            return (
              <div
                key={ef.id}
                className="bg-black/70 border border-white/25 px-2.5 py-1 flex items-center justify-between gap-3 min-w-[140px]"
              >
                <span className="text-xs font-bold mc-text-shadow-sm" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span className="text-[11px] font-mono text-white tabular-nums mc-text-shadow-sm">
                  {formatDuration(ef.remaining)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Subtle Pointer-Lock Resume Hint when unlocked and no modal open */}
      {!hud.pointerLocked && !hud.isDead && !chatOpen && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 pointer-events-auto ${
            hud.bossBar ? 'top-16' : 'top-4'
          }`}
        >
          <button
            type="button"
            onClick={onRequestResume}
            className="mc-panel-dark px-4 py-1.5 text-xs text-neutral-100 mc-text-shadow-sm hover:border-white cursor-pointer"
          >
            Click to capture mouse • [E] Inventory • [L] Advancements • [F5] Camera • [T] Chat • [Esc] Pause
          </button>
        </div>
      )}

      {/* Bottom-Left Classic Chat Log, Autocomplete & Input */}
      <div className="fixed left-3 bottom-24 w-full max-w-md flex flex-col gap-1.5">
        {visibleMessages.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {visibleMessages.map((msg) => (
              <div
                key={msg.id}
                className="bg-black/55 px-2.5 py-1 text-xs leading-snug mc-text-shadow-sm break-words"
              >
                {msg.kind === 'system' ? (
                  <span className="text-amber-200">{msg.text}</span>
                ) : msg.kind === 'error' ? (
                  <span className="text-red-300">{msg.text}</span>
                ) : (
                  <>
                    <span className="text-neutral-300">&lt;{msg.sender}&gt; </span>
                    <span className="text-white">{msg.text}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {chatOpen && commandSuggestions.length > 0 && (
          <div className="pointer-events-auto flex flex-col bg-black/85 border border-white/30">
            {commandSuggestions.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => {
                  onChatDraftChange(cmd);
                  inputRef.current?.focus();
                }}
                className="px-2.5 py-1 text-left text-[11px] text-amber-200 hover:bg-white/15 cursor-pointer"
              >
                {cmd}
              </button>
            ))}
          </div>
        )}

        {chatOpen && (
          <form
            className="pointer-events-auto flex items-center bg-black/80 border-2 border-white/60"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitChat();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={chatDraft}
              onChange={(e) => onChatDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCloseChat();
                } else if (e.key === 'Tab' && commandSuggestions.length > 0) {
                  e.preventDefault();
                  onChatDraftChange(commandSuggestions[0]);
                }
              }}
              placeholder="Type chat or /help (/time, /weather, /xp, /dimension, /give, /spawn)..."
              className="w-full bg-transparent px-2.5 py-1.5 text-xs text-white outline-none"
            />
          </form>
        )}
      </div>

      {/* Bottom-Center Survival Bars, Classic XP Bar & 9-Slot Hotbar */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        {/* Contextual Action Prompt (Fishing Bite, Boat Riding, Shield Blocking) */}
        {(hud.fishingBiting || hud.ridingBoat || hud.shieldBlocking) && !hud.isDead && (
          <div className="px-3 py-0.5 bg-black/65 border border-white/20 text-xs font-bold mc-text-shadow-sm text-amber-200">
            {hud.fishingBiting
              ? 'Splash! Right-click now to reel in!'
              : hud.ridingBoat
              ? 'Oak Boat — W/A/S/D to paddle • Shift to dismount'
              : 'Shield Raised — Blocking Attacks'}
          </div>
        )}

        {/* Held Item Name Fade Banner */}
        <div
          className={`text-sm font-bold text-white mc-text-shadow transition-opacity duration-300 h-5 ${
            showHeldLabel && hud.heldItemLabel ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {hud.heldItemLabel}
        </div>

        {/* Survival Vitals Stack (Armor, Air, Hearts, Hunger, XP Bar) */}
        {hud.gameMode === 'survival' && (
          <div className="w-[454px] max-w-[96vw] flex flex-col gap-1 px-0.5">
            {/* Upper Row: Armor (left) & Air Bubbles (right) */}
            {(hud.armorPoints > 0 || hud.air < hud.maxAir) && (
              <div className="flex items-center justify-between h-4">
                <div className="flex items-center gap-[1px]">
                  {hud.armorPoints > 0 &&
                    Array.from({ length: 10 }).map((_, i) => {
                      const val = hud.armorPoints - i * 2;
                      const state = val >= 2 ? 'full' : val >= 1 ? 'half' : 'empty';
                      return <PixelArmor key={i} state={state} />;
                    })}
                </div>
                <div className="flex items-center gap-[1px]">
                  {hud.air < hud.maxAir &&
                    Array.from({ length: 10 }).map((_, i) => {
                      const filled = hud.air >= (i + 1) * (hud.maxAir / 10) - 0.1;
                      return <PixelBubble key={i} filled={filled} />;
                    })}
                </div>
              </div>
            )}

            {/* Middle Row: Hearts (left) & Hunger Drumsticks (right) */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[1px]">
                {Array.from({ length: 10 }).map((_, i) => {
                  const val = hud.health - i * 2;
                  const state = val >= 2 ? 'full' : val >= 1 ? 'half' : 'empty';
                  return <PixelHeart key={i} state={state} />;
                })}
              </div>
              <div className="flex items-center gap-[1px]">
                {Array.from({ length: 10 }).map((_, i) => {
                  const val = hud.hunger - i * 2;
                  const state = val >= 2 ? 'full' : val >= 1 ? 'half' : 'empty';
                  return <PixelHunger key={i} state={state} />;
                })}
              </div>
            </div>

            {/* Classic 18-Segment Green XP Bar + Centered Glowing Lime Level Numeral */}
            <div className="relative pt-1">
              {hud.xpLevel > 0 && (
                <div
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs font-black tabular-nums leading-none z-10"
                  style={{
                    color: '#80ff20',
                    textShadow: '-1px 0 #000, 1px 0 #000, 0 -1px #000, 0 1px #000',
                  }}
                >
                  {hud.xpLevel}
                </div>
              )}
              <div className="relative w-full h-[7px] bg-[#1c2b1a] border border-black overflow-hidden">
                <div
                  className="h-full bg-[#7be320] transition-all duration-150"
                  style={{ width: `${xpPercent}%` }}
                />
                {/* Classic 18-segment tick dividers */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, transparent, transparent calc(100% / 18 - 1px), rgba(0,0,0,0.45) calc(100% / 18 - 1px), rgba(0,0,0,0.45) calc(100% / 18))',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Classic 9-Slot Hotbar */}
        <div className="mc-hotbar-shell p-1 flex items-center gap-1 pointer-events-auto">
          {Array.from({ length: 9 }).map((_, idx) => {
            const slot = hud.hotbar[idx];
            const selected = idx === hud.selectedSlot;
            const durRatio =
              slot?.maxDurability && slot.durability !== undefined
                ? Math.max(0, Math.min(1, slot.durability / slot.maxDurability))
                : null;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectHotbar(idx)}
                className={`relative w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center cursor-pointer ${
                  selected ? 'mc-hotbar-slot-selected -my-0.5 z-10' : 'mc-hotbar-slot'
                } ${
                  slot?.enchants && Object.keys(slot.enchants).length > 0
                    ? 'ring-1 ring-inset ring-fuchsia-400/80 bg-fuchsia-950/35'
                    : ''
                }`}
                title={slot?.customName || slot?.name || `Hotbar ${idx + 1}`}
              >
                <span className="absolute top-0.5 left-1 text-[9px] text-white/45 leading-none">
                  {idx + 1}
                </span>

                {slot && (
                  <>
                    {slot.icon && (
                      <img
                        src={slot.icon}
                        alt={slot.name}
                        className="w-8 h-8 mc-pixel pointer-events-none"
                        draggable={false}
                      />
                    )}
                    {slot.count > 1 && (
                      <span className="absolute bottom-0.5 right-1 text-[11px] font-bold text-white mc-text-shadow-sm tabular-nums leading-none">
                        {slot.count}
                      </span>
                    )}
                    {durRatio !== null && durRatio < 1 && (
                      <div className="absolute bottom-1 left-1.5 right-1.5 h-1 bg-black">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.round(durRatio * 100)}%`,
                            backgroundColor:
                              durRatio > 0.5 ? '#4ade80' : durRatio > 0.25 ? '#facc15' : '#ef4444',
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Classic "You Died!" Overlay */}
      {hud.isDead && (
        <div className="fixed inset-0 z-40 pointer-events-auto bg-[#5a0d0d]/75 flex flex-col items-center justify-center gap-6 px-4">
          <div className="text-center">
            <h2 className="text-5xl font-black text-white mc-text-shadow tracking-wider">
              You Died!
            </h2>
            <p className="text-sm text-red-100 mc-text-shadow-sm mt-2">
              Defeated by: {hud.deathCause || 'unknown'}
            </p>
          </div>

          <div className="w-full max-w-xs flex flex-col gap-3">
            <button
              type="button"
              className="mc-btn w-full py-3 text-base font-bold"
              onClick={onRespawn}
            >
              Respawn
            </button>
            <button
              type="button"
              className="mc-btn w-full py-3 text-base font-bold"
              onClick={onQuitToTitle}
            >
              Title Screen
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
