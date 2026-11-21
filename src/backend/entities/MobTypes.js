/**
 * @file MobTypes.js
 * @description Defines passive and hostile voxel mob archetypes, dimensions, speeds,
 * health, loot drops, and visual palette specs.
 */

export const MOB_TYPES = Object.freeze({
  SHEEP: 'sheep',
  COW: 'cow',
  ZOMBIE: 'zombie',
  SLIME: 'slime',
});

/**
 * @typedef {Object} MobDefinition
 * @property {string} type
 * @property {string} name
 * @property {'passive'|'hostile'} category
 * @property {number} width
 * @property {number} height
 * @property {number} maxHealth
 * @property {number} walkSpeed
 * @property {number} chaseSpeed
 * @property {number} attackDamage
 * @property {number} attackRange
 * @property {number} detectRange
 * @property {boolean} burnsInSunlight
 * @property {Array<{ itemId: string, count: number, chance?: number }>} drops
 * @property {{ primary: number, secondary: number, accent: number }} palette
 */

/** @type {Record<string, MobDefinition>} */
export const MOB_DEFINITIONS = Object.freeze({
  [MOB_TYPES.SHEEP]: {
    type: MOB_TYPES.SHEEP,
    name: 'Sheep',
    category: 'passive',
    width: 0.85,
    height: 1.25,
    maxHealth: 8,
    walkSpeed: 1.85,
    chaseSpeed: 3.4,
    attackDamage: 0,
    attackRange: 0,
    detectRange: 10,
    burnsInSunlight: false,
    drops: [{ itemId: 'raw_beef', count: 1, chance: 1 }],
    palette: { primary: 0xf2f0eb, secondary: 0xd9c2a3, accent: 0x3a3734 },
  },
  [MOB_TYPES.COW]: {
    type: MOB_TYPES.COW,
    name: 'Cow',
    category: 'passive',
    width: 0.9,
    height: 1.35,
    maxHealth: 10,
    walkSpeed: 1.75,
    chaseSpeed: 3.3,
    attackDamage: 0,
    attackRange: 0,
    detectRange: 10,
    burnsInSunlight: false,
    drops: [{ itemId: 'raw_beef', count: 2, chance: 1 }],
    palette: { primary: 0x5c402c, secondary: 0xd9d2c5, accent: 0x2a2018 },
  },
  [MOB_TYPES.ZOMBIE]: {
    type: MOB_TYPES.ZOMBIE,
    name: 'Zombie',
    category: 'hostile',
    width: 0.65,
    height: 1.85,
    maxHealth: 20,
    walkSpeed: 1.9,
    chaseSpeed: 3.25,
    attackDamage: 3,
    attackRange: 1.65,
    detectRange: 18,
    burnsInSunlight: true,
    drops: [
      { itemId: 'coal', count: 1, chance: 0.65 },
      { itemId: 'iron_ingot', count: 1, chance: 0.2 },
    ],
    palette: { primary: 0x4b7f48, secondary: 0x268596, accent: 0x353b73 },
  },
  [MOB_TYPES.SLIME]: {
    type: MOB_TYPES.SLIME,
    name: 'Slime',
    category: 'hostile',
    width: 0.9,
    height: 0.9,
    maxHealth: 12,
    walkSpeed: 1.6,
    chaseSpeed: 2.6,
    attackDamage: 2,
    attackRange: 1.4,
    detectRange: 14,
    burnsInSunlight: false,
    drops: [
      { itemId: 'apple', count: 1, chance: 0.45 },
      { itemId: 'stick', count: 2, chance: 0.55 },
    ],
    palette: { primary: 0x67c954, secondary: 0x489c39, accent: 0x1e3819 },
  },
});

/**
 * Resolves a mob definition safely by type.
 * @param {string} type
 * @returns {MobDefinition|undefined}
 */
export function getMobDefinition(type) {
  return MOB_DEFINITIONS[type];
}
