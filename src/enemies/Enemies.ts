import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, Rng } from '../util/Rng';
import type { CollisionWorld } from '../world/Collision';
import type { Effects } from '../fx/Effects';

/* ------------------------------------------------------------------ *
 * THE NULL SYNDICATE — original enemy faction.
 * SLEEK HULL DESIGN: every machine is built from smooth capsules,
 * blades and lenses — no boxy primitives, no toy-like proportions.
 * Visual identity: near-black gunmetal carapaces, blade wings, and a
 * single crimson sensor lens per machine. All original geometry.
 * ------------------------------------------------------------------ */

export type EnemyType =
  | 'INTERCEPTOR' | 'HUNTER' | 'HEAVY' | 'MISSILE' | 'SHIELD' | 'GROUND_AA' | 'BOSS_CARRIER';

export interface EnemyDef {
  type: EnemyType;
  hp: number;
  shield: number;
  speed: number;
  radius: number;
  score: number;
  fireRate: number; // seconds between shots (0 = no weapon)
  damage: number;
  preferredRange: number;
  flying: boolean;
  label: string;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  INTERCEPTOR: { type: 'INTERCEPTOR', hp: 60, shield: 0, speed: 34, radius: 3.4, score: 120, fireRate: 2.6, damage: 6, preferredRange: 46, flying: true, label: 'INTERCEPTOR DRONE' },
  HUNTER: { type: 'HUNTER', hp: 78, shield: 0, speed: 52, radius: 3.8, score: 180, fireRate: 3.4, damage: 7, preferredRange: 70, flying: true, label: 'AERIAL HUNTER' },
  HEAVY: { type: 'HEAVY', hp: 200, shield: 60, speed: 17, radius: 7.2, score: 340, fireRate: 1.9, damage: 11, preferredRange: 60, flying: true, label: 'HEAVY GUNSHIP' },
  MISSILE: { type: 'MISSILE', hp: 96, shield: 0, speed: 26, radius: 4.6, score: 220, fireRate: 4.6, damage: 14, preferredRange: 150, flying: true, label: 'MISSILE PLATFORM' },
  SHIELD: { type: 'SHIELD', hp: 92, shield: 140, speed: 22, radius: 4.4, score: 240, fireRate: 3.2, damage: 8, preferredRange: 55, flying: true, label: 'SHIELD UNIT' },
  GROUND_AA: { type: 'GROUND_AA', hp: 140, shield: 30, speed: 0, radius: 4.2, score: 200, fireRate: 1.6, damage: 9, preferredRange: 120, flying: false, label: 'AA BATTERY' },
  BOSS_CARRIER: { type: 'BOSS_CARRIER', hp: 1500, shield: 300, speed: 12, radius: 20, score: 2500, fireRate: 1.4, damage: 13, preferredRange: 90, flying: true, label: 'SYNDICATE CARRIER' },
};

const MAT = {
  hull: () => new THREE.MeshStandardMaterial({ color: 0x181b21, metalness: 0.94, roughness: 0.22, envMapIntensity: 1.4 }),
  hullDark: () => new THREE.MeshStandardMaterial({ color: 0x0d0f13, metalness: 0.88, roughness: 0.35, envMapIntensity: 1.0 }),
  blade: () => new THREE.MeshStandardMaterial({ color: 0x2e333c, metalness: 0.98, roughness: 0.12, envMapIntensity: 1.8 }),
  core: () => new THREE.MeshStandardMaterial({ color: 0x140404, emissive: 0xff2418, emissiveIntensity: 4.2, roughness: 0.2 }),
  accent: () => new THREE.MeshStandardMaterial({ color: 0x061318, emissive: 0xff5a2a, emissiveIntensity: 2.4, roughness: 0.25 }),
};

/** Shared helper: sleek capsule pod, optionally tapered. */
function pod(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Shared helper: swept blade (flattened, elongated octahedron). */
function blade(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, len: number, x: number, y: number, z: number, ry = 0, rz = 0): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(w, h, len);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(0, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Shared helper: glowing sensor lens with dark bezel. */
function lens(parent: THREE.Object3D, coreMat: THREE.Material, gunMat: THREE.Material, r: number, x: number, y: number, z: number): THREE.Mesh {
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.28, 10, 24), gunMat);
  bezel.position.set(x, y, z);
  parent.add(bezel);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.82, 18, 14), coreMat);
  eye.position.set(x, y, z - r * 0.15);
  eye.scale.set(1, 1, 0.55);
  parent.add(eye);
  return eye;
}

