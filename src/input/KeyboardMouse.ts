import type { FlightInput } from './types';

export interface KeySettings {
  invertY: boolean;
  mouseSens: number;    // deg per pixel-ish
  gamepadSens: number;
}

/**
 * Keyboard + pointer-lock mouse flight stick. Mouse X/Y drive angular RATES
 * (flight-stick behaviour) which is what gives the banking superhero feel.
 */
export class KeyboardMouse {
  settings: KeySettings = { invertY: false, mouseSens: 1.0, gamepadSens: 1.0 };
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseLeft = false;
  private mouseRight = false;
  /** Right-drag fly-by-wire: while held, mouse deltas steer without pointer lock. */
  private dragLook = false;
  /** Set true while the player is actively steering with the mouse this frame. */
  mouseSteering = false;
  private edges = {
    takeoff: false, pause: false, reset: false, cycle: false, emp: false, gesture: false,
  };
  private padPrev: boolean[] = [];
  locked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseLeft = false; this.mouseRight = false; });
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) { this.mouseRight = true; this.dragLook = true; }
      if (e.button === 1) this.dragLook = true;
      if (!this.locked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) { this.mouseRight = false; this.dragLook = false; }
      if (e.button === 1) this.dragLook = false;
    });
    window.addEventListener('blur', () => { this.dragLook = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragLook) {
        const scale = this.locked ? 1 : 1.35; // drag needs a touch more authority
        this.mouseDX += e.movementX * scale;
        this.mouseDY += e.movementY * scale;
      }
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    if (!e.repeat) {
      if (k === ' ') this.edges.takeoff = true;
      if (k === 'p' || k === 'escape') this.edges.pause = true;
      if (k === 'tab') this.edges.cycle = true;
      if (k === 'g' || k === 'r') this.edges.emp = true;
      if (k === 'v') this.edges.gesture = true;
      if (k === 'backspace') this.edges.reset = true;
    }
    this.keys.add(k);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  requestLock(): void {
    // pointer lock is a nice-to-have: it fails in embedded/offscreen views, and
    // the browser surfaces that as a promise rejection rather than a throw
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => { /* no mouse look */ });
    } catch { /* pointer lock is optional */ }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Consumes accumulated mouse motion (radians-ish rates). */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  fill(out: FlightInput): FlightInput {
    const k = this.keys;
    const gamepad = navigator.getGamepads?.()[0] ?? null;
    let padYaw = 0, padPitch = 0, padRoll = 0, padThrust = 0, padBoost = false;

    if (gamepad) {
      const ax = gamepad.axes;
      const bt = gamepad.buttons;
      padYaw = Math.abs(ax[0] ?? 0) > 0.12 ? (ax[0] ?? 0) : 0;
      // stick forward (negative axis) = nose up, matching keys and gestures
      padPitch = Math.abs(ax[1] ?? 0) > 0.12 ? -(ax[1] ?? 0) : 0;
      padThrust = Math.abs(ax[3] ?? 0) > 0.1 ? -(ax[3] ?? 0) : 0;
      padRoll = (bt[5]?.value ?? 0) - (bt[4]?.value ?? 0);
      padBoost = (bt[7]?.pressed ?? false) || (bt[0]?.pressed ?? false);
    }

    // shared input convention: pitch > 0 = nose UP, yaw > 0 = turn RIGHT,
    // roll > 0 = roll right. Every source (keys, pad, mouse, gestures) agrees.
    const keyPitch = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
    const keyYaw = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0);

    const thrust = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0) + padThrust;
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const roll = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0) + padRoll;
    const vertical = (k.has(' ') ? 1 : 0) - ((k.has('c') || k.has('control')) ? 1 : 0);

    out.thrust = Math.max(-1, Math.min(1, thrust));
    out.strafe = Math.max(-1, Math.min(1, strafe));
    out.roll = Math.max(-1, Math.min(1, roll));
    out.vertical = Math.max(-1, Math.min(1, vertical));
    out.pitch = Math.max(-1, Math.min(1, keyPitch + (this.settings.invertY ? -padPitch : padPitch)));
    out.yaw = Math.max(-1, Math.min(1, keyYaw + padYaw));
    out.boost = k.has('shift') || padBoost;
    out.brake = k.has('x');
    out.fire = this.mouseLeft;
    out.unibeam = k.has('f');
    // Auto-level is a held key (Z), never forced by pointer-lock state. Forcing
    // it while unlocked silently cancelled pitch/roll and made controls feel dead.
    out.level = k.has('z');
    // Track whether the mouse is the active stick this frame (for HUD + assist decay).
    this.mouseSteering = this.locked || this.dragLook;
    out.emp = false;
    out.cycleTarget = false;
    out.takeoffPressed = false;
    out.pausePressed = false;
    out.resetPressed = false;
    // Gamepad quality-of-life: A also requests takeoff when grounded (menu says START/A).
    const padA = gamepad?.buttons[0]?.pressed ?? false;
    if (padA && !this.padPrev[0]) this.edges.takeoff = true;
    out.source = out.source === 'gesture' ? 'gesture' : 'keyboard';
    return out;
  }

  /** Consumes per-frame edge events. Call once per frame after fill(). */
  consumeEdges(): typeof this.edges {
    const e = { ...this.edges };
    this.edges.takeoff = false;
    this.edges.pause = false;
    this.edges.reset = false;
    this.edges.cycle = false;
    this.edges.emp = false;
    this.edges.gesture = false;
    void this.padPrev;
    return e;
  }
}
