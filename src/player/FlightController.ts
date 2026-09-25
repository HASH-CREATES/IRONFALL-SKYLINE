import * as THREE from 'three';
import { ENERGY, FLIGHT, INTEGRITY, type FlightState } from '../config';
import { clamp, damp, lerp, smoothstep } from '../util/Rng';
import type { City } from '../world/City';
import { CollisionWorld, type Hit } from '../world/Collision';

export interface FlightInputState {
  thrust: number;   // -1..1 forward / reverse
  strafe: number;   // -1..1 lateral repulsor assist
  pitch: number;    // -1..1 pitch rate (stick)
  yaw: number;      // -1..1 yaw rate (stick)
  roll: number;     // -1..1 roll rate
  vertical: number; // -1..1 climb / descend trim
  boost: boolean;
  brake: boolean;
  takeoff: boolean; // edge triggered by the input layer
  level: boolean;   // auto-level assist request
}

export const EMPTY_FLIGHT_INPUT: FlightInputState = {
  thrust: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, vertical: 0,
  boost: false, brake: false, takeoff: false, level: false,
};

const V = {
  fwd: new THREE.Vector3(),
  up: new THREE.Vector3(),
  right: new THREE.Vector3(),
  tmp: new THREE.Vector3(),
  tmp2: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  euler: new THREE.Euler(),
  axis: new THREE.Vector3(),
  center: new THREE.Vector3(),
};

/**
 * Body-oriented flight model. Three blended forces give superhero flight that
 * keeps momentum yet stays controllable:
 *   1. thrust along the suit's own axis
 *   2. repulsor lift that cancels gravity in proportion to how slow you are
 *   3. anisotropic drag — light on the flight axis, heavy laterally (grip)
 */
export class FlightController {
  pos = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  velocity = new THREE.Vector3();

  state: FlightState = 'IDLE';
  prevState: FlightState = 'IDLE';
  stateTime = 0;

  energy = ENERGY.max;
  integrity = INTEGRITY.max;
  grounded = false;
  groundY = 0;
  visualRoll = 0;
  bankTarget = 0;
  thrustLevel = 0;
  boostLevel = 0;
  brakeLevel = 0;
  speed = 0;
  forwardSpeed = 0;
  verticalSpeed = 0;
  speedNorm = 0;

  staggerTimer = 0;
  impactFlash = 0;
  lastImpactSpeed = 0;
  damageThisFrame = 0;
  crashThisFrame = false;
  landedThisFrame = false;
  instability = 0;

  private sm = { thrust: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, vertical: 0 };
  private sinceDamage = 999;
  private hit: Hit = { box: null as never, normal: new THREE.Vector3(), depth: 0 };
  private surfaceTmp: number | null = null;
  private levelTimer = 0;
  private groundContactTimer = 0;

  onCrash?: (speed: number, damage: number) => void;
  onLand?: (speed: number) => void;
  onTakeoff?: () => void;

  constructor(private collision: CollisionWorld) {
    this.reset(new THREE.Vector3(24, 190, 78), Math.PI);
  }

  /* ---------------------------------------------------------------- */

  reset(pos: THREE.Vector3, yaw: number): void {
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    this.state = 'IDLE';
    this.stateTime = 0;
    this.energy = ENERGY.max;
    this.integrity = INTEGRITY.max;
    this.grounded = false;
    this.staggerTimer = 0;
    this.visualRoll = 0;
    this.speed = 0;
    this.thrustLevel = 0;
    this.boostLevel = 0;
    this.brakeLevel = 0;
    this.sinceDamage = 999;
    this.instability = 0;
    this.sm = { thrust: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, vertical: 0 };
  }

  teleport(pos: THREE.Vector3, yaw?: number): void {
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    this.state = pos.y > 5 ? 'HOVER' : 'GROUND';
    this.staggerTimer = 0;
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }
  getUp(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }
  getRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  applyDamage(amount: number): void {
    if (amount <= 0) return;
    this.integrity = clamp(this.integrity - amount, 0, INTEGRITY.max);
    this.sinceDamage = 0;
    this.impactFlash = Math.min(1, this.impactFlash + amount / 30);
    this.instability = Math.min(1, this.instability + amount / 60);
  }

  heal(amount: number): void {
    this.integrity = clamp(this.integrity + amount, 0, INTEGRITY.max);
  }

  addEnergy(amount: number): void {
    this.energy = clamp(this.energy + amount, 0, ENERGY.max);
  }

  forceStagger(power = 1): void {
    this.state = 'STAGGERED';
    this.stateTime = 0;
    this.staggerTimer = FLIGHT.staggerTime * power;
    this.instability = 1;
  }

