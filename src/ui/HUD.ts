import type { GestureTelemetry } from '../input/types';
import { INTEGRITY } from '../config';

export interface HudRadarBlip {
  x: number;      // world x
  z: number;      // world z
  kind: 'enemy' | 'waypoint' | 'tower' | 'patrol';
  alt?: number;
}

export interface HudLock {
  active: boolean;
  name: string;
  progress: number;
  locked: boolean;
  screenX: number;
  screenY: number;
  onScreen: boolean;
  offscreenAngle: number;
  hpRatio: number;
  distance: number;
}

export interface HudState {
  speed: number;
  altitude: number;
  vertical: number;
  heading: number;
  district: string;
  flightState: string;
  energy: number;
  maxEnergy: number;
  integrity: number;
  boost: number;
  inputMode: string;
  gestureText: string;
  gestureOn: boolean;
  objectiveText: string;
  objectiveProgress: number;
  timer: number | null;
  missionName: string;
  score: number;
  kills: number;
  lock: HudLock;
  blips: HudRadarBlip[];
  heroX: number;
  heroZ: number;
  warning: string;
  boundary: boolean;
  water: boolean;
  damaged: number;
  boosting: number;
  speedNorm: number;
  fps: number;
  onGround: boolean;
}

const COMPASS_RANGE_DEG = 120;
const PX_PER_DEG = 4.2;
const GLOBAL_PX = 360 * PX_PER_DEG;

export class HUD {
  root: HTMLDivElement;
  visible = false;
  showGesturePreview = false;

  private compassTrack!: HTMLDivElement;
  private compassWrap!: HTMLDivElement;
  private headingEl!: HTMLDivElement;
  private districtEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private objText!: HTMLDivElement;
  private objBar!: HTMLDivElement;
  private energyArc!: SVGCircleElement;
  private integrityArc!: SVGCircleElement;
  private energyVal!: HTMLDivElement;
  private integrityVal!: HTMLDivElement;
  private velVal!: HTMLDivElement;
  private altVal!: HTMLDivElement;
  private vsVal!: HTMLDivElement;
  private boostVal!: HTMLDivElement;
  private stateChip!: HTMLDivElement;
  private inputChip!: HTMLDivElement;
  private gestureChip!: HTMLDivElement;
  private scoreChip!: HTMLDivElement;
  private reticle!: HTMLDivElement;
  private reticleArc!: SVGCircleElement;
  private lockBox!: HTMLDivElement;
  private lockMeta!: HTMLDivElement;
  private lockHp!: HTMLDivElement;
  private offscreen!: HTMLDivElement;
  private toasts!: HTMLDivElement;
  private mouseHint!: HTMLDivElement;
  private warning!: HTMLDivElement;
  private dmgFlash!: HTMLDivElement;
  private boostVeil!: HTMLDivElement;
  private speedLines!: HTMLDivElement;
  private boundary!: HTMLDivElement;
  private radar!: HTMLCanvasElement;
  private radarCtx!: CanvasRenderingContext2D;
  private radarSweep = 0;

