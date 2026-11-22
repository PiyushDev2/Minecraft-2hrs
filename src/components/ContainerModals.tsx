/**
 * @file ContainerModals.tsx
 * @description Classic Minecraft beveled stone GUI panels for:
 * - Player Inventory (E): 4 Armor slots, interactive 2x2 Crafting Grid, 27 Backpack + 9 Hotbar, Recipe Book, Creative Catalog
 * - Crafting Table: interactive 3x3 Crafting Grid + Full Recipe Book (auto-fill or Shift-click instant craft)
 * - Furnace: Input, Fuel, animated flame & cook progress arrow, Output + Player Inventory
 * - Chest: 27-slot storage grid + Player Inventory
 * - Pause Menu (Esc) & full Classic Options Suite (Video, Audio, Resource Packs, Controls)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FURNACE_COOK_DURATION, FUEL_VALUES, SMELTING_RECIPES } from '../backend/world/BlockEntityManager.js';
import type { StoredResourcePack } from '../game/ResourcePackManager';
import { ClassicOptionsModal, type GameOptionsState } from './ClassicOptionsModal';

export type ActiveModalType =
  | null
  | { type: 'inventory' }
  | { type: 'crafting_table' }
  | { type: 'furnace'; x: number; y: number; z: number }
  | { type: 'chest'; x: number; y: number; z: number }
  | { type: 'pause' }
  | { type: 'options' };

interface CraftCell {
  itemId: string;
  count: number;
}

interface ContainerModalsProps {
  modal: ActiveModalType;
  worldManager: any;
  revision: number;
  options: GameOptionsState;
  activePackName: string | null;
  currentSlotName: string;
  onUpdateOptions: (next: Partial<GameOptionsState>) => void;
  onApplyResourcePack: (pack: StoredResourcePack | null) => Promise<void>;
  onRefresh: () => void;
  onClose: () => void;
  onOpenOptions: () => void;
  onSaveWorld: () => void;
  onExportJson: () => void;
  onSaveAndQuit: () => void;
  onUiClick: () => void;
}

const ARMOR_LABELS = ['Helmet', 'Chest', 'Legs', 'Boots'];

function ItemSlotButton({
  stack,
  itemRegistry,
  textureAtlas,
  selected = false,
  placeholder,
  highlight = false,
  onLeftClick,
  onRightClick,
}: {
  stack: {
    itemId: string;
    count: number;
    durability?: number;
    maxDurability?: number;
    enchants?: Record<string, number>;
    customName?: string;
  } | null;
  itemRegistry: any;
  textureAtlas: any;
  selected?: boolean;
  placeholder?: string;
  highlight?: boolean;
  onLeftClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRightClick?: () => void;
}) {
  const def = stack ? itemRegistry.get(stack.itemId) : null;
  const icon = stack ? itemRegistry.getItemIconUrl(stack.itemId, textureAtlas) : '';
  const hasEnchants = Boolean(stack?.enchants && Object.keys(stack.enchants).length > 0);
  const enchStr = hasEnchants
    ? Object.entries(stack!.enchants!)
        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
        .join(', ')
    : '';
  const durRatio =
    stack?.maxDurability && stack.durability !== undefined
      ? Math.max(0, Math.min(1, stack.durability / stack.maxDurability))
      : null;

  return (
    <button
      type="button"
      onClick={onLeftClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick?.();
      }}
      title={
        def
          ? `${stack?.customName || def.name}${enchStr ? ` [${enchStr}]` : ''}${
              stack?.durability ? ` (${stack.durability}/${stack.maxDurability})` : ''
            }`
          : placeholder || ''
      }
      className={`relative w-10 h-10 flex items-center justify-center cursor-pointer ${
        selected ? 'mc-slot-active' : highlight ? 'mc-slot ring-2 ring-emerald-500' : 'mc-slot'
      } ${hasEnchants ? 'ring-1 ring-inset ring-fuchsia-400/80 bg-fuchsia-950/35' : ''}`}
    >
      {!stack && placeholder && (
        <span className="text-[9px] text-neutral-600 font-bold uppercase pointer-events-none">
          {placeholder}
        </span>
      )}
      {stack && icon && (
        <img src={icon} alt={def?.name ?? stack.itemId} className="w-7 h-7 mc-pixel pointer-events-none" draggable={false} />
      )}
      {stack && stack.count > 1 && (
        <span className="absolute bottom-0.5 right-0.5 text-[10px] font-bold text-white mc-text-shadow-sm tabular-nums leading-none">
          {stack.count}
        </span>
      )}
      {durRatio !== null && durRatio < 1 && (
        <div className="absolute bottom-0.5 left-1 right-1 h-1 bg-black">
          <div
            className="h-full"
            style={{
              width: `${Math.round(durRatio * 100)}%`,
              backgroundColor: durRatio > 0.5 ? '#4ade80' : durRatio > 0.25 ? '#facc15' : '#ef4444',
            }}
          />
        </div>
      )}
    </button>
  );
}

export const ContainerModals: React.FC<ContainerModalsProps> = ({
  modal,
  worldManager,
  revision,
  options,
  activePackName,
  currentSlotName,
  onUpdateOptions,
  onApplyResourcePack,
  onRefresh,
  onClose,
  onOpenOptions,
  onSaveWorld,
  onExportJson,
  onSaveAndQuit,
  onUiClick,
}) => {
  const [selectedInvSlot, setSelectedInvSlot] = useState<number | null>(null);
  const [invTab, setInvTab] = useState<'survival' | 'creative'>('survival');
  const [searchQuery, setSearchQuery] = useState('');
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'craftable'>('all');
  const [craftGrid, setCraftGrid] = useState<Array<CraftCell | null>>([]);
  const craftGridRef = useRef<Array<CraftCell | null>>([]);
  craftGridRef.current = craftGrid;

  const inventory = worldManager?.inventory;
  const itemRegistry = worldManager?.itemRegistry;
  const crafting = worldManager?.crafting;
  const blockEntities = worldManager?.blockEntities;

  const returnGridToInventory = useCallback(() => {
    if (!inventory) return;
    const current = craftGridRef.current;
    let returnedAny = false;
    for (const cell of current) {
      if (cell && cell.count > 0) {
        inventory.addItem(cell.itemId, cell.count);
        returnedAny = true;
      }
    }
    if (returnedAny) {
      craftGridRef.current = [];
      setCraftGrid([]);
      onRefresh();
    }
  }, [inventory, onRefresh]);

  const handleCloseModal = useCallback(() => {
    returnGridToInventory();
    onClose();
  }, [onClose, returnGridToInventory]);

  // Reset crafting grid and return any leftover items whenever modal changes or unmounts
  useEffect(() => {
    setSelectedInvSlot(null);
    const prevCells = craftGridRef.current;
    if (inventory && prevCells.length > 0) {
      let returned = false;
      for (const cell of prevCells) {
        if (cell && cell.count > 0) {
          inventory.addItem(cell.itemId, cell.count);
          returned = true;
        }
      }
      if (returned) onRefresh();
    }
    if (modal?.type === 'crafting_table') {
      setCraftGrid(new Array(9).fill(null));
    } else if (modal?.type === 'inventory') {
      setCraftGrid(new Array(4).fill(null));
    } else {
      setCraftGrid([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.type]);

  useEffect(() => {
    return () => {
      if (inventory && craftGridRef.current.length > 0) {
        for (const cell of craftGridRef.current) {
          if (cell && cell.count > 0) {
            inventory.addItem(cell.itemId, cell.count);
          }
        }
      }
    };
  }, [inventory]);

  const allItems = useMemo(() => {
    if (!itemRegistry) return [];
    const list = itemRegistry.getAll();
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter((it: any) => it.name.toLowerCase().includes(q) || it.id.includes(q));
  }, [itemRegistry, searchQuery]);

  const recipes = useMemo(() => {
    if (!crafting || !inventory) return [];
    if (modal?.type !== 'inventory' && modal?.type !== 'crafting_table') return [];
    const maxGridSize = modal.type === 'crafting_table' ? 3 : 2;
    return crafting.getRecipeBook(inventory, maxGridSize).filter((entry: any) =>
      recipeFilter === 'craftable' ? entry.craftable : true
    );
  }, [crafting, inventory, modal?.type, recipeFilter, revision]);

  const gridSize = modal?.type === 'crafting_table' ? 3 : 2;
  const matchedRecipe = useMemo(() => {
    if (!crafting) return null;
    if (modal?.type !== 'inventory' && modal?.type !== 'crafting_table') return null;
    if (craftGrid.length !== gridSize * gridSize) return null;
    return crafting.findMatchingRecipe(
      craftGrid.map((c) => c?.itemId ?? null),
      gridSize
    );
  }, [crafting, craftGrid, gridSize, modal?.type]);

  if (!modal || !worldManager) return null;

  const handleCraftCellLeftClick = (cellIdx: number) => {
    onUiClick();
    const next = [...craftGrid];
    const cell = next[cellIdx];

    if (selectedInvSlot !== null) {
      const invStack = inventory.getSlot(selectedInvSlot);
      if (!invStack) {
        setSelectedInvSlot(null);
        return;
      }
      if (!cell) {
        next[cellIdx] = { itemId: invStack.itemId, count: 1 };
      } else if (cell.itemId === invStack.itemId) {
        const def = itemRegistry.get(invStack.itemId);
        const maxStack = def?.maxStack ?? 64;
        if (cell.count >= maxStack) return;
        next[cellIdx] = { itemId: cell.itemId, count: cell.count + 1 };
      } else {
        // Swap grid cell back to inventory and place 1 of selected item
        inventory.addItem(cell.itemId, cell.count);
        next[cellIdx] = { itemId: invStack.itemId, count: 1 };
      }

      if (worldManager.gameMode !== 'creative') {
        if (invStack.count <= 1) {
          inventory.setSlot(selectedInvSlot, null);
          setSelectedInvSlot(null);
        } else {
          inventory.setSlot(selectedInvSlot, { ...invStack, count: invStack.count - 1 });
        }
      }
      setCraftGrid(next);
      onRefresh();
      return;
    }

    // No inventory slot selected -> pull cell contents back to inventory
    if (cell) {
      inventory.addItem(cell.itemId, cell.count);
      next[cellIdx] = null;
      setCraftGrid(next);
      onRefresh();
    }
  };

  const handleCraftCellRightClick = (cellIdx: number) => {
    onUiClick();
    const next = [...craftGrid];
    const cell = next[cellIdx];
    if (!cell) return;
    inventory.addItem(cell.itemId, 1);
    if (cell.count <= 1) {
      next[cellIdx] = null;
    } else {
      next[cellIdx] = { itemId: cell.itemId, count: cell.count - 1 };
    }
    setCraftGrid(next);
    onRefresh();
  };

  const handleCraftOutputClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!matchedRecipe) return;
    onUiClick();
    let maxCrafts = Infinity;
    for (const cell of craftGrid) {
      if (cell) maxCrafts = Math.min(maxCrafts, cell.count);
    }
    if (!Number.isFinite(maxCrafts) || maxCrafts <= 0) return;

    const times = e.shiftKey ? maxCrafts : 1;
    const next = craftGrid.map((cell) => {
      if (!cell) return null;
      const rem = cell.count - times;
      return rem > 0 ? { itemId: cell.itemId, count: rem } : null;
    });
    inventory.addItem(matchedRecipe.result.itemId, matchedRecipe.result.count * times);
    setCraftGrid(next);
    onRefresh();
  };

  const handleRecipeClick = (entry: any, e: React.MouseEvent<HTMLButtonElement>) => {
    onUiClick();
    const recipe = entry.recipe;
    if (e.shiftKey) {
      crafting.craftById(recipe.id, inventory);
      onRefresh();
      return;
    }

    // Return existing grid items first, then auto-fill pattern from inventory
    const existing = craftGridRef.current;
    for (const cell of existing) {
      if (cell && cell.count > 0) {
        inventory.addItem(cell.itemId, cell.count);
      }
    }

    const layout: Array<string | null> | null = crafting.getGridLayoutForRecipe(recipe.id, gridSize);
    if (!layout) {
      setCraftGrid(new Array(gridSize * gridSize).fill(null));
      onRefresh();
      return;
    }

    const filled: Array<CraftCell | null> = new Array(gridSize * gridSize).fill(null);
    let ok = true;
    for (let i = 0; i < layout.length; i++) {
      const reqId = layout[i];
      if (!reqId) continue;
      if (worldManager.gameMode === 'creative') {
        filled[i] = { itemId: reqId, count: 1 };
      } else if (inventory.consumeItem(reqId, 1)) {
        filled[i] = { itemId: reqId, count: 1 };
      } else {
        ok = false;
        break;
      }
    }

    if (!ok) {
      // Roll back partially pulled items
      for (const cell of filled) {
        if (cell) inventory.addItem(cell.itemId, cell.count);
      }
      setCraftGrid(new Array(gridSize * gridSize).fill(null));
    } else {
      setCraftGrid(filled);
    }
    setSelectedInvSlot(null);
    onRefresh();
  };

  const handlePlayerSlotClick = (idx: number) => {
    onUiClick();
    if (modal.type === 'chest') {
      blockEntities.transferToChest(modal.x, modal.y, modal.z, inventory, idx);
      onRefresh();
      return;
    }
    if (modal.type === 'furnace') {
      const stack = inventory.getSlot(idx);
      if (stack) {
        if (SMELTING_RECIPES[stack.itemId as keyof typeof SMELTING_RECIPES]) {
          blockEntities.insertIntoFurnace(modal.x, modal.y, modal.z, 'input', inventory, idx);
        } else if (FUEL_VALUES[stack.itemId as keyof typeof FUEL_VALUES]) {
          blockEntities.insertIntoFurnace(modal.x, modal.y, modal.z, 'fuel', inventory, idx);
        }
        onRefresh();
      }
      return;
    }

    if (selectedInvSlot === null) {
      if (inventory.getSlot(idx)) {
        setSelectedInvSlot(idx);
      }
    } else if (selectedInvSlot === idx) {
      const s = inventory.getSlot(idx);
      const def = s ? itemRegistry.get(s.itemId) : null;
      if (def?.armorSlot) {
        inventory.equipArmorFromSlot(idx);
        onRefresh();
      }
      setSelectedInvSlot(null);
    } else {
      inventory.swapSlots(selectedInvSlot, idx);
      setSelectedInvSlot(null);
      onRefresh();
    }
  };

  const handlePlayerSlotRightClick = (idx: number) => {
    onUiClick();
    if (selectedInvSlot !== null && selectedInvSlot !== idx) {
      inventory.splitHalf(selectedInvSlot, idx);
      setSelectedInvSlot(null);
      onRefresh();
    } else {
      const stack = inventory.getSlot(idx);
      const def = stack ? itemRegistry.get(stack.itemId) : null;
      if (def?.armorSlot) {
        inventory.equipArmorFromSlot(idx);
        onRefresh();
      }
    }
  };

  // Pause Menu
  if (modal.type === 'pause') {
    return (
      <div className="fixed inset-0 z-30 bg-black/65 flex items-center justify-center p-4 pointer-events-auto">
        <div className="w-full max-w-sm flex flex-col gap-3">
          <h2 className="text-center text-xl font-bold text-white mc-text-shadow mb-2">
            Game Menu
          </h2>
          <button
            type="button"
            className="mc-btn w-full py-3 text-sm font-bold"
            onClick={() => {
              onUiClick();
              handleCloseModal();
            }}
          >
            Back to Game
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                onOpenOptions();
              }}
            >
              Options...
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                const next = worldManager.gameMode === 'survival' ? 'creative' : 'survival';
                worldManager.setGameMode(next);
                onRefresh();
              }}
            >
              Mode: {worldManager.gameMode === 'survival' ? 'Survival' : 'Creative'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                onSaveWorld();
              }}
            >
              Save World
            </button>
            <button
              type="button"
              className="mc-btn py-2.5 text-xs font-bold"
              onClick={() => {
                onUiClick();
                onExportJson();
              }}
            >
              Export JSON
            </button>
          </div>

          <button
            type="button"
            className="mc-btn w-full py-3 text-sm font-bold mt-1"
            onClick={() => {
              onUiClick();
              onSaveAndQuit();
            }}
          >
            Save &amp; Quit to Title
          </button>

          <div className="mc-panel-dark p-3 text-[11px] text-neutral-300 leading-relaxed mt-1">
            <div className="font-bold text-white mb-1">Controls ({currentSlotName})</div>
            <div>WASD Move • Space Jump/Swim • Shift Sneak • Ctrl Sprint • F Fly (Creative)</div>
            <div>LMB Hold Mine / Attack • RMB Use / Eat / Bow • Q Drop • E Inventory</div>
            <div>T or / Chat &amp; Commands • F3 Debug HUD • F3+G Chunk Borders • F5 Camera</div>
          </div>
        </div>
      </div>
    );
  }

  // Full Classic In-Game Options Suite (Video, Audio, Resource Packs, Controls)
  if (modal.type === 'options') {
    return (
      <div className="fixed inset-0 z-30 bg-black/72 flex items-center justify-center p-4 pointer-events-auto">
        <ClassicOptionsModal
          options={options}
          activePackName={activePackName}
          onUpdateOptions={onUpdateOptions}
          onApplyResourcePack={onApplyResourcePack}
          onClose={handleCloseModal}
          onUiClick={onUiClick}
          standalone
        />
      </div>
    );
  }

  const renderPlayerInventoryGrid = (hint: string) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-bold text-[#3a3a3a]">
        <span>Inventory</span>
        <span className="text-[10px] font-normal text-[#555555]">{hint}</span>
      </div>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 27 }).map((_, i) => {
          const idx = i + 9;
          return (
            <ItemSlotButton
              key={idx}
              stack={inventory.getSlot(idx)}
              itemRegistry={itemRegistry}
              textureAtlas={worldManager.world.textureAtlas}
              selected={selectedInvSlot === idx}
              onLeftClick={() => handlePlayerSlotClick(idx)}
              onRightClick={() => handlePlayerSlotRightClick(idx)}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-9 gap-1 pt-1.5 border-t-2 border-[#7b7b7b]">
        {Array.from({ length: 9 }).map((_, idx) => (
          <ItemSlotButton
            key={idx}
            stack={inventory.getSlot(idx)}
            itemRegistry={itemRegistry}
            textureAtlas={worldManager.world.textureAtlas}
            selected={selectedInvSlot === idx}
            onLeftClick={() => handlePlayerSlotClick(idx)}
            onRightClick={() => handlePlayerSlotRightClick(idx)}
          />
        ))}
      </div>
    </div>
  );

  // Chest Modal
  if (modal.type === 'chest') {
    const chest = blockEntities.getOrCreateChest(modal.x, modal.y, modal.z);
    return (
      <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4 pointer-events-auto">
        <div className="mc-panel p-4 flex flex-col gap-3 max-w-full">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Chest</h3>
            <button type="button" className="mc-btn px-2.5 py-0.5 text-xs font-bold" onClick={handleCloseModal}>
              X
            </button>
          </div>
          <div className="grid grid-cols-9 gap-1">
            {chest.slots.map((slot: any, idx: number) => (
              <ItemSlotButton
                key={idx}
                stack={slot}
                itemRegistry={itemRegistry}
                textureAtlas={worldManager.world.textureAtlas}
                onLeftClick={() => {
                  onUiClick();
                  blockEntities.transferFromChest(modal.x, modal.y, modal.z, idx, inventory);
                  onRefresh();
                }}
              />
            ))}
          </div>
          <div className="h-1" />
          {renderPlayerInventoryGrid('Click item to transfer')}
        </div>
      </div>
    );
  }

  // Furnace Modal
  if (modal.type === 'furnace') {
    const furnace = blockEntities.getOrCreateFurnace(modal.x, modal.y, modal.z);
    const burnRatio =
      furnace.burnDuration > 0 ? Math.max(0, Math.min(1, furnace.burnTime / furnace.burnDuration)) : 0;
    const cookRatio = Math.max(0, Math.min(1, furnace.cookProgress / FURNACE_COOK_DURATION));

    return (
      <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4 pointer-events-auto">
        <div className="mc-panel p-4 flex flex-col gap-4 max-w-full">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Furnace</h3>
            <button type="button" className="mc-btn px-2.5 py-0.5 text-xs font-bold" onClick={handleCloseModal}>
              X
            </button>
          </div>

          <div className="flex items-center justify-center gap-6 py-2 bg-[#b5b5b5] border-2 border-[#7b7b7b] px-4">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[10px] font-bold uppercase text-neutral-700">Input</div>
              <ItemSlotButton
                stack={furnace.input}
                itemRegistry={itemRegistry}
                textureAtlas={worldManager.world.textureAtlas}
                placeholder="Ore"
                onLeftClick={() => {
                  onUiClick();
                  blockEntities.extractFromFurnace(modal.x, modal.y, modal.z, 'input', inventory);
                  onRefresh();
                }}
              />
              <div className="w-7 h-7 bg-[#424242] border border-black relative overflow-hidden">
                <div
                  className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-orange-600 via-amber-400 to-yellow-200"
                  style={{ height: `${Math.round(burnRatio * 100)}%` }}
                />
              </div>
              <ItemSlotButton
                stack={furnace.fuel}
                itemRegistry={itemRegistry}
                textureAtlas={worldManager.world.textureAtlas}
                placeholder="Fuel"
                onLeftClick={() => {
                  onUiClick();
                  blockEntities.extractFromFurnace(modal.x, modal.y, modal.z, 'fuel', inventory);
                  onRefresh();
                }}
              />
              <div className="text-[10px] font-bold uppercase text-neutral-700">Fuel</div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className="w-20 h-4 bg-[#5c5c5c] border border-black overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-100"
                  style={{ width: `${Math.round(cookRatio * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-neutral-700 tabular-nums">
                {Math.round(cookRatio * 100)}%
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className="text-[10px] font-bold uppercase text-neutral-700">Output</div>
              <ItemSlotButton
                stack={furnace.output}
                itemRegistry={itemRegistry}
                textureAtlas={worldManager.world.textureAtlas}
                placeholder="Out"
                onLeftClick={() => {
                  onUiClick();
                  blockEntities.extractFromFurnace(modal.x, modal.y, modal.z, 'output', inventory);
                  onRefresh();
                }}
              />
            </div>
          </div>

          <div className="text-[10px] text-neutral-700 text-center">
            Click raw ores, sand, cobblestone, raw meat, coal, planks, or logs below to load. Click furnace slots to extract.
          </div>

          {renderPlayerInventoryGrid('Click to insert ore/fuel')}
        </div>
      </div>
    );
  }

  // Inventory (E) or Crafting Table Modal
  const isTable = modal.type === 'crafting_table';
  const showCreativeCatalog = !isTable && worldManager.gameMode === 'creative' && invTab === 'creative';
  const hasAnyGridItem = craftGrid.some(Boolean);

  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-3 pointer-events-auto">
      <div className="mc-panel p-4 flex flex-col lg:flex-row gap-4 max-w-[96vw] max-h-[92vh] overflow-y-auto">
        {/* Left/Main Inventory + Interactive Crafting Grid + Armor / Creative Catalog */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">
                {isTable ? 'Crafting Table (3×3)' : 'Inventory'}
              </h3>
              {!isTable && worldManager.gameMode === 'creative' && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`px-2 py-0.5 text-[11px] font-bold border border-black cursor-pointer ${
                      invTab === 'survival' ? 'bg-white text-black' : 'bg-[#8b8b8b] text-white'
                    }`}
                    onClick={() => setInvTab('survival')}
                  >
                    Gear
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-0.5 text-[11px] font-bold border border-black cursor-pointer ${
                      invTab === 'creative' ? 'bg-white text-black' : 'bg-[#8b8b8b] text-white'
                    }`}
                    onClick={() => setInvTab('creative')}
                  >
                    Catalog
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="mc-btn px-2.5 py-0.5 text-xs font-bold" onClick={handleCloseModal}>
              X
            </button>
          </div>

          {/* Interactive Crafting Grid & Armor Row */}
          {!showCreativeCatalog && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#b3b3b3] border-2 border-[#7b7b7b] p-2.5">
              {/* Armor Slots (only in Player Inventory) */}
              {!isTable && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold text-neutral-800">
                    Armor ({inventory.getArmorPoints()}/20)
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {Array.from({ length: 4 }).map((_, aIdx) => (
                      <ItemSlotButton
                        key={aIdx}
                        stack={inventory.getArmorSlot(aIdx)}
                        itemRegistry={itemRegistry}
                        textureAtlas={worldManager.world.textureAtlas}
                        placeholder={ARMOR_LABELS[aIdx]}
                        onLeftClick={() => {
                          onUiClick();
                          inventory.unequipArmor(aIdx);
                          onRefresh();
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive 2x2 or 3x3 Crafting Grid */}
              <div className="flex items-center gap-3 mx-auto">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-neutral-800">
                      Crafting ({gridSize}×{gridSize})
                    </span>
                    {hasAnyGridItem && (
                      <button
                        type="button"
                        onClick={() => {
                          onUiClick();
                          returnGridToInventory();
                          setCraftGrid(new Array(gridSize * gridSize).fill(null));
                        }}
                        className="px-1.5 py-0.5 text-[9px] font-bold bg-[#8b8b8b] text-white border border-black hover:bg-[#9c9c9c] cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div
                    className={`grid gap-1 ${gridSize === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
                  >
                    {Array.from({ length: gridSize * gridSize }).map((_, idx) => (
                      <ItemSlotButton
                        key={idx}
                        stack={craftGrid[idx] ?? null}
                        itemRegistry={itemRegistry}
                        textureAtlas={worldManager.world.textureAtlas}
                        onLeftClick={() => handleCraftCellLeftClick(idx)}
                        onRightClick={() => handleCraftCellRightClick(idx)}
                      />
                    ))}
                  </div>
                </div>

                {/* Arrow */}
                <div className="text-lg font-black text-neutral-700 select-none">→</div>

                {/* Live Output Preview Slot */}
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-neutral-800">Result</span>
                  <ItemSlotButton
                    stack={
                      matchedRecipe
                        ? { itemId: matchedRecipe.result.itemId, count: matchedRecipe.result.count }
                        : null
                    }
                    itemRegistry={itemRegistry}
                    textureAtlas={worldManager.world.textureAtlas}
                    highlight={Boolean(matchedRecipe)}
                    placeholder="Out"
                    onLeftClick={handleCraftOutputClick}
                  />
                  <span className="text-[9px] text-neutral-700">
                    {matchedRecipe ? 'Click / Shift+Click' : 'Place items'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Creative Item Catalog */}
          {showCreativeCatalog ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blocks, tools, armor, food..."
                className="bg-black text-white border-2 border-[#555] px-2.5 py-1.5 text-xs outline-none"
              />
              <div className="grid grid-cols-9 gap-1 max-h-52 overflow-y-auto bg-[#a6a6a6] p-1 border-2 border-[#555]">
                {allItems.map((it: any) => (
                  <ItemSlotButton
                    key={it.id}
                    stack={{ itemId: it.id, count: it.maxStack }}
                    itemRegistry={itemRegistry}
                    textureAtlas={worldManager.world.textureAtlas}
                    onLeftClick={() => {
                      onUiClick();
                      inventory.addItem(it.id, it.maxStack > 1 ? 64 : 1);
                      onRefresh();
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {renderPlayerInventoryGrid(
            selectedInvSlot !== null
              ? 'Click a Crafting cell to place 1, or another slot to swap'
              : 'LMB Select/Swap • RMB Split/Equip'
          )}
        </div>

        {/* Right Column: Classic Recipe Book */}
        <div className="w-full lg:w-72 flex flex-col gap-2 border-t-2 lg:border-t-0 lg:border-l-2 border-[#7b7b7b] pt-3 lg:pt-0 lg:pl-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold">
              {isTable ? '3×3 Recipe Book' : '2×2 Recipe Book'}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`px-2 py-0.5 text-[10px] font-bold border border-black cursor-pointer ${
                  recipeFilter === 'all' ? 'bg-white text-black' : 'bg-[#8b8b8b] text-white'
                }`}
                onClick={() => setRecipeFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 text-[10px] font-bold border border-black cursor-pointer ${
                  recipeFilter === 'craftable' ? 'bg-white text-black' : 'bg-[#8b8b8b] text-white'
                }`}
                onClick={() => setRecipeFilter('craftable')}
              >
                Ready
              </button>
            </div>
          </div>
          <div className="text-[10px] text-neutral-700">
            Click to load into grid • Shift+Click to quick-craft
          </div>

          <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">
            {recipes.map((entry: any) => {
              const r = entry.recipe;
              const outItemId = r.result?.itemId;
              const outCount = r.result?.count ?? 1;
              const outIcon = outItemId
                ? itemRegistry.getItemIconUrl(outItemId, worldManager.world.textureAtlas)
                : null;
              const outDef = outItemId ? itemRegistry.get(outItemId) : null;
              const costs = Array.isArray(entry.costs) ? entry.costs : [];
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!entry.craftable}
                  onClick={(e) => handleRecipeClick(entry, e)}
                  className={`flex items-center gap-2 p-1.5 border-2 text-left transition-colors ${
                    entry.craftable
                      ? 'bg-[#b2c7a4] border-[#3d6328] hover:bg-[#c5deb5] cursor-pointer'
                      : 'bg-[#a4a4a4] border-[#6a6a6a] opacity-65 cursor-not-allowed'
                  }`}
                >
                  {outIcon && (
                    <img src={outIcon} alt={outDef?.name ?? r.name} className="w-7 h-7 mc-pixel shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-neutral-900 truncate">
                      {outDef?.name ?? r.name} ×{outCount}
                    </div>
                    <div className="text-[10px] text-neutral-700 truncate">
                      {costs
                        .map((ing: any) => `${ing.count} ${itemRegistry.get(ing.itemId)?.name ?? ing.itemId}`)
                        .join(', ')}
                    </div>
                  </div>
                </button>
              );
            })}
            {recipes.length === 0 && (
              <div className="text-xs text-neutral-600 text-center py-6">
                No matching recipes.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
