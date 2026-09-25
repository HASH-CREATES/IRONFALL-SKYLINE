import type { ControlMode } from '../config';
import { KeyboardMouse } from './KeyboardMouse';
import { GestureInput } from './GestureInput';
import { emptyFlightInput, type FlightInput } from './types';

export interface UnifiedEdges {
  takeoff: boolean;
  pause: boolean;
  reset: boolean;
  cycleTarget: boolean;
  emp: boolean;
  toggleGesture: boolean;
  fireStarted: boolean;
  unibeamStarted: boolean;
  brakeStarted: boolean;
}

/**
 * One frame, one schema. Keyboard/mouse and gesture both write into the same
 * FlightInput, so the flight controller cannot behave differently per source.
 * Hybrid mode lets the two coexist: keys always work, gestures add intent.
 */
export class UnifiedInput {
  mode: ControlMode = 'keyboard';
  frame: FlightInput = emptyFlightInput();
  edges: UnifiedEdges = {
    takeoff: false, pause: false, reset: false, cycleTarget: false,
    emp: false, toggleGesture: false, fireStarted: false, unibeamStarted: false, brakeStarted: false,
  };

  private prev = { fire: false, unibeam: false, brake: false, boost: false, emp: false, takeoff: false };

  constructor(public keys: KeyboardMouse, public gesture: GestureInput) {}

  get gestureActive(): boolean {
    return this.mode !== 'keyboard' && this.gesture.enabled;
  }

  update(): FlightInput {
    const frame = emptyFlightInput();
    this.keys.fill(frame);

    if (this.gestureActive) {
      this.gesture.fill(frame);
      const ge = this.gesture.consumeEdges();
      if (ge.emp) this.edges.emp = true;
      if (ge.cycleTarget) this.edges.cycleTarget = true;
      if (frame.source === 'none') frame.source = 'gesture';
    }

    const ke = this.keys.consumeEdges();
    if (ke.takeoff) this.edges.takeoff = true;
    if (ke.pause) this.edges.pause = true;
    if (ke.reset) this.edges.reset = true;
    if (ke.cycle) this.edges.cycleTarget = true;
    if (ke.emp) this.edges.emp = true;
    if (ke.gesture) this.edges.toggleGesture = true;
    if (frame.emp) this.edges.emp = true;

    this.edges.fireStarted = frame.fire && !this.prev.fire;
    this.edges.unibeamStarted = frame.unibeam && !this.prev.unibeam;
    this.edges.brakeStarted = frame.brake && !this.prev.brake;

    this.prev.fire = frame.fire;
    this.prev.unibeam = frame.unibeam;
    this.prev.brake = frame.brake;
    this.prev.boost = frame.boost;
    this.prev.emp = frame.emp;

    this.frame = frame;
    return frame;
  }

  /** Call once per frame after the game has consumed the edges. */
  clearEdges(): void {
    this.edges.takeoff = false;
    this.edges.pause = false;
    this.edges.reset = false;
    this.edges.cycleTarget = false;
    this.edges.emp = false;
    this.edges.toggleGesture = false;
  }

  /** The input passed to the flight controller per frame. */
  toFlightInput(): Parameters<import('../player/FlightController').FlightController['update']>[1] {
    const f = this.frame;
    return {
      thrust: f.thrust,
      strafe: f.strafe,
      pitch: f.pitch,
      yaw: f.yaw,
      roll: f.roll,
      vertical: f.vertical,
      boost: f.boost,
      brake: f.brake,
      takeoff: false,
      level: f.level,
    };
  }
}