  private last = {
    heading: -999, district: '', state: '', obj: '', objP: -1, timer: -1, energy: -1, integrity: -1,
    speed: -1, alt: -1, vs: -1, boost: -1, score: -1, warning: '', input: '', gesture: '', lockName: '',
    lockX: -9999, lockY: -9999, lockLocked: false, dmg: -1, boostVeil: -1, lines: -1, boundary: null as boolean | null,
    hp: -1, off: -999,
  };
  private toastTimers: { el: HTMLDivElement; t: number }[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ic-hud ic-hidden';
    this.root.innerHTML = `
      <div class="ic-glass"></div>
      <div class="ic-boundary"></div>

      <div class="ic-gesture-mini">
        <div class="cam"><canvas width="300" height="224"></canvas></div>
        <div class="cap">HAND TRACKING</div>
        <div class="g">—</div>
      </div>

      <div class="ic-hud-top">
        <div class="ic-compass">
          <div class="ic-compass-track"></div>
          <div class="ic-compass-center"></div>
        </div>
        <div class="ic-heading">000°</div>
        <div class="ic-district">DOWNTOWN CORE</div>
      </div>

      <div class="ic-timer"></div>
      <div class="ic-objective"><div class="txt"></div><div class="bar"><i></i></div></div>

      <div class="ic-readouts">
        <div class="ic-readout"><div class="k">VELOCITY</div><div class="v">0<small>KM/H</small></div></div>
        <div class="ic-readout gold"><div class="k">ALTITUDE</div><div class="v">0<small>M</small></div></div>
        <div class="ic-readout"><div class="k">VERTICAL</div><div class="v">0<small>M/S</small></div></div>
        <div class="ic-readout"><div class="k">BOOST RESERVE</div><div class="v">0<small>%</small></div></div>
      </div>

      <div class="ic-state">
        <div class="ic-chip idle">MODE</div>
        <div class="ic-chip gold">INPUT</div>
        <div class="ic-chip idle">GESTURE</div>
        <div class="ic-chip">SCORE 0</div>
      </div>

      <div class="ic-gauge left">
        <svg viewBox="0 0 168 168">
          <circle cx="84" cy="84" r="66" fill="none" stroke="rgba(143,154,168,0.2)" stroke-width="7"></circle>
          <circle cx="84" cy="84" r="66" fill="none" stroke="#54f0ff" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="415" stroke-dashoffset="415" transform="rotate(-90 84 84)"></circle>
          <circle cx="84" cy="84" r="52" fill="none" stroke="rgba(216,166,61,0.25)" stroke-width="1" stroke-dasharray="3 6"></circle>
        </svg>
        <div class="value">100</div>
        <div class="unit">BOOST ENERGY</div>
        <div class="label">REPULSOR CELL</div>
      </div>

      <div class="ic-gauge right">
        <svg viewBox="0 0 168 168">
          <circle cx="84" cy="84" r="66" fill="none" stroke="rgba(143,154,168,0.2)" stroke-width="7"></circle>
          <circle cx="84" cy="84" r="66" fill="none" stroke="#d5342a" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="415" stroke-dashoffset="0" transform="rotate(-90 84 84)"></circle>
          <circle cx="84" cy="84" r="52" fill="none" stroke="rgba(216,166,61,0.25)" stroke-width="1" stroke-dasharray="3 6"></circle>
        </svg>
        <div class="value">100</div>
        <div class="unit">SUIT INTEGRITY</div>
        <div class="label">MK-1 PLATING</div>
      </div>

      <div class="ic-reticle">
        <div class="ring"></div>
        <div class="dot"></div>
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(216,166,61,0.9)" stroke-width="2"
            stroke-dasharray="264" stroke-dashoffset="264" transform="rotate(-90 60 60)"></circle>
        </svg>
      </div>
      <div class="ic-lock-box" style="display:none">
        <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
        <div class="meta"></div><div class="hp"><i></i></div>
      </div>
      <div class="ic-offscreen" style="display:none"></div>

      <div class="ic-radar">
        <canvas width="316" height="316"></canvas>
        <div class="cap">SYNDICATE TRACK</div>
      </div>

      <div class="ic-warning" style="display:none"></div>
      <div class="ic-toasts"></div>
      <div class="ic-mousehint ic-hidden"><span class="ic-kbd">CLICK</span> canvas to look-steer · or hold <span class="ic-kbd">RMB</span> drag · <span class="ic-kbd">W</span> thrust <span class="ic-kbd">SPACE</span> up</div>
      <div class="ic-dmgflash"></div>
      <div class="ic-boostveil"></div>
      <div class="ic-speedlines"></div>
    `;
    document.body.appendChild(this.root);

    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.compassTrack = q('.ic-compass-track');
    this.compassWrap = q('.ic-compass');
    this.headingEl = q('.ic-heading');
    this.districtEl = q('.ic-district');
    this.timerEl = q('.ic-timer');
    this.objText = q('.ic-objective .txt');
    this.objBar = q('.ic-objective .bar i');
    this.energyArc = this.root.querySelectorAll('.ic-gauge.left circle')[1] as SVGCircleElement;
    this.integrityArc = this.root.querySelectorAll('.ic-gauge.right circle')[1] as SVGCircleElement;
    const gvals = this.root.querySelectorAll('.ic-gauge .value');
    this.energyVal = gvals[0] as HTMLDivElement;
    this.integrityVal = gvals[1] as HTMLDivElement;
    const readouts = this.root.querySelectorAll('.ic-readout .v');
    this.velVal = readouts[0] as HTMLDivElement;
    this.altVal = readouts[1] as HTMLDivElement;
    this.vsVal = readouts[2] as HTMLDivElement;
    this.boostVal = readouts[3] as HTMLDivElement;
    const chips = this.root.querySelectorAll('.ic-chip');
    this.stateChip = chips[0] as HTMLDivElement;
    this.inputChip = chips[1] as HTMLDivElement;
    this.gestureChip = chips[2] as HTMLDivElement;
    this.scoreChip = chips[3] as HTMLDivElement;
    this.reticle = q('.ic-reticle');
    this.reticleArc = this.reticle.querySelector('circle') as SVGCircleElement;
    this.lockBox = q('.ic-lock-box');
    this.lockMeta = q('.ic-lock-box .meta');
    this.lockHp = q('.ic-lock-box .hp i');
    this.offscreen = q('.ic-offscreen');
    this.toasts = q('.ic-toasts');
    this.mouseHint = q('.ic-mousehint');
    this.warning = q('.ic-warning');
    this.dmgFlash = q('.ic-dmgflash');
    this.boostVeil = q('.ic-boostveil');
    this.speedLines = q('.ic-speedlines');
    this.boundary = q('.ic-boundary');
    this.radar = q('.ic-radar canvas');
    this.radarCtx = this.radar.getContext('2d')!;

    this.buildCompass();
    this.buildSpeedLines();
  }

