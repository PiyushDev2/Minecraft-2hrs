/**
 * @file Physics.js
 * @description Entity kinematic physics integrator handling gravity, walking acceleration,
 * air drag, jumping, water buoyancy, and voxel collision stepping.
 */

import { AABB, isBoxInLiquid, moveBoxWithCollision } from './Collision.js';

export const PHYSICS_CONSTANTS = Object.freeze({
  GRAVITY: -28.0,
  WATER_GRAVITY: -6.0,
  TERMINAL_VELOCITY: -46.0,
  WATER_TERMINAL_VELOCITY: -4.5,
  JUMP_VELOCITY: 9.2,
  SWIM_UP_VELOCITY: 5.2,
  WALK_SPEED: 5.4,
  SPRINT_SPEED: 8.2,
  SNEAK_SPEED: 2.6,
  SWIM_SPEED: 3.6,
  FLY_SPEED: 14.0,
  FLY_SPRINT_SPEED: 24.0,
  GROUND_ACCEL: 55.0,
  AIR_ACCEL: 18.0,
  GROUND_FRICTION: 12.0,
  AIR_FRICTION: 2.5,
  WATER_FRICTION: 6.5,
});

/**
 * Integrates one physics step for an entity (such as Player) inside the voxel World.
 * Sub-steps large deltaTimes (> 0.05s) for collision stability.
 *
 * @param {Object} entity - Entity with position, velocity, width, height, grounded, inWater, flyMode.
 * @param {import('../world/World.js').World} world
 * @param {number} deltaTime - Elapsed frame time in seconds.
 * @param {{ wishX: number, wishZ: number, jump: boolean, sprint: boolean, sneak: boolean }} intent
 */
export function stepEntityPhysics(entity, world, deltaTime, intent) {
  const clampedDt = Math.min(Math.max(deltaTime, 0), 0.25);
  if (clampedDt === 0) return;

  const maxStep = 1 / 60;
  let remaining = clampedDt;

  while (remaining > 0) {
    const dt = Math.min(remaining, maxStep);
    _integrateSubstep(entity, world, dt, intent);
    remaining -= dt;
  }
}

/**
 * @private
 */
function _integrateSubstep(entity, world, dt, intent) {
  const pos = entity.position;
  const vel = entity.velocity;
  const box = AABB.fromEntityPosition(pos.x, pos.y, pos.z, entity.width, entity.height);

  entity.inWater = isBoxInLiquid(world, box);

  if (entity.flyMode) {
    const speed = intent.sprint ? PHYSICS_CONSTANTS.FLY_SPRINT_SPEED : PHYSICS_CONSTANTS.FLY_SPEED;
    const targetVx = intent.wishX * speed;
    const targetVz = intent.wishZ * speed;
    let targetVy = 0;
    if (intent.jump) targetVy += speed * 0.75;
    if (intent.sneak) targetVy -= speed * 0.75;

    const blend = Math.min(1, dt * 14);
    vel.x += (targetVx - vel.x) * blend;
    vel.y += (targetVy - vel.y) * blend;
    vel.z += (targetVz - vel.z) * blend;

    const res = moveBoxWithCollision(world, box, vel.x * dt, vel.y * dt, vel.z * dt);
    if (res.hitX) vel.x = 0;
    if (res.hitZ) vel.z = 0;
    if (res.grounded || res.hitCeiling) vel.y = 0;
    entity.grounded = res.grounded;
  } else {
    // Horizontal movement
    let maxSpeed = PHYSICS_CONSTANTS.WALK_SPEED;
    if (entity.inWater) {
      maxSpeed = PHYSICS_CONSTANTS.SWIM_SPEED;
    } else if (intent.sneak) {
      maxSpeed = PHYSICS_CONSTANTS.SNEAK_SPEED;
    } else if (intent.sprint) {
      maxSpeed = PHYSICS_CONSTANTS.SPRINT_SPEED;
    }

    const accel = entity.grounded ? PHYSICS_CONSTANTS.GROUND_ACCEL : PHYSICS_CONSTANTS.AIR_ACCEL;
    const friction = entity.inWater
      ? PHYSICS_CONSTANTS.WATER_FRICTION
      : entity.grounded
      ? PHYSICS_CONSTANTS.GROUND_FRICTION
      : PHYSICS_CONSTANTS.AIR_FRICTION;

    // Apply damping when no horizontal input, or accelerate toward wish direction
    const wishMag = Math.hypot(intent.wishX, intent.wishZ);
    if (wishMag > 0.001) {
      const targetVx = (intent.wishX / wishMag) * maxSpeed;
      const targetVz = (intent.wishZ / wishMag) * maxSpeed;
      const factor = Math.min(1, accel * dt / maxSpeed);
      vel.x += (targetVx - vel.x) * factor;
      vel.z += (targetVz - vel.z) * factor;
    } else {
      const damp = Math.max(0, 1 - friction * dt);
      vel.x *= damp;
      vel.z *= damp;
    }

    // Vertical forces: gravity, jump, water buoyancy
    if (entity.inWater) {
      vel.y += PHYSICS_CONSTANTS.WATER_GRAVITY * dt;
      if (intent.jump) {
        vel.y = Math.min(PHYSICS_CONSTANTS.SWIM_UP_VELOCITY, vel.y + 24.0 * dt);
      }
      vel.y = Math.max(PHYSICS_CONSTANTS.WATER_TERMINAL_VELOCITY, vel.y);
    } else {
      if (intent.jump && entity.grounded) {
        vel.y = PHYSICS_CONSTANTS.JUMP_VELOCITY;
        entity.grounded = false;
      }
      vel.y += PHYSICS_CONSTANTS.GRAVITY * dt;
      vel.y = Math.max(PHYSICS_CONSTANTS.TERMINAL_VELOCITY, vel.y);
    }

    const res = moveBoxWithCollision(world, box, vel.x * dt, vel.y * dt, vel.z * dt);

    if (res.hitX) vel.x = 0;
    if (res.hitZ) vel.z = 0;
    if (res.grounded && vel.y < 0) {
      vel.y = 0;
    }
    if (res.hitCeiling && vel.y > 0) {
      vel.y = 0;
    }

    entity.grounded = res.grounded;
  }

  // Update entity position from resolved AABB center-bottom
  pos.x = (box.minX + box.maxX) * 0.5;
  pos.y = box.minY;
  pos.z = (box.minZ + box.maxZ) * 0.5;

  // Safety floor clamp so player never falls into void below Y=-32
  if (pos.y < -32) {
    pos.y = 80;
    vel.y = 0;
  }
}
