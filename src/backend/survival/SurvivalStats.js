/**
 * @file SurvivalStats.js
 * @description Manages player survival vitals (health, hunger, saturation, oxygen,
 * fall damage, drowning, natural regeneration, and respawn state).
 */

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

/**
 * Tracks and updates player survival mechanics.
 */
export class SurvivalStats {
  constructor() {
    /** @type {number} 0..20 */
    this.health = MAX_HEALTH;
    /** @type {number} */
    this.maxHealth = MAX_HEALTH;
    /** @type {number} 0..20 */
    this.hunger = MAX_HUNGER;
    /** @type {number} */
    this.maxHunger = MAX_HUNGER;
    /** @type {number} */
    this.saturation = 5;
    /** @type {number} 0..10 oxygen bubbles */
    this.air = MAX_AIR;
    /** @type {number} */
    this.maxAir = MAX_AIR;

    /** @type {boolean} */
    this.isDead = false;
    /** @type {string|null} */
    this.lastDamageSource = null;

    /** @type {number} Invulnerability frames remaining (seconds) */
    this.invulnerableTimer = 0;
    /** @type {number} Visual hurt flash timer (seconds) */
    this.hurtFlashTimer = 0;

    /** @type {boolean} */
    this._wasGrounded = true;
    /** @type {number} */
    this._peakAirY = 64;
    /** @type {number} */
    this._regenTimer = 0;
    /** @type {number} */
    this._starveTimer = 0;
    /** @type {number} */
    this._drownTimer = 0;
    /** @type {number} */
    this._airDepleteTimer = 0;
    /** @type {number} */
    this._exhaustion = 0;
  }

  /**
   * Resets all survival stats to healthy defaults (used on respawn or new world).
   * @param {number} [spawnY=64]
   */
  reset(spawnY = 64) {
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.air = this.maxAir;
    this.isDead = false;
    this.lastDamageSource = null;
    this.invulnerableTimer = 0;
    this.hurtFlashTimer = 0;
    this._wasGrounded = true;
    this._peakAirY = spawnY;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._drownTimer = 0;
    this._airDepleteTimer = 0;
    this._exhaustion = 0;
  }

  /**
   * Applies damage to the player, respecting invulnerability cooldown unless bypassArmor is true.
   * @param {number} amount
   * @param {string} [source='unknown']
   * @param {boolean} [ignoreInvulnerability=false]
   * @returns {boolean} True if damage was actually applied.
   */
  damage(amount, source = 'unknown', ignoreInvulnerability = false) {
    if (this.isDead || amount <= 0) return false;
    if (!ignoreInvulnerability && this.invulnerableTimer > 0) return false;

    const dmg = Math.max(1, Math.round(amount));
    this.health = Math.max(0, this.health - dmg);
    this.lastDamageSource = source;
    this.invulnerableTimer = 0.5;
    this.hurtFlashTimer = 0.35;

    if (this.health <= 0) {
      this.isDead = true;
    }
    return true;
  }

  /**
   * Restores health up to maxHealth.
   * @param {number} amount
   * @returns {number} Actual health restored.
   */
  heal(amount) {
    if (this.isDead || amount <= 0) return 0;
    const prev = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - prev;
  }

  /**
   * Consumes food points and saturation.
   * @param {number} foodValue
   * @param {number} [saturationBonus=2]
   * @returns {boolean} False if already full hunger or dead.
   */
  eat(foodValue, saturationBonus = 2) {
    if (this.isDead || this.hunger >= this.maxHunger) return false;
    this.hunger = Math.min(this.maxHunger, this.hunger + Math.max(1, foodValue));
    this.saturation = Math.min(this.hunger, this.saturation + Math.max(0, saturationBonus));
    return true;
  }

  /**
   * Adds exhaustion (e.g., sprinting, breaking blocks) which drains saturation then hunger.
   * @param {number} amount
   */
  addExhaustion(amount) {
    if (amount <= 0 || this.isDead) return;
    this._exhaustion += amount;
    while (this._exhaustion >= 4) {
      this._exhaustion -= 4;
      if (this.saturation > 0) {
        this.saturation = Math.max(0, this.saturation - 1);
      } else if (this.hunger > 0) {
        this.hunger = Math.max(0, this.hunger - 1);
      }
    }
  }

