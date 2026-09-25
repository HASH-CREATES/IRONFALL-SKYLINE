import * as THREE from 'three';
import { CAMERA, ENERGY, FLIGHT, FLIGHT as FL, INTEGRITY, PERF, type PhaseName, type QualityLevel } from '../config';
import { clamp, damp } from '../util/Rng';
import { City } from '../world/City';
import { ArmoredHero } from '../player/ArmoredHero';
import { FlightController } from '../player/FlightController';
import { Effects } from '../fx/Effects';
import { EnemyManager } from '../enemies/Enemies';
import { Combat } from '../gameplay/Combat';
import { MissionRunner, MISSIONS, type Mission } from '../gameplay/Missions';
import { Run } from '../gameplay/Run';
import { Audio } from '../audio/Audio';
import { KeyboardMouse } from '../input/KeyboardMouse';
import { GestureInput } from '../input/GestureInput';
import { UnifiedInput } from '../input/Unified';
import { FlightCamera } from './FlightCamera';
import { Armory } from '../ui/Armory';
import { applySuit, persistSuitId, suitById, savedSuitId } from '../player/Suit';
import { Environment } from './Environment';
import { Perf } from './Perf';
import { Landing } from '../ui/Landing';
import { HUD, type HudLock, type HudRadarBlip, type HudState } from '../ui/HUD';
import { Calibration } from '../ui/Calibration';
import { Exhibition } from '../ui/Exhibition';
import { Overlays, loadSettings, saveSettings, type GameSettings } from '../ui/Overlays';

const V = {
  fwd: new THREE.Vector3(),
  ndc: new THREE.Vector3(),
  tmp: new THREE.Vector3(),
  tmp2: new THREE.Vector3(),
};

export class Game {
  /* core */
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig: FlightCamera;
  env: Environment;
  perf: Perf;

  /* world */
  city: City;
  hero: ArmoredHero;
  heroRoot = new THREE.Group();
  controller: FlightController;
  fx: Effects;
  enemies: EnemyManager;

  /* gameplay */
  combat: Combat;
  missions: MissionRunner;
  run = new Run();

  /* io */
  audio = new Audio();
  keys: KeyboardMouse;
  gesture = new GestureInput();
  input: UnifiedInput;

  /* ui */
  settings: GameSettings;
  landing: Landing;
  hud: HUD;
  overlays: Overlays;
  calibration: Calibration;
  exhibition: Exhibition;
  armory: Armory;
  /** Currently equipped suit frame; drives hero palette + gameplay mods. */
  suitId = savedSuitId();

  /* state */
  phase: PhaseName = 'boot';
  hudVisible = true;
  private last = 0;
  private accumulator = 0;
  private elapsed = 0;
  private cinematicTime = 0;
  private damageFlash = 0;
  private lastDistance = new THREE.Vector3();
  private activeMission: Mission = MISSIONS[0];
  private benchmark = { active: false, timer: 0, frames: 0, timeSum: 0, result: '' };
  private waterTimer = 0;
  private groundToastCooldown = 0;
  private warnedLowEnergy = false;
  private warnedCeiling = false;
  /** One-shot mouse-steer coach mark state. */
  private mouseHintDone = false;

  constructor() {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      // shadow map type is selected in Environment (VSM when available)
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.domElement.className = 'ic-gl';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app')?.appendChild(this.renderer.domElement);

    this.perf = new Perf(this.renderer);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.35, 4200);
    this.env = new Environment(this.renderer, this.scene, innerWidth / innerHeight);
    this.env.setNight(this.settings.nightMix);
    this.city = new City();
    this.scene.add(this.city.group);

    this.rig = new FlightCamera(innerWidth / innerHeight, this.city);
    this.camera = this.rig.camera;

    this.hero = new ArmoredHero();
    this.heroRoot.add(this.hero.root);
    this.scene.add(this.heroRoot);
    this.controller = new FlightController(this.city.collision);
    this.fx = new Effects();
    this.scene.add(this.fx.group);
    this.enemies = new EnemyManager(this.city.collision, this.fx);
    this.scene.add(this.enemies.group);
    this.combat = new Combat(this.city.collision, this.enemies, this.fx, this.audio);
    this.scene.add(this.combat.group);
    this.missions = new MissionRunner(this.scene, this.city, this.enemies, this.fx);

    this.keys = new KeyboardMouse(this.renderer.domElement);
    this.input = new UnifiedInput(this.keys, this.gesture);

    this.landing = new Landing();
    this.hud = new HUD();
    this.overlays = new Overlays(this.settings);
    this.calibration = new Calibration();
    this.exhibition = new Exhibition();
    this.armory = new Armory();
    this.armory.onAction = (action, payload) => this.handleAction(action, payload);
    // apply the persisted frame at boot: palette + live tuning constants
    applySuit(suitById(this.suitId));
    this.hero.setPalette(suitById(this.suitId).palette);
    this.armory.commitEquip(this.suitId);

