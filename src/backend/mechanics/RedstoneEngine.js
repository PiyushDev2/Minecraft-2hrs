/**
 * @file RedstoneEngine.js
 * @description Event-driven bounded-BFS Redstone signal propagation (0..15) for wires,
 * torches, levers, buttons, pressure plates, lamps, doors, TNT ignition, and pistons.
 */

import { BLOCK_IDS } from '../blocks/BlockRegistry.js';
import { ENGINE_EVENTS } from '../core/EventBus.js';

const NEIGHBORS_6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const HORIZONTAL_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const UNPUSHABLE = new Set([
  BLOCK_IDS.BEDROCK,
  BLOCK_IDS.OBSIDIAN,
  BLOCK_IDS.END_PORTAL_FRAME,
  BLOCK_IDS.END_PORTAL_FRAME_FILLED,
  BLOCK_IDS.END_PORTAL,
  BLOCK_IDS.NETHER_PORTAL,
  BLOCK_IDS.ENCHANTING_TABLE,
  BLOCK_IDS.CHEST,
  BLOCK_IDS.FURNACE,
  BLOCK_IDS.FURNACE_LIT,
  BLOCK_IDS.PISTON_EXTENDED,
]);

function keyOf(x, y, z) {
  return `${x},${y},${z}`;
}

export class RedstoneEngine {
  /**
   * @param {{ world: any, eventBus?: any, onIgniteTnt?: (x:number,y:number,z:number)=>void }} opts
   */
  constructor({ world, eventBus = null, onIgniteTnt = null }) {
    this.world = world;
    this.eventBus = eventBus;
    this.onIgniteTnt = onIgniteTnt;
    /** @type {Map<string, { x:number, y:number, z:number, remaining:number }>} */
    this._timedButtons = new Map();
    /** @type {Map<string, { x:number, y:number, z:number }>} */
    this._pressedPlates = new Map();
    this._solving = false;
  }

  clear() {
    this._timedButtons.clear();
    this._pressedPlates.clear();
    this._solving = false;
  }

  isPowerSource(id) {
    return (
      id === BLOCK_IDS.REDSTONE_TORCH ||
      id === BLOCK_IDS.LEVER_ON ||
      id === BLOCK_IDS.STONE_BUTTON_ON ||
      id === BLOCK_IDS.PRESSURE_PLATE_ON
    );
  }

  isWire(id) {
    return id === BLOCK_IDS.REDSTONE_WIRE || id === BLOCK_IDS.REDSTONE_WIRE_ON;
  }

  isRedstoneRelevant(id) {
    return (
      this.isPowerSource(id) ||
      this.isWire(id) ||
      id === BLOCK_IDS.LEVER ||
      id === BLOCK_IDS.STONE_BUTTON ||
      id === BLOCK_IDS.PRESSURE_PLATE ||
      id === BLOCK_IDS.REDSTONE_LAMP ||
      id === BLOCK_IDS.REDSTONE_LAMP_ON ||
      id === BLOCK_IDS.PISTON ||
      id === BLOCK_IDS.PISTON_EXTENDED ||
      id === BLOCK_IDS.OAK_DOOR_CLOSED ||
      id === BLOCK_IDS.OAK_DOOR_OPEN ||
      id === BLOCK_IDS.TNT
    );
  }