/** Builds the sleek hull for a given archetype. Forward is -Z for every ship. */
export function buildEnemyHull(type: EnemyType): { root: THREE.Group; core: THREE.Mesh; shieldMesh?: THREE.Mesh; turret?: THREE.Group } {
  const root = new THREE.Group();
  const hull = MAT.hull();
  const dark = MAT.hullDark();
  const bladeMat = MAT.blade();
  const coreMat = MAT.core();
  const accent = MAT.accent();

  const engineFlare = new THREE.MeshBasicMaterial({
    color: 0xff9a4a, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  switch (type) {
    case 'INTERCEPTOR': {
      // dart fuselage + two long blade wings + crimson lens
      const body = pod(root, hull, 0.62, 3.4, 0, 0, -0.4, Math.PI / 2);
      body.scale.set(1, 1, 0.72);
      const nose = blade(root, bladeMat, 0.5, 0.42, 2.6, 0, 0, -3.2);
      nose.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) {
        blade(root, bladeMat, 0.09, 0.85, 4.4, s * 2.5, 0, 0.6, 0, s * 0.18); // swept main wings
        blade(root, bladeMat, 0.07, 0.6, 2.2, s * 1.1, 0.35, 1.6, 0, s * -0.5); // canards
        pod(root, dark, 0.24, 0.8, s * 1.9, -0.08, 1.9, Math.PI / 2); // engine nacelles
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 12, 1, true), engineFlare);
        fl.position.set(s * 1.9, -0.08, 3.0);
        fl.rotation.x = -Math.PI / 2;
        fl.name = 'flare';
        root.add(fl);
      }
      const core = lens(root, coreMat, dark, 0.42, 0, 0.06, -1.55);
      return { root, core };
    }
    case 'HUNTER': {
      // split-hull pursuer: twin pods + bridge spine, aggressive stance
      for (const s of [-1, 1]) {
        pod(root, hull, 0.55, 3.0, s * 1.05, 0, 0.4, Math.PI / 2);
        blade(root, bladeMat, 0.08, 0.5, 3.6, s * 2.0, -0.1, 1.4, 0, s * 0.35);
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.9, 12, 1, true), engineFlare);
        fl.position.set(s * 1.05, 0, 3.3);
        fl.rotation.x = -Math.PI / 2;
        fl.name = 'flare';
        root.add(fl);
      }
      pod(root, dark, 0.3, 2.6, 0, 0.32, 0.4, Math.PI / 2); // spine bridge
      const core = lens(root, coreMat, dark, 0.4, 0, 0.3, -1.3);
      return { root, core };
    }
    case 'HEAVY': {
      // broad-wing gunship: thick center lozenge, four engine rings, twin cannons
      const body = new THREE.Mesh(new THREE.SphereGeometry(2.1, 26, 18), hull);
      body.scale.set(1.25, 0.72, 1.9);
      body.castShadow = true;
      root.add(body);
      for (const s of [-1, 1]) {
        blade(root, bladeMat, 0.14, 1.15, 6.4, s * 3.4, 0.1, 0.8, 0, s * 0.12);
        pod(root, dark, 0.5, 1.6, s * 2.6, -0.35, 2.4, Math.PI / 2);
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 14, 1, true), engineFlare);
        fl.position.set(s * 2.6, -0.35, 4.0);
        fl.rotation.x = -Math.PI / 2;
        fl.name = 'flare';
        root.add(fl);
        // underwing cannon pods
        pod(root, dark, 0.28, 2.2, s * 3.2, -0.55, -0.6, Math.PI / 2);
        new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 10), dark).translateX(0).translateY(0).translateZ(0);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.0, 10), dark);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(s * 3.2, -0.55, -2.4);
        root.add(barrel);
      }
      const core = lens(root, coreMat, dark, 0.7, 0, 0.75, -1.7);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 0.3), accent);
      strip.position.set(0, 0.9, 0.6);
      root.add(strip);
      return { root, core };
    }
    case 'MISSILE': {
      // slender rail platform: long spindle + missile racks
      pod(root, hull, 0.7, 5.2, 0, 0, 0.4, Math.PI / 2);
      const nose = blade(root, bladeMat, 0.42, 0.42, 2.4, 0, 0, -3.4);
      nose.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) {
        for (const t of [-1, 1]) {
          const rack = pod(root, dark, 0.2, 1.9, s * 1.15, -0.35, t * 1.1, Math.PI / 2);
          void rack;
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 12), dark);
          tube.rotation.x = Math.PI / 2;
          tube.position.set(s * 1.15, -0.35, t * 1.1 - 1.3);
          root.add(tube);
        }
        blade(root, bladeMat, 0.07, 0.75, 2.8, s * 1.7, 0.15, 2.2, 0, s * -0.4);
      }
      const core = lens(root, coreMat, dark, 0.38, 0, 0.45, -1.9);
      return { root, core };
    }
    case 'SHIELD': {
      // smooth orbiter sphere + dual halo rings + lens
      const body = new THREE.Mesh(new THREE.SphereGeometry(2.6, 30, 22), hull);
      body.castShadow = true;
      root.add(body);
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.14, 10, 40), bladeMat);
      ringA.rotation.x = Math.PI / 2;
      ringA.castShadow = true;
      root.add(ringA);
      const ringB = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.1, 10, 40), bladeMat);
      ringB.rotation.y = Math.PI / 2;
      root.add(ringB);
      const core = lens(root, coreMat, dark, 0.6, 0, 0, -2.35);
      const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(6.0, 24, 18), new THREE.MeshStandardMaterial({
        color: 0x0a2030, emissive: 0xffa060, emissiveIntensity: 0.9, transparent: true, opacity: 0.2,
        roughness: 0.1, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false,
      }));
      shieldMesh.name = 'shield';
      root.add(shieldMesh);
      return { root, core, shieldMesh };
    }
    case 'GROUND_AA': {
      // sleek tripod walker: lens head + articulated legs
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 18), hull);
      head.scale.set(1, 0.85, 1);
      head.position.y = 3.1;
      head.castShadow = true;
      root.add(head);
      const turret = new THREE.Group();
      turret.position.set(0, 3.1, 0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.4, 14), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0, -2.0);
      turret.add(barrel);
      root.add(turret);
      const core = lens(root, coreMat, dark, 0.5, 0, 0.15, -1.15);
      root.add(core.parent === root ? new THREE.Object3D() : new THREE.Object3D()); // keep counts stable
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const hipX = Math.cos(a) * 1.15, hipZ = Math.sin(a) * 1.15;
        const upper = pod(root, dark, 0.17, 1.7, hipX * 1.5, 2.1, hipZ * 1.5, 0, 0, 0);
        upper.lookAt(0, 3.0, 0);
        upper.rotateX(Math.PI / 2);
        const lower = pod(root, dark, 0.13, 1.9, hipX * 2.1, 0.95, hipZ * 2.1, 0, 0, 0);
        lower.lookAt(hipX * 1.5, 2.1, hipZ * 1.5);
        lower.rotateX(Math.PI / 2);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), bladeMat);
        foot.position.set(hipX * 2.35, 0.3, hipZ * 2.35);
        root.add(foot);
      }
      return { root, core, turret };
      // (legs attach to root; turret holds the barrel)
    }
    case 'BOSS_CARRIER':
    default: {
      // command leviathan: layered smooth hull, blade fins, crimson command lens
      const spine = new THREE.Mesh(new THREE.CapsuleGeometry(5.5, 34, 12, 24), hull);
      spine.rotation.x = Math.PI / 2;
      spine.scale.set(1.3, 1, 0.72);
      spine.castShadow = true;
      root.add(spine);
      const conning = new THREE.Mesh(new THREE.SphereGeometry(4.2, 26, 18), dark);
      conning.scale.set(1.15, 0.6, 1.4);
      conning.position.set(0, 2.6, 2);
      conning.castShadow = true;
      root.add(conning);
      for (const s of [-1, 1]) {
        blade(root, bladeMat, 0.3, 5.2, 14, s * 9.5, 0.5, 3, 0, s * 0.1); // blade sails
        pod(root, dark, 1.15, 6.0, s * 7.5, -0.5, 6, Math.PI / 2);
        const fl = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.5, 14, 1, true), engineFlare);
        fl.position.set(s * 7.5, -0.5, 10.5);
        fl.rotation.x = -Math.PI / 2;
        fl.name = 'flare';
        root.add(fl);
      }
      const keel = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 16, 10, 18), dark);
      keel.rotation.x = Math.PI / 2;
      keel.position.set(0, -2.6, 2);
      root.add(keel);
      const core = lens(root, coreMat, dark, 1.9, 0, -0.5, -14);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(20, 0.16, 0.5), accent);
      strip.position.set(0, 4.4, 0);
      root.add(strip);
      return { root, core };
    }
  }
}


