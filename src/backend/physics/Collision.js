/**
 * @file Collision.js
 * @description Axis-Aligned Bounding Box (AABB) collision detection and
 * axis-separated swept voxel terrain resolution.
 */

const EPSILON = 1e-5;

/**
 * Axis-Aligned Bounding Box used for entities and voxel blocks.
 */
export class AABB {
  /**
   * @param {number} minX
   * @param {number} minY
   * @param {number} minZ
   * @param {number} maxX
   * @param {number} maxY
   * @param {number} maxZ
   */
  constructor(minX, minY, minZ, maxX, maxY, maxZ) {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
  }

  /**
   * Constructs an entity AABB centered horizontally at (x, z) with bottom at y.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} width
   * @param {number} height
   * @returns {AABB}
   */
  static fromEntityPosition(x, y, z, width, height) {
    const halfW = width * 0.5;
    return new AABB(x - halfW, y, z - halfW, x + halfW, y + height, z + halfW);
  }

  /**
   * Checks whether this AABB strictly overlaps another AABB.
   * @param {AABB} other
   * @returns {boolean}
   */
  intersects(other) {
    return (
      this.minX < other.maxX &&
      this.maxX > other.minX &&
      this.minY < other.maxY &&
      this.maxY > other.minY &&
      this.minZ < other.maxZ &&
      this.maxZ > other.minZ
    );
  }

  /**
   * Translates AABB in-place by (dx, dy, dz).
   * @param {number} dx
   * @param {number} dy
   * @param {number} dz
   * @returns {AABB}
   */
  translate(dx, dy, dz) {
    this.minX += dx;
    this.maxX += dx;
    this.minY += dy;
    this.maxY += dy;
    this.minZ += dz;
    this.maxZ += dz;
    return this;
  }

  /**
   * Returns a cloned AABB.
   * @returns {AABB}
   */
  clone() {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }
}

/**
 * Checks whether an AABB overlaps any solid block in the world.
 * @param {import('../world/World.js').World} world
 * @param {AABB} box
 * @returns {boolean}
 */
