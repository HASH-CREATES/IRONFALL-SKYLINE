import type { GestureInput } from '../input/GestureInput';
import type { GestureName } from '../input/types';

interface Step {
  text: string;
  hint: string;
  /** Returns true when the current gesture sample satisfies the step. */
  test: (ctx: StepContext) => boolean;
  progress: number;
}

interface StepContext {
  gesture: GestureName;
  steerX: number;
  hands: number;
  confidence: number;
  handFound: boolean;
}

const NEED = 18; // consecutive satisfied samples to accept a step

/** Seconds-long calibration: four guided hand poses with live landmark feedback. */
export class Calibration {
  root: HTMLDivElement;
  open = false;
  onAction: (action: string) => void = () => {};
  private gesture: GestureInput | null = null;
  private stepIndex = 0;
  private stepFrames = 0;
  private steps: Step[] = [
    {
      text: 'SHOW AN OPEN PALM',
      hint: 'Hold your hand up, fingers spread, inside the frame.',
      progress: 0,
      test: (c) => c.handFound && (c.gesture === 'OPEN_PALM' || c.gesture === 'PALM_UP' || c.gesture === 'PALM_DOWN'),
    },
    {
      text: 'STEER LEFT, THEN RIGHT',
      hint: 'Move your open hand to the left edge of the frame, then to the right.',
      progress: 0,
      test: (c) => Math.abs(c.steerX) > 0.45,
    },
    {
      text: 'CLOSE YOUR HAND INTO A FIST',
      hint: 'This is your brake and hold-station command.',
      progress: 0,
      test: (c) => c.handFound && c.gesture === 'FIST',
    },
    {
      text: 'RAISE TWO OPEN HANDS',
      hint: 'Two open palms is boost. Pull them apart as fists for the EMP pulse.',
      progress: 0,
      test: (c) => c.hands >= 2,
    },
  ];
  private videoEl: HTMLVideoElement | null = null;
  private canvas!: HTMLCanvasElement;
  private statusEl!: HTMLDivElement;
  private stepsEl!: HTMLDivElement;
  private meterEl!: HTMLElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ic-overlay ic-hidden';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el?.dataset.act) this.onAction(el.dataset.act);
    });
  }

  start(gesture: GestureInput): void {
    this.gesture = gesture;
    this.stepIndex = 0;
    this.stepFrames = 0;
    for (const s of this.steps) s.progress = 0;
    this.open = true;
    this.render();
    this.root.classList.remove('ic-hidden');
    this.captureElements();
    if (gesture.tracker.video) {
      this.videoEl = gesture.tracker.video;
      this.videoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      this.videoEl.id = 'gesture-source';
      const holder = this.root.querySelector('.ic-cal-cam');
      if (holder && this.videoEl.parentElement !== holder) holder.appendChild(this.videoEl);
    }
  }

  private render(): void {
    const camReady = this.gesture?.telemetry.camera === 'on';
    this.root.innerHTML = `
      <div class="ic-panel">
        <div class="sub">GESTURE CALIBRATION</div>
        <h2>HAND TRACKING SETUP</h2>
        <p>Four quick poses. Nothing is recorded or uploaded — every frame is processed locally in your browser.</p>
        <div class="ic-cal">
          <div>
            <div class="ic-cal-cam"><canvas width="320" height="240"></canvas></div>
            <div class="ic-note" id="cal-status" style="margin-top:8px">
              ${camReady ? 'CAMERA ONLINE · TRACKING' : 'WAITING FOR CAMERA'}
            </div>
            <div class="ic-meter"><i></i></div>
            <div class="ic-note" id="cal-latency">—</div>
          </div>
          <div>
            <div class="ic-cal-steps">
              ${this.steps.map((s, i) => `<div class="${i === this.stepIndex ? 'active' : i < this.stepIndex ? 'done' : ''}">${s.text}</div>`).join('')}
            </div>
            <h3 id="cal-hint">${this.steps[this.stepIndex]?.hint ?? 'Calibration complete.'}</h3>
            <p class="ic-note">If your hand cannot be seen, add light in front of you and keep it inside the frame.
            Keyboard control always works — press the button below to skip.</p>
            <div class="actions">
              <button class="ic-btn primary" data-act="calibrate-done">Use Gesture Control</button>
              <button class="ic-btn ghost" data-act="calibrate-retry">Retry</button>
              <button class="ic-btn ghost" data-act="use-keyboard">Use Keyboard Only</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private captureElements(): void {
    this.canvas = this.root.querySelector('.ic-cal-cam canvas') as HTMLCanvasElement;
    this.statusEl = this.root.querySelector('#cal-status') as HTMLDivElement;
    this.stepsEl = this.root.querySelector('#cal-hint') as HTMLDivElement;
    this.meterEl = this.root.querySelector('.ic-meter i') as HTMLElement;
  }

  /** Called from the game loop while calibration is open. */
  update(): void {
    if (!this.open || !this.gesture) return;
    const t = this.gesture.telemetry;
    const step = this.steps[this.stepIndex];
    const ctx: StepContext = {
      gesture: this.gesture.gestureName as GestureName,
      steerX: t.steerX,
      hands: t.hands,
      confidence: t.confidence,
      handFound: t.handFound,
    };

    if (step && step.test(ctx)) {
      this.stepFrames++;
      step.progress = Math.min(1, this.stepFrames / NEED);
      if (this.stepFrames >= NEED) {
        this.stepIndex++;
        this.stepFrames = 0;
        this.stepsEl.textContent = this.steps[this.stepIndex]?.hint ?? 'Calibration complete — you are clear to fly.';
        const divs = this.root.querySelectorAll('.ic-cal-steps div');
        divs.forEach((d, i) => {
          d.className = i === this.stepIndex ? 'active' : i < this.stepIndex ? 'done' : '';
        });
      }
    } else if (step) {
      this.stepFrames = Math.max(0, this.stepFrames - 2);
      step.progress = Math.min(1, this.stepFrames / NEED);
    }

    this.meterEl.style.width = `${((step ? step.progress : 1) * 100).toFixed(0)}%`;
    this.statusEl.textContent = t.handFound
      ? `${t.hands} HAND · GESTURE ${t.gesture} · CONF ${Math.round(t.confidence * 100)}%`
      : 'NO HAND DETECTED — CHECK LIGHTING';
    const latency = this.root.querySelector('#cal-latency');
    if (latency) {
      latency.textContent = `INFERENCE ${t.latencyMs}MS @ ${t.fps}HZ · DETECTOR ${t.camera === 'on' ? 'ACTIVE' : t.camera.toUpperCase()} · LIGHT ${Math.round(t.brightness * 100)}%`;
    }

    this.drawOverlay();
  }

  private drawOverlay(): void {
    if (!this.canvas || !this.gesture) return;
    const ctx = this.canvas.getContext('2d')!;
    const video = this.gesture.tracker.video;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-this.canvas.width, 0);
    if (video && video.readyState >= 2) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#04121a';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.restore();

    const hands = this.gesture.landmarks;
    for (const hand of hands) {
      const lm = hand.landmarks;
      ctx.fillStyle = '#d8a63d';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc((1 - p.x) * this.canvas.width, p.y * this.canvas.height, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const c = hand.center;
      ctx.strokeStyle = 'rgba(84,240,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((1 - c.x) * this.canvas.width, c.y * this.canvas.height, 18, 0, Math.PI * 2);
      ctx.stroke();
      // steering axes guide
      ctx.strokeStyle = 'rgba(216,166,61,0.6)';
      ctx.beginPath();
      ctx.moveTo(this.canvas.width * 0.5, 0);
      ctx.lineTo(this.canvas.width * 0.5, this.canvas.height);
      ctx.moveTo(0, this.canvas.height * 0.5);
      ctx.lineTo(this.canvas.width, this.canvas.height * 0.5);
      ctx.stroke();
    }
  }

  get complete(): boolean {
    return this.stepIndex >= this.steps.length;
  }

  close(): void {
    this.open = false;
    this.root.classList.add('ic-hidden');
    this.root.innerHTML = '';
    if (this.videoEl) {
      this.videoEl.style.cssText = '';
    }
  }
}
