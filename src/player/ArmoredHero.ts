import * as THREE from 'three';
import { clamp, damp, lerp } from '../util/Rng';
import { ENERGY, INTEGRITY, type FlightState } from '../config';

/* ------------------------------------------------------------------ *
 * ORIGINAL ARMORED HERO — "IRONFALL MK-1"
 * Built procedurally from primitives: armored superhero suit with
 * glowing chest reactor, repulsor palms, boot/back thrusters, full
 * articulation. The palette is applied by the ARMORY (src/player/Suit.ts)
 * so each suit frame re-skins the same geometry — no third-party or
 * copyrighted geometry, textures, logos or suit patterns are used.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * ORIGINAL ARMORED HERO — "IRONFALL MARK-1"
 * Built procedurally from primitives: red/gold metallic superhero armor,
 * glowing chest reactor, repulsor palms, boot/back thrusters, full
 * articulation (shoulder/elbow/hip/knee/head). No third-party or
 * copyrighted geometry, textures, logos or suit patterns are used.
 * ------------------------------------------------------------------ */

interface PoseValues {
  hipX: number; hipZ: number; kneeX: number;
  shX: number; shZ: number; elbowX: number;
  headX: number; torsoX: number; torsoZ: number;
}

const POSES: Record<string, PoseValues> = {
  idle: { hipX: 0, hipZ: 0.06, kneeX: 0.05, shX: 0, shZ: 0.1, elbowX: 0.18, headX: 0, torsoX: 0, torsoZ: 0 },
  flight: { hipX: 0.12, hipZ: 0.05, kneeX: 0.12, shX: 0.12, shZ: 0.95, elbowX: 0.5, headX: -0.06, torsoX: 0.14, torsoZ: 0 },
  hover: { hipX: -0.08, hipZ: 0.14, kneeX: 0.22, shX: -0.12, shZ: 0.55, elbowX: 0.55, headX: 0.05, torsoX: -0.05, torsoZ: 0 },
  boost: { hipX: 0.3, hipZ: 0.03, kneeX: 0.2, shX: 0.55, shZ: 1.32, elbowX: 0.75, headX: 0.02, torsoX: 0.24, torsoZ: 0 },
  dive: { hipX: 0.2, hipZ: 0.02, kneeX: 0.08, shX: 0.45, shZ: 1.5, elbowX: 0.15, headX: 0.1, torsoX: 0.3, torsoZ: 0 },
  brake: { hipX: 0.45, hipZ: 0.2, kneeX: 0.75, shX: -0.75, shZ: 1.05, elbowX: 0.95, headX: 0.12, torsoX: -0.2, torsoZ: 0 },
  climb: { hipX: -0.2, hipZ: 0.06, kneeX: 0.1, shX: -0.35, shZ: 0.35, elbowX: 0.6, headX: -0.14, torsoX: -0.18, torsoZ: 0 },
  land: { hipX: 0.6, hipZ: 0.16, kneeX: 1.0, shX: -0.5, shZ: 0.8, elbowX: 0.9, headX: 0.16, torsoX: -0.32, torsoZ: 0 },
  stagger: { hipX: -0.35, hipZ: 0.34, kneeX: 0.5, shX: -0.9, shZ: 0.5, elbowX: 0.35, headX: 0.3, torsoX: -0.25, torsoZ: 0.22 },
  ground: { hipX: 0, hipZ: 0.05, kneeX: 0.08, shX: 0, shZ: 0.14, elbowX: 0.25, headX: 0, torsoX: 0, torsoZ: 0 },
};

export const STATE_POSE: Record<FlightState, keyof typeof POSES> = {
  IDLE: 'idle',
  GROUND: 'ground',
  TAKEOFF: 'climb',
  HOVER: 'hover',
  FLIGHT: 'flight',
  BOOST: 'boost',
  DIVE: 'dive',
  CLIMB: 'climb',
  BRAKE: 'brake',
  LANDING: 'land',
  STAGGERED: 'stagger',
};

export class ArmoredHero {
  root = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();

  private plumes: THREE.Mesh[] = [];
  private repulsors: THREE.Mesh[] = [];
  private reactor!: THREE.Mesh;
  private visor!: THREE.Mesh;
  /** Shared suit materials, re-skinned by the ARMORY. */
  mats = {
    primary: null as THREE.MeshStandardMaterial | null,
    primaryDark: null as THREE.MeshStandardMaterial | null,
    secondary: null as THREE.MeshStandardMaterial | null,
    trim: null as THREE.MeshStandardMaterial | null,
    glow: null as THREE.MeshStandardMaterial | null,
    visorGlow: null as THREE.MeshStandardMaterial | null,
    reactorGlow: null as THREE.MeshStandardMaterial | null,
    amber: null as THREE.MeshStandardMaterial | null,
  };
  private pose: PoseValues = { ...POSES.idle };
  private flareMat: THREE.MeshBasicMaterial;
  private impactFlash = 0;