  private buildCompass(): void {
    let html = '';
    const labels: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let deg = 0; deg < 360; deg += 5) {
      const x = deg * PX_PER_DEG;
      const major = deg % 15 === 0;
      html += `<div class="ic-compass-tick${major ? ' major' : ''}" style="left:${x}px"></div>`;
      if (deg % 30 === 0) {
        const label = labels[deg] ?? String(deg).padStart(3, '0');
        html += `<div class="ic-compass-label" style="left:${x}px">${label}</div>`;
      }
    }
    html += `<div class="ic-compass-tick major" style="left:${GLOBAL_PX}px"></div>`;
    html += `<div class="ic-compass-label" style="left:${GLOBAL_PX}px">N</div>`;
    this.compassTrack.innerHTML = html;
  }

  private buildSpeedLines(): void {
    let html = '';
    for (let i = 0; i < 16; i++) {
      html += `<i style="transform:rotate(${(i / 16) * 360}deg) translateY(-14vh)"></i>`;
    }
    this.speedLines.innerHTML = html;
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('ic-hidden');
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('ic-hidden');
  }

  setGesturePreview(on: boolean): void {
    this.showGesturePreview = on;
    (this.root.querySelector('.ic-gesture-mini') as HTMLElement).style.display = on ? 'block' : 'none';
  }

  /** Shown until the player steers with the mouse (locked or right-drag). */
  setMouseHint(visible: boolean): void {
    const want = visible && this.visible;
    this.mouseHint.classList.toggle('ic-hidden', !want);
  }

  toast(message: string, kind: 'default' | 'gold' | 'red' = 'default', seconds = 3.2): void {
    const el = document.createElement('div');
    el.className = `ic-toast${kind === 'default' ? '' : ' ' + kind}`;
    el.textContent = message;
    this.toasts.appendChild(el);
    this.toastTimers.push({ el, t: seconds });
    while (this.toastTimers.length > 5) {
      const first = this.toastTimers.shift()!;
      first.el.remove();
    }
  }

  update(dt: number, s: HudState): void {
    if (!this.visible) return;
    const L = this.last;

    /* compass -------------------------------------------------------- */
    const heading = ((s.heading % 360) + 360) % 360;
    if (Math.abs(heading - L.heading) > 0.15) {
      L.heading = heading;
      const x = -heading * PX_PER_DEG + this.compassWrap.clientWidth / 2;
      this.compassTrack.style.transform = `translateX(${x.toFixed(1)}px)`;
      this.headingEl.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
    }
    if (s.district !== L.district) {
      L.district = s.district;
      this.districtEl.textContent = s.district;
    }

    /* objective + timer ---------------------------------------------- */
    if (s.objectiveText !== L.obj) {
      L.obj = s.objectiveText;
      this.objText.textContent = s.objectiveText;
    }
    if (Math.abs(s.objectiveProgress - L.objP) > 0.01) {
      L.objP = s.objectiveProgress;
      this.objBar.style.width = `${(s.objectiveProgress * 100).toFixed(1)}%`;
    }
    if (s.timer !== null) {
      const shown = Math.max(0, s.timer);
      if (Math.abs(shown - L.timer) > 0.05) {
        L.timer = shown;
        const m = Math.floor(shown / 60);
        const sec = Math.floor(shown % 60);
        this.timerEl.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
        this.timerEl.classList.toggle('warn', shown < 20);
      }
    } else if (L.timer !== -1) {
      L.timer = -1;
      this.timerEl.textContent = '';
    }

    /* readouts -------------------------------------------------------- */
    const kmh = s.speed * 3.6;
    if (Math.abs(kmh - L.speed) > 0.5) {
      L.speed = kmh;
      this.velVal.innerHTML = `${Math.round(kmh)}<small>KM/H</small>`;
    }
    if (Math.abs(s.altitude - L.alt) > 0.4) {
      L.alt = s.altitude;
      this.altVal.innerHTML = `${Math.round(s.altitude)}<small>M</small>`;
    }
    if (Math.abs(s.vertical - L.vs) > 0.2) {
      L.vs = s.vertical;
      this.vsVal.innerHTML = `${s.vertical >= 0 ? '+' : ''}${s.vertical.toFixed(1)}<small>M/S</small>`;
    }
    if (Math.abs(s.energy - L.energy) > 0.4) {
      L.energy = s.energy;
      const ratio = s.energy / s.maxEnergy;
      this.energyArc.setAttribute('stroke-dashoffset', String(415 * (1 - ratio)));
      this.energyVal.textContent = String(Math.round(s.energy));
      this.energyArc.setAttribute('stroke', ratio < 0.22 ? '#d5342a' : '#54f0ff');
    }
    if (Math.abs(s.integrity - L.integrity) > 0.4) {
      L.integrity = s.integrity;
      // live read: the ARMORY can raise/lower the integrity maximum per suit
      const ratio = s.integrity / Math.max(1, INTEGRITY.max);
      this.integrityArc.setAttribute('stroke-dashoffset', String(415 * (1 - ratio)));
      this.integrityVal.textContent = String(Math.round(s.integrity));
      this.integrityArc.setAttribute('stroke', ratio < 0.35 ? '#ff5040' : '#d5342a');
    }
    const boostPct = Math.round(s.boost * 100);
    if (Math.abs(boostPct - L.boost) > 1) {
      L.boost = boostPct;
      this.boostVal.innerHTML = `${boostPct}<small>%</small>`;
    }

    /* chips ---------------------------------------------------------- */
    if (s.flightState !== L.state) {
      L.state = s.flightState;
      this.stateChip.textContent = s.flightState;
      this.stateChip.className = `ic-chip${s.flightState === 'BOOST' || s.flightState === 'DIVE' ? '' : ' idle'}`;
    }
    const inputText = `INPUT ${s.inputMode.toUpperCase()}`;
    if (inputText !== L.input) {
      L.input = inputText;
      this.inputChip.textContent = inputText;
    }
    const gText = s.gestureOn ? s.gestureText : 'GESTURE STANDBY';
    if (gText !== L.gesture) {
      L.gesture = gText;
      this.gestureChip.textContent = gText;
      this.gestureChip.className = `ic-chip${s.gestureOn ? '' : ' idle'}`;
    }
    if (s.score !== L.score) {
      L.score = Math.round(s.score);
      this.scoreChip.textContent = `SCORE ${L.score}`;
    }

    /* lock-on -------------------------------------------------------- */
    this.reticle.classList.toggle('locked', s.lock.locked);
    const lockProgress = s.lock.active ? s.lock.progress : 0;
    this.reticleArc.setAttribute('stroke-dashoffset', String(264 * (1 - lockProgress)));
    this.reticleArc.setAttribute('stroke', s.lock.locked ? '#d5342a' : 'rgba(216,166,61,0.9)');

    if (s.lock.active && s.lock.onScreen) {
      if (this.lockBox.style.display !== 'block') this.lockBox.style.display = 'block';
      if (Math.abs(s.lock.screenX - L.lockX) > 1 || Math.abs(s.lock.screenY - L.lockY) > 1) {
        L.lockX = s.lock.screenX;
        L.lockY = s.lock.screenY;
        this.lockBox.style.transform = `translate3d(${s.lock.screenX.toFixed(1)}px, ${s.lock.screenY.toFixed(1)}px, 0)`;
      }
      if (s.lock.name !== L.lockName) {
        L.lockName = s.lock.name;
        this.lockMeta.textContent = `${s.lock.locked ? 'LOCKED' : 'ACQUIRING'} · ${s.lock.name} · ${Math.round(s.lock.distance)}M`;
      }
      if (Math.abs(s.lock.hpRatio - L.hp) > 0.02) {
        L.hp = s.lock.hpRatio;
        this.lockHp.style.width = `${(s.lock.hpRatio * 100).toFixed(0)}%`;
      }
      this.lockBox.classList.toggle('locking', !s.lock.locked);
    } else {
      if (this.lockBox.style.display !== 'none') this.lockBox.style.display = 'none';
    }

    if (s.lock.active && !s.lock.onScreen) {
      this.offscreen.style.display = 'block';
      const r = Math.min(innerWidth, innerHeight) * 0.33;
      const a = s.lock.offscreenAngle;
      this.offscreen.style.transform = `translate3d(${(innerWidth / 2 + Math.cos(a) * r).toFixed(1)}px, ${(innerHeight / 2 + Math.sin(a) * r).toFixed(1)}px, 0) rotate(45deg)`;
    } else if (this.offscreen.style.display !== 'none') {
      this.offscreen.style.display = 'none';
    }

    /* warnings + damage ---------------------------------------------- */
    if (s.warning !== L.warning) {
      L.warning = s.warning;
      if (s.warning) {
        this.warning.style.display = 'block';
        this.warning.textContent = s.warning;
      } else {
        this.warning.style.display = 'none';
      }
    }
    const dmg = Math.max(s.damaged, 0);
    if (Math.abs(dmg - L.dmg) > 0.02) {
      L.dmg = dmg;
      this.dmgFlash.style.opacity = String(Math.min(0.85, dmg));
    }
    if (Math.abs(s.boosting - L.boostVeil) > 0.03) {
      L.boostVeil = s.boosting;
      this.boostVeil.style.opacity = String(Math.min(0.85, s.boosting * 0.5));
    }
    const lines = Math.max(s.boosting, Math.max(0, s.speedNorm - 0.45) * 1.6);
    if (Math.abs(lines - L.lines) > 0.04) {
      L.lines = lines;
      this.speedLines.style.opacity = String(Math.min(0.6, lines * 0.5));
    }
    const boundaryOn = s.boundary || s.water;
    if (boundaryOn !== L.boundary) {
      L.boundary = boundaryOn;
      this.boundary.classList.toggle('on', boundaryOn);
    }

    /* toasts --------------------------------------------------------- */
    for (let i = this.toastTimers.length - 1; i >= 0; i--) {
      const t = this.toastTimers[i];
      t.t -= dt;
      if (t.t <= 0) {
        t.el.style.animation = 'ic-toast-out .26s ease forwards';
        setTimeout(() => t.el.remove(), 280);
        this.toastTimers.splice(i, 1);
      }
    }

    this.drawRadar(dt, s);
  }

  private drawRadar(dt: number, s: HudState): void {
    const ctx = this.radarCtx;
    const size = this.radar.width;
    const c = size / 2;
    const range = 720;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.translate(c, c);
    // frame
    ctx.strokeStyle = 'rgba(143,154,168,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, c - 3, 0, Math.PI * 2);
    ctx.stroke();
    for (const r of [0.35, 0.7]) {
      ctx.beginPath();
      ctx.arc(0, 0, (c - 3) * r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(84,240,255,0.16)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-c, 0); ctx.lineTo(c, 0);
    ctx.moveTo(0, -c); ctx.lineTo(0, c);
    ctx.strokeStyle = 'rgba(84,240,255,0.12)';
    ctx.stroke();

    // heading-up rotation: rotate the world by -heading
    const headingRad = (s.heading * Math.PI) / 180;
    ctx.rotate(-headingRad);

    // sweep
    this.radarSweep = (this.radarSweep + dt * 2.4) % (Math.PI * 2);
    const grad = ctx.createLinearGradient(0, 0, Math.cos(this.radarSweep) * c, Math.sin(this.radarSweep) * c);
    grad.addColorStop(0, 'rgba(84,240,255,0.35)');
    grad.addColorStop(1, 'rgba(84,240,255,0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(this.radarSweep) * c, Math.sin(this.radarSweep) * c);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.stroke();

    const scale = (c - 6) / range;
    for (const b of s.blips) {
      const dx = (b.x - s.heroX) * scale;
      const dz = (b.z - s.heroZ) * scale;
      const d = Math.hypot(dx, dz);
      if (d > c - 6) continue;
      if (b.kind === 'enemy') {
        ctx.fillStyle = '#ff5a3c';
        ctx.beginPath();
        ctx.arc(dx, dz, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,60,0.4)';
        ctx.beginPath();
        ctx.arc(dx, dz, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === 'waypoint') {
        ctx.fillStyle = '#d8a63d';
        ctx.beginPath();
        ctx.moveTo(dx, dz - 7);
        ctx.lineTo(dx + 7, dz + 4);
        ctx.lineTo(dx - 7, dz + 4);
        ctx.closePath();
        ctx.fill();
      } else if (b.kind === 'tower') {
        ctx.strokeStyle = '#54f0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(dx - 5, dz - 5, 10, 10);
      }
    }
    ctx.restore();

    // hero marker (always centred, pointing up)
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.moveTo(c, c - 9);
    ctx.lineTo(c + 6, c + 7);
    ctx.lineTo(c - 6, c + 7);
    ctx.closePath();
    ctx.fill();
  }

  /** Draw the webcam + landmarks into the mini preview canvas. */
  drawGesturePreview(telemetry: GestureTelemetry, video: HTMLVideoElement | null, hands: { landmarks: { x: number; y: number }[] }[]): void {
    const canvas = this.root.querySelector('.ic-gesture-mini canvas') as HTMLCanvasElement;
    const label = this.root.querySelector('.ic-gesture-mini .g') as HTMLElement;
    if (!this.showGesturePreview || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    if (video && video.readyState >= 2) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#04121a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();

    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
    ];
    for (const hand of hands) {
      const lm = hand.landmarks;
      ctx.strokeStyle = 'rgba(84,240,255,0.85)';
      ctx.lineWidth = 2;
      for (const [a, b] of edges) {
        if (!lm[a] || !lm[b]) continue;
        ctx.beginPath();
        ctx.moveTo((1 - lm[a].x) * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo((1 - lm[b].x) * canvas.width, lm[b].y * canvas.height);
        ctx.stroke();
      }
      ctx.fillStyle = '#d8a63d';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    label.textContent = telemetry.handFound
      ? `${telemetry.hands} HAND${telemetry.hands > 1 ? 'S' : ''} · ${Math.round(telemetry.confidence * 100)}%`
      : telemetry.camera === 'on' ? 'NO HAND IN FRAME' : telemetry.camera.toUpperCase();
  }
}