  /** Repulsor kick — used by abilities and by the EMP pulse. */
  impulse(dir: THREE.Vector3, amount: number): void {
    this.velocity.addScaledVector(dir, amount);
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, input: FlightInputState, city: City): void {
    this.damageThisFrame = 0;
    this.crashThisFrame = false;
    this.landedThisFrame = false;
    this.stateTime += dt;
    this.sinceDamage += dt;
    this.impactFlash = Math.max(0, this.impactFlash - dt * 2.2);
    this.instability = Math.max(0, this.instability - dt * 0.45);

    if (this.state === 'STAGGERED') {
      this.staggerTimer -= dt;
      if (this.staggerTimer <= 0) {
        this.state = this.grounded ? 'GROUND' : 'HOVER';
        this.stateTime = 0;
      }
    }

    // ---- input smoothing (once per frame; integration is substepped)
    const kFast = damp(16, dt);
    const kMid = damp(11, dt);
    const authority = this.state === 'STAGGERED' ? 0.22 : 1;
    this.sm.thrust = lerp(this.sm.thrust, input.thrust, kFast);
    this.sm.strafe = lerp(this.sm.strafe, input.strafe, kFast);
    this.sm.pitch = lerp(this.sm.pitch, input.pitch, kMid);
    this.sm.yaw = lerp(this.sm.yaw, input.yaw, kMid);
    this.sm.roll = lerp(this.sm.roll, input.roll, kFast);
    this.sm.vertical = lerp(this.sm.vertical, input.vertical, kMid);

    this.thrustLevel = lerp(this.thrustLevel, clamp(Math.abs(this.sm.thrust), 0, 1), damp(8, dt));
    this.brakeLevel = lerp(this.brakeLevel, input.brake ? 1 : 0, damp(7, dt));

    // ---- energy / boost
    const wantBoost = input.boost && this.energy > 1 && this.state !== 'GROUND' && this.state !== 'IDLE';
    if (wantBoost) {
      this.energy = clamp(this.energy - ENERGY.boostDrain * dt, 0, ENERGY.max);
    } else {
      const thrustDrain = Math.abs(this.sm.thrust) > 0.25 ? ENERGY.thrustDrain : 0;
      this.energy = clamp(this.energy + (ENERGY.boostRegen - thrustDrain) * dt, 0, ENERGY.max);
    }
    this.boostLevel = lerp(this.boostLevel, wantBoost ? 1 : 0, damp(wantBoost ? 5.5 : 3.2, dt));

    // ---- integrity regen out of combat
    if (this.sinceDamage > INTEGRITY.regenDelay) {
      this.integrity = clamp(this.integrity + INTEGRITY.regenRate * dt, 0, INTEGRITY.max);
    }

    // ---- substepping keeps fast flight from tunnelling through buildings
    this.speed = this.velocity.length();
    const substeps = clamp(Math.ceil((this.speed * dt) / 1.5), 1, 6);
    const sdt = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.integrate(sdt, input, authority, city);
    }

    // ---- state resolution (after integration so it reflects reality)
    this.resolveState(input, wantBoost, dt);

    // ---- visual bank read: banking INTO the turn, so the sign is inverted
    const bankSource = clamp(-(this.sm.yaw * 1.25 + this.sm.roll * 0.5), -1, 1);
    this.bankTarget = bankSource * FLIGHT.maxBank * (0.35 + 0.65 * clamp(this.speed / (FLIGHT.cruiseMax * 0.8), 0, 1));
    this.visualRoll = lerp(this.visualRoll, this.bankTarget, damp(5.2, dt));

