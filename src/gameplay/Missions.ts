import * as THREE from 'three';
import { clamp } from '../util/Rng';
import type { City } from '../world/City';
import type { EnemyManager, EnemyType } from '../enemies/Enemies';
import type { FlightController } from '../player/FlightController';
import type { Effects } from '../fx/Effects';
import type { Run } from './Run';

export type ObjectiveKind = 'takeoff' | 'reach' | 'hover' | 'boost' | 'land' | 'destroy' | 'protect' | 'survive';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  text: string;
  /** Named landmark the objective is anchored to (resolved against the city). */
  landmark?: string;
  air?: number;
  radius?: number;
  count?: number;
  seconds?: number;
  progress: number;
  done: boolean;
  pos?: THREE.Vector3;
}

export interface WaveSpec {
  at: number;
  type: EnemyType;
  count: number;
  nearLandmark?: string;
  spread?: number;
  hpScale?: number;
}

export interface Mission {
  id: string;
  name: string;
  subtitle: string;
  index: number;
  brief: string[];
  objectives: Objective[];
  timeLimit?: number;
  waves: WaveSpec[];
  freeFlight?: boolean;
}

const o = (obj: Partial<Objective> & { id: string; kind: ObjectiveKind; text: string }): Objective => ({
  progress: 0, done: false, ...obj,
});

export const MISSIONS: Mission[] = [
  {
    id: 'm01',
    name: 'FIRST FLIGHT',
    subtitle: 'SUIT CERTIFICATION',
    index: 0,
    brief: [
      'Repulsor array is green. Take the Mark-1 off the Zero Point Spire deck.',
      'Fly the downtown gap, hold a hover, then push the boosters.',
      'Touch down on a rooftop pad to certify the suit.',
    ],
    timeLimit: undefined,
    waves: [],
    objectives: [
      o({ id: 'm01-takeoff', kind: 'takeoff', text: 'LIFT OFF — press SPACE to launch from the deck' }),
      o({ id: 'm01-reach', kind: 'reach', text: 'FLY TO FINANCIAL PLAZA ALTITUDE', landmark: 'FINANCIAL PLAZA', air: 90, radius: 62 }),
      o({ id: 'm01-hover', kind: 'hover', text: 'HOLD POSITION — stabilise in hover for 3s', seconds: 3 }),
      o({ id: 'm01-boost', kind: 'boost', text: 'OPEN THE THROTTLE — boost for 5s total', seconds: 5 }),
      o({ id: 'm01-land', kind: 'land', text: 'LAND ON THE MERIDIAN TOWER ROOF PAD', landmark: 'MERIDIAN TOWER', radius: 24 }),
    ],
  },
  {
    id: 'm02',
    name: 'SKYLINE INTERCEPT',
    subtitle: 'URGENT DISPATCH',
    index: 1,
    brief: [
      'Syndicate scouts are mapping the skyline.',
      'Thread the towers and hit all three beacons before they vanish.',
      'Stay fast — the clock is running.',
    ],
    timeLimit: 140,
    waves: [
      { at: 18, type: 'INTERCEPTOR', count: 3, nearLandmark: 'HIGH-RISE SKYLINE' },
      { at: 70, type: 'HUNTER', count: 3 },
    ],
    objectives: [
      o({ id: 'm02-a', kind: 'reach', text: 'BEACON 1 — HIGH-RISE SKYLINE', landmark: 'MERIDIAN TOWER', air: 120, radius: 45 }),
      o({ id: 'm02-b', kind: 'reach', text: 'BEACON 2 — POWER PLANT', landmark: 'POWER PLANT', air: 40, radius: 45 }),
      o({ id: 'm02-c', kind: 'reach', text: 'BEACON 3 — HARBOR DOCKS', landmark: 'HARBOR DOCKS', air: 70, radius: 45 }),
    ],
  },
  {
    id: 'm03',
    name: 'DRONE SWARM',
    subtitle: 'AIRSPACE DEFENCE',
    index: 2,
    brief: [
      'A Null Syndicate swarm is sweeping the downtown core.',
      'Disable the interceptors with repulsor pulses.',
      'Lock, pulse, repeat. Do not let them mass up.',
    ],
    timeLimit: 210,
    waves: [
      { at: 2, type: 'INTERCEPTOR', count: 4, nearLandmark: 'ZERO POINT SPIRE', spread: 90 },
      { at: 34, type: 'INTERCEPTOR', count: 5, spread: 140 },
      { at: 74, type: 'HUNTER', count: 3 },
      { at: 112, type: 'INTERCEPTOR', count: 5, spread: 160 },
      { at: 146, type: 'HEAVY', count: 1 },
    ],
    objectives: [
      o({ id: 'm03-kills', kind: 'destroy', text: 'DISABLE SYNDICATE DRONES', count: 12 }),
    ],
  },
  {
    id: 'm04',
    name: 'ROOFTOP EMERGENCY',
    subtitle: 'TIME CRITICAL',
    index: 3,
    brief: [
      'Three rooftops are flashing distress beacons across the city.',
      'They are spread wide — the high skyline, the industrial belt, the old city.',
      'You have ninety seconds. Fly clean.',
    ],
    timeLimit: 95,
    waves: [{ at: 30, type: 'HUNTER', count: 2 }],
    objectives: [
      o({ id: 'm04-a', kind: 'land', text: 'ROOFTOP A — HIGH-RISE SKYLINE', landmark: 'MERIDIAN TOWER', radius: 22 }),
      o({ id: 'm04-b', kind: 'land', text: 'ROOFTOP B — POWER PLANT', landmark: 'POWER PLANT', radius: 26, air: 46 }),
      o({ id: 'm04-c', kind: 'land', text: 'ROOFTOP C — OLD CITY SQUARE', landmark: 'OLD CITY SQUARE', radius: 30, air: 24 }),
    ],
  },
  {
    id: 'm05',
    name: 'CITY DEFENSE',
    subtitle: 'HOLD THE LINE',
    index: 4,
    brief: [
      'A Syndicate strike group is inbound on three relay towers.',
      'They will fire on the towers whenever you are not between them.',
      'Two minutes. Keep all three standing.',
    ],
    timeLimit: 120,
    waves: [
      { at: 2, type: 'INTERCEPTOR', count: 4, spread: 160 },
      { at: 24, type: 'HEAVY', count: 1 },
      { at: 40, type: 'MISSILE', count: 2 },
      { at: 64, type: 'INTERCEPTOR', count: 6, spread: 200 },
      { at: 88, type: 'SHIELD', count: 2 },
    ],
    objectives: [
      o({ id: 'm05-protect', kind: 'protect', text: 'PROTECT THE THREE RELAY TOWERS', seconds: 120 }),
      o({ id: 'm05-kills', kind: 'destroy', text: 'DISABLE THE STRIKE GROUP', count: 10 }),
    ],
  },
  {
    id: 'free',
    name: 'FREE FLIGHT',
    subtitle: 'NO ORDERS',
    index: 5,
    brief: [
      'No mission parameters. The city is yours.',
      'Chain buildings, chase the horizon, and disable any drone that picks a fight.',
    ],
    waves: [],
    freeFlight: true,
    objectives: [],
  },
];

