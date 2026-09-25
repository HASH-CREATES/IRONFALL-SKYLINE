// IRONFALL // SKYLINE — central tuning. All gameplay feel lives here.
// NOTE: FLIGHT/ENERGY/INTEGRITY/COMBAT are mutable module objects — the
// ARMORY (src/player/Suit.ts) rewrites fields when a suit frame is equipped.

export const FLIGHT = {
  gravity: 22,
  // repulsor lift blends gravity out at low speed: full lift below hoverSpeed, none above cruiseSpeed
  hoverSpeed: 6,
  cruiseSpeed: 30,
  liftAuthority: 1.02,

  forwardAccel: 42,
  boostAccel: 78,
  reverseAccel: 24,
  strafeAccel: 20,
  verticalAccel: 34, // repulsor vertical trim (climb/descend input)
  verticalTrimMax: 26, // soft terminal rate for the vertical trim channel

  cruiseMax: 84,
  boostMax: 196,
  diveMax: 238,
  brakeMax: 30,

  forwardDrag: 0.12,
  lateralGrip: 4.6,
  lateralGripDive: 2.4,
  brakeDrag: 3.1,
  freefallDrag: 0.25,

  pitchRate: 1.45,
  yawRate: 1.2,
  rollRate: 2.7,
  pitchSens: 1.0,
  yawSens: 1.0,
  autoLevelRate: 2.4,
  bankFactor: 1.15,
  maxBank: 1.0,

  takeoffImpulse: 26,
  takeoffTime: 0.55,
  landingSpeed: 9,
  landingProbe: 3.2,
  touchdownAccel: 30,
  touchdownGraceSpeed: 8, // controlled touchdowns below this rate are free

  staggerTime: 1.15,
  crashSpeed: 24,
  crashDamageScale: 0.45,

  groundAccel: 34,
  groundDrag: 6.5,
  frictionGround: 0.86,

  heroRadius: 1.15,
  heroHeight: 2.3,

  boundsRadius: 660,
  ceiling: 620,
};

export const ENERGY = {
  max: 100,
  boostDrain: 24,
  boostRegen: 9,
  thrustDrain: 1.4,
  empCost: 34,
  unibeamCost: 30,
  lowWarn: 22,
};

export const INTEGRITY = {
  max: 100,
  regenDelay: 6,
  regenRate: 4.5,
  shieldCoolFeedback: 0.35,
};

export const CAMERA = {
  fovBase: 68,
  fovSpeedMax: 30,
  fovBoost: 9,
  fovDive: 12,
  distBase: 8.6,
  distSpeed: 0.062,
  distBoost: 2.4,
  heightBase: 2.7,
  lookAhead: 0.17,
  posLerp: 7.2,
  rotLerp: 5.4,
  fovLerp: 4.2,
  shakeDecay: 4.6,
  landingFov: -6,
};

export const COMBAT = {
  lockRange: 460,
  lockConeDeg: 58,
  lockTime: 0.42,
  lockDropTime: 1.1,
  boltSpeed: 260,
  boltLife: 2.4,
  boltDamage: 26,
  boltCooldown: 0.19,
  fireSpread: 0.004,
  homingTurn: 3.4,
  empRadius: 190,
  empStunTime: 3.2,
  unibeamDamage: 46,
  unibeamCooldown: 4.5,
  braveLead: 0.85,
};

export const CITY = {
  blockSize: 46,
  roadWidth: 13,
  grid: 26, // blocks per side
  seed: 20870214,
  buildingMinSide: 11,
  buildingMaxSide: 30,
  minGap: 3.5,
  landmarkHeight: 330,
  fogNear: 240,
  fogFar: 1450,
};

export const PERF = {
  targetFps: 60,
  acceptFps: 45,
  maxPixelRatio: 2,
  adaptiveMinPixelRatio: 0.75,
  shadowMapSize: 2048,
};

export const AUDIO = {
  master: 0.42,
  engine: 0.5,
  ui: 0.5,
  music: 0.34,
};

export type ControlMode = 'keyboard' | 'gesture' | 'hybrid';
export type InputSource = 'keyboard' | 'gesture' | 'none';

export type PhaseName =
  | 'boot'
  | 'landing'
  | 'armory'
  | 'controls'
  | 'technology'
  | 'settings'
  | 'calibrate'
  | 'brief'
  | 'play'
  | 'pause'
  | 'result';

export type FlightState =
  | 'IDLE'
  | 'GROUND'
  | 'TAKEOFF'
  | 'HOVER'
  | 'FLIGHT'
  | 'BOOST'
  | 'DIVE'
  | 'CLIMB'
  | 'BRAKE'
  | 'LANDING'
  | 'STAGGERED';

export type QualityLevel = 'low' | 'medium' | 'high';
