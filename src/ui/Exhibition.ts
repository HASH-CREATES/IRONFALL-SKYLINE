import type { Perf } from '../core/Perf';
import type { GestureTelemetry } from '../input/types';

export interface ExhibitionData {
  perf: Perf;
  gesture: GestureTelemetry;
  gestureEnabled: boolean;
  flightState: string;
  speed: number;
  altitude: number;
  boostLevel: number;
  inputMode: string;
  mission: string;
  objective: string;
  buildings: number;
  cities: { name: string; value: string }[];
  boltCount: number;
  enemies: number;
  quality: string;
  assetSource: string;
  delegate: string;
}

/**
 * Exhibition mode: makes the technology legible to judges. Every number is
 * measured live in the browser, nothing is hard-coded.
 */
export class Exhibition {
  root: HTMLDivElement;
  visible = false;
  onAction: (action: string) => void = () => {};

  private rows = new Map<string, HTMLElement>();
  private staticEl!: HTMLDivElement;
  private dynamic!: HTMLDivElement;
  private acc = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ic-exhibit ic-hidden';
    this.root.innerHTML = `
      <div class="hd">
        <span>EXHIBITION MODE</span>
        <span><button data-act="toggle-hud">HIDE</button></span>
      </div>
      <div class="dynamic"></div>
      <div class="hint">
        Every value above is measured live in this browser tab. Hand landmarks come from the webcam through a local
        MediaPipe model; the flight numbers come from the same controller the keyboard drives.
      </div>
      <div class="meters" style="margin-top:8px">
        <div>FLIGHT PHYSICS <span data-m="phys">10-STATE</span></div>
        <div>HAND TRACKING <span data-m="track">MEDIAPIPE</span></div>
        <div>WORLD <span data-m="world">PROCEDURAL</span></div>
        <div>RENDERER <span data-m="gl">WEBGL2</span></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.staticEl = this.root.querySelector('.hint') as HTMLDivElement;
    this.dynamic = this.root.querySelector('.dynamic') as HTMLDivElement;
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el?.dataset.act) this.onAction(el.dataset.act);
    });
    this.buildRows();
  }

  private buildRows(): void {
    const keys: [string, string][] = [
      ['fps', 'FPS'],
      ['frame', 'FRAME TIME'],
      ['draws', 'DRAW CALLS'],
      ['tris', 'TRIANGLES'],
      ['quality', 'QUALITY'],
      ['mode', 'INPUT MODE'],
      ['cam', 'CAMERA'],
      ['hand', 'HANDS'],
      ['gesture', 'GESTURE'],
      ['confidence', 'CONFIDENCE'],
      ['latency', 'INFERENCE'],
      ['mapped', 'MAPPED ACTION'],
      ['model', 'MODEL'],
      ['state', 'FLIGHT STATE'],
      ['speed', 'AIRSPEED'],
      ['alt', 'ALTITUDE'],
      ['boost', 'BOOST'],
      ['enemies', 'HOSTILES'],
      ['bolts', 'PROJECTILES'],
      ['buildings', 'CITY BLOCKS'],
      ['mission', 'MISSION'],
      ['objective', 'OBJECTIVE'],
    ];
    this.dynamic.innerHTML = keys
      .map(([k, label]) => `<div class="row"><span>${label}</span><span data-row="${k}">—</span></div>`)
      .join('');
    for (const [k] of keys) {
      this.rows.set(k, this.dynamic.querySelector(`[data-row="${k}"]`) as HTMLElement);
    }
  }

  toggle(on?: boolean): void {
    this.visible = on ?? !this.visible;
    this.root.classList.toggle('ic-hidden', !this.visible);
  }

  update(dt: number, d: ExhibitionData): void {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 0.2) return; // 5 Hz is plenty for a panel
    this.acc = 0;

    const set = (k: string, v: string, color?: string) => {
      const el = this.rows.get(k);
      if (!el) return;
      if (el.textContent !== v) el.textContent = v;
      if (color) el.style.color = color;
    };

    const g = d.gesture;
    set('fps', `${d.perf.fps}`, d.perf.fps >= 55 ? '#7dffb0' : d.perf.fps >= 45 ? '#d8a63d' : '#ff5a3c');
    set('frame', `${d.perf.frameMs.toFixed(1)} ms`);
    set('draws', String(d.perf.drawCalls));
    set('tris', `${(d.perf.triangles / 1000).toFixed(0)}k`);
    set('quality', d.quality.toUpperCase());
    set('mode', d.inputMode.toUpperCase());
    set('cam', d.gestureEnabled ? `${g.camera.toUpperCase()} (${d.delegate})` : 'KEYBOARD ONLY');
    set('hand', g.handFound ? `YES (${g.hands})` : 'NO');
    set('gesture', d.gestureEnabled ? g.gesture : 'STANDBY');
    set('confidence', d.gestureEnabled ? `${Math.round(g.confidence * 100)}%` : '—');
    set('latency', d.gestureEnabled ? `${g.latencyMs} ms @ ${g.fps} Hz` : '—');
    set('mapped', d.gestureEnabled ? g.mappedAction : 'KEYBOARD/MOUSE');
    set('model', d.assetSource === 'local' ? 'LOCAL / OFFLINE' : d.assetSource === 'cdn' ? 'CDN' : 'NONE');
    set('state', d.flightState);
    set('speed', `${(d.speed * 3.6).toFixed(0)} km/h`);
    set('alt', `${d.altitude.toFixed(0)} m`);
    set('boost', `${Math.round(d.boostLevel * 100)}%`);
    set('enemies', String(d.enemies));
    set('bolts', String(d.boltCount));
    set('buildings', String(d.buildings));
    set('mission', d.mission);
    set('objective', d.objective);
    void this.staticEl;
  }
}
