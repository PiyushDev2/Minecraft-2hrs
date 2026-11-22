/**
 * @file SurvivalStats.js
 * @description Tracks player survival vitals (health, hunger, saturation, oxygen, fire/lava burn),
 * armor damage reduction, fall damage, ladder fall-reset, drowning, starvation, and regeneration.
 */

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

const ARMOR_BYPASS_SOURCES = new Set(['drowning', 'starvation', 'fall', 'fire']);

export class SurvivalStats {
  constructor() {
    this.health = MAX_HEALTH;
    this.maxHealth = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.maxHunger = MAX_HUNGER;
    this.saturation = 5;
    this.air = MAX_AIR;
    this.maxAir = MAX_AIR;
    this.isDead = false;
    this.lastDamageSource = null;
    this.invulnerableTimer = 0;
    this.hurtFlashTimer = 0;
    this.burnTimer = 0;
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.xpTotal = 0;
    this._xpInLevel = 0;
    this._wasGrounded = true;
    this._peakAirY = 64;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._drownTimer = 0;
    this._airDepleteTimer = 0;
    this._burnTickTimer = 0;
    this._exhaustion = 0;
    /** @type {() => number} Optional provider returning current armor points 0..20 */
    this.getArmorPoints = () => 0;
    /** @type {() => number} Optional provider returning Protection enchantment total */
    this.getProtectionBonus = () => 0;
    /** @type {((amount: number) => void)|null} Optional callback to degrade armor durability */
    this.onArmorAbsorb = null;
    /** @type {((amount: number) => void)|null} Optional callback when shield blocks a hit */
    this.onShieldBlock = null;
    /** @type {boolean} True while player holds right-click with a Shield */
    this.shieldBlocking = false;
    /** @type {Map<string, { id: string, level: number, remaining: number, duration: number }>} */
    this.activeEffects = new Map();
    this._potionRegenTimer = 0;
  }

  /**
   * Classic Minecraft XP required to advance from `level` to `level + 1`.
   * @param {number} level
   */
  xpToNextLevel(level = this.xpLevel) {
    if (level <= 15) return 2 * level + 7;
    if (level <= 30) return 5 * level - 38;
    return 9 * level - 158;
  }

  /**
   * Awards XP points and advances levels accordingly.
   * @param {number} amount
   * @returns {{ leveledUp: boolean, level: number, xpProgress: number, xpTotal: number }}
   */
  addXp(amount) {
    const gain = Math.max(0, Math.round(amount));
    if (gain <= 0) {
      return { leveledUp: false, level: this.xpLevel, xpProgress: this.xpProgress, xpTotal: this.xpTotal };
    }
    const prevLevel = this.xpLevel;
    this.xpTotal += gain;
    this._xpInLevel += gain;
    let req = this.xpToNextLevel(this.xpLevel);
    while (this._xpInLevel >= req) {
      this._xpInLevel -= req;
      this.xpLevel += 1;
      req = this.xpToNextLevel(this.xpLevel);
    }
    this.xpProgress = req > 0 ? Math.max(0, Math.min(1, this._xpInLevel / req)) : 0;
    return {
      leveledUp: this.xpLevel > prevLevel,
      level: this.xpLevel,
      xpProgress: this.xpProgress,
      xpTotal: this.xpTotal,
    };
  }

  /**
   * Sets explicit XP level (for /xp set command).
   * @param {number} level
   */
  setXpLevel(level) {
    this.xpLevel = Math.max(0, Math.floor(level));
    this._xpInLevel = 0;
    this.xpProgress = 0;
  }

  /**
   * Deducts XP levels (for Enchanting Table / Anvil). Returns false if insufficient.
   */
  spendXpLevels(levels) {
    const cost = Math.max(0, Math.floor(levels));
    if (this.xpLevel < cost) return false;
    this.xpLevel -= cost;
    const req = this.xpToNextLevel(this.xpLevel);
    this._xpInLevel = Math.min(this._xpInLevel, Math.max(0, req - 1));
    this.xpProgress = req > 0 ? Math.max(0, Math.min(1, this._xpInLevel / req)) : 0;
    return true;
  }

  /**
   * Applies or refreshes a timed potion status effect.
   */
  addEffect(id, durationSec, level = 1) {
    if (!id || durationSec <= 0) return;
    this.activeEffects.set(id, {
      id,
      level: Math.max(1, Math.floor(level)),
      remaining: durationSec,
      duration: durationSec,
    });
  }

  hasEffect(id) {
    const eff = this.activeEffects.get(id);
    return Boolean(eff && eff.remaining > 0);
  }

