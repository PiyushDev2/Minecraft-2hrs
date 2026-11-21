/**
 * @file Player.js
 * @description Player controller & physics state exposing clean coordinates, look direction,
 * velocity, ground/water detection, and block overlap prevention for frontend integration.
 */

import { AABB } from './Collision.js';
import { stepEntityPhysics } from './Physics.js';

/**
 * Represents the controllable player entity in the voxel world.
 */
export class Player {
  /**
   * @param {import('../world/World.js').World} world
   * @param {Object} [options]
   * @param {number} [options.x=8]
   * @param {number} [options.y=64]
   * @param {number} [options.z=8]
   * @param {number} [options.width=0.6]
   * @param {number} [options.height=1.8]
   * @param {number} [options.eyeHeight=1.62]
   */
  constructor(world, { x = 8, y = 64, z = 8, width = 0.6, height = 1.8, eyeHeight = 1.62 } = {}) {
    /** @type {import('../world/World.js').World} */
    this.world = world;

    /** @type {{ x: number, y: number, z: number }} */
    this.position = { x, y, z };
    /** @type {{ x: number, y: number, z: number }} */
    this.velocity = { x: 0, y: 0, z: 0 };

    /** @type {number} */
    this.width = width;
    /** @type {number} */
    this.height = height;
    /** @type {number} */
    this.eyeHeight = eyeHeight;

    /** @type {number} Horizontal look angle in radians */
    this.yaw = 0;
    /** @type {number} Vertical look angle in radians (-PI/2 .. PI/2) */
    this.pitch = -0.15;

    /** @type {boolean} */
    this.grounded = false;
    /** @type {boolean} */
    this.inWater = false;
    /** @type {boolean} */
    this.flyMode = false;
    /** @type {boolean} */
    this.sneaking = false;
  }

  /**
   * Returns a copy of player feet position { x, y, z }.
   * @returns {{ x: number, y: number, z: number }}
   */
  getPosition() {
    return { x: this.position.x, y: this.position.y, z: this.position.z };
  }

  /**
   * Returns player eye/camera position { x, y, z }.
   * @returns {{ x: number, y: number, z: number }}
   */
  getEyePosition() {
    const crouchOffset = this.sneaking && !this.flyMode ? -0.12 : 0;
    return {
      x: this.position.x,
      y: this.position.y + this.eyeHeight + crouchOffset,
      z: this.position.z,
    };
  }

  /**
   * Teleports player to (x, y, z) and resets velocity.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  /**
   * Returns a copy of current velocity { x, y, z }.
   * @returns {{ x: number, y: number, z: number }}
   */
  getVelocity() {
    return { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
  }

  /**
   * Returns true if player is standing on solid ground.
   * @returns {boolean}
   */
  isGrounded() {
    return this.grounded;
  }

  /**
   * Returns true if player bounding box intersects water.
   * @returns {boolean}
   */
  isInWater() {
    return this.inWater;
  }

  /**
   * Toggles creative flight mode (disables gravity and enables vertical flight).
   * @param {boolean} enabled
   */
  setFlyMode(enabled) {
    this.flyMode = Boolean(enabled);
    if (this.flyMode) {
      this.velocity.y = 0;
      this.grounded = false;
    }
  }

  /**
   * Sets yaw and pitch in radians, clamping pitch to avoid gimbal flip.
   * @param {number} yaw
   * @param {number} pitch
   */
  setRotation(yaw, pitch) {
    this.yaw = yaw;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, pitch));
  }

  /**
   * Applies incremental look deltas in radians.
   * @param {number} deltaYaw
   * @param {number} deltaPitch
   */
  rotate(deltaYaw, deltaPitch) {
    this.setRotation(this.yaw + deltaYaw, this.pitch + deltaPitch);
  }

  /**
   * Returns { yaw, pitch } in radians.
   * @returns {{ yaw: number, pitch: number }}
   */
  getRotation() {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  /**
   * Computes normalized 3D look direction vector matching Three.js YXZ camera orientation
   * where yaw = 0 looks along -Z.
   * @returns {{ x: number, y: number, z: number }}
   */
  getForwardVector() {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  /**
   * Returns the player's current world-space AABB.
   * @returns {AABB}
   */
  getBoundingBox() {
    return AABB.fromEntityPosition(
      this.position.x,
      this.position.y,
      this.position.z,
      this.width,
      this.height
    );
  }

  /**
   * Checks whether placing a solid block at voxel (bx, by, bz) would intersect the player.
   * @param {number} bx
   * @param {number} by
   * @param {number} bz
   * @returns {boolean}
   */
  wouldBlockCollide(bx, by, bz) {
    const blockBox = new AABB(bx, by, bz, bx + 1, by + 1, bz + 1);
    return this.getBoundingBox().intersects(blockBox);
  }

  /**
   * Steps player movement & physics for one frame.
   * @param {number} deltaTime - Seconds elapsed since previous frame.
   * @param {Object} [input={}]
   * @param {boolean} [input.forward=false]
   * @param {boolean} [input.backward=false]
   * @param {boolean} [input.left=false]
   * @param {boolean} [input.right=false]
   * @param {boolean} [input.jump=false]
   * @param {boolean} [input.sprint=false]
   * @param {boolean} [input.sneak=false]
   */
  update(deltaTime, input = {}) {
    const forwardAxis = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const strafeAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    // Forward along -Z when yaw=0; Right along +X when yaw=0
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    let wishX = -sinY * forwardAxis + cosY * strafeAxis;
    let wishZ = -cosY * forwardAxis - sinY * strafeAxis;

    const len = Math.hypot(wishX, wishZ);
    if (len > 1) {
      wishX /= len;
      wishZ /= len;
    }

    this.sneaking = Boolean(input.sneak);

    stepEntityPhysics(this, this.world, deltaTime, {
      wishX,
      wishZ,
      jump: Boolean(input.jump),
      sprint: Boolean(input.sprint),
      sneak: this.sneaking,
    });
  }
}
