import { HandTracker } from '../gesture/HandTracker';
import { GestureClassifier } from '../gesture/GestureClassifier';
import { applyGestureMapping, DEFAULT_MAPPING, type GestureMappingEdges, type GestureMappingOptions } from '../gesture/GestureMapping';
import { defaultTelemetry, emptyFlightInput, type FlightInput, type GestureTelemetry, type HandSample } from './types';

const PROCESS_INTERVAL_MS = 33; // ~30 Hz inference keeps the render loop free

/**
 * Webcam → HandTracker → GestureClassifier → GestureMapping → FlightInput.
 * No separate physics: the output is merged with the keyboard into one frame.
 */
export class GestureInput {
  tracker = new HandTracker();
  telemetry: GestureTelemetry = defaultTelemetry();
  mapping: GestureMappingOptions = { ...DEFAULT_MAPPING };
  enabled = false;
  showOverlay = true;
  /** Latest landmark set, for the calibration/exhibition overlay. */
  landmarks: HandSample[] = [];

  private classifier = new GestureClassifier();
  private lastProcess = 0;
  private frames = 0;
  private fpsWindow = performance.now();
  private frame: FlightInput = emptyFlightInput();
  private edges: GestureMappingEdges = { emp: false, cycleTarget: false, fire: false };
  private resultGesture = 'NONE';
  private mappedAction = 'IDLE';

  async start(): Promise<boolean> {
    this.telemetry.camera = 'starting';
    const ok = await this.tracker.start();
    if (!ok) {
      const denied = /permission|denied|notallowed/i.test(this.tracker.errorText);
      this.telemetry.camera = denied ? 'denied' : 'error';
      this.telemetry.errorText = this.tracker.errorText;
      this.enabled = false;
      return false;
    }
    this.telemetry.camera = 'on';
    this.telemetry.errorText = '';
    this.enabled = true;
    this.classifier.reset();
    return true;
  }

  stop(): void {
    this.tracker.stop();
    this.enabled = false;
    this.telemetry.camera = 'off';
    this.frame = emptyFlightInput();
  }

  /** Runs detection on its own cadence; call once per frame. */
  update(dt: number): void {
    if (!this.enabled || !this.tracker.ready) return;
    const now = performance.now();
    if (now - this.lastProcess < PROCESS_INTERVAL_MS) return;
    const t0 = now;
    const sinceLast = Math.max(0.005, Math.min(0.25, (now - this.lastProcess) / 1000));
    this.lastProcess = now;

    const raw = this.tracker.detect(now);
    this.landmarks = this.tracker.asSamples(raw);
    const result = this.classifier.update(this.landmarks, sinceLast);

    const frame = emptyFlightInput();
    this.edges.emp = false;
    this.edges.cycleTarget = false;
    const action = applyGestureMapping(result, frame, this.edges, this.mapping);
    this.frame = frame;
    this.resultGesture = result.gesture;
    this.mappedAction = this.enabled ? action : 'KEYBOARD FALLBACK';

    this.frames++;
    if (now - this.fpsWindow > 1000) {
      this.telemetry.fps = this.frames;
      this.frames = 0;
      this.fpsWindow = now;
    }
    this.telemetry.handFound = this.landmarks.length > 0;
    this.telemetry.hands = this.landmarks.length;
    this.telemetry.gesture = result.gesture;
    this.telemetry.confidence = result.confidence;
    this.telemetry.latencyMs = Math.round(performance.now() - t0);
    this.telemetry.mappedAction = action;
    this.telemetry.steerX = result.steerX;
    this.telemetry.pitchY = result.pitchY;

    // brightness probing is cheaper on a slower cadence
    if (Math.random() < 0.06) this.telemetry.brightness = this.tracker.brightness();
  }

  /** Merges gesture intent into an existing frame (hybrid mode). */
  fill(out: FlightInput): FlightInput {
    if (!this.enabled) return out;
    if (out.source === 'none') out.source = 'gesture';
    out.thrust = out.thrust !== 0 ? out.thrust : this.frame.thrust;
    out.strafe = out.strafe !== 0 ? out.strafe : this.frame.strafe;
    out.pitch = out.pitch !== 0 ? out.pitch : this.frame.pitch;
    out.yaw = out.yaw !== 0 ? out.yaw : this.frame.yaw;
    out.roll = out.roll !== 0 ? out.roll : this.frame.roll;
    out.vertical = out.vertical !== 0 ? out.vertical : this.frame.vertical;
    out.boost = out.boost || this.frame.boost;
    out.brake = out.brake || this.frame.brake;
    out.fire = out.fire || this.frame.fire;
    out.unibeam = out.unibeam || this.frame.unibeam;
    out.level = out.level || this.frame.level;
    out.emp = out.emp || this.frame.emp;
    return out;
  }

  /** One-shot gesture edges, consumed by the input aggregator. */
  consumeEdges(): GestureMappingEdges {
    const e = { ...this.edges };
    this.edges.emp = false;
    this.edges.cycleTarget = false;
    this.edges.fire = false;
    return e;
  }

  get gestureName(): string {
    return this.resultGesture;
  }

  get actionText(): string {
    return this.mappedAction;
  }

  get video(): HTMLVideoElement | null {
    return this.tracker.video;
  }

  get assetSource(): string {
    return this.tracker.assetSource;
  }

  get delegate(): string {
    return this.tracker.delegate;
  }
}