export interface Enemy {
  def: EnemyDef;
  root: THREE.Group;
  core: THREE.Mesh;  shieldMesh?: THREE.Mesh;
  turret?: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  shield: number;
  maxHp: number;
  maxShield: number;
  active: boolean;
  state: 'engage' | 'stunned' | 'downed';
  yaw: number;
  pitch: number;
  roll: number;
  fireTimer: number;
  charge: number;
  telegraph: number;
  stunTimer: number;
  downTimer: number;
  wobble: number;
  phase: number;
  seed: number;
  score: number;
}

export interface HostileBolt {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  active: boolean;
  homing: number;
  radius: number;
}

export interface EnemyContext {
  heroPos: THREE.Vector3;
  heroVel: THREE.Vector3;
  collision: CollisionWorld;
  fx: Effects;
  damageHero: (amount: number, source: THREE.Vector3, kind: string) => void;
  onEnemyDowned?: (enemy: Enemy) => void;
  onEnemyDamaged?: (enemy: Enemy, amount: number) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

export class EnemyManager {
  group = new THREE.Group();
  enemies: Enemy[] = [];
  hostiles: HostileBolt[] = [];
  private rng = new Rng(97531);
  private boltGeo: THREE.SphereGeometry;
  private boltMat: THREE.MeshStandardMaterial;
  private missileGeo: THREE.CapsuleGeometry;

