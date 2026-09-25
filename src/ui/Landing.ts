import { MISSIONS } from '../gameplay/Missions';
import { Run } from '../gameplay/Run';
import { HeroStage } from './HeroStage';

/**
 * Cinematic landing page: a live 3D city renders behind this DOM layer, which
 * adds the armored-OS interface, parallax, boot sequence and mission select.
 */
export class Landing {
  root: HTMLDivElement;
  loading: HTMLDivElement;
  private loadFill: HTMLDivElement;
  private loadText: HTMLDivElement;
  private missionGrid: HTMLDivElement;
  private center: HTMLDivElement;
  private selectRow: HTMLDivElement;
  private parallaxEls: HTMLElement[] = [];
  private settleTimer = 0;
  private stage: HeroStage;
  visible = false;
  onAction: (action: string, payload?: string) => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ic-landing ic-hidden';
    this.root.innerHTML = `
      <div class="ic-brand-row" data-fu style="--i:0">
        <div class="ic-brand">
          <div class="ic-mark"></div>
          <div class="ic-brand-name">IRONFALL<span>Collection of Flight</span></div>
        </div>
        <nav class="ic-nav">
          <button class="ic-nav-link" data-act="armory">Armory</button>
          <button class="ic-nav-link" data-act="technology">Technology</button>
          <button class="ic-nav-link" data-act="settings">Settings</button>
        </nav>
      </div>

      <div class="ic-center">
        <div class="il-copy">
          <div class="ic-subtitle" data-p="1" data-fu style="--i:2">NEW YORK-CLASS AIRSPACE // SECTOR 7</div>
          <h1 class="il-headline" data-p="2" data-fu style="--i:3">The skyline<br/><em>is yours.</em></h1>
          <p class="ic-tagline" data-p="1" data-fu style="--i:4">
            The last pilot of the MK-1 frame. A living metropolis at repulsor speed.
            The Null Syndicate is already in the air.
          </p>
          <span class="il-tag-rule" data-fu style="--i:4"></span>
          <div class="il-cta" data-p="3" data-fu style="--i:5">
            <button class="il-enter" data-act="start-mission">Enter the Skyline</button>
            <button class="il-free" data-act="free-flight">Free Flight</button>
          </div>
        </div>

        <div class="ic-select-row" style="display:none;width:100%">
          <div class="ic-hudline"></div>
          <div style="font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--accent-amber);margin-bottom:10px">
            SELECT MISSION PROFILE
          </div>
          <div class="ic-missions"></div>
          <div style="margin-top:12px"><button class="ic-btn small ghost" data-act="close-select">Back</button></div>
        </div>
      </div>

      <div class="ic-modes" data-fu style="--i:8">
        <button class="ic-mode primary" data-act="start-mission"><span class="idx">01</span><span class="lbl">Start Mission</span><span class="sub">6 PROFILES</span></button>
        <button class="ic-mode" data-act="free-flight"><span class="idx">02</span><span class="lbl">Free Flight</span><span class="sub">OPEN CITY</span></button>
        <button class="ic-mode" data-act="armory"><span class="idx">03</span><span class="lbl">Armory</span><span class="sub">4 FRAMES</span></button>
        <button class="ic-mode" data-act="gesture-flight"><span class="idx">04</span><span class="lbl">Gesture Flight</span><span class="sub">WEBCAM</span></button>
        <button class="ic-mode" data-act="controls"><span class="idx">05</span><span class="lbl">Controls</span><span class="sub">INPUT MAP</span></button>
        <button class="ic-mode" data-act="technology"><span class="idx">06</span><span class="lbl">Technology</span><span class="sub">WEBGL2</span></button>
        <button class="ic-mode" data-act="settings"><span class="idx">07</span><span class="lbl">Settings</span><span class="sub">QUALITY · INPUT</span></button>
      </div>
    `;
    document.body.appendChild(this.root);