export function isBoxCollidingWithWorld(world, box) {
  const minBX = Math.floor(box.minX + EPSILON);
  const maxBX = Math.floor(box.maxX - EPSILON);
  const minBY = Math.floor(box.minY + EPSILON);
  const maxBY = Math.floor(box.maxY - EPSILON);
  const minBZ = Math.floor(box.minZ + EPSILON);
  const maxBZ = Math.floor(box.maxZ - EPSILON);

  for (let y = minBY; y <= maxBY; y++) {
    for (let z = minBZ; z <= maxBZ; z++) {
      for (let x = minBX; x <= maxBX; x++) {
        const blockId = world.getBlock(x, y, z);
        if (world.blockRegistry.isSolid(blockId)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether an AABB overlaps any liquid (water or lava) block in the world.
 * @param {import('../world/World.js').World} world
 * @param {AABB} box
 * @returns {boolean}
 */
export function isBoxInLiquid(world, box) {
  const minBX = Math.floor(box.minX + EPSILON);
  const maxBX = Math.floor(box.maxX - EPSILON);
  const minBY = Math.floor(box.minY + EPSILON);
  const maxBY = Math.floor(box.maxY - EPSILON);
  const minBZ = Math.floor(box.minZ + EPSILON);
  const maxBZ = Math.floor(box.maxZ - EPSILON);

  for (let y = minBY; y <= maxBY; y++) {
    for (let z = minBZ; z <= maxBZ; z++) {
      for (let x = minBX; x <= maxBX; x++) {
        const blockId = world.getBlock(x, y, z);
        if (world.blockRegistry.isLiquid(blockId)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether an AABB overlaps any water block in the world.
 * @param {import('../world/World.js').World} world
 * @param {AABB} box
 * @returns {boolean}
 */
export function isBoxInWater(world, box) {
  const minBX = Math.floor(box.minX + EPSILON);
  const maxBX = Math.floor(box.maxX - EPSILON);
  const minBY = Math.floor(box.minY + EPSILON);
  const maxBY = Math.floor(box.maxY - EPSILON);
  const minBZ = Math.floor(box.minZ + EPSILON);
  const maxBZ = Math.floor(box.maxZ - EPSILON);

  for (let y = minBY; y <= maxBY; y++) {
    for (let z = minBZ; z <= maxBZ; z++) {
      for (let x = minBX; x <= maxBX; x++) {
        if (world.blockRegistry.isWater(world.getBlock(x, y, z))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether an AABB overlaps any lava block in the world.
 * @param {import('../world/World.js').World} world
 * @param {AABB} box
 * @returns {boolean}
 */
export function isBoxInLava(world, box) {
  const minBX = Math.floor(box.minX + EPSILON);
  const maxBX = Math.floor(box.maxX - EPSILON);
  const minBY = Math.floor(box.minY + EPSILON);
  const maxBY = Math.floor(box.maxY - EPSILON);
  const minBZ = Math.floor(box.minZ + EPSILON);
  const maxBZ = Math.floor(box.maxZ - EPSILON);

  for (let y = minBY; y <= maxBY; y++) {
    for (let z = minBZ; z <= maxBZ; z++) {
      for (let x = minBX; x <= maxBX; x++) {
        if (world.blockRegistry.isLava(world.getBlock(x, y, z))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Resolves entity movement along Y, X, and Z axes independently against solid voxel blocks.
 * Prevents corner snagging and reports ground/wall/ceiling contact flags.
 *
 * @param {import('../world/World.js').World} world
 * @param {AABB} box - Starting entity bounding box (mutated to final position).
 * @param {number} dx - Desired X displacement.
 * @param {number} dy - Desired Y displacement.
 * @param {number} dz - Desired Z displacement.
 * @returns {{ dx: number, dy: number, dz: number, grounded: boolean, hitCeiling: boolean, hitX: boolean, hitZ: boolean }}
 */
export function moveBoxWithCollision(world, box, dx, dy, dz) {
  let resolvedDx = dx;
  let resolvedDy = dy;
  let resolvedDz = dz;
  let grounded = false;
  let hitCeiling = false;
  let hitX = false;
  let hitZ = false;

  // 1. Resolve Y axis first (gravity / jump)
  if (dy !== 0) {
    const minBX = Math.floor(box.minX + EPSILON);
    const maxBX = Math.floor(box.maxX - EPSILON);
    const minBZ = Math.floor(box.minZ + EPSILON);
    const maxBZ = Math.floor(box.maxZ - EPSILON);

    if (dy < 0) {
      const targetMinY = Math.floor(box.minY + dy);
      const startMaxY = Math.floor(box.minY);
      outerDown: for (let y = startMaxY; y >= targetMinY; y--) {
        for (let z = minBZ; z <= maxBZ; z++) {
          for (let x = minBX; x <= maxBX; x++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              const blockTop = y + 1;
              if (box.minY >= blockTop - EPSILON && box.minY + resolvedDy < blockTop) {
                resolvedDy = blockTop - box.minY;
                grounded = true;
                break outerDown;
              }
            }
          }
        }
      }
    } else {
      const startMinY = Math.floor(box.maxY);
      const targetMaxY = Math.floor(box.maxY + dy);
      outerUp: for (let y = startMinY; y <= targetMaxY; y++) {
        for (let z = minBZ; z <= maxBZ; z++) {
          for (let x = minBX; x <= maxBX; x++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              const blockBottom = y;
              if (box.maxY <= blockBottom + EPSILON && box.maxY + resolvedDy > blockBottom) {
                resolvedDy = blockBottom - box.maxY;
                hitCeiling = true;
                break outerUp;
              }
            }
          }
        }
      }
    }
    box.translate(0, resolvedDy, 0);
  }

  // 2. Resolve X axis
  if (dx !== 0) {
    const minBY = Math.floor(box.minY + EPSILON);
    const maxBY = Math.floor(box.maxY - EPSILON);
    const minBZ = Math.floor(box.minZ + EPSILON);
    const maxBZ = Math.floor(box.maxZ - EPSILON);

    if (dx > 0) {
      const startX = Math.floor(box.maxX);
      const endX = Math.floor(box.maxX + dx);
      outerRight: for (let x = startX; x <= endX; x++) {
        for (let y = minBY; y <= maxBY; y++) {
          for (let z = minBZ; z <= maxBZ; z++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              if (box.maxX <= x + EPSILON && box.maxX + resolvedDx > x) {
                resolvedDx = x - box.maxX;
                hitX = true;
                break outerRight;
              }
            }
          }
        }
      }
    } else {
      const startX = Math.floor(box.minX);
      const endX = Math.floor(box.minX + dx);
      outerLeft: for (let x = startX; x >= endX; x--) {
        for (let y = minBY; y <= maxBY; y++) {
          for (let z = minBZ; z <= maxBZ; z++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              const blockRight = x + 1;
              if (box.minX >= blockRight - EPSILON && box.minX + resolvedDx < blockRight) {
                resolvedDx = blockRight - box.minX;
                hitX = true;
                break outerLeft;
              }
            }
          }
        }
      }
    }
    box.translate(resolvedDx, 0, 0);
  }

  // 3. Resolve Z axis
  if (dz !== 0) {
    const minBY = Math.floor(box.minY + EPSILON);
    const maxBY = Math.floor(box.maxY - EPSILON);
    const minBX = Math.floor(box.minX + EPSILON);
    const maxBX = Math.floor(box.maxX - EPSILON);

    if (dz > 0) {
      const startZ = Math.floor(box.maxZ);
      const endZ = Math.floor(box.maxZ + dz);
      outerFront: for (let z = startZ; z <= endZ; z++) {
        for (let y = minBY; y <= maxBY; y++) {
          for (let x = minBX; x <= maxBX; x++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              if (box.maxZ <= z + EPSILON && box.maxZ + resolvedDz > z) {
                resolvedDz = z - box.maxZ;
                hitZ = true;
                break outerFront;
              }
            }
          }
        }
      }
    } else {
      const startZ = Math.floor(box.minZ);
      const endZ = Math.floor(box.minZ + dz);
      outerBack: for (let z = startZ; z >= endZ; z--) {
        for (let y = minBY; y <= maxBY; y++) {
          for (let x = minBX; x <= maxBX; x++) {
            if (world.blockRegistry.isSolid(world.getBlock(x, y, z))) {
              const blockBack = z + 1;
              if (box.minZ >= blockBack - EPSILON && box.minZ + resolvedDz < blockBack) {
                resolvedDz = blockBack - box.minZ;
                hitZ = true;
                break outerBack;
              }
            }
          }
        }
      }
    }
    box.translate(0, 0, resolvedDz);
  }

  // Extra ground probe at feet when dy === 0 (standing still on ground)
  if (!grounded && dy <= 0) {
    const footProbe = box.clone().translate(0, -0.015, 0);
    grounded = isBoxCollidingWithWorld(world, footProbe);
  }

  return {
    dx: resolvedDx,
    dy: resolvedDy,
    dz: resolvedDz,
    grounded,
    hitCeiling,
    hitX,
    hitZ,
  };
}