export interface MissionEvents {
  onObjectiveDone?: (objective: Objective, index: number) => void;
  onProgress?: (message: string) => void;
  onComplete?: (bonus: number) => void;
  onFail?: (reason: string) => void;
}

interface WaveRuntime extends WaveSpec {
  fired: boolean;
}

const V = new THREE.Vector3();

/** Mission runtime: objective evaluation, wave spawning and 3D waypoint markers. */
export class MissionRunner {
  mission: Mission = MISSIONS[0];
  timeLeft = 0;
  running = false;
  private waves: WaveRuntime[] = [];
  private markers: (THREE.Group | null)[] = [];
  private markerRoot = new THREE.Group();
  private hoverAccum = 0;
  private boostAccum = 0;
  private protectTargets: { name: string; pos: THREE.Vector3; integrity: number; alive: boolean; flash: number }[] = [];
  private ambientTimer = 20;
  events: MissionEvents = {};

  constructor(private scene: THREE.Scene, private city: City, private enemies: EnemyManager, private fx: Effects) {
    this.scene.add(this.markerRoot);
  }

  get objectiveList(): Objective[] {
    return this.mission.objectives;
  }

  get current(): Objective | null {
    return this.mission.objectives.find((x) => !x.done) ?? null;
  }

  start(mission: Mission): void {
    this.mission = mission;
    this.running = true;
    this.timeLeft = mission.timeLimit ?? 0;
    this.hoverAccum = 0;
    this.boostAccum = 0;
    this.waves = mission.waves.map((w) => ({ ...w, fired: false }));
    this.ambientTimer = 20;
    this.enemies.clear();
    this.clearMarkers();
    this.protectTargets = this.city.protectTargets.map((t) => ({
      name: t.name, pos: t.pos.clone(), integrity: 100, alive: true, flash: 0,
    }));
    for (const t of this.city.protectTargets) t.integrity = 100, t.alive = true;

    // resolve objective anchors against the generated city
    for (const obj of mission.objectives) {
      obj.progress = 0;
      obj.done = false;
      if (!obj.landmark) continue;
      const lm = this.city.landmarkMap.get(obj.landmark);
      let pos: THREE.Vector3 | null = null;
      if (lm) {
        pos = lm.pos.clone();
        if (obj.kind === 'land' || obj.air !== undefined) {
          const roof = this.city.rooftopAt(pos.x, pos.z);
          pos.y = Math.max(pos.y, roof) + (obj.air ?? 4);
        }
        if (obj.kind === 'reach' && obj.air !== undefined && lm.kind === 'ground') {
          pos.y = (obj.air ?? 60);
        }
      } else {
        // fall back to the district centre for landmarks we do not have
        pos = new THREE.Vector3(0, obj.air ?? 80, 0);
      }
      obj.pos = pos;
      if (obj.air !== undefined && obj.kind === 'reach') pos.y = obj.air;
    }
    // one marker slot per objective so hiding on completion is exact
    this.markers = mission.objectives.map((obj) =>
      obj.pos ? this.buildMarker(obj.pos, obj.kind === 'land' ? 0xffcf6a : 0x54f0ff, obj.radius ?? 40) : null
    );
    this.layoutMarkers();
  }