    // the framed 3D hero stage (Iron Man model, outline type, brackets)
    this.stage = new HeroStage();
    this.stage.resizeObserver();
    document.body.appendChild(this.stage.root);

    this.center = this.root.querySelector('.ic-center') as HTMLDivElement;
    this.missionGrid = this.root.querySelector('.ic-missions') as HTMLDivElement;
    this.selectRow = this.root.querySelector('.ic-select-row') as HTMLDivElement;
    this.parallaxEls = Array.from(this.root.querySelectorAll('[data-p]')) as HTMLElement[];

    this.loading = document.createElement('div');
    this.loading.className = 'ic-loading';
    this.loading.innerHTML = `
      <div class="ring"></div>
      <div class="ic-kicker">IRONFALL // SKYLINE</div>
      <div class="ic-load-bar"><div class="ic-load-fill"></div></div>
      <div class="ic-load-text">INITIALISING</div>
    `;
    document.body.appendChild(this.loading);
    this.loadFill = this.loading.querySelector('.ic-load-fill') as HTMLDivElement;
    this.loadText = this.loading.querySelector('.ic-load-text') as HTMLDivElement;

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el?.dataset.act) this.onAction(el.dataset.act);
    });
    window.addEventListener('mousemove', (e) => {
      const nx = e.clientX / innerWidth - 0.5;
      const ny = e.clientY / innerHeight - 0.5;
      this.parallax(nx, ny);
      this.stage.parallax(nx, ny);
    });

    this.buildMissionGrid();
  }

  private buildMissionGrid(): void {
    this.missionGrid.innerHTML = MISSIONS.map((m) => {
      const best = Run.bestFor(m.id);
      return `
        <div class="ic-mission" data-act="mission" data-mission="${m.id}">
          <div class="n">PROFILE ${String(m.index + 1).padStart(2, '0')}</div>
          <div class="t">${m.name}</div>
          <div class="d">${m.subtitle} — ${m.brief[0]}</div>
          ${best > 0 ? `<div class="best">BEST ${best}</div>` : `<div class="best">NOT FLOWN</div>`}
        </div>`;
    }).join('');
    this.missionGrid.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-mission]') as HTMLElement | null;
      if (el?.dataset.mission) this.onAction('mission', el.dataset.mission);
    });
  }

  private parallax(nx: number, ny: number): void {
    if (!this.visible) return;
    for (const el of this.parallaxEls) {
      if (!el.classList.contains('ic-settled')) continue; // entrance animation owns the transform
      const depth = Number(el.dataset.p ?? 1) * 5;
      el.style.transform = `translate3d(${(-nx * depth).toFixed(2)}px, ${(-ny * depth * 0.6).toFixed(2)}px, 0)`;
    }
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('ic-hidden');
    this.stage.show();
    this.loading.classList.add('ic-hidden');
    this.buildMissionGrid();
    // re-trigger the staggered entrance, then hand transform control back to
    // the parallax loop once every element has finished rising in
    for (const el of this.parallaxEls) {
      el.classList.remove('ic-settled');
      void (el as HTMLElement).offsetWidth; // restart CSS animation
    }
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      for (const el of this.parallaxEls) el.classList.add('ic-settled');
    }, 1700);
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('ic-hidden');
    this.stage.hide();
  }

  showMissionSelect(show: boolean): void {
    this.selectRow.style.display = show ? 'block' : 'none';
    this.root.classList.toggle('selecting', show);
  }

  setLoading(pct: number, text: string): void {
    this.loadFill.style.right = `${(100 - Math.max(0, Math.min(100, pct))).toFixed(1)}%`;
    this.loadText.textContent = text;
  }

  hideLoading(): void {
    this.loading.classList.add('ic-hidden');
  }

  setStamp(text: string): void {
    const el = this.root.querySelector('#ic-build-stamp');
    if (el) el.textContent = text;
  }
}
