import type { GestureName, HandSample } from '../input/types';
import { clamp } from '../util/Rng';

interface ClassifiedHand extends HandSample {
  extended: boolean[];
}

export interface GestureResult {
  gesture: GestureName;
  hands: number;
  confidence: number;
  /** Smoothed steering −1..1 from hand position / tilt. */
  steerX: number;
  /** Smoothed pitch −1..1 from hand height. */
  pitchY: number;
  pointStarted: boolean;
  pointing: boolean;
  empBurst: boolean;
  handsDetail: ClassifiedHand[];
}

/**
 * Landmark → features → gesture state.
 *
 * Robustness rules required by the brief:
 *  - scale-invariant finger tests (all distances normalised by hand size)
 *  - exponential smoothing on the steering axes
 *  - dead-zone + hysteresis so gestures do not chatter
 *  - stable-frame confirmation before a gesture is accepted
 *  - per-gesture cooldown for one-shot actions (EMP)
 *  - lost-hand grace period so a dropped track never spikes the controls
 */
export class GestureClassifier {
  private smoothSteer = 0;
  private smoothPitch = 0;
  private smoothTilt = 0;
  private current: GestureName = 'NONE';
  private candidate: GestureName = 'NONE';
  private stable = 0;
  private lostTimer = 0;
  private lastPointing = false;
  private pointHold = 0;
  private lastEmpAt = -9999;
  private now = 0;

  update(samples: HandSample[], dt: number): GestureResult {
    this.now += dt * 1000;
    const hands: ClassifiedHand[] = samples.map((h) => this.extract(h));

    const result: GestureResult = {
      gesture: 'NONE', hands: hands.length, confidence: 0,
      steerX: this.smoothSteer, pitchY: this.smoothPitch,
      pointStarted: false, pointing: false, empBurst: false, handsDetail: hands,
    };

    /* ---------------- lost-hand recovery ---------------- */
    if (hands.length === 0) {
      this.lostTimer += dt;
      if (this.lostTimer > 0.6) {
        this.smoothSteer *= Math.max(0, 1 - dt * 3);
        this.smoothPitch *= Math.max(0, 1 - dt * 3);
        this.setGesture('NONE');
      }
      result.gesture = this.current;
      result.steerX = this.smoothSteer;
      result.pitchY = this.smoothPitch;
      result.confidence = 0;
      return result;
    }
    this.lostTimer = 0;

    /* ---------------- steering axes ---------------- */
    const primary = hands[0];
    const center = primary.center;
    const rawSteer = deadzone((center.x - 0.5) * 2.1, 0.1);
    const rawPitch = deadzone((0.52 - center.y) * 2.4, 0.12);
    const tilt = primary.tiltX;
    this.smoothSteer += (clamp(rawSteer, -1, 1) - this.smoothSteer) * Math.min(1, dt * 7);
    this.smoothPitch += (clamp(rawPitch, -1, 1) - this.smoothPitch) * Math.min(1, dt * 6);
    this.smoothTilt += (tilt - this.smoothTilt) * Math.min(1, dt * 6);

    /* ---------------- gesture classification ---------------- */
    const twoHands = hands.length >= 2;
    const allOpen = hands.length > 0 && hands.every((h) => h.fingers >= 4);
    const allFist = hands.length > 0 && hands.every((h) => h.fingers <= 1);
    const pointOnly = !twoHands && primary.indexExtended && primary.fingers === 1;

    let label: GestureName = 'NONE';
    let empBurst = false;

    if (twoHands) {
      const spread = handSeparation(hands[0], hands[1]);
      if (allFist) {
        if (spread > 0.26 && this.now - this.lastEmpAt > 2600) {
          this.lastEmpAt = this.now;
          empBurst = true;
        }
        label = 'TWO_FIST';
      } else if (allOpen) {
        label = 'TWO_OPEN';
      } else {
        label = hands[0].fingers >= 3 ? 'OPEN_PALM' : 'FIST';
      }
    } else if (pointOnly) {
      label = 'POINT';
    } else if (allFist) {
      label = 'FIST';
    } else if (allOpen) {
      if (this.smoothTilt < -0.38) label = 'TILT_LEFT';
      else if (this.smoothTilt > 0.38) label = 'TILT_RIGHT';
      else if (center.y < 0.3) label = 'PALM_UP';
      else if (center.y > 0.72) label = 'PALM_DOWN';
      else label = 'OPEN_PALM';
    } else if (primary.fingers >= 3) {
      label = 'OPEN_PALM';
    }

    /* ---------------- hysteresis + debounce ---------------- */
    this.setGesture(label);

    /* ---------------- pointing / firing ---------------- */
    const pointing = label === 'POINT';
    if (pointing && !this.lastPointing) {
      result.pointStarted = true;
      this.pointHold = 0;
    }
    if (pointing) this.pointHold += dt;
    this.lastPointing = pointing;

    const meanScore = hands.reduce((s, h) => s + h.score, 0) / hands.length;
    result.gesture = this.current;
    result.steerX = this.smoothSteer;
    result.pitchY = this.smoothPitch;
    result.confidence = clamp(meanScore * (this.stable >= 2 ? 1 : 0.6) * (twoHands ? 0.95 : 1), 0, 1);
    result.pointing = pointing && this.pointHold > 0.12;
    result.empBurst = empBurst;
    return result;
  }