  constructor(private collision: CollisionWorld, private fx: Effects, private maxEnemies = 34) {
    this.boltGeo = new THREE.SphereGeometry(0.55, 10, 8);
    this.boltMat = new THREE.MeshStandardMaterial({
      color: 0x220604, emissive: 0xff6a2f, emissiveIntensity: 3.4, roughness: 0.3,
    });
    this.missileGeo = new THREE.CapsuleGeometry(0.4, 1.6, 4, 8).rotateX(Math.PI / 2);

    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(this.boltGeo, this.boltMat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.hostiles.push({
        mesh: m, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        life: 0, damage: 6, active: false, homing: 0, radius: 3.2,
      });
    }
  }

  clear(): void {
    for (const e of this.enemies) {
      this.group.remove(e.root);
    }
    this.enemies.length = 0;
    for (const b of this.hostiles) {
      b.active = false;
      b.mesh.visible = false;
    }
  }

  spawn(type: EnemyType, pos: THREE.Vector3, difficulty = 1, hpScale = 1): Enemy {
    const def = ENEMY_DEFS[type];
    const built = buildEnemyHull(type);
    built.root.position.copy(pos);
    built.root.castShadow = true;
    this.group.add(built.root);

    const enemy: Enemy = {
      def, root: built.root, core: built.core, shieldMesh: built.shieldMesh, turret: built.turret,
      pos: pos.clone(), vel: new THREE.Vector3(),
      hp: def.hp * hpScale, shield: def.shield * hpScale,
      maxHp: def.hp * hpScale, maxShield: def.shield * hpScale,
      active: true, state: 'engage',
      yaw: this.rng.range(0, Math.PI * 2), pitch: 0, roll: 0,
      fireTimer: this.rng.range(0.6, 2.4), charge: 0, telegraph: 0,
      stunTimer: 0, downTimer: 0, wobble: this.rng.range(0, Math.PI * 2),
      phase: 0, seed: this.rng.next(), score: def.score,
    };
    this.enemies.push(enemy);
    void difficulty;
    return enemy;
  }

