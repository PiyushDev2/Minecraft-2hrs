# VoxelCraft Backend & World Engine (`src/backend/`)

Complete modular backend engine for a browser-based Minecraft-style voxel game built with JavaScript ES Modules, Three.js, and WebGL/Browser APIs.

---

## Architecture Overview

```text
src/backend/
├── index.js                 # Barrel exports & createVoxelEngine() factory
├── blocks/
│   ├── Block.js             # Block entity model & face constants
│   └── BlockRegistry.js     # Central block registry, BLOCK_IDS, O(1) lookup tables
├── terrain/
│   ├── Noise.js             # Seeded Mulberry32 PRNG, 2D/3D Simplex, FBM & Ridged noise
│   ├── BiomeGenerator.js    # Climate sampling (Ocean, Beach, Valley, Plains, Forest, Desert, Mountains)
│   └── TerrainGenerator.js  # Multi-biome elevation, rivers, 3D caves, water & cross-chunk trees
├── chunks/
│   ├── Chunk.js             # 16×128×16 Uint8Array voxel storage & edit delta tracking
│   ├── ChunkManager.js      # View-distance streaming, async/budgeted loading & neighbor dirtying
│   └── ChunkMesher.js       # Greedy meshing, cross-chunk culling, vertex AO & Three.js BufferGeometry
├── textures/
│   └── TextureAtlas.js      # Procedural 16×16 pixel-art HTML5 Canvas atlas (zero external assets)
├── physics/
│   ├── Collision.js         # AABB & axis-separated swept voxel collision resolution
│   ├── Physics.js           # Gravity, walking, sprinting, jumping, water buoyancy & fly mode
│   └── Player.js            # Player state, look vectors, physics step & block overlap guard
├── save/
│   └── WorldSave.js         # Seed + sparse chunk modification delta persistence (localStorage & JSON)
└── world/
    ├── World.js             # Core World API (generate, get/setBlock, raycast DDA, chunk lifecycle)
    └── WorldManager.js      # High-level coordinator syncing World, Player, Save & Three.js Scene
```

---

## Quick Start: Frontend Integration

### 1. Initialize Engine & Attach Three.js Scene

```js
import * as THREE from 'three';
import { WorldManager, BLOCK_IDS } from './backend/index.js';

const scene = new THREE.Scene();
const engine = new WorldManager({
  seed: 'alpine-valley-2026',
  viewDistance: 5,
  scene, // Automatically adds/removes chunk THREE.Groups as chunks stream
});

const { world, player } = engine.initWorld();
```

### 2. Frame Loop (Physics, Chunk Streaming & Camera Sync)

```js
function animate(deltaTime) {
  // 1. Step player AABB physics & stream/remesh chunks around player
  engine.update(deltaTime, {
    forward: keys.KeyW,
    backward: keys.KeyS,
    left: keys.KeyA,
    right: keys.KeyD,
    jump: keys.Space,
    sprint: keys.ShiftLeft,
    sneak: keys.ControlLeft,
  });

  // 2. Sync Three.js camera with player eye position & rotation
  const eye = player.getEyePosition();
  const rot = player.getRotation();
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = rot.yaw;
  camera.rotation.x = rot.pitch;

  renderer.render(scene, camera);
}
```

### 3. Block Breaking & Placement via Voxel DDA Raycast

```js
const hit = world.raycast(player.getEyePosition(), player.getForwardVector(), 6);

if (hit.hit) {
  // Break targeted block (automatically respects breakable: false on Bedrock)
  world.breakBlock(hit.position.x, hit.position.y, hit.position.z);

  // Or place block on targeted face, preventing self-entrapment inside player AABB
  const { x, y, z } = hit.adjacent;
  world.placeBlock(x, y, z, BLOCK_IDS.OAK_LOG, (bx, by, bz) =>
    player.wouldBlockCollide(bx, by, bz)
  );
}
```

### 4. Save & Load Persistence

```js
// Save seed + player position + only modified voxel deltas to localStorage
engine.save('slot_1');

// Restore saved world & edits
engine.load('slot_1');
```

---

## Core Public API Reference

### `World` (`src/backend/world/World.js`)
- `world.generate(seed, options)` — Resets and generates terrain from a string or numeric seed.
- `world.getBlock(x, y, z)` — Returns numeric `BLOCK_ID` at world coordinates.
- `world.setBlock(x, y, z, blockId)` — Sets block ID, records edit delta, and dirties affected chunk(s).
- `world.breakBlock(x, y, z)` — Breaks block if breakable (`{ broken, previousId }`).
- `world.placeBlock(x, y, z, blockId, overlapCheck)` — Places block into Air/Liquid if valid.
- `world.getChunk(chunkX, chunkZ)` — Returns loaded `Chunk` or `undefined`.
- `world.loadChunk(chunkX, chunkZ, buildMeshNow)` — Loads and optionally meshes a 16×128×16 chunk.
- `world.unloadChunk(chunkX, chunkZ)` — Unloads chunk, saves delta in memory, disposes GPU buffers.
- `world.update(focusPosition, deltaTime)` — Streams chunks within `viewDistance` and remeshes dirty chunks.
- `world.raycast(origin, direction, maxDistance)` — Fast 3D DDA voxel ray traversal returning `{ hit, blockId, position, normal, adjacent, distance }`.
- `world.getSurfaceY(x, z)` / `world.getBiomeAt(x, z)` — Terrain & biome queries.
- `world.onChunkMeshReady(cb)` / `world.onChunkUnloaded(cb)` — Lifecycle hooks for custom Three.js scene management.

### `Player` (`src/backend/physics/Player.js`)
- `player.getPosition()` / `player.getEyePosition()` — Feet and camera-eye coordinates.
- `player.setPosition(x, y, z)` — Teleports player and clears velocity.
- `player.getVelocity()` — Current `{ x, y, z }` velocity vector.
- `player.isGrounded()` / `player.isInWater()` — Contact & liquid state queries.
- `player.setFlyMode(enabled)` — Toggles creative flight vs survival gravity/collision.
- `player.rotate(deltaYaw, deltaPitch)` / `player.setRotation(yaw, pitch)` — Clamped YXZ look orientation.
- `player.getForwardVector()` — Normalized 3D look direction for raycasting.
- `player.wouldBlockCollide(bx, by, bz)` — Prevents placing blocks overlapping the player's AABB.
- `player.update(deltaTime, input)` — Advances sub-stepped AABB physics and collision resolution.

### `BlockRegistry` (`src/backend/blocks/BlockRegistry.js`)
Built-in `BLOCK_IDS`: `AIR (0)`, `GRASS (1)`, `DIRT (2)`, `STONE (3)`, `BEDROCK (4)`, `SAND (5)`, `GRAVEL (6)`, `WATER (7)`, `OAK_LOG (8)`, `OAK_LEAVES (9)`.
Each `Block` exposes `id`, `key`, `name`, `textures`, `solid`, `transparent`, `liquid`, `breakable`, `hardness`, `color`, and `occludesFaces`.