  /**
   * Toggles a lever at (x, y, z) and recomputes local redstone power.
   */
  toggleLever(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id !== BLOCK_IDS.LEVER && id !== BLOCK_IDS.LEVER_ON) return false;
    const next = id === BLOCK_IDS.LEVER ? BLOCK_IDS.LEVER_ON : BLOCK_IDS.LEVER;
    this.world.setBlock(x, y, z, next);
    this.solveAround(x, y, z);
    const powered = next === BLOCK_IDS.LEVER_ON;
    this.eventBus?.emit(ENGINE_EVENTS.REDSTONE_UPDATED, { x, y, z, powered });
    return powered;
  }

  /**
   * Presses a stone button at (x, y, z) for 1.0 seconds.
   */
  pressButton(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id !== BLOCK_IDS.STONE_BUTTON && id !== BLOCK_IDS.STONE_BUTTON_ON) return false;
    this.world.setBlock(x, y, z, BLOCK_IDS.STONE_BUTTON_ON);
    this._timedButtons.set(keyOf(x, y, z), { x, y, z, remaining: 1.0 });
    this.solveAround(x, y, z);
    this.eventBus?.emit(ENGINE_EVENTS.REDSTONE_UPDATED, { x, y, z, powered: true });
    return true;
  }

  /**
   * Called whenever any block changes in the world to update nearby redstone networks.
   */
  onBlockChanged(x, y, z, newBlockId = null) {
    if (this._solving) return;
    const id = newBlockId ?? this.world.getBlock(x, y, z);
    let relevant = this.isRedstoneRelevant(id);
    if (!relevant) {
      for (const [dx, dy, dz] of NEIGHBORS_6) {
        if (this.isRedstoneRelevant(this.world.getBlock(x + dx, y + dy, z + dz))) {
          relevant = true;
          break;
        }
      }
    }
    if (relevant) {
      this.solveAround(x, y, z);
    }
  }

  /**
   * Bounded BFS solver around (ox, oy, oz) with max signal distance 15.
   */
  solveAround(ox, oy, oz) {
    if (this._solving) return;
    this._solving = true;
    try {
      const radius = 16;
      const visitedWires = new Map(); // key -> { x, y, z, power }
      const sources = [];
      const actuators = new Map(); // key -> { x, y, z, id }

      // 1. Collect all connected wires, sources, and actuators within bounded box
      const scanQueue = [[ox, oy, oz]];
      const scanned = new Set([keyOf(ox, oy, oz)]);
      let head = 0;

      while (head < scanQueue.length && scanned.size < 600) {
        const [cx, cy, cz] = scanQueue[head++];
        const id = this.world.getBlock(cx, cy, cz);

        if (this.isPowerSource(id)) {
          sources.push({ x: cx, y: cy, z: cz });
        } else if (this.isWire(id)) {
          visitedWires.set(keyOf(cx, cy, cz), { x: cx, y: cy, z: cz, power: 0 });
        } else if (
          id === BLOCK_IDS.REDSTONE_LAMP ||
          id === BLOCK_IDS.REDSTONE_LAMP_ON ||
          id === BLOCK_IDS.PISTON ||
          id === BLOCK_IDS.PISTON_EXTENDED ||
          id === BLOCK_IDS.OAK_DOOR_CLOSED ||
          id === BLOCK_IDS.OAK_DOOR_OPEN ||
          id === BLOCK_IDS.TNT
        ) {
          actuators.set(keyOf(cx, cy, cz), { x: cx, y: cy, z: cz, id });
        }

        // Expand neighbors (6-way + diagonal step up/down for wires)
        const expandOffsets = [
          ...NEIGHBORS_6,
          [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
          [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
        ];
        for (const [dx, dy, dz] of expandOffsets) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nz = cz + dz;
          if (
            Math.abs(nx - ox) > radius ||
            Math.abs(ny - oy) > 8 ||
            Math.abs(nz - oz) > radius
          ) {
            continue;
          }
          const k = keyOf(nx, ny, nz);
          if (scanned.has(k)) continue;
          const nid = this.world.getBlock(nx, ny, nz);
          if (this.isRedstoneRelevant(nid)) {
            scanned.add(k);
            scanQueue.push([nx, ny, nz]);
          }
        }
      }

      // 2. Propagate power (15 -> 1) from every active power source through wire graph
      const powerQueue = [];
      for (const src of sources) {
        for (const [dx, dy, dz] of NEIGHBORS_6) {
          const k = keyOf(src.x + dx, src.y + dy, src.z + dz);
          const w = visitedWires.get(k);
          if (w && w.power < 15) {
            w.power = 15;
            powerQueue.push(w);
          }
        }
      }

      let pqHead = 0;
      while (pqHead < powerQueue.length) {
        const cur = powerQueue[pqHead++];
        if (cur.power <= 1) continue;
        const nextPower = cur.power - 1;
        for (const [dx, dz] of HORIZONTAL_4) {
          for (const dy of [0, 1, -1]) {
            const nk = keyOf(cur.x + dx, cur.y + dy, cur.z + dz);
            const nw = visitedWires.get(nk);
            if (nw && nw.power < nextPower) {
              nw.power = nextPower;
              powerQueue.push(nw);
            }
          }
        }
      }

      // 3. Apply wire block states
      for (const w of visitedWires.values()) {
        const curId = this.world.getBlock(w.x, w.y, w.z);
        const wantId = w.power > 0 ? BLOCK_IDS.REDSTONE_WIRE_ON : BLOCK_IDS.REDSTONE_WIRE;
        if (curId !== wantId) {
          this.world.setBlock(w.x, w.y, w.z, wantId);
        }
      }

      // Helper to check if a position receives power from any adjacent source or powered wire
      const isPositionPowered = (ax, ay, az) => {
        for (const [dx, dy, dz] of NEIGHBORS_6) {
          const nid = this.world.getBlock(ax + dx, ay + dy, az + dz);
          if (this.isPowerSource(nid) || nid === BLOCK_IDS.REDSTONE_WIRE_ON) {
            return true;
          }
        }
        return false;
      };

      // 4. Update lamps, doors, TNT, and pistons
      for (const act of actuators.values()) {
        const powered = isPositionPowered(act.x, act.y, act.z);
        const curId = this.world.getBlock(act.x, act.y, act.z);

        if (curId === BLOCK_IDS.REDSTONE_LAMP && powered) {
          this.world.setBlock(act.x, act.y, act.z, BLOCK_IDS.REDSTONE_LAMP_ON);
        } else if (curId === BLOCK_IDS.REDSTONE_LAMP_ON && !powered) {
          this.world.setBlock(act.x, act.y, act.z, BLOCK_IDS.REDSTONE_LAMP);
        } else if (curId === BLOCK_IDS.OAK_DOOR_CLOSED && powered) {
          this.world.setBlock(act.x, act.y, act.z, BLOCK_IDS.OAK_DOOR_OPEN);
        } else if (curId === BLOCK_IDS.OAK_DOOR_OPEN && !powered) {
          this.world.setBlock(act.x, act.y, act.z, BLOCK_IDS.OAK_DOOR_CLOSED);
        } else if (curId === BLOCK_IDS.TNT && powered) {
          this.onIgniteTnt?.(act.x, act.y, act.z);
        } else if (curId === BLOCK_IDS.PISTON && powered) {
          this._extendPiston(act.x, act.y, act.z);
        } else if (curId === BLOCK_IDS.PISTON_EXTENDED && !powered) {
          this.world.setBlock(act.x, act.y, act.z, BLOCK_IDS.PISTON);
        }
      }
    } finally {
      this._solving = false;
    }
  }

  /**
   * Pushes up to 8 solid blocks in front of the piston (-Z direction) and extends head.
   * @private
   */
  _extendPiston(px, py, pz) {
    const dirZ = -1;
    const chain = [];
    for (let i = 1; i <= 8; i++) {
      const bz = pz + dirZ * i;
      const id = this.world.getBlock(px, py, bz);
      if (id === BLOCK_IDS.AIR || id === BLOCK_IDS.WATER) {
        break;
      }
      if (UNPUSHABLE.has(id)) {
        return; // Blocked by unpushable block
      }
      chain.push({ z: bz, id });
      if (i === 8) {
        // Check if 9th block is empty
        const after = this.world.getBlock(px, py, pz + dirZ * 9);
        if (after !== BLOCK_IDS.AIR && after !== BLOCK_IDS.WATER) return;
      }
    }

    // Shift blocks from farthest to nearest
    for (let i = chain.length - 1; i >= 0; i--) {
      this.world.setBlock(px, py, chain[i].z + dirZ, chain[i].id);
    }
    if (chain.length > 0) {
      this.world.setBlock(px, py, pz + dirZ, BLOCK_IDS.AIR);
    }
    this.world.setBlock(px, py, pz, BLOCK_IDS.PISTON_EXTENDED);
  }

  /**
   * Ticks button release timers and pressure plate occupancy.
   */
  update(dt, playerPos, entities = []) {
    // 1. Timed stone buttons
    if (this._timedButtons.size > 0) {
      for (const [k, btn] of this._timedButtons.entries()) {
        btn.remaining -= dt;
        if (btn.remaining <= 0) {
          this._timedButtons.delete(k);
          if (this.world.getBlock(btn.x, btn.y, btn.z) === BLOCK_IDS.STONE_BUTTON_ON) {
            this.world.setBlock(btn.x, btn.y, btn.z, BLOCK_IDS.STONE_BUTTON);
            this.solveAround(btn.x, btn.y, btn.z);
          }
        }
      }
    }

    // 2. Pressure plates stepped on by player or mobs
    const occupiedKeys = new Set();
    const checkFoot = (pos) => {
      if (!pos) return;
      const fx = Math.floor(pos.x);
      const fy = Math.floor(pos.y + 0.05);
      const fz = Math.floor(pos.z);
      const id = this.world.getBlock(fx, fy, fz);
      if (id === BLOCK_IDS.PRESSURE_PLATE || id === BLOCK_IDS.PRESSURE_PLATE_ON) {
        const k = keyOf(fx, fy, fz);
        occupiedKeys.add(k);
        if (id === BLOCK_IDS.PRESSURE_PLATE) {
          this.world.setBlock(fx, fy, fz, BLOCK_IDS.PRESSURE_PLATE_ON);
          this._pressedPlates.set(k, { x: fx, y: fy, z: fz });
          this.solveAround(fx, fy, fz);
        }
      }
    };

    checkFoot(playerPos);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e && !e.dead && e.position) checkFoot(e.position);
    }

    // Release pressure plates no longer occupied
    for (const [k, plate] of this._pressedPlates.entries()) {
      if (!occupiedKeys.has(k)) {
        this._pressedPlates.delete(k);
        if (this.world.getBlock(plate.x, plate.y, plate.z) === BLOCK_IDS.PRESSURE_PLATE_ON) {
          this.world.setBlock(plate.x, plate.y, plate.z, BLOCK_IDS.PRESSURE_PLATE);
          this.solveAround(plate.x, plate.y, plate.z);
        }
      }
    }
  }
}