    this.speed = this.velocity.length();
    this.forwardSpeed = this.velocity.dot(this.getForward(V.fwd));
    this.verticalSpeed = this.velocity.y;
    this.speedNorm = clamp(this.speed / FLIGHT.boostMax, 0, 1);
  }

  private resolveState(input: FlightInputState, wantBoost: boolean, dt: number): void {
    if (this.state === 'STAGGERED') return;

    const fwdY = this.getForward(V.fwd).y;
    const speed = this.velocity.length();
    const inAir = !this.grounded;

    let next: FlightState = this.state;

    if (this.grounded && speed < FLIGHT.landingSpeed * 0.75 && Math.abs(this.sm.thrust) < 0.3 && !wantBoost) {
      next = 'LANDING';
      this.landingTimer += dt;
      if (this.landingTimer > 0.35) {
        next = 'GROUND';
        this.landingTimer = 0;
      }
    } else if (this.grounded && this.state !== 'TAKEOFF') {
      next = 'GROUND';
      this.landingTimer = 0;
    } else if (this.state === 'TAKEOFF' && this.stateTime < FLIGHT.takeoffTime) {
      next = 'TAKEOFF';
    } else if (input.brake && speed > 4) {
      next = 'BRAKE';
    } else if (wantBoost && speed > FLIGHT.hoverSpeed) {
      next = 'BOOST';
    } else if (inAir && fwdY < -0.4 && speed > FLIGHT.cruiseMax * 0.45) {
      next = 'DIVE';
    } else if (inAir && fwdY > 0.42 && this.sm.thrust > 0.15) {
      next = 'CLIMB';
    } else if (speed < FLIGHT.hoverSpeed * 2.1) {
      next = 'HOVER';
    } else {
      next = 'FLIGHT';
    }

    if (next !== this.state) {
      this.prevState = this.state;
      this.state = next;
      this.stateTime = 0;
      if (next === 'LANDING') this.landedThisFrame = true;
    }
  }

  private landingTimer = 0;

  /* ---------------------------------------------------------------- */

  private integrate(dt: number, input: FlightInputState, authority: number, city: City): void {
    const fwd = this.getForward(V.fwd);
    const up = this.getUp(V.up);
    const right = this.getRight(V.right);
    const speed = this.velocity.length();

    /* ---- 1. attitude: body-relative stick rates -------------------- */
    // input convention: pitch>0 nose up, yaw>0 turn right, roll>0 roll right.
    // The quaternion is built in body space, where +X rotation raises the nose,
    // +Y rotation turns left and +Z rotation lifts the right wing.
    const pitchIn = this.sm.pitch * authority * FLIGHT.pitchRate * (0.7 + 0.3 * FLIGHT.pitchSens);
    const yawIn = -this.sm.yaw * authority * FLIGHT.yawRate * (0.7 + 0.3 * FLIGHT.yawSens);
    const rollIn = -this.sm.roll * authority * FLIGHT.rollRate;

    const stagger = this.state === 'STAGGERED' ? this.instability : this.instability * 0.35;
    const wobble = stagger * 2.6 * Math.sin(this.stateTime * 9.0);

    V.euler.set(pitchIn * dt + wobble * dt * 0.6, yawIn * dt + wobble * dt * 0.7, rollIn * dt, 'YXZ');
    V.q.setFromEuler(V.euler);
    this.quaternion.multiply(V.q).normalize();

    /* ---- 2. auto-level assist -------------------------------------- */
    const noRotInput = Math.abs(this.sm.pitch) < 0.05 && Math.abs(this.sm.roll) < 0.05;
    const wantLevel =
      input.level ||
      this.state === 'HOVER' ||
      this.state === 'LANDING' ||
      this.state === 'GROUND' ||
      (noRotInput && speed < FLIGHT.cruiseSpeed * 0.55);
    if (wantLevel && this.state !== 'STAGGERED') {
      const upNow = this.getUp(V.tmp2);
      const dot = clamp(upNow.dot(V.tmp.set(0, 1, 0)), -1, 1);
      const angle = Math.acos(dot);
      if (angle > 0.001) {
        V.tmp2.copy(upNow).cross(V.tmp).normalize();
        if (!Number.isFinite(V.tmp2.x) || V.tmp2.lengthSq() < 1e-6) V.tmp2.set(1, 0, 0);
        const strength = this.state === 'HOVER' || this.state === 'GROUND' ? 1.0 : 0.55;
        V.q2.setFromAxisAngle(V.tmp2, Math.min(angle, angle * FLIGHT.autoLevelRate * strength * dt));
        this.quaternion.premultiply(V.q2).normalize();
      }
    }

    // refresh basis after attitude change
    this.getForward(fwd);
    this.getUp(up);
    this.getRight(right);

    /* ---- 3. thrust ------------------------------------------------- */
    const boostMul = 1 + this.boostLevel * (FLIGHT.boostAccel / FLIGHT.forwardAccel - 1);
    const thrust = this.sm.thrust;
    if (thrust > 0) {
      const a = FLIGHT.forwardAccel * thrust * boostMul;
      this.velocity.addScaledVector(fwd, a * dt);
    } else if (thrust < 0) {
      this.velocity.addScaledVector(fwd, FLIGHT.reverseAccel * thrust * dt);
    }
    if (Math.abs(this.sm.strafe) > 0.01) {
      this.velocity.addScaledVector(right, FLIGHT.strafeAccel * this.sm.strafe * dt);
    }
    if (Math.abs(this.sm.vertical) > 0.01) {
      // vertical trim is rate-limited: prevent runaway, but keep the channel
      // decisively stronger than hover station-holding so C-descents work
      const vCap = FLIGHT.verticalTrimMax;
      const vy = this.velocity.y;
      const want = FLIGHT.verticalAccel * this.sm.vertical * dt;
      if ((vy > vCap && want > 0) || (vy < -vCap && want < 0)) {
        // already at/above the soft cap in the requested direction
      } else {
        this.velocity.y += want;
      }
    }

    /* ---- 4. repulsor lift vs gravity ------------------------------- */
    const liftBlend = 1 - smoothstep(FLIGHT.hoverSpeed, FLIGHT.cruiseSpeed, speed);
    const liftAuthority = this.state === 'STAGGERED' ? liftBlend * 0.5 : liftBlend;
    // hover/landing actively hold altitude; dive gets full gravity
    const powerHold = this.state === 'HOVER' || this.state === 'LANDING' || this.state === 'TAKEOFF' ? 1 : 0;
    const lift = FLIGHT.gravity * FLIGHT.liftAuthority * Math.max(liftAuthority, powerHold * 0.98);
    this.velocity.y += (lift - FLIGHT.gravity) * dt;

    /* ---- 5. drag: anisotropic, preserves momentum along the nose --- */
    const fwdComp = this.velocity.dot(fwd);
    const lateral = V.tmp.copy(this.velocity).addScaledVector(fwd, -fwdComp);
    // vertical sees far less aerodynamic grip than horizontal, otherwise the
    // grip term silently caps climb/descend rates at accel/grip (~7 m/s)
    lateral.y *= 0.25;
    const grip = this.state === 'DIVE' ? FLIGHT.lateralGripDive : FLIGHT.lateralGrip;
    this.velocity.addScaledVector(lateral, -Math.min(1, grip * dt));
    const fwdDrag = FLIGHT.forwardDrag * (this.state === 'BRAKE' ? 3.4 : 1);
    this.velocity.addScaledVector(fwd, -fwdComp * Math.min(1, fwdDrag * dt));

    /* ---- 6. braking ------------------------------------------------- */
    if (this.brakeLevel > 0.01) {
      this.velocity.multiplyScalar(Math.max(0, 1 - FLIGHT.brakeDrag * this.brakeLevel * dt));
    }
    // hover stabilization: hold station when the player is not asking to go anywhere
    if ((this.state === 'HOVER' || this.state === 'TAKEOFF') && Math.abs(this.sm.thrust) < 0.12 && this.brakeLevel < 0.1) {
      this.velocity.x *= Math.max(0, 1 - 1.15 * dt);
      this.velocity.z *= Math.max(0, 1 - 1.15 * dt);
      if (Math.abs(this.sm.vertical) < 0.05) this.velocity.y *= Math.max(0, 1 - 1.15 * dt);
    }
    if (this.state === 'GROUND') {
      this.velocity.x *= Math.max(0, 1 - FLIGHT.groundDrag * dt);
      this.velocity.z *= Math.max(0, 1 - FLIGHT.groundDrag * dt);
    }

    /* ---- 7. speed envelope ----------------------------------------- */
    const diveFwd = -fwd.y > 0.4;
    let envelope = FLIGHT.cruiseMax;
    if (this.brakeLevel > 0.3) envelope = FLIGHT.brakeMax;
    else if (this.boostLevel > 0.15) envelope = FLIGHT.boostMax;
    else if (diveFwd) envelope = FLIGHT.diveMax;
    if (this.state === 'GROUND' || this.state === 'LANDING') envelope = FLIGHT.brakeMax * 1.4;

    let sp = this.velocity.length();
    if (sp > envelope) {
      // momentum above the envelope bleeds off instead of being hard-clamped
      const bleed = 0.35 + (sp - envelope) / envelope * 0.8;
      const scale = Math.max(0, 1 - bleed * dt);
      this.velocity.multiplyScalar(scale);
      sp = this.velocity.length();
    }

    /* ---- 8. integrate + world bounds ------------------------------- */
    this.pos.addScaledVector(this.velocity, dt);

    if (this.pos.y > FLIGHT.ceiling) {
      this.velocity.y -= 30 * dt;
    }
    const radial = Math.hypot(this.pos.x, this.pos.z);
    if (radial > FLIGHT.boundsRadius) {
      const push = (radial - FLIGHT.boundsRadius) * 0.6 + 6;
      this.velocity.x -= (this.pos.x / radial) * push * dt;
      this.velocity.z -= (this.pos.z / radial) * push * dt;
    }
    if (this.pos.y < -40) {
      // safety net: never lose the player to the void
      this.pos.y = 80;
      this.velocity.set(0, 0, 0);
      this.applyDamage(35);
      this.forceStagger(1.2);
    }

    /* ---- 9. collision --------------------------------------------- */
    this.collide(city);
  }

  private collide(city: City): void {
    const wasGrounded = this.grounded;
    this.grounded = false;

    const hitCount = this.resolveOnce(city);
    // a second pass settles corners and wedges
    if (hitCount) this.resolveOnce(city);

    const support = city.collision.supportHeightAt(this.pos.x, this.pos.z, this.pos.y - FLIGHT.heroRadius * 0.4, 0.7);
    this.surfaceTmp = support;

    // ground contact: sitting on a roof/street/deck
    if (support !== null) {
      const feet = this.pos.y - FLIGHT.heroRadius;
      if (feet <= support + FLIGHT.heroRadius * 0.35 && this.velocity.y <= 1.5) {
        this.grounded = true;
        this.groundY = support;
        this.pos.y = support + FLIGHT.heroRadius;
        if (this.velocity.y < 0) {
          const impact = -this.velocity.y;
          this.velocity.y = 0;
          if (impact > FLIGHT.crashSpeed * 1.4 && impact > FLIGHT.touchdownGraceSpeed && this.state !== 'STAGGERED') {
            this.registerCrash(impact * 0.6, 'ground');
          }
        }
      }
    }
    if (!wasGrounded && this.grounded) {
      this.groundContactTimer = 0;
      this.onLand?.(this.speed);
    }
    if (wasGrounded && !this.grounded) this.groundContactTimer = 0;
  }

  private resolveOnce(city: City): number {
    const center = V.center.copy(this.pos);
    const hit = city.collision.resolveSphere(center, FLIGHT.heroRadius, this.hit);
    if (!hit) return 0;

    const n = hit.normal;
    const vn = this.velocity.dot(n);
    this.pos.addScaledVector(n, hit.depth + 0.01);

    if (vn < 0) {
      // remove the into-surface component, keep a little bounce, lose energy
      const restitution = hit.box.kind === 1 ? 0.18 : 0.1;
      this.velocity.addScaledVector(n, -vn * (1 + restitution));
      const scrape = hit.normal.y > 0.5 ? 0.06 : 0.34;
      this.velocity.multiplyScalar(1 - scrape);

      const impactSpeed = -vn;
      if (impactSpeed > FLIGHT.crashSpeed && this.state !== 'STAGGERED' && n.y < 0.6) {
        this.registerCrash(impactSpeed, 'wall');
      } else if (impactSpeed > 6) {
        this.lastImpactSpeed = impactSpeed;
        this.applyDamage(clamp(impactSpeed * 0.35, 0, 14));
        this.instability = Math.min(1, this.instability + impactSpeed / 90);
      }
    }
    void city;
    return 1;
  }

  private registerCrash(impactSpeed: number, kind: 'wall' | 'ground'): void {
    const damage = clamp((impactSpeed - FLIGHT.crashSpeed * 0.6) * FLIGHT.crashDamageScale, 4, 34);
    this.applyDamage(damage);
    this.forceStagger(clamp(impactSpeed / 60, 0.6, 1.6));
    this.lastImpactSpeed = impactSpeed;
    this.damageThisFrame = damage;
    this.crashThisFrame = true;
    // bounce back and tumble
    const fwd = this.getForward(V.fwd);
    this.velocity.addScaledVector(fwd, -Math.min(impactSpeed * 0.35, 26));
    this.velocity.y += kind === 'ground' ? 5.5 : 3.0;
    this.onCrash?.(impactSpeed, damage);
  }

  /* ---------------------------------------------------------------- */

  /** Start a takeoff from the ground. */
  requestTakeoff(): boolean {
    if (this.state !== 'GROUND' && this.state !== 'LANDING' && this.state !== 'IDLE') return false;
    this.state = 'TAKEOFF';
    this.stateTime = 0;
    this.grounded = false;
    const up = this.getUp(V.up);
    this.velocity.addScaledVector(up, FLIGHT.takeoffImpulse);
    this.velocity.y += FLIGHT.takeoffImpulse * 0.35;
    const fwd = this.getForward(V.fwd);
    this.velocity.addScaledVector(fwd, 6);
    this.onTakeoff?.();
    return true;
  }

  /** True when the hero is safe to interact/collide as a flying body. */
  get airborne(): boolean {
    return !this.grounded && this.state !== 'GROUND' && this.state !== 'LANDING';
  }
}

export { V as FlightVecs };
