import type { QualityLevel } from '../config';
import type { Mission } from '../gameplay/Missions';
import type { RunSummary } from '../gameplay/Run';

export interface GameSettings {
  quality: QualityLevel | 'auto';
  resolutionScale: number;   // 0.6 .. 2.0
  fov: number;               // 55 .. 88
  mouseSens: number;         // 0.4 .. 2.6
  invertY: boolean;
  cameraShake: boolean;
  nightMix: number;          // 0 .. 1
  volume: number;
  music: number;
  mute: boolean;
  gestureSens: number;       // 0.5 .. 1.8
  gesturePreview: boolean;
  showExhibition: boolean;
}

export const defaultSettings = (): GameSettings => ({
  quality: 'auto',
  resolutionScale: 1,
  fov: 68,
  mouseSens: 1,
  invertY: false,
  cameraShake: true,
  nightMix: 0.3,
  volume: 0.42,
  music: 0.34,
  mute: false,
  gestureSens: 1,
  gesturePreview: true,
  showExhibition: false,
});

const KEY = 'IRONFALL.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage may be unavailable */ }
}

export type OverlayKind = 'brief' | 'pause' | 'result' | 'controls' | 'technology' | 'settings';

/** Panel overlays. One DOM node, re-rendered per screen, plus live settings. */
export class Overlays {
  root: HTMLDivElement;
  open = false;
  kind: OverlayKind | null = null;
  settings: GameSettings;
  onAction: (action: string, payload?: string) => void = () => {};
  private data: { mission?: Mission; summary?: RunSummary; failReason?: string } = {};