  getEffectLevel(id) {
    const eff = this.activeEffects.get(id);
    return eff && eff.remaining > 0 ? eff.level : 0;
  }

  getActiveEffects() {
    return Array.from(this.activeEffects.values()).map((e) => ({ ...e }));
  }

  clearEffects() {
    this.activeEffects.clear();
  }

  reset(spawnY = 64) {
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.air = this.maxAir;
    this.isDead = false;
    this.lastDamageSource = null;
    this.invulnerableTimer = 0;
    this.hurtFlashTimer = 0;
    this.burnTimer = 0;
    this.shieldBlocking = false;
    this.activeEffects.clear();
    this._potionRegenTimer = 0;
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.xpTotal = 0;
    this._xpInLevel = 0;
    this._wasGrounded = true;
    this._peakAirY = spawnY;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._drownTimer = 0;
    this._airDepleteTimer = 0;
    this._burnTickTimer = 0;
    this._exhaustion = 0;
  }

  /**
   * Applies damage to the player, applying Fire Resistance, Shield blocking, and Armor + Protection mitigation.
   */
  damage(amount, source = 'unknown', ignoreInvulnerability = false) {
    if (this.isDead || amount <= 0) return false;
    if (!ignoreInvulnerability && this.invulnerableTimer > 0) return false;

    // Fire Resistance grants full immunity to lava, fire, and blaze fireballs
    if ((source === 'lava' || source === 'fire' || source === 'fireball') && this.hasEffect('fire_resistance')) {
      this.burnTimer = 0;
      return false;
    }

    let effectiveAmount = amount;

    // Shield blocking negates frontal mob/arrow attacks and 80% of explosions/fireballs
    if (this.shieldBlocking) {
      if (source === 'mob' || source === 'arrow' || source === 'dragon') {
        this.onShieldBlock?.(1);
        this.invulnerableTimer = 0.25;
        return false;
      }
      if (source === 'explosion' || source === 'fireball') {
        this.onShieldBlock?.(2);
        effectiveAmount = Math.max(0, amount * 0.2);
        if (effectiveAmount < 1) {
          this.invulnerableTimer = 0.25;
          return false;
        }
      }
    }

    if (!ARMOR_BYPASS_SOURCES.has(source)) {
      const armorPts = Math.max(0, Math.min(20, this.getArmorPoints?.() || 0));
      const protPts = Math.max(0, Math.min(16, this.getProtectionBonus?.() || 0));
      if (armorPts > 0 || protPts > 0) {
        const armorRed = Math.min(0.75, armorPts * 0.036);
        const protRed = Math.min(0.4, protPts * 0.03);
        effectiveAmount = Math.max(1, effectiveAmount * (1 - armorRed) * (1 - protRed));
        if (armorPts > 0) this.onArmorAbsorb?.(1);
      }
    }

    const dmg = Math.max(1, Math.round(effectiveAmount));
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
   * Applies damage and returns the actual HP lost after armor mitigation (0 if blocked/invulnerable).
   * @param {number} amount
   * @param {string} [source='generic']
   * @param {boolean} [ignoreInvulnerability=false]
   * @returns {number}
   */
  applyDamage(amount, source = 'generic', ignoreInvulnerability = false) {
    const prev = this.health;
    this.damage(amount, source, ignoreInvulnerability);
    return Math.max(0, prev - this.health);
  }

  heal(amount) {
    if (this.isDead || amount <= 0) return 0;
    const prev = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - prev;
  }

  eat(foodValue, saturationBonus = 2) {
    if (this.isDead || this.hunger >= this.maxHunger) return false;
    this.hunger = Math.min(this.maxHunger, this.hunger + Math.max(1, foodValue));
    this.saturation = Math.min(this.hunger, this.saturation + Math.max(0, saturationBonus));
    return true;
  }

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

  update(deltaTime, player, world, gameMode) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.25);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);

    // Tick active potion effects in both Creative and Survival
    if (this.activeEffects.size > 0) {
      for (const [id, eff] of this.activeEffects.entries()) {
        eff.remaining -= dt;
        if (eff.remaining <= 0) {
          this.activeEffects.delete(id);
        }
      }
      if (this.hasEffect('regeneration') && !this.isDead && this.health < this.maxHealth) {
        this._potionRegenTimer += dt;
        if (this._potionRegenTimer >= 1.5) {
          this._potionRegenTimer -= 1.5;
          this.heal(1);
        }
      } else {
        this._potionRegenTimer = 0;
      }
    }

    const pos = player.getPosition();

    if (gameMode !== 'survival' || player.flyMode) {
      this._wasGrounded = true;
      this._peakAirY = pos.y;
      this.air = this.maxAir;
      this.burnTimer = 0;
      this.invulnerableTimer = 0;
      return { damaged: 0, damageSource: null, died: false };
    }

    if (this.isDead) {
      return { damaged: 0, damageSource: null, died: false };
    }

    let damaged = 0;
    let damageSource = null;

    // 1. Fall damage detection (water & ladders cancel fall height)
    if (player.inWater || player.onLadder) {
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

    // 2. Lava & Fire burning
    if (player.inLava) {
      this.burnTimer = 4.0;
      this._burnTickTimer += dt;
      if (this._burnTickTimer >= 0.55) {
        this._burnTickTimer = 0;
        if (this.damage(4, 'lava', true)) {
          damaged += 4;
          damageSource = 'lava';
        }
      }
    } else if (player.inWater) {
      this.burnTimer = 0;
      this._burnTickTimer = 0;
    } else if (this.burnTimer > 0) {
      this.burnTimer = Math.max(0, this.burnTimer - dt);
      this._burnTickTimer += dt;
      if (this._burnTickTimer >= 1.0) {
        this._burnTickTimer = 0;
        if (this.damage(1, 'fire', true)) {
          damaged += 1;
          damageSource = 'fire';
        }
      }
    } else {
      this._burnTickTimer = 0;
    }

    // 2b. Contact hazard blocks (e.g. Cactus damageOnTouch)
    if (!this.isDead && this.invulnerableTimer <= 0) {
      const pad = 0.06;
      const halfW = (player.width ?? 0.6) * 0.5 + pad;
      const minX = Math.floor(pos.x - halfW);
      const maxX = Math.floor(pos.x + halfW);
      const minY = Math.floor(pos.y);
      const maxY = Math.floor(pos.y + (player.height ?? 1.8));
      const minZ = Math.floor(pos.z - halfW);
      const maxZ = Math.floor(pos.z + halfW);
      cactusLoop: for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          for (let cx = minX; cx <= maxX; cx++) {
            const bId = world.getBlock(cx, cy, cz);
            const bDef = world.blockRegistry.getById(bId);
            if (bDef && bDef.damageOnTouch > 0 && !bDef.isLiquid) {
              if (this.damage(bDef.damageOnTouch, 'cactus')) {
                damaged += bDef.damageOnTouch;
                damageSource = 'cactus';
              }
              break cactusLoop;
            }
          }
        }
      }
    }

    // 3. Underwater breath / drowning (only water, not lava)
    const eye = player.getEyePosition();
    const eyeBlock = world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const headSubmerged = world.blockRegistry.isWater(eyeBlock);

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

    // 4. Exhaustion from movement
    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (hSpeed > 0.25) {
      this.addExhaustion(dt * (hSpeed > 6.5 ? 0.38 : 0.09));
    }

    // 5. Natural regeneration vs Starvation
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

    return { damaged, damageSource, died: this.isDead };
  }

  exportState() {
    return {
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      air: Math.round(this.air),
      isDead: this.isDead,
      xpLevel: this.xpLevel,
      xpProgress: this.xpProgress,
      xpTotal: this.xpTotal,
      xpInLevel: this._xpInLevel,
      activeEffects: this.getActiveEffects(),
    };
  }

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
    if (Number.isFinite(data.xpLevel)) {
      this.xpLevel = Math.max(0, Math.floor(data.xpLevel));
    }
    if (Number.isFinite(data.xpTotal)) {
      this.xpTotal = Math.max(0, Math.floor(data.xpTotal));
    }
    if (Number.isFinite(data.xpInLevel)) {
      this._xpInLevel = Math.max(0, Math.floor(data.xpInLevel));
    }
    if (Array.isArray(data.activeEffects)) {
      for (const e of data.activeEffects) {
        if (e && typeof e.id === 'string' && e.remaining > 0) {
          this.activeEffects.set(e.id, {
            id: e.id,
            level: Math.max(1, Math.floor(e.level || 1)),
            remaining: e.remaining,
            duration: Math.max(e.remaining, e.duration || e.remaining),
          });
        }
      }
    }
    const req = this.xpToNextLevel(this.xpLevel);
    this.xpProgress = Number.isFinite(data.xpProgress)
      ? Math.max(0, Math.min(1, data.xpProgress))
      : req > 0
      ? Math.min(1, this._xpInLevel / req)
      : 0;
    this.isDead = Boolean(data.isDead || this.health <= 0);
  }
}
