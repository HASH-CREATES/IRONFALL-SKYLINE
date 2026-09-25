import { ENERGY, FLIGHT, INTEGRITY, COMBAT } from '../config';

/* ------------------------------------------------------------------ *
 * SUIT FRAMES — original armored-hero variants for the ARMORY.
 * Each frame is a unique design (no Marvel suit is reproduced): its
 * palette re-skins the MK-1 hero geometry and its mods re-tune the
 * flight/combat constants, so choosing a frame changes real gameplay.
 * Base values mirror src/config.ts; applySuit() applies multipliers.
 * ------------------------------------------------------------------ */

export interface SuitPalette {
  primary: number;      // main armor plates
  primaryDark: number;  // shadowed plates
  secondary: number;    // gold/accent panels
  trim: number;         // gunmetal joints
  glow: number;         // repulsor / palm glow
  visor: number;        // helmet visor
  reactor: number;      // chest reactor
  flare: number;        // thruster plume tint
}

export interface SuitStats {
  speed: number;   // 0..100 display
  power: number;
  armor: number;
  energy: number;
}

export interface SuitMods {
  accelMul: number;
  boostMaxAdd: number;
  cruiseMaxAdd: number;
  boltDamageMul: number;
  boltCooldownMul: number;
  empCostMul: number;
  energyMax: number;
  integrityMax: number;
  boostDrainMul: number;
  regenAdd: number;
}

export interface SuitFrame {
  id: string;
  name: string;
  codename: string;
  role: string;
  story: string;
  palette: SuitPalette;
  stats: SuitStats;
  mods: SuitMods;
}

export const SUITS: SuitFrame[] = [
  {
    id: 'extremis',
    name: 'MK-1 EXTREMIS',
    codename: 'BASELINE FRAME',
    role: 'ALL-ROUND',
    story:
      'The baseline IRONFALL frame. Balanced repulsor output, adaptive alloy ' +
      'plating and the original arc-core tuned by its first pilot. Every ' +
      'later frame is measured against this one.',
    palette: {
      primary: 0xa81f1a, primaryDark: 0x74140f, secondary: 0xe0ac42,
      trim: 0x2a2f36, glow: 0x63e8ff, visor: 0xa9f4ff, reactor: 0xcdf3ff, flare: 0x9fe8ff,
    },
    stats: { speed: 62, power: 62, armor: 62, energy: 62 },
    mods: {
      accelMul: 1.0, boostMaxAdd: 0, cruiseMaxAdd: 0,
      boltDamageMul: 1.0, boltCooldownMul: 1.0, empCostMul: 1.0,
      energyMax: 100, integrityMax: 100, boostDrainMul: 1.0, regenAdd: 0,
    },
  },
  {
    id: 'vanguard',
    name: 'AEGIS VANGUARD',
    codename: 'SIEGE FRAME',
    role: 'BULWARK',
    story:
      'Built for the harbor defense. Layered composite plating and a ' +
      'reinforced chest array let the Vanguard walk through flak it cannot ' +
      'outrun — at the cost of repulsor agility and boost economy.',
    palette: {
      primary: 0x27436b, primaryDark: 0x16283f, secondary: 0xb9c4cf,
      trim: 0x1a2129, glow: 0x54f0b8, visor: 0x9fffd9, reactor: 0xafffe0, flare: 0x8fffd2,
    },
    stats: { speed: 44, power: 74, armor: 92, energy: 55 },
    mods: {
      accelMul: 0.88, boostMaxAdd: 8, cruiseMaxAdd: 6,
      boltDamageMul: 1.15, boltCooldownMul: 1.1, empCostMul: 1.0,
      energyMax: 90, integrityMax: 135, boostDrainMul: 1.15, regenAdd: 0,
    },
  },
  {
    id: 'wraith',
    name: 'WRAITH NYX',
    codename: 'PROTOTYPE-0',
    role: 'INTERCEPTOR',
    story:
      'A stripped hush-frame flown once across the grid at dawn and never ' +
      'officially acknowledged. Overclocked repulsors, radar-dulled hull — ' +
      'the fastest thing in the sky, and the most fragile.',
    palette: {
      primary: 0x14131a, primaryDark: 0x0b0a10, secondary: 0x6d2a56,
      trim: 0x0f0f14, glow: 0xff4fd8, visor: 0xff9df0, reactor: 0xffb1ef, flare: 0xff7ae2,
    },
    stats: { speed: 96, power: 52, armor: 34, energy: 78 },
    mods: {
      accelMul: 1.18, boostMaxAdd: 14, cruiseMaxAdd: 10,
      boltDamageMul: 0.85, boltCooldownMul: 0.85, empCostMul: 1.0,
      energyMax: 115, integrityMax: 78, boostDrainMul: 0.9, regenAdd: 0,
    },
  },
  {
    id: 'gladiator',
    name: 'SOLSTICE GLADIATOR',
    codename: 'EXHIBITION-X',
    role: 'GUNSHIP',
    story:
      'The crowd-pleaser. Overcharged palm emitters built for the Solstice ' +
      'air-combat exhibitions, kept hot ever since. Slow-cycling, devastating ' +
      'repulsor artillery wrapped in bone-white court armor.',
    palette: {
      primary: 0xd8d3c4, primaryDark: 0x9a948a, secondary: 0xd97b2f,
      trim: 0x33383d, glow: 0xffb454, visor: 0xffd9a6, reactor: 0xffe2b0, flare: 0xffc46a,
    },
    stats: { speed: 58, power: 98, armor: 58, energy: 88 },
    mods: {
      accelMul: 0.95, boostMaxAdd: 0, cruiseMaxAdd: 0,
      boltDamageMul: 1.45, boltCooldownMul: 1.35, empCostMul: 0.85,
      energyMax: 125, integrityMax: 95, boostDrainMul: 1.05, regenAdd: 1.5,
    },
  },
];

export function suitById(id: string): SuitFrame {
  return SUITS.find((s) => s.id === id) ?? SUITS[0];
}

const SUIT_KEY = 'IRONFALL.suit';

export function savedSuitId(): string {
  try {
    return localStorage.getItem(SUIT_KEY) ?? 'extremis';
  } catch {
    return 'extremis';
  }
}

export function persistSuitId(id: string): void {
  try {
    localStorage.setItem(SUIT_KEY, id);
  } catch {
    /* private mode: suit choice is session-only */
  }
}

/**
 * Applies a frame's gameplay modifiers to the live tuning constants.
 * The constants objects are plain module exports read per-frame by the
 * flight controller and combat system, so mutation takes effect at once.
 */
export function applySuit(s: SuitFrame): void {
  FLIGHT.forwardAccel = 42 * s.mods.accelMul;
  FLIGHT.boostAccel = 78 * s.mods.accelMul;
  FLIGHT.boostMax = 196 + s.mods.boostMaxAdd;
  FLIGHT.cruiseMax = 84 + s.mods.cruiseMaxAdd;

  COMBAT.boltDamage = 26 * s.mods.boltDamageMul;
  COMBAT.boltCooldown = 0.19 * s.mods.boltCooldownMul;
  ENERGY.empCost = 34 * s.mods.empCostMul;

  ENERGY.max = s.mods.energyMax;
  ENERGY.boostDrain = 24 * s.mods.boostDrainMul;
  ENERGY.boostRegen = 9 + s.mods.regenAdd;
  INTEGRITY.max = s.mods.integrityMax;
}