  private clearMarkers(): void {
    for (const m of this.markers) if (m) this.markerRoot.remove(m);
    this.markers.length = 0;
  }

  private buildMarker(pos: THREE.Vector3, color: number, radius: number): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(pos);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.55, Math.max(0.5, radius * 0.028), 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    g.add(ring);
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 260, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    column.position.y = 130;
    g.add(column);
    for (let i = 0; i < 4; i++) {
      const chev = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 0.1, radius * 0.22, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      chev.position.y = -radius * 0.3 - i * radius * 0.22;
      chev.rotation.x = Math.PI;
      g.add(chev);
    }
    this.markerRoot.add(g);
    return g;
  }

  private layoutMarkers(): void {
    for (let i = 0; i < this.mission.objectives.length; i++) {
      const obj = this.mission.objectives[i];
      const m = this.markers[i];
      if (!m) continue;
      if (obj.done || !obj.pos) { m.visible = false; continue; }
      m.visible = true;
      m.position.copy(obj.pos);
    }
  }

  update(dt: number, hero: FlightController, run: Run, cameraFwd: THREE.Vector3): void {
    if (!this.running) return;

    /* ---------- ambient free-flight encounters ---------- */
    if (this.mission.freeFlight) {
      this.ambientTimer -= dt;
      const nearby = this.enemies.near(hero.pos, 420);
      if (this.ambientTimer <= 0 && nearby.length < 4) {
        this.ambientTimer = 26;
        const type: EnemyType = Math.random() < 0.7 ? 'INTERCEPTOR' : Math.random() < 0.6 ? 'HUNTER' : 'HEAVY';
        const count = type === 'HEAVY' ? 1 : 2;
        for (let i = 0; i < count; i++) {
          this.spawnNear(hero.pos, type, 260 + i * 40, 46);
        }
        this.events.onProgress?.('SYNDICATE PATROL DETECTED NEARBY');
      }
    }

    /* ---------- timed waves ---------- */
    for (const w of this.waves) {
      if (w.fired || run.missionTime < w.at) continue;
      w.fired = true;
      const anchor = w.nearLandmark ? this.city.landmarkMap.get(w.nearLandmark)?.pos ?? hero.pos : hero.pos;
      for (let i = 0; i < w.count; i++) {
        this.spawnNear(anchor, w.type, 150 + Math.random() * 140, w.spread ?? 120, w.hpScale ?? 1, run.difficulty());
      }
    }

    /* ---------- time limit ---------- */
    let failed = false;
    if (this.mission.timeLimit) {
      this.timeLeft = clamp(this.timeLeft - dt, 0, this.mission.timeLimit);
      if (this.timeLeft <= 0) failed = true;
    }

    /* ---------- objectives ---------- */
    let allDone = this.mission.objectives.length > 0;
    for (let i = 0; i < this.mission.objectives.length; i++) {
      const obj = this.mission.objectives[i];
      if (obj.done) continue;
      const done = this.evaluate(obj, dt, hero, run);
      if (done) {
        obj.done = true;
        const marker = this.markers[i];
        if (marker) marker.visible = false;
        run.addScore(180);
        this.events.onObjectiveDone?.(obj, i);
      } else {
        allDone = false;
      }
    }

    if (allDone && this.mission.objectives.length > 0) {
      this.running = false;
      const timeBonus = this.mission.timeLimit ? Math.round(this.timeLeft * 12) : Math.round(clamp(180 - run.missionTime, 0, 180) * 8);
      this.events.onComplete?.(timeBonus + 500);
      return;
    }
    if (failed) {
      this.running = false;
      this.events.onFail?.('TIME EXPIRED');
      return;
    }

    /* ---------- protection objective ---------- */
    const protect = this.mission.objectives.find((x) => x.kind === 'protect');
    if (protect && !protect.done) {
      for (const t of this.protectTargets) {
        if (!t.alive) continue;
        const attackers = this.enemies.near(t.pos, 90);
        if (attackers.length > 0) {
          const dps = attackers.reduce((n, e) => n + (e.def.damage * 0.55), 0);
          t.integrity -= dps * dt * 0.5;
          t.flash = 1;
          if (Math.random() < dt * 6) this.fx.energyHit(t.pos, 0xff7a4a);
          if (t.integrity <= 0) {
            t.alive = false;
            t.integrity = 0;
            this.fx.explosion(t.pos, 2.4, 0xff8a3a);
          }
        }
        t.flash = Math.max(0, t.flash - dt * 2);
      }
      const elapsed = (this.mission.timeLimit ?? 0) - this.timeLeft;
      protect.progress = clamp(elapsed / (protect.seconds ?? 1), 0, 1);
      if (protect.progress >= 1) {
        protect.done = true;
        run.addScore(400);
        this.events.onObjectiveDone?.(protect, this.mission.objectives.indexOf(protect));
      }
      if (this.protectTargets.some((t) => !t.alive)) {
        this.running = false;
        this.events.onFail?.('RELAY TOWER LOST');
        return;
      }
    }

    this.layoutMarkers();
    for (const m of this.markers) {
      if (!m || !m.visible) continue;
      m.rotation.y += dt * 0.4;
    }
  }

  private evaluate(obj: Objective, dt: number, hero: FlightController, run: Run): boolean {
    switch (obj.kind) {
      case 'takeoff':
        return hero.airborne && hero.pos.y > 3;
      case 'hover':
        if (hero.state === 'HOVER' && hero.speed < 8) {
          obj.progress += dt / (obj.seconds ?? 3);
        } else {
          obj.progress = Math.max(0, obj.progress - dt * 0.35);
        }
        return obj.progress >= 1;
      case 'boost':
        if (hero.boostLevel > 0.4) obj.progress += dt / (obj.seconds ?? 5);
        return obj.progress >= 1;
      case 'reach': {
        if (!obj.pos) return false;
        const d = hero.pos.distanceTo(obj.pos);
        obj.progress = clamp(1 - d / (obj.radius ?? 50) / 3, 0, 1);
        return d < (obj.radius ?? 50);
      }
      case 'land': {
        if (!obj.pos) return false;
        const d = hero.pos.distanceTo(obj.pos);
        obj.progress = clamp(1 - d / (obj.radius ?? 24) / 2, 0, 1);
        return hero.grounded && d < (obj.radius ?? 24);
      }
      case 'destroy':
        obj.progress = clamp(run.kills / (obj.count ?? 10), 0, 1);
        return run.kills >= (obj.count ?? 10);
      case 'survive':
        obj.progress = clamp(obj.progress + dt / (obj.seconds ?? 30), 0, 1);
        return obj.progress >= 1;
      case 'protect':
        return obj.done;
      default:
        return false;
    }
  }

  private spawnNear(anchor: THREE.Vector3, type: EnemyType, radius: number, spread: number, hpScale = 1, difficulty = 1): void {
    const ang = Math.random() * Math.PI * 2;
    const r = radius + Math.random() * spread;
    V.set(anchor.x + Math.cos(ang) * r, anchor.y + 20 + Math.random() * 60, anchor.z + Math.sin(ang) * r);
    const ground = this.city.supportAt(V.x, V.z, V.y);
    V.y = Math.max(V.y, ground + 24);
    this.enemies.spawn(type, V.clone(), difficulty, hpScale);
  }

  /** Marker positions currently active (radar uses this). */
  activeWaypoints(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const obj of this.mission.objectives) {
      if (!obj.done && obj.pos) out.push(obj.pos);
    }
    return out;
  }

  protectState(): { name: string; integrity: number; alive: boolean }[] {
    return this.protectTargets.map((t) => ({ name: t.name, integrity: t.integrity, alive: t.alive }));
  }

  get objectiveText(): string {
    const cur = this.current;
    return cur ? cur.text : this.mission.objectives.length ? 'MISSION COMPLETE' : 'FREE FLIGHT — NO OBJECTIVES';
  }

  get progressRatio(): number {
    const list = this.mission.objectives;
    if (!list.length) return 0;
    if (list.length === 1) return list[0].progress;
    const done = list.filter((o) => o.done).length;
    const partial = this.current?.progress ?? 0;
    return clamp((done + partial) / list.length, 0, 1);
  }
}
