import type { InputSource } from '../config';

/** The single input schema every control source feeds into. */
export interface FlightInput {
  thrust: number;   // -1..1
  strafe: number;   // -1..1
  pitch: number;    // -1..1 rate
  yaw: number;      // -1..1 rate
  roll: number;     // -1..1 rate
  vertical: number; // -1..1 climb / descend
  boost: boolean;
  brake: boolean;
  fire: boolean;
  unibeam: boolean;
  emp: boolean;          // edge
  level: boolean;        // auto-level assist held
  cycleTarget: boolean;  // edge
  takeoffPressed: boolean; // edge
  pausePressed: boolean;   // edge
  resetPressed: boolean;   // edge
  toggleGesture: boolean;  // edge
  source: InputSource;
}

export const emptyFlightInput = (): FlightInput => ({
  thrust: 0, strafe: 0, pitch: 0, yaw: 0, roll: 0, vertical: 0,
  boost: false, brake: false, fire: false, unibeam: false, emp: false, level: false,
  cycleTarget: false, takeoffPressed: false, pausePressed: false, resetPressed: false,
  toggleGesture: false, source: 'none',
});

export type GestureName =
  | 'NONE' | 'OPEN_PALM' | 'FIST' | 'POINT' | 'TWO_OPEN' | 'TWO_FIST'
  | 'TILT_LEFT' | 'TILT_RIGHT' | 'PALM_UP' | 'PALM_DOWN';

export interface GestureTelemetry {
  camera: 'off' | 'starting' | 'on' | 'denied' | 'error';
  handFound: boolean;
  hands: number;
  gesture: GestureName;
  confidence: number;
  latencyMs: number;
  fps: number;
  mappedAction: string;
  steerX: number;
  pitchY: number;
  brightness: number;
  errorText: string;
}

export const defaultTelemetry = (): GestureTelemetry => ({
  camera: 'off', handFound: false, hands: 0, gesture: 'NONE', confidence: 0,
  latencyMs: 0, fps: 0, mappedAction: 'IDLE', steerX: 0, pitchY: 0, brightness: 0, errorText: '',
});

export interface HandSample {
  side: 'left' | 'right';
  /** Normalised 0..1 image coordinates, 21 landmarks. */
  landmarks: { x: number; y: number; z: number }[];
  /** Palm centre in normalised coords. */
  center: { x: number; y: number };
  /** 0..1 confidence from the model. */
  score: number;
  /** Extended finger count 0..5. */
  fingers: number;
  indexExtended: boolean;
  pinch: number;
  /** Palm direction in screen space: 0 = pointing up, +-1 scaled by sin. */
  tiltX: number;
  /** Hand span normalised by frame height. */
  span: number;
}