  private setGesture(raw: GestureName): void {
    if (raw === this.candidate) {
      this.stable++;
    } else {
      this.candidate = raw;
      this.stable = 0;
    }
    // 2 stable frames (~60 ms) to switch INTO a gesture; one frame to release
    const needed = raw === 'NONE' ? 1 : 2;
    if (this.stable >= needed && this.current !== raw) this.current = raw;
  }

  reset(): void {
    this.current = 'NONE';
    this.candidate = 'NONE';
    this.stable = 0;
    this.smoothSteer = 0;
    this.smoothPitch = 0;
    this.smoothTilt = 0;
    this.lostTimer = 0;
    this.pointHold = 0;
  }

  /* ---------------- feature extraction ---------------- */

  private extract(h: HandSample): ClassifiedHand {
    const lm = h.landmarks;
    const wrist = lm[0];
    const midMcp = lm[9];
    const size = Math.max(0.035, dist2(wrist, midMcp));
    const extended: boolean[] = [];

    // thumb: distance of the tip from the index MCP, relative to hand size
    extended.push(dist2(lm[4], lm[5]) / size > 0.85);
    // index/middle/ring/pinky: tip further from the wrist than the PIP joint
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]] as const) {
      extended.push(dist2(lm[tip], wrist) > dist2(lm[pip], wrist) * 1.12);
    }

    const fingersCount = extended.filter(Boolean).length;
    const indexExtended = extended[1] && fingersCount <= 2;

    // palm direction (wrist → middle MCP); 0 = pointing straight up on screen
    const tiltX = Math.sin(Math.atan2(midMcp.x - wrist.x, -(midMcp.y - wrist.y)));

    const xs = lm.map((p) => p.x);
    const ys = lm.map((p) => p.y);
    const span = Math.max(...ys) - Math.min(...ys);

    return {
      ...h,
      center: centerOf(lm),
      fingers: fingersCount,
      indexExtended,
      pinch: dist2(lm[4], lm[8]) / size,
      tiltX,
      span,
      extended,
    };
  }
}

function centerOf(lm: HandSample['landmarks']): { x: number; y: number } {
  let x = 0, y = 0;
  const idx = [0, 5, 9, 13, 17];
  for (const i of idx) { x += lm[i].x; y += lm[i].y; }
  return { x: x / idx.length, y: y / idx.length };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function handSeparation(a: HandSample, b: HandSample): number {
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
}

function deadzone(v: number, dz: number): number {
  if (Math.abs(v) < dz) return 0;
  return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
}
