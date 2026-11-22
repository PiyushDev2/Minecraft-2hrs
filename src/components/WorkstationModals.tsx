import React, { useEffect, useState } from 'react';
import { formatEnchantLabel } from '../backend/index.js';

export type WorkstationModalType =
  | null
  | { type: 'enchanting_table'; x: number; y: number; z: number }
  | { type: 'anvil'; x: number; y: number; z: number }
  | { type: 'brewing_stand'; x: number; y: number; z: number }
  | { type: 'villager'; entityId: number; profession: string }
  | { type: 'sign'; x: number; y: number; z: number }
  | { type: 'advancements' };

interface WorkstationModalsProps {
  modal: WorkstationModalType;
  worldManager: any;
  revision: number;
  onRefresh: () => void;
  onClose: () => void;
  onUiClick: () => void;
  onNotify?: (msg: string) => void;
}

function getItemIcon(wm: any, itemId: string | null | undefined): string {
  if (!itemId || !wm) return '';
  return wm.itemRegistry.getItemIconUrl(itemId, wm.world.textureAtlas) || '';
}

function formatStackTooltip(wm: any, stack: any): string {
  if (!stack) return '';
  const def = wm?.itemRegistry?.get(stack.itemId);
  const title = stack.customName || def?.name || stack.itemId;
  const enchList = stack.enchants
    ? Object.entries(stack.enchants)
        .map(([k, v]) => formatEnchantLabel(k, v as number))
        .join(', ')
    : '';
  return enchList ? `${title} — ${enchList}` : title;
}

function MiniSlot({
  wm,
  stack,
  selected = false,
  highlight = false,
  label,
  onClick,
  size = 'w-10 h-10',
}: {
  wm: any;
  stack: any;
  selected?: boolean;
  highlight?: boolean;
  label?: string;
  onClick?: () => void;
  size?: string;
}) {
  const icon = stack ? getItemIcon(wm, stack.itemId) : '';
  const hasEnchants = Boolean(stack?.enchants && Object.keys(stack.enchants).length > 0);
  const durPct =
    stack?.maxDurability && stack?.durability !== undefined
      ? Math.max(0, Math.min(1, stack.durability / stack.maxDurability))
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={stack ? formatStackTooltip(wm, stack) : label || 'Empty'}
      className={`relative ${size} flex items-center justify-center ${
        selected ? 'mc-slot-active' : 'mc-slot'
      } ${hasEnchants ? 'ring-1 ring-inset ring-fuchsia-400/80 bg-fuchsia-950/35' : ''} ${
        highlight && !selected ? 'ring-1 ring-inset ring-sky-400/70' : ''
      }`}
    >
      {icon ? (
        <img src={icon} alt={stack.itemId} className="w-7 h-7 mc-pixel pointer-events-none select-none" />
      ) : label ? (
        <span className="text-[9px] text-neutral-500 font-bold select-none">{label}</span>
      ) : null}

      {stack && stack.count > 1 && (
        <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white mc-text-shadow-sm pointer-events-none leading-none">
          {stack.count}
        </span>
      )}

      {durPct !== null && durPct < 1 && (
        <div className="absolute bottom-0.5 left-1 right-1 h-1 bg-black/80 pointer-events-none">
          <div
            className="h-full"
            style={{
              width: `${Math.round(durPct * 100)}%`,
              backgroundColor: durPct > 0.5 ? '#22c55e' : durPct > 0.25 ? '#eab308' : '#ef4444',
            }}
          />
        </div>
      )}
    </button>
  );
}