    this.wireEvents();
    this.applySettings();
    this.placeHeroAtSpawn();

    addEventListener('resize', () => this.onResize());
    addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'play') this.pause();
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                 */
  /* ------------------------------------------------------------------ */

  async boot(): Promise<void> {
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const stages: [number, string][] = [
      [8, 'WAKING SUIT OS'],
      [24, 'CHARGING REPULSOR ARRAYS'],
      [44, 'GENERATING METRO CITY GRID'],
      [64, 'RAISING SKYLINE DISTRICTS'],
      [78, 'SEEDING TRAFFIC + STREET NETWORK'],
      [88, 'ARMING NULL SYNDICATE PATROLS'],
      [96, 'CALIBRATING FLIGHT MODEL'],
      [100, 'IRONFALL MK-1 ONLINE'],
    ];
    this.landing.setLoading(2, stages[0][1]);
    await nextFrame();

    for (const [pct, text] of stages) {
      this.landing.setLoading(pct, text);
      await nextFrame();
      await nextFrame();
    }

    this.last = performance.now();
    this.loop(this.last);
    this.landing.hideLoading();
    const preloader = document.getElementById('ic-preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      setTimeout(() => preloader.remove(), 420);
    }
    this.showLanding();
    this.audioStarted = false;
  }

  private audioStarted = false;

  private showLanding(): void {
    this.phase = 'landing';
    this.landing.show();
    this.landing.showMissionSelect(false);
    this.hud.hide();
    this.overlays.hide();
    this.cinematicTime = 0;
    this.missions.running = false;
    this.enemies.clear();
    this.placeHeroAtSpawn();
    this.hud.setGesturePreview(false);
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */

  private wireEvents(): void {
    this.landing.onAction = (action, payload) => this.handleAction(action, payload);
    this.overlays.onAction = (action, payload) => this.handleAction(action, payload);
    this.calibration.onAction = (action) => this.handleAction(action);
    this.exhibition.onAction = (action) => this.handleAction(action);

    this.combat.onKill = (enemy) => {
      this.run.registerKill(enemy.score);
      this.hud.toast(`${enemy.def.label} DISABLED  +${enemy.score}`, 'gold', 2.2);
    };

    this.controller.onCrash = (speed, damage) => {
      const p = this.controller.pos.clone().addScaledVector(this.controller.getForward(V.fwd), -1.4);
      this.fx.impact(p, this.controller.getForward(V.tmp).multiplyScalar(-1), clamp(speed / 40, 0.4, 1.6));
      this.fx.sparkBurst(p, 1.1, 0xffd08a, 26);
      this.audio.crash();
      this.run.registerCrash();
      this.damageFlash = 1;
      if (this.settings.cameraShake) this.rig.addShake(clamp(speed / 26, 0.4, 1.5));
      this.hud.toast(`IMPACT — ${Math.round(damage)}% INTEGRITY LOST`, 'red', 2.6);
      this.hero.flash();
      void damage;
    };
    this.controller.onLand = (speed) => {
      this.audio.land();
      this.fx.sparkBurst(this.controller.pos.clone().setY(this.controller.pos.y - FL.heroRadius), 0.5, 0xbfd4e8, 12);
      if (speed > FLIGHT.landingSpeed * 1.6) {
        this.hud.toast('HARD TOUCHDOWN — REPULSOR REBALANCE', 'gold', 2.0);
      }
      if (this.settings.cameraShake) this.rig.addShake(0.35);
    };
    this.controller.onTakeoff = () => {
      this.audio.takeoff();
      this.fx.sparkBurst(this.controller.pos.clone(), 0.8, 0x9fe8ff, 20);
      this.hud.toast('REPULSORS ONLINE — FLIGHT CLEARANCE GRANTED', 'default', 2.4);
    };

    this.missions.events = {
      onObjectiveDone: (obj) => {
        this.audio.waypointReached();
        this.hud.toast(`OBJECTIVE COMPLETE — ${obj.text}`, 'gold', 3.0);
      },
      onProgress: (msg) => this.hud.toast(msg, 'default', 3.0),
      onComplete: (bonus) => this.finishMission(true, bonus),
      onFail: (reason) => this.finishMission(false, 0, reason),
    };

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'h') this.toggleHud();
      if (k === 'm') this.setMute(!this.settings.mute);
      if (k === 't') this.toggleExhibition();
      if (k === 'b') this.toggleBenchmark();
      if (k === 'v') this.toggleGestureMode();
    });
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                              */
  /* ------------------------------------------------------------------ */

  private handleAction(action: string, payload?: string): void {
    this.audio.ensure();
    if (!this.audioStarted) {
      this.audioStarted = true;
      this.audio.startMusic();
      this.audio.boot();
    }
    switch (action) {
      case 'start-mission':
        this.audio.click();
        this.landing.showMissionSelect(true);
        break;
      case 'close-select':
        this.audio.click();
        this.landing.showMissionSelect(false);
        break;
      case 'mission': {
        const m = MISSIONS.find((x) => x.id === payload);
        if (!m) break;
        this.audio.click();
        this.activeMission = m;
        this.overlays.show('brief', { mission: m });
        break;
      }
      case 'free-flight':
        this.audio.click();
        this.launchMission(MISSIONS.find((m) => m.freeFlight) ?? MISSIONS[0]);
        break;
      case 'gesture-flight':
        this.audio.click();
        void this.startGestureFlight();
        break;
      case 'launch':
        this.audio.click();
        this.launchMission(this.activeMission);
        break;
      case 'controls':
        this.audio.click();
        this.overlays.show('controls');
        break;
      case 'technology':
        this.audio.click();
        this.overlays.show('technology');
        break;
      case 'settings':
        this.audio.click();
        this.overlays.show('settings');
        break;
      case 'armory':
        this.audio.click();
        this.phase = 'armory';
        this.armory.show();
        this.audio.activate();
        break;
      case 'close-armory':
        this.audio.click();
        this.armory.hide();
        this.phase = 'landing';
        break;
      case 'select-suit':
        if (payload) {
          this.hero.setPalette(suitById(payload).palette);
          this.audio.hover();
        }
        break;
      case 'equip-suit': {
        const sel = this.armory.visible ? suitById(this.armory.selectedId()) : null;
        if (sel) {
          this.suitId = sel.id;
          applySuit(sel);
          persistSuitId(sel.id);
          this.hero.setPalette(sel.palette);
          // re-fill suit resources so a heavier frame starts at its new max
          this.controller.energy = Math.min(this.controller.energy, ENERGY.max);
          this.controller.integrity = Math.min(this.controller.integrity, INTEGRITY.max);
          this.armory.commitEquip(sel.id);
          this.audio.activate();
        }
        break;
      }
      case 'close-controls':
      case 'close-technology':
      case 'close-settings':
        this.audio.click();
        if (this.phase === 'pause') this.overlays.show('pause');
        else this.overlays.hide();
        break;
      case 'resume':
        this.audio.click();
        this.resume();
        break;
      case 'restart':
        this.audio.click();
        this.launchMission(this.activeMission);
        break;
      case 'back-landing':
        this.audio.click();
        this.showLanding();
        break;
      case 'calibrate-done':
        this.audio.click();
        this.calibration.close();
        this.enterPlayWithGesture();
        break;
      case 'calibrate-retry':
        this.audio.click();
        this.calibration.start(this.gesture);
        break;
      case 'use-keyboard':
        this.audio.click();
        this.calibration.close();
        this.input.mode = 'keyboard';
        this.gesture.enabled = false;
        this.hud.setGesturePreview(false);
        this.launchMission(MISSIONS.find((m) => m.freeFlight) ?? MISSIONS[0]);
        break;
      case 'set-quality':
        if (payload) {
          this.settings.quality = payload as QualityLevel | 'auto';
          saveSettings(this.settings);
          this.applySettings();
          this.overlays.show('settings');
        }
        break;
      case 'toggle-invert':
        this.settings.invertY = !this.settings.invertY;
        this.applySettings();
        this.overlays.show('settings');
        break;
      case 'toggle-shake':
        this.settings.cameraShake = !this.settings.cameraShake;
        this.applySettings();
        this.overlays.show('settings');
        break;
      case 'toggle-mute':
        this.setMute(!this.settings.mute);
        this.overlays.show('settings');
        break;
      case 'toggle-preview':
        this.settings.gesturePreview = !this.settings.gesturePreview;
        this.applySettings();
        this.overlays.show('settings');
        break;
      case 'toggle-exhibition':
        this.settings.showExhibition = !this.settings.showExhibition;
        this.applySettings();
        this.overlays.show('settings');
        break;
      case 'reset-settings':
        this.settings = { ...loadSettings(), ...defaultSettingsCopy() };
        saveSettings(this.settings);
        this.applySettings();
        this.overlays.show('settings');
        break;
      case 'settings-changed':
        saveSettings(this.settings);
        this.applySettings();
        break;
      case 'toggle-hud':
        this.toggleExhibition();
        break;
      default:
        break;
    }
  }

  private applySettings(): void {
    this.keys.settings.mouseSens = this.settings.mouseSens;
    this.keys.settings.invertY = this.settings.invertY;
    this.gesture.mapping.yawGain = this.settings.gestureSens;
    this.gesture.mapping.pitchGain = this.settings.gestureSens;
    this.audio.setVolumes({ master: this.settings.volume, music: this.settings.music, ui: 0.5, engine: 0.5 });
    this.audio.setMuted(this.settings.mute);
    this.env.setNight(this.settings.nightMix);
    this.camera.fov = this.settings.fov;

    const level: QualityLevel = this.settings.quality === 'auto'
      ? this.autoQuality
      : this.settings.quality;
    this.env.setQuality(level, this.renderer);
    const base = level === 'high' ? 2 : level === 'medium' ? 1.5 : 1;
    this.perf.setPixelRatio(Math.min(base, Math.min(devicePixelRatio || 1, PERF.maxPixelRatio)) * this.settings.resolutionScale);
    this.fx.setPixelRatio(this.perf.pixelRatio);
    this.hud.setGesturePreview(this.settings.gesturePreview && this.effectiveGestureOn);
    this.exhibition.toggle(this.settings.showExhibition && this.phase !== 'landing');
    this.renderer.domElement.style.filter = '';
  }

  private get effectiveGestureOn(): boolean {
    return this.input.mode !== 'keyboard' && this.gesture.enabled;
  }

  private autoQuality: QualityLevel = 'high';

  private setMute(muted: boolean): void {
    this.settings.mute = muted;
    this.audio.setMuted(muted);
    saveSettings(this.settings);
    this.hud.toast(muted ? 'AUDIO MUTED' : 'AUDIO ON', 'default', 1.6);
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    if (this.phase === 'play' || this.phase === 'pause') {
      this.hudVisible ? this.hud.show() : this.hud.hide();
    }
  }

  private toggleExhibition(): void {
    this.settings.showExhibition = !this.settings.showExhibition;
    this.exhibition.toggle(this.settings.showExhibition && this.phase !== 'landing');
    saveSettings(this.settings);
  }

  private toggleBenchmark(): void {
    if (this.phase !== 'play') return;
    this.benchmark.active = !this.benchmark.active;
    this.benchmark.timer = this.benchmark.active ? 12 : 0;
    this.benchmark.frames = 0;
    this.benchmark.timeSum = 0;
    this.hud.toast(this.benchmark.active ? 'BENCHMARK FLIGHT STARTED — 12s AUTOPILOT' : 'BENCHMARK CANCELLED', 'gold', 2.6);
  }

  private async startGestureFlight(): Promise<void> {
    const ok = await this.gesture.start();
    if (!ok) {
      this.hud.toast('CAMERA UNAVAILABLE — KEYBOARD FALLBACK ACTIVE', 'red', 4);
      this.input.mode = 'keyboard';
      this.landing.show();
      return;
    }
    this.input.mode = 'hybrid';
    this.landing.hide();
    this.calibration.start(this.gesture);
  }

  private toggleGestureMode(): void {
    if (this.phase === 'landing') return;
    if (this.effectiveGestureOn) {
      this.input.mode = 'keyboard';
      this.gesture.enabled = false;
      this.gesture.stop();
      this.hud.setGesturePreview(false);
      this.hud.toast('GESTURE CONTROL DISENGAGED — KEYBOARD ACTIVE', 'default', 2.4);
    } else {
      void this.gesture.start().then((ok) => {
        if (ok) {
          this.input.mode = 'hybrid';
          this.hud.setGesturePreview(this.settings.gesturePreview);
          this.hud.toast('GESTURE CONTROL ENGAGED — OPEN PALM TO FLY', 'gold', 3);
        } else {
          this.hud.toast('CAMERA UNAVAILABLE — KEYBOARD FALLBACK ACTIVE', 'red', 3.4);
        }
      });
    }
  }

  private enterPlayWithGesture(): void {
    this.input.mode = 'hybrid';
    this.hud.setGesturePreview(this.settings.gesturePreview);
    this.launchMission(MISSIONS.find((m) => m.freeFlight) ?? MISSIONS[0]);
  }

  /* ------------------------------------------------------------------ */
  /* mission flow                                                        */
  /* ------------------------------------------------------------------ */

  private launchMission(mission: Mission): void {
    this.activeMission = mission;
    this.landing.hide();
    this.landing.showMissionSelect(false);
    this.overlays.hide();
    this.placeHeroAtSpawn();
    this.combat.reset();
    this.run.start(mission.id, mission.name, mission.index);
    this.missions.start(mission);
    this.phase = 'play';
    this.hud.show();
    this.hudVisible = true;
    this.audio.activate();
    this.audio.startMusic();
    this.exhibition.toggle(this.settings.showExhibition);
    this.rig.snap(this.subjectForCamera());
    this.hud.toast(mission.freeFlight ? 'FREE FLIGHT — NO ORDERS' : `MISSION ACTIVE — ${mission.name}`, 'gold', 3.4);
    if (this.effectiveGestureOn) {
      this.hud.setGesturePreview(this.settings.gesturePreview);
    }
    this.keys.requestLock();
  }

  private finishMission(completed: boolean, bonus: number, failReason?: string): void {
    if (completed) {
      this.run.finish(bonus);
      this.audio.missionComplete();
    } else {
      this.audio.missionFail();
    }
    const summary = this.run.summary();
    this.phase = 'result';
    this.overlays.show('result', { summary, failReason });
    this.keys.releaseLock();
    void this.landing;
  }

  private pause(): void {
    if (this.phase !== 'play') return;
    this.phase = 'pause';
    this.overlays.show('pause');
    this.keys.releaseLock();
  }

  private resume(): void {
    if (this.phase !== 'pause') return;
    this.phase = 'play';
    this.overlays.hide();
    this.keys.requestLock();
  }

  private placeHeroAtSpawn(): void {
    const spawn = this.city.spawn;
    this.controller.reset(spawn.pos.clone(), spawn.yaw);
    this.controller.teleport(spawn.pos.clone(), spawn.yaw);
    this.controller.state = 'GROUND';
    this.controller.speed = 0;
    this.heroRoot.position.copy(spawn.pos);
    this.heroRoot.quaternion.copy(this.controller.quaternion);
    this.lastDistance.copy(spawn.pos);
  }

  private resetToPad(keepMission: boolean): void {
    const spawn = this.city.spawn;
    this.controller.teleport(spawn.pos.clone(), spawn.yaw);
    this.controller.state = 'GROUND';
    this.controller.heal(40);
    this.combat.reset();
    this.hud.toast('SUIT RECOVERED — RETURNED TO SPIRE DECK', 'gold', 2.6);
    if (!keepMission) this.missions.running = false;
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                           */
  /* ------------------------------------------------------------------ */

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dtRaw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(dtRaw, 0.0005, 0.05);
    this.elapsed += dt;
    this.cinematicTime += dt;
    this.perf.sample(dt);

    this.input.update();
    this.gesture.update(dt);

    if (this.phase === 'play') this.stepPlay(dt, now);
    else if (this.phase === 'pause') this.stepPaused(dt);
    else this.stepAmbient(dt);

    if (this.calibration.open) this.calibration.update();
    this.adaptQuality();
    this.render(dt);
    this.input.clearEdges();
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
  };

  private stepAmbient(dt: number): void {
    this.city.update(dt);
    this.env.update(dt, this.city.spawn.pos);
    this.hero.update(dt, 'GROUND', 0, 0, 0, 0);
    this.heroRoot.position.copy(this.controller.pos);
    this.heroRoot.quaternion.copy(this.controller.quaternion);
    // cinematic orbit framed on the hero standing on the launch deck
    const center = V.tmp.copy(this.city.spawn.pos).add(V.tmp2.set(0, 1.2, 0));
    this.rig.cinematic(dt, center, this.cinematicTime, 84, 22);
    this.fx.update(dt, this.heroRoot.position, this.heroRoot.quaternion, V.tmp2.set(0, 0, 0), 0, 0);
    this.exhibition.update(dt, this.exhibitionData());
  }

  private stepPaused(dt: number): void {
    this.city.update(dt);
    this.env.update(dt, this.controller.pos);
    this.hero.update(dt, this.controller.state, 0, 0, this.controller.speedNorm, 1 - this.controller.integrity / 100);
    this.heroRoot.position.copy(this.controller.pos);
    this.heroRoot.quaternion.copy(this.controller.quaternion);
    this.rig.update(dt * 0.25, this.subjectForCamera());
    this.fx.update(dt, this.heroRoot.position, this.heroRoot.quaternion, this.controller.velocity, 0, 0);
  }

  private stepPlay(dt: number, now: number): void {
    const inp = this.input.frame;

    /* ---- pause / reset / gesture toggles ---- */
    if (this.input.edges.pause) {
      this.pause();
      return;
    }
    if (this.input.edges.reset) this.resetToPad(true);

    /* ---- benchmark autopilot for exhibitions ---- */
    if (this.benchmark.active) {
      this.benchmark.timer -= dt;
      this.benchmark.frames++;
      this.benchmark.timeSum += dt;
      inp.thrust = 1;
      inp.boost = this.benchmark.timer % 6 > 3;
      inp.yaw = Math.sin(this.elapsed * 0.4) * 0.5;
      inp.pitch = Math.sin(this.elapsed * 0.23) * 0.25;
      inp.fire = false;
      if (this.benchmark.timer <= 0) {
        this.benchmark.active = false;
        const avgFps = this.benchmark.frames / Math.max(0.001, this.benchmark.timeSum);
        this.benchmark.result = `${avgFps.toFixed(1)} FPS`;
        this.hud.toast(`BENCHMARK RESULT — ${avgFps.toFixed(1)} FPS AVERAGE`, 'gold', 6);
      }
    }

    /* ---- mouse stick: pointer-lock or right-drag deltas become pitch/yaw RATES ---- */
    const mouse = this.keys.consumeMouse();
    if (mouse.dx !== 0 || mouse.dy !== 0) {
      const sens = 0.011 * this.settings.mouseSens; // ~90 px for full stick: precise, not twitchy
      const yawSign = 1;
      const pitchSign = this.settings.invertY ? 1 : -1;
      inp.yaw = clamp(inp.yaw + mouse.dx * sens * yawSign, -1, 1);
      inp.pitch = clamp(inp.pitch + mouse.dy * sens * pitchSign, -1, 1);
    }

    /* ---- flight ---- */
    const flight = this.input.toFlightInput();
    if (this.input.edges.takeoff || inp.takeoffPressed) {
      this.controller.requestTakeoff();
    }
    this.controller.update(dt, flight, this.city);

    /* ---- mouse-steer coach mark: show once, retire forever once used ---- */
    if (!this.mouseHintDone) {
      if (this.keys.mouseSteering) {
        this.mouseHintDone = true;
        this.hud.setMouseHint(false);
      } else {
        this.hud.setMouseHint(true);
      }
    }

    /* ---- water + ceiling feedback ---- */
    this.handleEnvironmentFeedback(dt);

    /* ---- hero mesh ---- */
    const damaged = 1 - this.controller.integrity / INTEGRITY.max;
    this.hero.update(dt, this.controller.state, this.controller.thrustLevel, this.controller.boostLevel, this.controller.speedNorm, damaged);
    this.heroRoot.position.copy(this.controller.pos);
    this.heroRoot.quaternion.copy(this.controller.quaternion);
    this.heroRoot.rotateZ(this.controller.visualRoll * 0.55);

    /* ---- combat ---- */
    const camFwd = V.fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const wantFire = this.phase === 'play' && (inp.fire || this.input.edges.fireStarted);
    this.combat.update(
      dt,
      this.controller,
      camFwd,
      this.camera,
      wantFire,
      inp.unibeam,
      this.input.edges.emp,
      this.input.edges.cycleTarget
    );

    /* ---- enemies ---- */
    this.enemies.update(dt, {
      heroPos: this.controller.pos,
      heroVel: this.controller.velocity,
      collision: this.city.collision,
      fx: this.fx,
      damageHero: (amount, source, kind) => this.damageHero(amount, source, kind),
      onEnemyDowned: (e) => this.run.registerKill(e.score),
    }, this.run.difficulty());

    /* ---- missions ---- */
    this.missions.update(dt, this.controller, this.run, camFwd);

    /* ---- run stats ---- */
    const distance = this.controller.pos.distanceTo(this.lastDistance);
    this.lastDistance.copy(this.controller.pos);
    this.run.update(dt, distance, this.controller.speed, this.controller.pos.y, this.controller.boostLevel);

    /* ---- world / camera / fx ---- */
    this.city.update(dt);
    this.env.update(dt, this.controller.pos);
    this.rig.focusOn(this.combat.lock.active && this.combat.lock.locked ? this.combat.lock.target?.pos ?? null : null, 0.35);
    this.rig.update(dt, this.subjectForCamera());
    this.fx.update(
      dt,
      this.heroRoot.position,
      this.heroRoot.quaternion,
      this.controller.velocity,
      this.controller.boostLevel,
      this.controller.speedNorm
    );
    this.hero.setRepulsorFire(this.combat.activeBoltCount > 0 && this.controller.boostLevel > 0.4);

    /* ---- signature FX: repulsor flow + downwash dust ---- */
    const flying = this.controller.airborne;
    const hoverIntensity = flying ? this.controller.thrustLevel * (1 - this.controller.speedNorm * 0.6) : 0;
    if (hoverIntensity > 0.05) {
      this.hero.palmWorlds(V.tmp, V.tmp2);
      this.fx.repulsorFlow(V.tmp, V.tmp2, hoverIntensity);
    }
    if (flying) {
      this.fx.downwashDust(this.controller.pos, 0, this.controller.thrustLevel); // street level
    }

    /* ---- audio ---- */
    this.audio.update(dt, {
      thrust: this.controller.thrustLevel,
      speedNorm: this.controller.speedNorm,
      boostLevel: this.controller.boostLevel,
      vertical: this.controller.verticalSpeed * 0.1,
      airborne: this.controller.airborne,
    });

    /* ---- sfx triggers ---- */
    if (this.input.edges.fireStarted) this.audio.repulsor(0);
    if (inp.boost && !this.boostWasOn) this.audio.boostShort();
    this.boostWasOn = inp.boost;
    if (inp.brake && !this.brakeWasOn) this.audio.brake();
    this.brakeWasOn = inp.brake;
    if (this.controller.energy < ENERGY.lowWarn && !this.warnedLowEnergy) {
      this.warnedLowEnergy = true;
      this.audio.lowEnergy();
      this.hud.toast('REPULSOR CELL LOW — BOOST LIMITED', 'red', 2.6);
    } else if (this.controller.energy > ENERGY.lowWarn * 1.8) {
      this.warnedLowEnergy = false;
    }

    /* ---- HUD + exhibition ---- */
    this.updateHud(dt);
    this.exhibition.update(dt, this.exhibitionData());
    void now;
  }

  private boostWasOn = false;
  private brakeWasOn = false;

  private handleEnvironmentFeedback(dt: number): void {
    const pos = this.controller.pos;
    if (pos.y < 3 && this.city.isWater(pos.x, pos.z)) {
      this.waterTimer += dt;
      if (this.waterTimer > 0.35) {
        this.waterTimer = 0;
        this.fx.splash(new THREE.Vector3(pos.x, 1, pos.z), 1.4);
        this.controller.applyDamage(12);
        this.controller.forceStagger(0.8);
        this.audio.splash();
        this.hud.toast('WATER CONTACT — REPULSOR RESTART', 'red', 2.2);
        this.controller.teleport(new THREE.Vector3(pos.x, pos.y + 42, pos.z));
      }
    }
    const radial = Math.hypot(pos.x, pos.z);
    if (radial > FLIGHT.boundsRadius || pos.y > FLIGHT.ceiling * 0.97) {
      if (!this.warnedCeiling) {
        this.warnedCeiling = true;
        this.audio.warning();
        this.hud.toast('AIRSPACE LIMIT — TURN BACK', 'red', 2.6);
      }
    } else if (radial < FLIGHT.boundsRadius * 0.9 && pos.y < FLIGHT.ceiling * 0.9) {
      this.warnedCeiling = false;
    }
    this.groundToastCooldown = Math.max(0, this.groundToastCooldown - dt);
  }

  private damageHero(amount: number, source: THREE.Vector3, kind: string): void {
    this.controller.applyDamage(amount);
    this.run.registerDamage(amount);
    this.damageFlash = Math.min(1, this.damageFlash + amount / 40);
    this.fx.energyHit(source, kind === 'plasma' ? 0xff8a4a : 0x9fe8ff);
    if (this.settings.cameraShake) this.rig.addShake(clamp(amount / 22, 0.15, 0.8));
    this.audio.warning();
    if (this.controller.integrity <= 0) {
      this.controller.integrity = 0;
      this.hud.toast('SUIT INTEGRITY CRITICAL — EMERGENCY RECOVERY', 'red', 3.4);
      this.controller.forceStagger(1.4);
      this.resetToPad(true);
      this.controller.heal(55);
      this.fx.explosion(this.controller.pos.clone(), 1.6, 0xff7a3a);
    }
  }

  private subjectForCamera(): Parameters<FlightCamera['update']>[1] {
    return {
      pos: this.controller.pos,
      quaternion: this.controller.quaternion,
      velocity: this.controller.velocity,
      visualRoll: this.controller.visualRoll,
      boostLevel: this.controller.boostLevel,
      speed: this.controller.speed,
      fovBoostAdd: 0,
      airborne: this.controller.airborne,
      landing: this.controller.state === 'LANDING',
    };
  }

  private adaptQuality(): void {
    if (this.phase === 'landing') return;
    if (this.settings.quality !== 'auto') return;
    const rec = this.perf.recommend();
    if (rec === -1) {
      if (this.autoQuality === 'high') this.autoQuality = 'medium';
      else if (this.autoQuality === 'medium') this.autoQuality = 'low';
      else {
        const pr = this.perf.pixelRatio - 0.12;
        if (pr >= PERF.adaptiveMinPixelRatio) {
          this.perf.setPixelRatio(pr);
          this.fx.setPixelRatio(this.perf.pixelRatio);
        }
      }
      this.env.setQuality(this.autoQuality, this.renderer);
    } else if (rec === 1) {
      if (this.perf.pixelRatio < Math.min(devicePixelRatio || 1, PERF.maxPixelRatio) * this.settings.resolutionScale) {
        this.perf.setPixelRatio(this.perf.pixelRatio + 0.1);
        this.fx.setPixelRatio(this.perf.pixelRatio);
      } else if (this.autoQuality === 'low') {
        this.autoQuality = 'medium';
        this.env.setQuality('medium', this.renderer);
      } else if (this.autoQuality === 'medium') {
        this.autoQuality = 'high';
        this.env.setQuality('high', this.renderer);
      }
    }
  }

  private render(dt: number): void {
    const usePost = this.env.quality !== 'low' && this.env.bloom !== null;
    this.env.render(this.renderer, this.camera, usePost);
    void dt;
  }

  /* ------------------------------------------------------------------ */
  /* hud                                                                 */
  /* ------------------------------------------------------------------ */

  private updateHud(dt: number): void {
    const c = this.controller;
    const lock = this.combat.lockedTarget;
    let lockState: HudLock = {
      active: false, name: '', progress: 0, locked: false,
      screenX: 0, screenY: 0, onScreen: false, offscreenAngle: 0, hpRatio: 0, distance: 0,
    };
    if (lock && lock.active) {
      V.ndc.copy(lock.pos).project(this.camera);
      const onScreen = V.ndc.z < 1 && Math.abs(V.ndc.x) < 0.98 && Math.abs(V.ndc.y) < 0.95;
      const screenX = (V.ndc.x * 0.5 + 0.5) * innerWidth;
      const screenY = (-V.ndc.y * 0.5 + 0.5) * innerHeight;
      const angle = Math.atan2(screenY - innerHeight / 2, screenX - innerWidth / 2) + (onScreen ? 0 : Math.PI);
      lockState = {
        active: true,
        name: lock.def.label,
        progress: this.combat.lock.progress,
        locked: this.combat.lock.locked,
        screenX,
        screenY,
        onScreen,
        offscreenAngle: angle,
        hpRatio: clamp((lock.hp / lock.maxHp + lock.shield / Math.max(1, lock.maxShield)) / 2, 0, 1),
        distance: lock.pos.distanceTo(c.pos),
      };
    }

    const blips: HudRadarBlip[] = [];
    for (const e of this.enemies.enemies) {
      if (!e.active || e.state === 'downed') continue;
      if (e.pos.distanceTo(c.pos) > 720) continue;
      blips.push({ x: e.pos.x, z: e.pos.z, kind: 'enemy' });
    }
    for (const wp of this.missions.activeWaypoints()) blips.push({ x: wp.x, z: wp.z, kind: 'waypoint' });
    for (const t of this.city.protectTargets) if (t.alive) blips.push({ x: t.pos.x, z: t.pos.z, kind: 'tower' });

    const g = this.gesture.telemetry;
    const warning = c.integrity < 30
      ? 'SUIT INTEGRITY CRITICAL'
      : c.energy < ENERGY.lowWarn
        ? 'REPULSOR CELL LOW'
        : Math.hypot(c.pos.x, c.pos.z) > FLIGHT.boundsRadius
          ? 'AIRSPACE BOUNDARY'
          : c.state === 'STAGGERED' ? 'ATTITUDE RECOVERY' : '';

    const heading = (() => {
      const fwd = V.fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
      const deg = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
      return (deg + 360) % 360;
    })();

    const state: HudState = {
      speed: c.speed,
      altitude: Math.max(0, c.pos.y),
      vertical: c.verticalSpeed,
      heading,
      district: this.city.labelAt(c.pos.x, c.pos.z),
      flightState: c.state,
      energy: c.energy,
      maxEnergy: ENERGY.max,
      integrity: c.integrity,
      boost: c.energy / ENERGY.max,
      inputMode: this.input.mode === 'keyboard' && !this.effectiveGestureOn ? 'keyboard' : this.input.mode,
      gestureText: g.gesture,
      gestureOn: this.effectiveGestureOn,
      objectiveText: this.missions.objectiveText,
      objectiveProgress: this.missions.progressRatio,
      timer: this.missions.mission.timeLimit ? this.missions.timeLeft : null,
      missionName: this.activeMission.name,
      score: this.run.score,
      kills: this.run.kills,
      lock: lockState,
      blips,
      heroX: c.pos.x,
      heroZ: c.pos.z,
      warning,
      boundary: Math.hypot(c.pos.x, c.pos.z) > FLIGHT.boundsRadius * 0.96,
      water: c.pos.y < 6 && this.city.isWater(c.pos.x, c.pos.z),
      damaged: Math.max(this.damageFlash, c.integrity < 35 ? (1 - c.integrity / 100) * 0.4 : 0),
      boosting: c.boostLevel,
      speedNorm: c.speedNorm,
      fps: this.perf.fps,
      onGround: c.grounded,
    };
    this.hud.update(dt, state);
    this.hud.drawGesturePreview(g, this.gesture.video, this.gesture.landmarks);
    void damp;
  }

  private exhibitionData(): Parameters<Exhibition['update']>[1] {
    const g = this.gesture.telemetry;
    return {
      perf: this.perf,
      gesture: { ...g, mappedAction: this.gesture.actionText, gesture: this.gesture.gestureName as typeof g.gesture },
      gestureEnabled: this.effectiveGestureOn,
      flightState: this.controller.state,
      speed: this.controller.speed,
      altitude: this.controller.pos.y,
      boostLevel: this.controller.boostLevel,
      inputMode: this.input.mode,
      mission: this.activeMission.name,
      objective: this.missions.objectiveText,
      buildings: this.city.buildings.count,
      cities: [],
      boltCount: this.combat.activeBoltCount + this.enemies.hostiles.filter((h) => h.active).length,
      enemies: this.enemies.aliveCount,
      quality: this.env.quality,
      assetSource: this.gesture.assetSource,
      delegate: this.gesture.delegate,
    };
  }

  private onResize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.env.resize(w, h);
    this.rig.applyAspect(w / h);
  }
}

function defaultSettingsCopy(): GameSettings {
  return {
    quality: 'auto', resolutionScale: 1, fov: CAMERA.fovBase, mouseSens: 1, invertY: false,
    cameraShake: true, nightMix: 0.45, volume: 0.42, music: 0.34, mute: false,
    gestureSens: 1, gesturePreview: true, showExhibition: false,
  };
}