  /** Enemies within a radius of a point (used by missions and the radar). */
  near(pos: THREE.Vector3, radius: number): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.pos.distanceToSquared(pos) < radius * radius) out.push(e);
    }
    return out;
  }

  get aliveCount(): number {
    return this.enemies.reduce((n, e) => n + (e.active && e.state !== 'downed' ? 1 : 0), 0);
  }

  nearestTarget(pos: THREE.Vector3, maxDist = 900): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (!e.active || e.state === 'downed') continue;
      const d = e.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Applies damage. Returns true when the shot disabled the unit. */
  damage(enemy: Enemy, amount: number, _from: THREE.Vector3, fx?: Effects): boolean {
    if (!enemy.active || enemy.state === 'downed') return false;
    let remaining = amount;
    if (enemy.shield > 0) {
      const absorbed = Math.min(enemy.shield, remaining);
      enemy.shield -= absorbed;
      remaining -= absorbed;
      if (enemy.shieldMesh) {
        (enemy.shieldMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.6;
      }
    }
    enemy.hp -= remaining;
    if (enemy.hp <= 0) {
      this.down(enemy, fx);
      return true;
    }
    return false;
  }

  private down(enemy: Enemy, fx?: Effects): void {
    enemy.hp = 0;
    enemy.state = 'downed';
    enemy.downTimer = 0;
    enemy.vel.multiplyScalar(0.3);
    if (enemy.shieldMesh) enemy.shieldMesh.visible = false;
    if (fx) {
      fx.explosion(enemy.pos, enemy.def.type === 'BOSS_CARRIER' ? 2.2 : 0.9, 0xff8a3a);
    }
  }

  /** Stun from the EMP pulse. */
  stun(pos: THREE.Vector3, radius: number, duration: number, fx?: Effects): number {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.active || e.state === 'downed') continue;
      if (e.pos.distanceToSquared(pos) > radius * radius) continue;
      e.state = 'stunned';
      e.stunTimer = duration;
      e.charge = 0;
      e.telegraph = 0;
      n++;
      if (fx) fx.energyHit(e.pos, 0x9fe8ff);
    }
    return n;
  }

  update(dt: number, ctx: EnemyContext, difficulty: number): void {
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.state === 'downed') {
        this.updateDowned(e, dt, ctx);
        continue;
      }
      if (e.state === 'stunned') {
        e.stunTimer -= dt;
        e.vel.y -= 14 * dt;
        e.vel.multiplyScalar(Math.max(0, 1 - 1.1 * dt));
        e.pos.addScaledVector(e.vel, dt);
        e.root.rotation.z += dt * 5;
        e.root.rotation.x += dt * 2;
        if (Math.random() < dt * 4) ctx.fx.energyHit(e.pos, 0x9fe8ff);
        if (Math.floor(e.stunTimer * 4) !== Math.floor((e.stunTimer + dt) * 4)) ctx.fx.sparkBurst(e.pos, 0.4, 0x8fe8ff, 5);
        if (e.stunTimer <= 0) {
          e.state = 'engage';
          e.root.rotation.set(0, e.yaw, 0);
        }
        e.root.position.copy(e.pos);
        this.settle(e, dt);
        continue;
      }
      this.updateEngaged(e, dt, ctx, difficulty);
    }
    this.updateHostiles(dt, ctx);
    // recycle fully expired wrecks
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === 'downed' && e.downTimer > 7) {
        this.group.remove(e.root);
        this.enemies.splice(i, 1);
      }
    }
  }

  private settle(e: Enemy, dt: number): void {
    if (!e.def.flying) return;
    const ground = this.collision.supportHeightAt(e.pos.x, e.pos.z, e.pos.y, 2);
    if (ground !== null && e.pos.y - e.def.radius < ground) {
      e.pos.y = ground + e.def.radius;
      e.vel.y = Math.max(0, e.vel.y);
    }
  }

  private updateDowned(e: Enemy, dt: number, ctx: EnemyContext): void {
    e.downTimer += dt;
    e.vel.y -= 26 * dt;
    e.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
    e.pos.addScaledVector(e.vel, dt);
    e.root.rotation.x += dt * (1.6 + e.seed);
    e.root.rotation.z += dt * 2.4;
    e.root.position.copy(e.pos);
    if (Math.random() < dt * 8) ctx.fx.sparkBurst(e.pos, 0.5, 0xffa050, 4);

    const ground = this.collision.supportHeightAt(e.pos.x, e.pos.z, e.pos.y, 2) ?? 0;
    if (e.pos.y - e.def.radius <= ground && e.downTimer > 0.2) {
      if (e.vel.lengthSq() > 25) {
        ctx.fx.explosion(e.pos, e.def.type === 'BOSS_CARRIER' ? 2.6 : 1.0, 0xffa040);
      }
      e.vel.set(0, 0, 0);
      e.pos.y = ground + e.def.radius * 0.6;
      e.root.position.copy(e.pos);
      e.downTimer = Math.max(e.downTimer, 3);
    }
  }

  private updateEngaged(e: Enemy, dt: number, ctx: EnemyContext, difficulty: number): void {
    const toHero = new THREE.Vector3().subVectors(ctx.heroPos, e.pos);
    const dist = toHero.length();
    const dir = toHero.clone().multiplyScalar(1 / Math.max(0.001, dist));

    // ---- desired steering
    const want = new THREE.Vector3();
    const range = e.def.preferredRange;
    if (e.def.type === 'GROUND_AA') {
      want.set(0, 0, 0);
    } else if (dist > range * 1.25) {
      want.copy(dir);
    } else if (dist < range * 0.7) {
      want.copy(dir).multiplyScalar(-1);
    } else {
      // orbit: strafe around the hero for a lively dogfight
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      const orbitDir = Math.sin(e.wobble * 0.35 + performance.now() * 0.0002) > 0 ? 1 : -1;
      want.copy(side).multiplyScalar(orbitDir * 0.9);
      want.y += Math.sin(performance.now() * 0.0007 + e.seed * 9) * 0.4;
    }
    if (e.def.type === 'HUNTER') {
      const boost = clamp((dist - range) / 120, -0.4, 1.2);
      want.copy(dir).multiplyScalar(boost).addScaledVector(UP, 0.1);
    }

    // ---- terrain avoidance
    const probe = e.pos.clone().addScaledVector(e.def.type === 'GROUND_AA' ? new THREE.Vector3() : dir, 12);
    if (this.collision.overlaps(probe, e.def.radius * 1.2)) {
      want.y += 1.6;
      want.addScaledVector(new THREE.Vector3(dir.z, 0, -dir.x), 0.6);
    }

    want.normalize().multiplyScalar(e.def.speed * (0.85 + difficulty * 0.15));
    e.vel.lerp(want, damp(1.5, dt));
    e.pos.addScaledVector(e.vel, dt);

    // hard collision + ground clamp
    const ground = this.collision.supportHeightAt(e.pos.x, e.pos.z, e.pos.y, 2);
    if (ground !== null && e.pos.y - e.def.radius < ground) {
      e.pos.y = ground + e.def.radius;
      e.vel.y = Math.max(0, e.vel.y + 6 * dt);
    }
    const hit = this.collision.resolveSphere(e.pos, e.def.radius * 0.85, {
      box: this.collision.all[0], normal: new THREE.Vector3(), depth: 0,
    });
    if (hit) {
      e.pos.addScaledVector(hit.normal, hit.depth + 0.05);
      e.vel.addScaledVector(hit.normal, -e.vel.dot(hit.normal) * 0.6);
    }

    // ---- orientation
    const lookTarget = e.def.type === 'GROUND_AA' ? ctx.heroPos : e.pos.clone().addScaledVector(e.vel, 0.6);
    const flat = new THREE.Vector3().subVectors(lookTarget, e.pos);
    const desiredYaw = Math.atan2(-flat.x, -flat.z);
    const desiredPitch = clamp(Math.asin(clamp(flat.clone().normalize().y, -1, 1)), -0.7, 0.7);
    e.yaw += angleDelta(e.yaw, desiredYaw) * damp(3.2, dt);
    e.pitch += (desiredPitch - e.pitch) * damp(3.0, dt);
    e.roll = -angleDelta(e.yaw, desiredYaw) * 0.9;

    if (e.turret) {
      e.turret.rotation.y = angleDelta(0, Math.atan2(-dir.x, -dir.z));
      e.turret.rotation.x = -desiredPitch;
      e.root.rotation.y = 0;
    } else {
      e.root.rotation.set(e.pitch, e.yaw, e.roll, 'YXZ');
    }
    e.root.position.copy(e.pos);

    // ---- core pulse
    const coreMat = e.core.material as THREE.MeshStandardMaterial;
    coreMat.emissiveIntensity = 2.6 + Math.sin(performance.now() * 0.004 + e.seed * 10) * 0.8 + e.charge * 3;

    if (e.shieldMesh) {
      const sMat = e.shieldMesh.material as THREE.MeshStandardMaterial;
      sMat.emissiveIntensity = Math.max(0.25, (e.shield / Math.max(1, e.maxShield)) * 2.0);
      sMat.opacity = 0.08 + (e.shield / Math.max(1, e.maxShield)) * 0.2;
      e.shieldMesh.rotation.y += dt * 0.6;
    }

    // ---- weapons
    if (e.def.fireRate > 0) {
      const inRange = dist < range * 2.4 + 60;
      const los = this.collision.losClear(e.pos, ctx.heroPos);
      e.fireTimer -= dt * (0.85 + difficulty * 0.3);
      if (e.telegraph > 0) {
        e.telegraph -= dt;
        if (e.telegraph <= 0) {
          this.fire(e, ctx, difficulty);
          e.fireTimer = e.def.fireRate * this.rng.range(0.85, 1.2);
        }
      } else if (e.fireTimer <= 0 && inRange && los && dist > 8) {
        e.telegraph = 0.45;
        e.charge = 1;
      }
      e.charge = Math.max(0, e.charge - dt * 2.2);
    }
  }

  private fire(e: Enemy, ctx: EnemyContext, difficulty: number): void {
    const shots = e.def.type === 'HEAVY' ? 3 : e.def.type === 'BOSS_CARRIER' ? 4 : 1;
    for (let i = 0; i < shots; i++) {
      const spread = shots > 1 ? (i - (shots - 1) / 2) * 0.05 : 0;
      this.launchBolt(e, ctx, spread, e.def.damage * (0.8 + difficulty * 0.25));
    }
    ctx.fx.energyHit(e.pos.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, e.yaw), e.def.radius), 0xff8a4a);
  }

  private launchBolt(e: Enemy, ctx: EnemyContext, spread: number, damage: number): void {
    const bolt = this.hostiles.find((b) => !b.active);
    if (!bolt) return;
    const origin = e.pos.clone();
    const aim = new THREE.Vector3().subVectors(ctx.heroPos, origin);
    const dist = aim.length();
    // lead the target so fast flight still gets threatened
    aim.addScaledVector(ctx.heroVel, clamp(dist / 220, 0, 0.8));
    aim.normalize();
    aim.applyAxisAngle(UP, spread);
    const speed = e.def.type === 'MISSILE' ? 70 : 150;
    bolt.pos.copy(origin).addScaledVector(aim, e.def.radius + 1);
    bolt.vel.copy(aim).multiplyScalar(speed);
    bolt.life = e.def.type === 'MISSILE' ? 9 : 4.2;
    bolt.damage = damage;
    bolt.active = true;
    bolt.homing = e.def.type === 'MISSILE' ? 2.2 : 0;
    bolt.radius = e.def.type === 'MISSILE' ? 3.4 : 2.8;
    bolt.mesh.geometry = e.def.type === 'MISSILE' ? this.missileGeo : this.boltGeo;
    bolt.mesh.visible = true;
    bolt.mesh.position.copy(bolt.pos);
  }

  private updateHostiles(dt: number, ctx: EnemyContext): void {
    for (const b of this.hostiles) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.homing > 0) {
        const desired = new THREE.Vector3().subVectors(ctx.heroPos, b.pos).normalize().multiplyScalar(b.vel.length());
        b.vel.lerp(desired, damp(b.homing, dt));
        b.homing += dt * 0.35;
      }
      const step = b.vel.clone().multiplyScalar(dt);
      const nextPos = b.pos.clone().add(step);

      // world collision along the flight path
      const hit = this.collision.raycast(b.pos, b.vel.clone().normalize(), step.length() + 0.4);
      if (hit) {
        ctx.fx.impact(hit.point, new THREE.Vector3(0, 1, 0), 0.6);
        b.active = false;
        b.mesh.visible = false;
        continue;
      }

      b.pos.copy(nextPos);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y += dt * 6;

      if (b.pos.distanceTo(ctx.heroPos) < b.radius) {
        ctx.damageHero(b.damage, b.pos.clone(), 'plasma');
        ctx.fx.energyHit(b.pos, 0xff7a3a);
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      if (b.life <= 0 || b.pos.y < -20) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  /** Player bolts / missile interception: does a point hit a hostile bolt? */
  interceptBolts(pos: THREE.Vector3, radius: number, fx: Effects): number {
    let n = 0;
    for (const b of this.hostiles) {
      if (!b.active) continue;
      if (b.pos.distanceTo(pos) < radius + b.radius) {
        b.active = false;
        b.mesh.visible = false;
        fx.explosion(b.pos, 0.5, 0xffc070);
        n++;
      }
    }
    return n;
  }
}

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