  constructor(settings: GameSettings) {
    this.settings = settings;
    this.root = document.createElement('div');
    this.root.className = 'ic-overlay ic-hidden';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el?.dataset.act) {
        this.onAction(el.dataset.act, el.dataset.value);
      }
    });
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      const key = el.dataset.set as keyof GameSettings | undefined;
      if (!key) return;
      if (el instanceof HTMLInputElement && el.type === 'range') {
        const value = Number(el.value);
        (this.settings[key] as number) = key === 'resolutionScale' ? value / 100 : value;
      } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        (this.settings[key] as boolean) = el.checked;
      } else if (el instanceof HTMLSelectElement) {
        (this.settings[key] as string) = el.value;
      }
      this.onAction('settings-changed');
      const out = this.root.querySelector(`[data-out="${key}"]`);
      if (out) {
        const value = this.settings[key];
        out.textContent = typeof value === 'number'
          ? (key === 'resolutionScale' ? `${Math.round(value * 100)}%` : String(Math.round(value * 100) / 100))
          : String(value).toUpperCase();
      }
    });
  }

  show(kind: OverlayKind, data?: { mission?: Mission; summary?: RunSummary; failReason?: string }): void {
    this.kind = kind;
    this.open = true;
    if (data) this.data = data;
    this.root.innerHTML = `<div class="ic-panel">${this.render(kind)}</div>`;
    this.root.classList.remove('ic-hidden');
  }

  hide(): void {
    this.open = false;
    this.kind = null;
    this.root.classList.add('ic-hidden');
  }

  private render(kind: OverlayKind): string {
    switch (kind) {
      case 'brief': return this.renderBrief();
      case 'pause': return this.renderPause();
      case 'result': return this.renderResult();
      case 'controls': return this.renderControls();
      case 'technology': return this.renderTechnology();
      case 'settings': return this.renderSettings();
      default: return '';
    }
  }

  private renderBrief(): string {
    const m = this.data.mission;
    if (!m) return '';
    return `
      <div class="sub">MISSION PROFILE ${String(m.index + 1).padStart(2, '0')}</div>
      <h2>${m.name}</h2>
      <div style="font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--titan);margin-top:6px">${m.subtitle}</div>
      <h3>Situation</h3>
      <ul>${m.brief.map((b) => `<li>${b}</li>`).join('')}</ul>
      ${m.timeLimit ? `<p><b style="color:var(--gold)">TIME LIMIT ${Math.floor(m.timeLimit / 60)}:${String(m.timeLimit % 60).padStart(2, '0')}</b></p>` : ''}
      <h3>Objectives</h3>
      <ul>${m.objectives.length ? m.objectives.map((o) => `<li>${o.text}</li>`).join('') : '<li>No objectives — the city is yours.</li>'}</ul>
      <div class="actions">
        <button class="ic-btn primary" data-act="launch">Launch</button>
        <button class="ic-btn ghost" data-act="back-landing">Back</button>
      </div>
    `;
  }

  private renderPause(): string {
    return `
      <div class="sub">SYSTEM HOLD</div>
      <h2>PAUSED</h2>
      <p>Flight physics suspended. The city keeps its traffic running behind you.</p>
      <div class="actions">
        <button class="ic-btn primary" data-act="resume">Resume</button>
        <button class="ic-btn" data-act="restart">Restart Mission</button>
        <button class="ic-btn ghost" data-act="controls">Controls</button>
        <button class="ic-btn ghost" data-act="settings">Settings</button>
        <button class="ic-btn ghost" data-act="back-landing">Abort to Landing</button>
      </div>
    `;
  }

  private renderResult(): string {
    const s = this.data.summary;
    if (!s) return '';
    const failed = !s.completed;
    return `
      <div class="sub">${failed ? 'MISSION FAILED' : 'MISSION COMPLETE'}</div>
      <h2>${this.data.failReason ?? s.mission}</h2>
      <p>${failed ? 'The suit survived — the objective did not. Re-arm and go again.' : 'Suit integrity held. Flight record archived to the MK-1 log.'}</p>
      <div class="stats">
        <div class="ic-stat"><div class="k">SCORE</div><div class="v">${s.score}</div></div>
        <div class="ic-stat"><div class="k">BEST</div><div class="v">${s.best}</div></div>
        <div class="ic-stat"><div class="k">DRONES DISABLED</div><div class="v">${s.kills}</div></div>
        <div class="ic-stat"><div class="k">DISTANCE</div><div class="v">${s.distanceKm.toFixed(2)} km</div></div>
        <div class="ic-stat"><div class="k">TOP SPEED</div><div class="v">${Math.round(s.topSpeed * 3.6)} km/h</div></div>
        <div class="ic-stat"><div class="k">PEAK ALTITUDE</div><div class="v">${Math.round(s.peakAltitude)} m</div></div>
        <div class="ic-stat"><div class="k">FLIGHT TIME</div><div class="v">${s.timeSeconds.toFixed(1)} s</div></div>
        <div class="ic-stat"><div class="k">IMPACTS</div><div class="v">${s.crashes}</div></div>
      </div>
      <div class="actions">
        <button class="ic-btn primary" data-act="restart">Fly Again</button>
        <button class="ic-btn" data-act="free-flight">Free Flight</button>
        <button class="ic-btn ghost" data-act="back-landing">Landing</button>
      </div>
    `;
  }

  private renderControls(): string {
    return `
      <div class="sub">CONTROL SCHEME</div>
      <h2>CONTROLS</h2>
      <h3>Flight</h3>
      <div class="ic-keys">
        <div><span class="ic-kbd">W</span> thrust / <span class="ic-kbd">S</span> reverse</div>
        <div><span class="ic-kbd">A</span><span class="ic-kbd">D</span> lateral repulsors</div>
        <div><span class="ic-kbd">MOUSE</span> click canvas to lock · or hold <span class="ic-kbd">RMB</span> drag to steer</div>
        <div><span class="ic-kbd">↑</span><span class="ic-kbd">↓</span> / <span class="ic-kbd">←</span><span class="ic-kbd">→</span> pitch + turn</div>
        <div><span class="ic-kbd">Q</span><span class="ic-kbd">E</span> roll</div>
        <div><span class="ic-kbd">SPACE</span> take off / climb</div>
        <div><span class="ic-kbd">C</span> descend</div>
        <div><span class="ic-kbd">SHIFT</span> boost</div>
        <div><span class="ic-kbd">X</span> brake</div>
        <div><span class="ic-kbd">Z</span> auto-level assist</div>
      </div>
      <h3>Combat</h3>
      <div class="ic-keys">
        <div><span class="ic-kbd">LMB</span> repulsor pulse</div>
        <div><span class="ic-kbd">TAB</span> cycle target</div>
        <div><span class="ic-kbd">F</span> chest unibeam</div>
        <div><span class="ic-kbd">G</span> / <span class="ic-kbd">R</span> EMP pulse</div>
      </div>
      <h3>System</h3>
      <div class="ic-keys">
        <div><span class="ic-kbd">P</span> / <span class="ic-kbd">ESC</span> pause</div>
        <div><span class="ic-kbd">V</span> toggle gesture control</div>
        <div><span class="ic-kbd">H</span> toggle HUD</div>
        <div><span class="ic-kbd">T</span> exhibition tech panel</div>
        <div><span class="ic-kbd">M</span> mute</div>
        <div><span class="ic-kbd">BACKSPACE</span> reset to launch pad</div>
      </div>
      <h3>Gesture (webcam)</h3>
      <div class="ic-keys">
        <div><b>OPEN PALM</b> cruise thrust, hand steers</div>
        <div><b>FIST</b> brake, then hold station</div>
        <div><b>POINT</b> lock target, hold to fire</div>
        <div><b>TWO OPEN HANDS</b> boost</div>
        <div><b>TWO FISTS SPREAD</b> EMP pulse</div>
        <div><b>NO HANDS</b> safe hover assist</div>
      </div>
      <p class="ic-note">Keyboard always works, in every mode. Gesture input feeds the exact same flight controller.</p>
      <div class="actions"><button class="ic-btn primary" data-act="close-controls">Close</button></div>
    `;
  }

  private renderTechnology(): string {
    return `
      <div class="sub">UNDER THE HOOD</div>
      <h2>TECHNOLOGY</h2>
      <h3>Flight model</h3>
      <p>A custom 10-state body-oriented controller. Thrust acts along the suit axis, repulsor lift cancels gravity in
      proportion to airspeed, and drag is anisotropic — light on the flight axis, heavy laterally. That combination is
      why the suit keeps momentum through a dive yet still turns on a coin.</p>
      <h3>City</h3>
      <p>A procedural metropolis: eight districts, over a thousand instanced towers drawn with a custom window shader,
      animated traffic, elevated highways, bridges and a waterfront. Everything is generated at load — no downloaded assets.</p>
      <h3>Gesture pipeline</h3>
      <p>Webcam → MediaPipe HandLandmarker (vendored WASM + model, runs offline) → 21 landmarks per hand → feature
      extraction → debounced gesture state → unified input schema → the same flight controller. Gestures never get their
      own physics and can never take control away: losing your hand hands you back to a safe hover.</p>
      <h3>Rendering</h3>
      <p>WebGL2 via three.js, ACES tone mapping, restrained bloom, custom sky/cloud/water shaders, pooled GPU particles,
      adaptive pixel ratio and quality tiers driven by measured frame time.</p>
      <div class="actions"><button class="ic-btn primary" data-act="close-technology">Close</button></div>
    `;
  }

  private renderSettings(): string {
    const s = this.settings;
    const qualityBtns = (['auto', 'low', 'medium', 'high'] as const)
      .map((q) => `<button data-act="set-quality" data-value="${q}" class="${s.quality === q ? 'on' : ''}">${q.toUpperCase()}</button>`)
      .join('');
    return `
      <div class="sub">SUIT CONFIGURATION</div>
      <h2>SETTINGS</h2>
      <div class="ic-row"><label>QUALITY TIER</label><div class="ic-switch">${qualityBtns}</div></div>
      <div class="ic-row"><label>RENDER SCALE</label>
        <div><input type="range" min="60" max="200" value="${Math.round(s.resolutionScale * 100)}" data-set="resolutionScale"> <span data-out="resolutionScale">${Math.round(s.resolutionScale * 100)}%</span></div></div>
      <div class="ic-row"><label>CAMERA FOV</label>
        <div><input type="range" min="55" max="88" value="${s.fov}" data-set="fov"> <span data-out="fov">${s.fov}</span></div></div>
      <div class="ic-row"><label>MOUSE SENSITIVITY</label>
        <div><input type="range" min="40" max="260" value="${Math.round(s.mouseSens * 100)}" data-set="mouseSens"> <span data-out="mouseSens">${s.mouseSens.toFixed(2)}</span></div></div>
      <div class="ic-row"><label>INVERT PITCH</label>
        <div class="ic-switch">
          <button data-act="toggle-invert" class="${s.invertY ? 'on' : ''}">${s.invertY ? 'ON' : 'OFF'}</button>
        </div></div>
      <div class="ic-row"><label>CAMERA SHAKE</label>
        <div class="ic-switch"><button data-act="toggle-shake" class="${s.cameraShake ? 'on' : ''}">${s.cameraShake ? 'ON' : 'OFF'}</button></div></div>
      <div class="ic-row"><label>TIME OF DAY</label>
        <div><input type="range" min="0" max="100" value="${Math.round(s.nightMix * 100)}" data-set="nightMix"> <span data-out="nightMix">${s.nightMix.toFixed(2)}</span></div></div>
      <div class="ic-row"><label>MASTER VOLUME</label>
        <div><input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-set="volume"> <span data-out="volume">${s.volume.toFixed(2)}</span></div></div>
      <div class="ic-row"><label>MUSIC</label>
        <div><input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-set="music"> <span data-out="music">${s.music.toFixed(2)}</span></div></div>
      <div class="ic-row"><label>MUTE</label>
        <div class="ic-switch"><button data-act="toggle-mute" class="${s.mute ? 'on' : ''}">${s.mute ? 'MUTED' : 'SOUND ON'}</button></div></div>
      <div class="ic-row"><label>GESTURE SENSITIVITY</label>
        <div><input type="range" min="50" max="180" value="${Math.round(s.gestureSens * 100)}" data-set="gestureSens"> <span data-out="gestureSens">${s.gestureSens.toFixed(2)}</span></div></div>
      <div class="ic-row"><label>GESTURE PREVIEW</label>
        <div class="ic-switch"><button data-act="toggle-preview" class="${s.gesturePreview ? 'on' : ''}">${s.gesturePreview ? 'ON' : 'OFF'}</button></div></div>
      <div class="ic-row"><label>EXHIBITION PANEL</label>
        <div class="ic-switch"><button data-act="toggle-exhibition" class="${s.showExhibition ? 'on' : ''}">${s.showExhibition ? 'ON' : 'OFF'}</button></div></div>
      <div class="actions">
        <button class="ic-btn primary" data-act="close-settings">Apply &amp; Close</button>
        <button class="ic-btn ghost" data-act="reset-settings">Reset Defaults</button>
      </div>
    `;
  }
}