function PlayerInventoryGrid({
  wm,
  selectedIndices = [],
  isHighlighted,
  onClickSlot,
}: {
  wm: any;
  selectedIndices?: number[];
  isHighlighted?: (stack: any) => boolean;
  onClickSlot: (slotIndex: number) => void;
}) {
  const slots: any[] = wm.inventory.slots;
  const backpack = slots.slice(9, 36);
  const hotbar = slots.slice(0, 9);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-bold text-[#3f3f3f]">Inventory</div>
      <div className="grid grid-cols-9 gap-1">
        {backpack.map((stack, i) => {
          const idx = i + 9;
          return (
            <MiniSlot
              key={idx}
              wm={wm}
              stack={stack}
              selected={selectedIndices.includes(idx)}
              highlight={Boolean(isHighlighted?.(stack))}
              onClick={() => onClickSlot(idx)}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-9 gap-1 pt-1 border-t border-[#8b8b8b]">
        {hotbar.map((stack, idx) => (
          <MiniSlot
            key={idx}
            wm={wm}
            stack={stack}
            selected={selectedIndices.includes(idx)}
            highlight={Boolean(isHighlighted?.(stack))}
            onClick={() => onClickSlot(idx)}
          />
        ))}
      </div>
    </div>
  );
}

export const WorkstationModals: React.FC<WorkstationModalsProps> = ({
  modal,
  worldManager: wm,
  revision,
  onRefresh,
  onClose,
  onUiClick,
  onNotify,
}) => {
  // Enchanting table selected inventory slot
  const [enchantSlot, setEnchantSlot] = useState<number>(-1);
  // Anvil left/right inventory slots + rename input
  const [anvilLeft, setAnvilLeft] = useState<number>(-1);
  const [anvilRight, setAnvilRight] = useState<number>(-1);
  const [anvilName, setAnvilName] = useState<string>('');
  // Sign 4 lines
  const [signLines, setSignLines] = useState<string[]>(['', '', '', '']);
  // Advancements category filter
  const [advCategory, setAdvCategory] = useState<string>('All');
  // Inline status message
  const [statusMsg, setStatusMsg] = useState<string>('');

  const modalKey = modal
    ? `${modal.type}:${'x' in modal ? `${modal.x},${modal.y},${modal.z}` : 'entityId' in modal ? modal.entityId : ''}`
    : '';

  useEffect(() => {
    setEnchantSlot(-1);
    setAnvilLeft(-1);
    setAnvilRight(-1);
    setAnvilName('');
    setStatusMsg('');
    if (modal?.type === 'sign' && wm) {
      const s = wm.blockEntities.getOrCreateSign(modal.x, modal.y, modal.z);
      setSignLines([s.lines[0] || '', s.lines[1] || '', s.lines[2] || '', s.lines[3] || '']);
    }
  }, [modalKey, modal, wm]);

  if (!modal || !wm) return null;
  // Consume revision prop so live updates re-render cleanly
  void revision;

  const isCreative = wm.gameMode === 'creative';
  const xpLevel: number = wm.survival.xpLevel || 0;

  // ==================== ENCHANTING TABLE ====================
  if (modal.type === 'enchanting_table') {
    const selectedStack = enchantSlot >= 0 ? wm.inventory.getSlot(enchantSlot) : null;
    const { bookshelves, options } = wm.getEnchantTableState(modal.x, modal.y, modal.z, enchantSlot);
    const lapisCount: number = wm.inventory.countItem('lapis_lazuli');

    const handleApply = (optIdx: number) => {
      onUiClick();
      const res = wm.applyEnchantment(modal.x, modal.y, modal.z, enchantSlot, optIdx);
      setStatusMsg(res.message || '');
      if (res.ok && res.message) onNotify?.(res.message);
      onRefresh();
    };

    return (
      <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
        <div className="mc-panel p-4 w-full max-w-[460px] flex flex-col gap-3 text-[#2b2b2b]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">Enchanting Table</h2>
              <div className="text-[11px] text-[#555]">
                Bookshelves: <span className="font-bold text-[#2b2b2b]">{bookshelves}/15</span> · XP Level:{' '}
                <span className="font-bold text-emerald-700">{isCreative ? '∞' : xpLevel}</span>
              </div>
            </div>
            <button type="button" className="mc-btn px-2.5 py-1 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          <div className="flex items-start gap-3">
            {/* Left column: Target Item + Lapis Pool */}
            <div className="flex flex-col items-center gap-2 bg-[#b5b5b5] border-2 border-[#7b7b7b] p-2.5 w-28 shrink-0">
              <div className="text-[10px] font-bold text-[#3f3f3f]">Item</div>
              <MiniSlot
                wm={wm}
                stack={selectedStack}
                selected={enchantSlot >= 0}
                label="Item"
                size="w-12 h-12"
                onClick={() => {
                  onUiClick();
                  setEnchantSlot(-1);
                }}
              />
              <div className="w-full border-t border-[#8b8b8b] pt-1.5 flex items-center justify-center gap-1.5">
                <img
                  src={getItemIcon(wm, 'lapis_lazuli')}
                  alt="Lapis"
                  className="w-5 h-5 mc-pixel"
                />
                <span className="text-xs font-bold text-blue-900">
                  {isCreative ? '∞' : lapisCount}
                </span>
              </div>
              <div className="text-[9px] text-center text-[#4f4f4f] leading-tight">
                Click an item below to enchant
              </div>
            </div>

            {/* Right column: 3 Enchantment Tier Offers */}
            <div className="flex-1 flex flex-col gap-1.5">
              {options.length === 0 ? (
                <div className="h-[154px] bg-[#6e6459] border-2 border-[#3f3932] flex items-center justify-center p-3 text-center text-xs text-amber-100/80">
                  {selectedStack
                    ? 'This item cannot be enchanted (or is already enchanted — use an Anvil to combine!).'
                    : 'Select a sword, pickaxe, axe, bow, armor, shield, fishing rod, or book from your inventory.'}
                </div>
              ) : (
                options.map((opt: any, idx: number) => {
                  const canAfford = isCreative || (xpLevel >= opt.xpReq && lapisCount >= opt.lapisCost);
                  return (
                    <button
                      key={opt.tier}
                      type="button"
                      disabled={!canAfford}
                      onClick={() => handleApply(idx)}
                      className={`w-full text-left px-2.5 py-2 border-2 transition-colors flex items-center justify-between gap-2 ${
                        canAfford
                          ? 'bg-[#645542] hover:bg-[#7d684f] border-t-[#9d886b] border-l-[#9d886b] border-r-[#3b3024] border-b-[#3b3024] text-amber-100 cursor-pointer'
                          : 'bg-[#4d443a] border-[#302a23] text-neutral-400 opacity-75 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-amber-200 mc-text-shadow-sm">
                          {opt.clue} ...?
                        </span>
                        <span className="text-[10px] text-blue-300">
                          Cost: {opt.lapisCost} Lapis · {opt.xpCost} XP Lvl
                        </span>
                      </div>
                      <span
                        className={`text-sm font-bold mc-text-shadow-sm px-1.5 py-0.5 rounded ${
                          canAfford ? 'text-lime-400' : 'text-red-400'
                        }`}
                      >
                        {opt.xpReq}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {statusMsg && (
            <div className="text-xs font-bold text-indigo-900 bg-indigo-200/80 border border-indigo-400 px-2.5 py-1">
              {statusMsg}
            </div>
          )}

          <PlayerInventoryGrid
            wm={wm}
            selectedIndices={enchantSlot >= 0 ? [enchantSlot] : []}
            isHighlighted={(st) => {
              if (!st) return false;
              const opts = wm.getEnchantTableState(modal.x, modal.y, modal.z, -1);
              void opts;
              if (st.itemId === 'book') return true;
              const def = wm.itemRegistry.get(st.itemId);
              return Boolean(
                def &&
                  (!st.enchants || Object.keys(st.enchants).length === 0) &&
                  (def.toolType || def.category === 'armor')
              );
            }}
            onClickSlot={(idx) => {
              onUiClick();
              setEnchantSlot(idx === enchantSlot ? -1 : idx);
              setStatusMsg('');
            }}
          />
        </div>
      </div>
    );
  }

  // ==================== ANVIL ====================
  if (modal.type === 'anvil') {
    const leftStack = anvilLeft >= 0 ? wm.inventory.getSlot(anvilLeft) : null;
    const rightStack = anvilRight >= 0 ? wm.inventory.getSlot(anvilRight) : null;
    const preview = wm.previewAnvilAction(anvilLeft, anvilRight, anvilName);
    const canAfford = Boolean(preview && (isCreative || xpLevel >= preview.xpCost));

    const handleForge = () => {
      onUiClick();
      const res = wm.applyAnvilAction(anvilLeft, anvilRight, anvilName);
      setStatusMsg(res.message || '');
      if (res.ok) {
        setAnvilRight(-1);
        setAnvilName('');
        if (res.message) onNotify?.(res.message);
      }
      onRefresh();
    };

    return (
      <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
        <div className="mc-panel p-4 w-full max-w-[460px] flex flex-col gap-3 text-[#2b2b2b]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">Anvil — Repair, Combine &amp; Name</h2>
              <div className="text-[11px] text-[#555]">
                XP Level: <span className="font-bold text-emerald-700">{isCreative ? '∞' : xpLevel}</span>
              </div>
            </div>
            <button type="button" className="mc-btn px-2.5 py-1 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          {/* Rename Input */}
          <input
            type="text"
            maxLength={32}
            value={anvilName}
            onChange={(e) => setAnvilName(e.target.value)}
            placeholder={
              leftStack
                ? leftStack.customName || wm.itemRegistry.get(leftStack.itemId)?.name || 'Custom Name'
                : 'Select target item first...'
            }
            disabled={!leftStack}
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#3b3b3b] text-white border-2 border-[#1f1f1f] outline-none placeholder:text-neutral-400 disabled:opacity-50"
          />

          {/* Anvil Slots Row */}
          <div className="flex items-center justify-between gap-2 bg-[#b5b5b5] border-2 border-[#7b7b7b] px-4 py-3">
            <div className="flex items-center gap-2">
              <MiniSlot
                wm={wm}
                stack={leftStack}
                selected={anvilLeft >= 0}
                label="Base"
                size="w-12 h-12"
                onClick={() => {
                  onUiClick();
                  setAnvilLeft(-1);
                  setAnvilName('');
                }}
              />
              <span className="text-lg font-bold text-[#4b4b4b]">+</span>
              <MiniSlot
                wm={wm}
                stack={rightStack}
                selected={anvilRight >= 0}
                label="Add"
                size="w-12 h-12"
                onClick={() => {
                  onUiClick();
                  setAnvilRight(-1);
                }}
              />
            </div>

            <span className="text-lg font-bold text-[#4b4b4b]">→</span>

            <div className="flex items-center gap-2.5">
              <MiniSlot
                wm={wm}
                stack={preview?.output || null}
                label="Out"
                size="w-12 h-12"
                onClick={canAfford ? handleForge : undefined}
              />
              <button
                type="button"
                disabled={!canAfford}
                onClick={handleForge}
                className="mc-btn px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                Forge
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs px-1">
            {preview ? (
              <>
                <span className="text-[#3f3f3f] truncate max-w-[260px]">
                  {formatStackTooltip(wm, preview.output)}
                </span>
                <span className={`font-bold ${canAfford ? 'text-emerald-700' : 'text-red-700'}`}>
                  Cost: {preview.xpCost} XP {preview.xpCost === 1 ? 'Level' : 'Levels'}
                </span>
              </>
            ) : (
              <span className="text-[#555]">
                Click an item below for Base, then an Ingot, matching item, or Enchanted Book to combine.
              </span>
            )}
          </div>

          {statusMsg && (
            <div className="text-xs font-bold text-emerald-900 bg-emerald-200/80 border border-emerald-500 px-2.5 py-1">
              {statusMsg}
            </div>
          )}

          <PlayerInventoryGrid
            wm={wm}
            selectedIndices={[anvilLeft, anvilRight].filter((i) => i >= 0)}
            onClickSlot={(idx) => {
              onUiClick();
              setStatusMsg('');
              const st = wm.inventory.getSlot(idx);
              if (!st) return;
              if (anvilLeft === idx) {
                setAnvilLeft(-1);
                setAnvilName('');
              } else if (anvilRight === idx) {
                setAnvilRight(-1);
              } else if (anvilLeft === -1) {
                setAnvilLeft(idx);
                setAnvilName(st.customName || '');
              } else {
                setAnvilRight(idx);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // ==================== BREWING STAND ====================
  if (modal.type === 'brewing_stand') {
    const stand = wm.blockEntities.getOrCreateBrewingStand(modal.x, modal.y, modal.z);
    const fuelPct = Math.max(0, Math.min(100, Math.round(((stand.fuelPower || 0) / 20) * 100)));
    const brewPct = Math.max(0, Math.min(100, Math.round(((stand.brewTime || 0) / 8) * 100)));

    const handleInsertFromInventory = (invIdx: number) => {
      onUiClick();
      const stack = wm.inventory.getSlot(invIdx);
      if (!stack) return;

      const isBottle =
        stack.itemId === 'water_bottle' ||
        stack.itemId === 'awkward_potion' ||
        stack.itemId.startsWith('potion_');

      if (isBottle) {
        const emptyBottleIdx = stand.bottles.findIndex((b: any) => !b);
        if (emptyBottleIdx >= 0) {
          wm.blockEntities.insertIntoBrewingStand(modal.x, modal.y, modal.z, emptyBottleIdx, wm.inventory, invIdx);
          onRefresh();
          return;
        }
      }

      // Blaze powder goes to fuel first if fuel is empty/low, otherwise ingredient
      if (stack.itemId === 'blaze_powder' && !stand.fuel && (stand.fuelPower || 0) < 4) {
        if (wm.blockEntities.insertIntoBrewingStand(modal.x, modal.y, modal.z, 'fuel', wm.inventory, invIdx)) {
          onRefresh();
          return;
        }
      }

      if (wm.blockEntities.insertIntoBrewingStand(modal.x, modal.y, modal.z, 'ingredient', wm.inventory, invIdx)) {
        onRefresh();
        return;
      }

      if (stack.itemId === 'blaze_powder') {
        if (wm.blockEntities.insertIntoBrewingStand(modal.x, modal.y, modal.z, 'fuel', wm.inventory, invIdx)) {
          onRefresh();
        }
      }
    };

    const handleExtract = (target: 'fuel' | 'ingredient' | 0 | 1 | 2) => {
      onUiClick();
      wm.blockEntities.extractFromBrewingStand(modal.x, modal.y, modal.z, target, wm.inventory);
      onRefresh();
    };

    return (
      <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
        <div className="mc-panel p-4 w-full max-w-[460px] flex flex-col gap-3 text-[#2b2b2b]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Brewing Stand</h2>
            <button type="button" className="mc-btn px-2.5 py-1 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          <div className="bg-[#b5b5b5] border-2 border-[#7b7b7b] p-3 flex flex-col items-center gap-3">
            <div className="w-full flex items-center justify-between px-4">
              {/* Blaze Fuel Slot + Bar */}
              <div className="flex flex-col items-center gap-1">
                <MiniSlot
                  wm={wm}
                  stack={stand.fuel}
                  label="Fuel"
                  onClick={() => handleExtract('fuel')}
                />
                <div className="w-12 h-2 bg-[#333] border border-black">
                  <div className="h-full bg-amber-400 transition-all" style={{ width: `${fuelPct}%` }} />
                </div>
                <span className="text-[9px] text-[#444]">Blaze ({stand.fuelPower || 0}/20)</span>
              </div>

              {/* Ingredient Slot */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-[#3f3f3f]">Ingredient</span>
                <MiniSlot
                  wm={wm}
                  stack={stand.ingredient}
                  label="Ing"
                  size="w-11 h-11"
                  onClick={() => handleExtract('ingredient')}
                />
              </div>

              {/* Brew Progress */}
              <div className="flex flex-col items-center gap-1 w-16">
                <span className="text-[10px] font-bold text-[#3f3f3f]">Brew</span>
                <div className="w-14 h-3 bg-[#333] border border-black">
                  <div className="h-full bg-fuchsia-400 transition-all" style={{ width: `${brewPct}%` }} />
                </div>
                <span className="text-[9px] text-[#444]">{brewPct}%</span>
              </div>
            </div>

            {/* 3 Bottle Slots */}
            <div className="flex items-center justify-center gap-6 pt-1">
              {[0, 1, 2].map((bIdx) => (
                <MiniSlot
                  key={bIdx}
                  wm={wm}
                  stack={stand.bottles[bIdx]}
                  label="Bottle"
                  size="w-11 h-11"
                  onClick={() => handleExtract(bIdx as 0 | 1 | 2)}
                />
              ))}
            </div>
          </div>

          <div className="text-[10px] bg-[#b8b8b8] border border-[#8b8b8b] px-2.5 py-1.5 text-[#333] leading-relaxed">
            <span className="font-bold">Recipes:</span> Water Bottle + Nether Wart → Awkward Potion.
            Then add Apple (Heal), Sugar (Speed), Blaze Powder (Strength), Gold Ingot (Fire Res), Glowstone (Night Vision), or Flower (Regen).
          </div>

          <PlayerInventoryGrid
            wm={wm}
            isHighlighted={(st) => {
              if (!st) return false;
              const brewItems = new Set([
                'blaze_powder',
                'nether_wart',
                'apple',
                'sugar',
                'gold_ingot',
                'glowstone_dust',
                'flower',
                'water_bottle',
                'awkward_potion',
              ]);
              return brewItems.has(st.itemId) || st.itemId.startsWith('potion_');
            }}
            onClickSlot={handleInsertFromInventory}
          />
        </div>
      </div>
    );
  }

  // ==================== VILLAGER TRADING ====================
  if (modal.type === 'villager') {
    const data = wm.getVillagerTrades(modal.entityId);

    const handleTrade = (offerIdx: number) => {
      onUiClick();
      const res = wm.tradeWithVillager(modal.entityId, offerIdx);
      setStatusMsg(res.message || '');
      if (res.ok) onNotify?.('Completed Villager trade!');
      onRefresh();
    };

    return (
      <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
        <div className="mc-panel p-4 w-full max-w-[480px] flex flex-col gap-3 text-[#2b2b2b]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">{data.title}</h2>
              <div className="text-[11px] text-[#444] flex items-center gap-1.5 mt-0.5">
                <img src={getItemIcon(wm, 'emerald')} alt="Emerald" className="w-4 h-4 mc-pixel" />
                <span>
                  Your Emeralds: <strong className="text-emerald-800">{isCreative ? '∞' : data.emeralds}</strong>
                </span>
              </div>
            </div>
            <button type="button" className="mc-btn px-2.5 py-1 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          <div className="max-h-[340px] overflow-y-auto flex flex-col gap-1.5 pr-1">
            {data.offers.map((offer: any, idx: number) => {
              const owned = wm.inventory.countItem(offer.costItem);
              const canTrade = isCreative || owned >= offer.costCount;
              const costDef = wm.itemRegistry.get(offer.costItem);
              const resDef = wm.itemRegistry.get(offer.resultItem);
              const enchSummary = offer.resultEnchants
                ? Object.entries(offer.resultEnchants)
                    .map(([k, v]) => formatEnchantLabel(k, v as number))
                    .join(', ')
                : '';

              return (
                <div
                  key={offer.id}
                  className="bg-[#b5b5b5] border-2 border-[#7b7b7b] px-2.5 py-2 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 bg-[#8b8b8b] border border-[#555] px-1.5 py-1 shrink-0">
                      <img src={getItemIcon(wm, offer.costItem)} alt={offer.costItem} className="w-6 h-6 mc-pixel" />
                      <span className="text-xs font-bold text-white mc-text-shadow-sm">
                        {offer.costCount}x
                      </span>
                    </div>
                    <span className="text-sm font-bold text-[#444]">→</span>
                    <div className="flex items-center gap-1.5 bg-[#8b8b8b] border border-[#555] px-1.5 py-1 shrink-0">
                      <img src={getItemIcon(wm, offer.resultItem)} alt={offer.resultItem} className="w-6 h-6 mc-pixel" />
                      <span className="text-xs font-bold text-white mc-text-shadow-sm">
                        {offer.resultCount}x
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold truncate">
                        {resDef?.name || offer.resultItem}
                      </span>
                      <span className="text-[10px] text-[#444] truncate">
                        {enchSummary ? (
                          <span className="text-purple-800 font-bold">{enchSummary}</span>
                        ) : (
                          `Costs ${offer.costCount} ${costDef?.name || offer.costItem}`
                        )}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!canTrade}
                    onClick={() => handleTrade(idx)}
                    className="mc-btn px-3 py-1.5 text-xs font-bold shrink-0 disabled:opacity-50"
                  >
                    Trade
                  </button>
                </div>
              );
            })}
          </div>

          {statusMsg && (
            <div className="text-xs font-bold text-emerald-900 bg-emerald-200/80 border border-emerald-500 px-2.5 py-1">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== OAK SIGN EDITOR ====================
  if (modal.type === 'sign') {
    const handleSaveSign = () => {
      onUiClick();
      wm.setSignLines(modal.x, modal.y, modal.z, signLines);
      onRefresh();
      onClose();
    };

    return (
      <div className="fixed inset-0 z-40 bg-black/65 flex items-center justify-center p-4">
        <div className="bg-[#9b7646] border-4 border-[#563a1c] shadow-2xl p-5 w-full max-w-[360px] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-100 mc-text-shadow-sm">Edit Sign Message</h2>
            <button type="button" className="mc-btn px-2 py-0.5 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          <div className="flex flex-col gap-1.5 bg-[#7c5b32] border-2 border-[#4d3316] p-3">
            {[0, 1, 2, 3].map((idx) => (
              <input
                key={idx}
                type="text"
                maxLength={20}
                value={signLines[idx] || ''}
                onChange={(e) => {
                  const next = [...signLines];
                  next[idx] = e.target.value;
                  setSignLines(next);
                }}
                placeholder={`Line ${idx + 1}`}
                className="w-full text-center font-mono text-sm font-bold text-[#1f1408] bg-[#b58e58]/80 border border-[#5f4120] py-1 px-2 outline-none focus:bg-[#caa268]"
              />
            ))}
          </div>

          <button type="button" className="mc-btn py-2 text-xs font-bold" onClick={handleSaveSign}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ==================== ADVANCEMENTS MODAL (L KEY) ====================
  if (modal.type === 'advancements') {
    const all: any[] = wm.advancements.getAllStatus();
    const unlockedCount = all.filter((a) => a.unlocked).length;
    const categories = ['All', 'Story', 'Combat', 'Nether', 'Magic', 'The End', 'Adventure'];
    const filtered = advCategory === 'All' ? all : all.filter((a) => a.category === advCategory);

    return (
      <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
        <div className="mc-panel p-4 w-full max-w-[600px] flex flex-col gap-3 text-[#2b2b2b]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">Advancements</h2>
              <div className="text-[11px] text-[#555]">
                Completed: <strong className="text-emerald-800">{unlockedCount} / {all.length}</strong>
              </div>
            </div>
            <button type="button" className="mc-btn px-2.5 py-1 text-xs font-bold" onClick={onClose}>
              X
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  onUiClick();
                  setAdvCategory(cat);
                }}
                className={`px-2.5 py-1 text-[11px] font-bold border ${
                  advCategory === cat
                    ? 'bg-[#5a5a5a] text-white border-black'
                    : 'mc-btn text-[#2b2b2b]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[380px] overflow-y-auto pr-1">
            {filtered.map((adv) => (
              <div
                key={adv.id}
                className={`p-2.5 border-2 flex items-center gap-2.5 ${
                  adv.unlocked
                    ? 'bg-[#2c3c28] border-amber-400 text-white'
                    : 'bg-[#383838] border-[#1f1f1f] text-neutral-300 opacity-75'
                }`}
              >
                <div
                  className={`w-10 h-10 shrink-0 flex items-center justify-center border-2 ${
                    adv.unlocked ? 'bg-amber-600/40 border-amber-300' : 'bg-[#242424] border-[#4b4b4b]'
                  }`}
                >
                  <img
                    src={getItemIcon(wm, adv.iconItem)}
                    alt={adv.title}
                    className={`w-7 h-7 mc-pixel ${adv.unlocked ? '' : 'grayscale opacity-60'}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-bold truncate ${
                        adv.unlocked ? 'text-amber-300 mc-text-shadow-sm' : 'text-neutral-200'
                      }`}
                    >
                      {adv.title}
                    </span>
                    <span className="text-[10px] font-bold text-lime-300 shrink-0">+{adv.xpReward} XP</span>
                  </div>
                  <p className="text-[10px] text-neutral-300 leading-snug mt-0.5">{adv.description}</p>
                  <div className="text-[9px] uppercase tracking-wider mt-1 text-neutral-400">
                    {adv.category} · {adv.unlocked ? 'Unlocked' : 'Locked'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