  constructor() {
    /* SLEEK MK-1 — smooth carapace robot. Zero box geometry: everything is
     * capsules / spheres / tori with high segment counts, slender athletic
     * proportions and near-mirror metal so the environment probe does the
     * shading work. Palette fields map 1:1 to the ARMORY system. */
    const red = new THREE.MeshStandardMaterial({ color: 0xa81f1a, metalness: 0.9, roughness: 0.24, envMapIntensity: 1.45 });
    const redDark = new THREE.MeshStandardMaterial({ color: 0x4a0d0a, metalness: 0.86, roughness: 0.38, envMapIntensity: 1.1 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a63e, metalness: 0.97, roughness: 0.13, envMapIntensity: 1.7 });
    const gun = new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.92, roughness: 0.3, envMapIntensity: 1.2 });

    const glow = (color: number, intensity: number) =>
      new THREE.MeshStandardMaterial({
        color: 0x06121a, emissive: new THREE.Color(color), emissiveIntensity: intensity,
        roughness: 0.25, metalness: 0.1,
      });

    const cyan = glow(0x63e8ff, 2.6);
    const amber = glow(0xffb347, 2.0);
    const visorGlowMat = glow(0xa9f4ff, 3.2);
    const reactorGlowMat = glow(0xcdf3ff, 3.8);
    this.mats.primary = red;
    this.mats.primaryDark = redDark;
    this.mats.secondary = gold;
    this.mats.trim = gun;
    this.mats.glow = cyan;
    this.mats.visorGlow = visorGlowMat;
    this.mats.reactorGlow = reactorGlowMat;
    this.mats.amber = amber;

    this.flareMat = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    /* torso: smooth breastplate over a dark undersuit -------------------- */
    const chest = add(this.torso, new THREE.SphereGeometry(0.5, 28, 22), red, 0, 0.3, 0.02);
    chest.scale.set(0.94, 1.04, 0.64);
    const upperChest = add(this.torso, new THREE.SphereGeometry(0.38, 24, 18), red, 0, 0.52, 0.03);
    upperChest.scale.set(0.92, 0.62, 0.6);
    const abs = add(this.torso, new THREE.CapsuleGeometry(0.235, 0.24, 10, 20), redDark, 0, -0.02, 0.015);
    abs.scale.set(1.12, 1, 0.78);
    const pelvis = add(this.torso, new THREE.SphereGeometry(0.3, 22, 16), redDark, 0, -0.36, 0);
    pelvis.scale.set(1.05, 0.7, 0.8);
    add(this.torso, new THREE.TorusGeometry(0.235, 0.07, 12, 28), gun, 0, 0.585, 0.02, Math.PI / 2 + 0.25, 0, 0); // collar

    // recessed reactor: dark bezel ring + glowing core
    add(this.torso, new THREE.TorusGeometry(0.155, 0.05, 12, 26), gun, 0, 0.3, -0.28);
    this.reactor = add(this.torso, new THREE.CylinderGeometry(0.115, 0.115, 0.06, 24), reactorGlowMat, 0, 0.3, -0.29, Math.PI / 2, 0, 0);
    // spine ridge
    const spine = add(this.torso, new THREE.CapsuleGeometry(0.07, 0.5, 8, 14), gun, 0, 0.24, 0.185);
    spine.scale.set(1, 1, 0.55);

    // back thruster pods (smooth capsules) + plumes
    for (const sx of [-0.19, 0.19]) {
      const pod = add(this.torso, new THREE.CapsuleGeometry(0.105, 0.26, 8, 16), gun, sx, 0.14, 0.24, 0.5, 0, 0);
      void pod;
      add(this.torso, new THREE.CylinderGeometry(0.075, 0.095, 0.09, 14), amber, sx, -0.06, 0.33, 0.5, 0, 0);
      const plume = add(this.torso, new THREE.ConeGeometry(0.11, 0.95, 14, 1, true), this.flareMat, sx, -0.44, 0.44, Math.PI + 0.5, 0, 0);
      plume.visible = false;
      this.plumes.push(plume);
    }

    /* head: smooth helmet shell + gold faceplate + pill visor ------------ */
    const helm = add(this.head, new THREE.SphereGeometry(0.26, 28, 22), red, 0, 0.02, 0);
    helm.scale.set(0.92, 1.1, 0.98);
    const face = add(this.head, new THREE.SphereGeometry(0.215, 26, 20), gold, 0, -0.015, -0.085);
    face.scale.set(0.84, 0.86, 0.72);
    // eye visor: horizontal pill — the sleek signature
    this.visor = add(this.head, new THREE.CapsuleGeometry(0.026, 0.17, 6, 14), visorGlowMat, 0, 0.045, -0.225, 0, 0, Math.PI / 2);
    // brow line
    const brow = add(this.head, new THREE.CapsuleGeometry(0.018, 0.2, 6, 12), gun, 0, 0.115, -0.185, 0, 0, Math.PI / 2);
    void brow;
    // ear caps
    for (const sx of [-1, 1]) {
      const cap = add(this.head, new THREE.CylinderGeometry(0.06, 0.07, 0.045, 16), gold, sx * 0.245, 0.02, -0.01, 0, 0, Math.PI / 2);
      void cap;
    }
    this.head.position.set(0, 0.82, 0);
    this.torso.add(this.head);

    /* arms: smooth tapered capsules -------------------------------------- */
    const buildArm = (side: number, shoulder: THREE.Group, elbow: THREE.Group) => {
      shoulder.position.set(side * 0.42, 0.46, 0);
      const pauldron = add(shoulder, new THREE.SphereGeometry(0.17, 22, 18), red, side * 0.03, 0.03, 0);
      pauldron.scale.set(1.05, 0.9, 1);
      add(shoulder, new THREE.SphereGeometry(0.1, 16, 14), gold, side * 0.09, -0.05, 0.01); // cap accent
      add(elbow, new THREE.CapsuleGeometry(0.082, 0.26, 8, 16), red, 0, -0.2, 0);
      add(elbow, new THREE.SphereGeometry(0.075, 14, 12), gun, 0, -0.37, 0);
      add(elbow, new THREE.CapsuleGeometry(0.072, 0.26, 8, 16), gold, 0, -0.55, 0); // smooth gold forearm
      const palm = add(elbow, new THREE.CylinderGeometry(0.068, 0.075, 0.05, 18), cyan, 0, -0.73, 0, Math.PI / 2, 0, 0);
      const flare = add(elbow, new THREE.CircleGeometry(0.11, 18), this.flareMat, 0, -0.76, 0, Math.PI / 2, 0, 0);
      flare.visible = false;
      this.repulsors.push(palm, flare);
      elbow.position.set(0, -0.16, 0);
      shoulder.add(elbow);
      this.torso.add(shoulder);
    };
    buildArm(-1, this.armL, this.elbowL);
    buildArm(1, this.armR, this.elbowR);

    /* legs: smooth tapered capsules into sculpted boots ------------------- */
    const buildLeg = (side: number, hip: THREE.Group, knee: THREE.Group) => {
      hip.position.set(side * 0.185, -0.58, 0);
      add(hip, new THREE.SphereGeometry(0.145, 18, 14), gold, 0, 0.03, 0);
      add(hip, new THREE.CapsuleGeometry(0.095, 0.28, 8, 16), red, 0, -0.22, 0);
      add(knee, new THREE.SphereGeometry(0.082, 14, 12), gun, 0, -0.02, 0);
      add(knee, new THREE.CapsuleGeometry(0.082, 0.3, 8, 16), red, 0, -0.26, 0);
      // boot: smooth capsule lying forward
      const boot = add(knee, new THREE.CapsuleGeometry(0.092, 0.2, 8, 16), gold, 0, -0.5, -0.055, Math.PI / 2 + 0.12, 0, 0);
      boot.scale.set(1.02, 1, 1.12);
      add(knee, new THREE.CylinderGeometry(0.06, 0.08, 0.08, 14), amber, 0, -0.5, 0.14, Math.PI / 2, 0, 0);
      const plume = add(knee, new THREE.ConeGeometry(0.1, 1.05, 14, 1, true), this.flareMat, 0, -0.56, 0.62, Math.PI / 2, 0, 0);
      plume.visible = false;
      this.plumes.push(plume);
      knee.position.set(0, -0.5, 0);
      hip.add(knee);
      this.torso.add(hip);
    };
    buildLeg(-1, this.legL, this.kneeL);
    buildLeg(1, this.legR, this.kneeR);

    this.root.add(this.torso);
    this.root.name = 'hero';
  }

  get object(): THREE.Object3D {
    return this.root;
  }

  /** Per-frame pose + FX update. thrust/boost/brake are 0..1 smoothed values. */
  update(dt: number, state: FlightState, thrust: number, boost: number, speedNorm: number, damaged: number): void {
    const key = STATE_POSE[state] ?? 'flight';
    const target = POSES[key];

    const k = damp(6.5, dt);
    this.pose.hipX = lerp(this.pose.hipX, target.hipX, k);
    this.pose.hipZ = lerp(this.pose.hipZ, target.hipZ, k);
    this.pose.kneeX = lerp(this.pose.kneeX, target.kneeX, k);
    this.pose.shX = lerp(this.pose.shX, target.shX, k);
    this.pose.shZ = lerp(this.pose.shZ, target.shZ, k);
    this.pose.elbowX = lerp(this.pose.elbowX, target.elbowX, k);
    this.pose.headX = lerp(this.pose.headX, target.headX, k);
    this.pose.torsoX = lerp(this.pose.torsoX, target.torsoX, k);
    this.pose.torsoZ = lerp(this.pose.torsoZ, target.torsoZ, k);

    const thrustAdd = thrust * 0.12;
    const flutter = Math.sin(performance.now() * 0.006) * 0.01;

    this.armL.rotation.set(this.pose.shX + thrustAdd, 0, this.pose.shZ + flutter);
    this.armR.rotation.set(this.pose.shX + thrustAdd, 0, -this.pose.shZ - flutter);
    this.elbowL.rotation.set(this.pose.elbowX, 0, 0.05);
    this.elbowR.rotation.set(this.pose.elbowX, 0, -0.05);
    this.legL.rotation.set(this.pose.hipX, 0, this.pose.hipZ);
    this.legR.rotation.set(-this.pose.hipX * 0.6 + this.pose.hipX, 0, -this.pose.hipZ);
    this.kneeL.rotation.set(this.pose.kneeX, 0, 0);
    this.kneeR.rotation.set(this.pose.kneeX * 0.85, 0, 0);
    this.head.rotation.set(this.pose.headX, 0, 0);
    this.torso.rotation.set(this.pose.torsoX, 0, this.pose.torsoZ);

    // thruster plumes react to thrust & boost
    const power = clamp(thrust * 0.7 + boost, 0, 1.6);
    for (const p of this.plumes) {
      const on = power > 0.06;
      p.visible = on;
      if (on) {
        const flick = 1 + Math.sin(performance.now() * 0.05 + p.position.x * 8) * 0.09;
        p.scale.set(0.75 + power * 0.5, (0.35 + power * 1.5) * flick, 0.75 + power * 0.5);
        const mat = p.material as THREE.MeshBasicMaterial;
        mat.opacity = clamp(0.3 + power * 0.5, 0, 0.9);
      }
    }
    for (const r of this.repulsors) {
      const mat = r.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      if ('emissiveIntensity' in mat) {
        (mat as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + boost * 2.4 + Math.sin(performance.now() * 0.01) * 0.2;
      } else {
        r.visible = boost > 0.5;
        mat.opacity = clamp(boost, 0, 0.8);
      }
    }
    this.reactor.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.03 + boost * 0.06);
    void speedNorm;

    // damage feedback: visor flickers, plausibility of a failing suit
    this.impactFlash = Math.max(0, this.impactFlash - dt * 2.4);
    const maxI = Math.max(1, INTEGRITY.max);
    const maxE = Math.max(1, ENERGY.max);
    void maxI; void maxE;
    const dmg = clamp(damaged, 0, 1);
    this.visor.scale.setScalar(1 - dmg * 0.12);
    const visorMat = this.visor.material as THREE.MeshStandardMaterial;
    visorMat.emissiveIntensity = 2.6 - dmg * 1.1 + this.impactFlash * 2.0;
  }

  /** One-shot flash for impacts. */
  flash(): void {
    this.impactFlash = 1;
  }

  /** Re-skin all suit materials to an ARMORY frame palette. */
  setPalette(p: { primary: number; primaryDark: number; secondary: number; trim: number; glow: number; visor: number; reactor: number; flare: number }): void {
    this.mats.primary?.color.setHex(p.primary);
    this.mats.primaryDark?.color.setHex(p.primaryDark);
    this.mats.secondary?.color.setHex(p.secondary);
    this.mats.trim?.color.setHex(p.trim);
    this.mats.glow?.emissive.setHex(p.glow);
    this.mats.visorGlow?.emissive.setHex(p.visor);
    this.mats.reactorGlow?.emissive.setHex(p.reactor);
    this.flareMat.color.setHex(p.flare);
    // amber accents (back/boot nozzles) follow the reactor family
    this.mats.amber?.emissive.setHex(p.reactor);
  }

  /** Boost flare discs on the palms. */
  setRepulsorFire(on: boolean): void {
    for (const r of this.repulsors) {
      const mat = r.material as THREE.MeshBasicMaterial;
      if (!('emissiveIntensity' in mat)) r.visible = on;
    }
  }

  /** World-space palm centres (repulsor emitters), left then right. */
  palmWorlds(outL: THREE.Vector3, outR: THREE.Vector3): void {
    const pL = new THREE.Vector3(0, -0.74, 0);
    const pR = new THREE.Vector3(0, -0.74, 0);
    this.elbowL.localToWorld(pL);
    this.elbowR.localToWorld(pR);
    outL.copy(pL);
    outR.copy(pR);
  }
}
