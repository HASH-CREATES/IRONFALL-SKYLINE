import type { FlightInput } from '../input/types';
import type { GestureResult } from './GestureClassifier';

export interface GestureMappingOptions {
  thrustGain: number;   // 0.5..1.5
  pitchGain: number;
  yawGain: number;
  hoverAssist: boolean;
}

export const DEFAULT_MAPPING: GestureMappingOptions = {
  thrustGain: 1,
  pitchGain: 1,
  yawGain: 1,
  hoverAssist: true,
};

export interface GestureMappingEdges {
  emp: boolean;
  cycleTarget: boolean;
  fire: boolean;
}

/**
 * Gesture → FlightInput. Deliberately maps onto the SAME fields the keyboard
 * produces, so gesture control drives the identical flight controller.
 *
 *  OPEN PALM      cruise thrust + steer
 *  OPEN PALM HIGH climb, LOW descend (via hand height → pitch)
 *  FIST           brake to a stop, then hold station (hover)
 *  POINT          lock the nearest drone, hold to fire repulsors
 *  TWO OPEN       boost
 *  TWO FISTS SPREAD  EMP pulse
 *  NO HANDS       neutral hover assist — the game never becomes uncontrollable
 */
export function applyGestureMapping(
  result: GestureResult,
  out: FlightInput,
  edges: GestureMappingEdges,
  opts: GestureMappingOptions = DEFAULT_MAPPING
): string {
  const g = result.gesture;
  out.source = 'gesture';
  out.yaw = clampUnit(result.steerX * opts.yawGain);
  out.pitch = clampUnit(result.pitchY * opts.pitchGain);

  let action = 'HOVER ASSIST — no hands detected';

  switch (g) {
    case 'OPEN_PALM':
    case 'TILT_LEFT':
    case 'TILT_RIGHT':
    case 'PALM_UP':
    case 'PALM_DOWN': {
      out.thrust = clampUnit(1.0 * opts.thrustGain);
      out.level = opts.hoverAssist;
      out.brake = false;
      out.boost = false;
      action = 'OPEN PALM — cruise thrust, hand steers';
      break;
    }
    case 'FIST': {
      out.thrust = 0;
      out.brake = true;
      out.level = true;
      out.boost = false;
      action = 'FIST — brake / hold station';
      break;
    }
    case 'POINT': {
      out.thrust = 0.35 * opts.thrustGain;
      out.level = true;
      out.fire = result.pointing;
      if (result.pointStarted) edges.cycleTarget = true;
      action = result.pointing ? 'POINT — lock + repulsor fire' : 'POINT — lock on';
      break;
    }
    case 'TWO_OPEN': {
      out.thrust = 1 * opts.thrustGain;
      out.boost = true;
      out.level = false;
      action = 'TWO OPEN HANDS — BOOST';
      break;
    }
    case 'TWO_FIST': {
      out.thrust = 0;
      out.brake = true;
      out.level = true;
      if (result.empBurst) { edges.emp = true; action = 'TWO FISTS SPREAD — EMP PULSE'; }
      else action = 'TWO FISTS — brake (spread them to EMP)';
      break;
    }
    default: {
      out.thrust = 0;
      out.level = true;
      action = 'IDLE — hover assist';
      break;
    }
  }
  return action;
}

function clampUnit(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}