  /**
   * Steps fall damage, oxygen depletion, natural healing, and starvation timers.
   * @param {number} deltaTime
   * @param {import('../physics/Player.js').Player} player
   * @param {import('../world/World.js').World} world
   * @param {'creative'|'survival'} gameMode
   * @returns {{ damaged: number, damageSource: string|null, died: boolean }}
   */
  update(deltaTime, player, world, gameMode) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.25);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);

    const pos = player.getPosition();

    // Creative mode or flying resets fall tracking & prevents vitals decay
    if (gameMode !== 'survival' || player.flyMode) {
      this._wasGrounded = true;
      this._peakAirY = pos.y;
      this.air = this.maxAir;
      this.invulnerableTimer = 0;
      return { damaged: 0, damageSource: null, died: false };
    }

    if (this.isDead) {
      return { damaged: 0, damageSource: null, died: false };
    }

    let damaged = 0;
    let damageSource = null;

    // 1. Fall damage detection
    if (player.inWater) {
      this._wasGrounded = false;
      this._peakAirY = pos.y;
    } else if (!player.grounded) {
      if (this._wasGrounded) {
        this._wasGrounded = false;
        this._peakAirY = pos.y;
      } else if (pos.y > this._peakAirY) {
        this._peakAirY = pos.y;
      }
    } else {
      if (!this._wasGrounded) {
        const fallDistance = this._peakAirY - pos.y;
        if (fallDistance > 3.25) {
          const fallDmg = Math.floor(fallDistance - 3);
          if (fallDmg > 0 && this.damage(fallDmg, 'fall', true)) {
            damaged += fallDmg;
            damageSource = 'fall';
          }
        }
      }
      this._wasGrounded = true;
      this._peakAirY = pos.y;
    }

    // 2. Underwater breath / drowning
    const eye = player.getEyePosition();
    const headSubmerged = world.isLiquidAt(
      Math.floor(eye.x),
      Math.floor(eye.y),
      Math.floor(eye.z)
    );
    if (headSubmerged) {
      if (this.air > 0) {
        this._airDepleteTimer += dt;
        if (this._airDepleteTimer >= 1.2) {
          this._airDepleteTimer -= 1.2;
          this.air = Math.max(0, this.air - 1);
        }
      } else {
        this._drownTimer += dt;
        if (this._drownTimer >= 1.0) {
          this._drownTimer -= 1.0;
          if (this.damage(2, 'drowning', true)) {
            damaged += 2;
            damageSource = 'drowning';
          }
        }
      }
    } else {
      this._airDepleteTimer = 0;
      this._drownTimer = 0;
      if (this.air < this.maxAir) {
        this.air = Math.min(this.maxAir, this.air + dt * 6);
      }
    }

    // 3. Exhaustion from horizontal movement speed
    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (hSpeed > 0.25) {
      this.addExhaustion(dt * (hSpeed > 6.5 ? 0.38 : 0.09));
    }

    // 4. Natural regeneration vs Starvation
    if (this.hunger >= 18 && this.health < this.maxHealth && !this.isDead) {
      this._regenTimer += dt;
      if (this._regenTimer >= 3.2) {
        this._regenTimer -= 3.2;
        this.heal(1);
        this.addExhaustion(1.5);
      }
    } else {
      this._regenTimer = 0;
    }

    if (this.hunger <= 0 && this.health > 1 && !this.isDead) {
      this._starveTimer += dt;
      if (this._starveTimer >= 4.0) {
        this._starveTimer -= 4.0;
        if (this.damage(1, 'starvation', true)) {
          damaged += 1;
          damageSource = 'starvation';
        }
      }
    } else {
      this._starveTimer = 0;
    }

    return {
      damaged,
      damageSource,
      died: this.isDead,
    };
  }

  /**
   * Serializes survival vitals for WorldSave persistence.
   * @returns {{ health: number, hunger: number, saturation: number, air: number, isDead: boolean }}
   */
  exportState() {
    return {
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      air: Math.round(this.air),
      isDead: this.isDead,
    };
  }

  /**
   * Restores survival vitals from saved state.
   * @param {any} data
   * @param {number} [spawnY=64]
   */
  importState(data, spawnY = 64) {
    this.reset(spawnY);
    if (!data || typeof data !== 'object') return;
    if (Number.isFinite(data.health)) {
      this.health = Math.max(0, Math.min(this.maxHealth, data.health));
    }
    if (Number.isFinite(data.hunger)) {
      this.hunger = Math.max(0, Math.min(this.maxHunger, data.hunger));
    }
    if (Number.isFinite(data.saturation)) {
      this.saturation = Math.max(0, Math.min(this.maxHunger, data.saturation));
    }
    if (Number.isFinite(data.air)) {
      this.air = Math.max(0, Math.min(this.maxAir, data.air));
    }
    this.isDead = Boolean(data.isDead || this.health <= 0);
  }
}
