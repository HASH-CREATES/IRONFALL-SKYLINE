import * as THREE from 'three';
import { COMBAT, ENERGY } from '../config';
import { clamp, damp } from '../util/Rng';
import type { CollisionWorld } from '../world/Collision';
import type { Effects } from '../fx/Effects';
import type { Enemy, EnemyManager } from '../enemies/Enemies';
import type { FlightController } from '../player/FlightController';
import type { Audio } from '../audio/Audio';

interface Bolt {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
  damage: number;
  fromHand: number;
}

export interface LockState {
  target: Enemy | null;
  progress: number; // 0..1
  locked: boolean;
  active: boolean;
}

/**
 * Non-graphic sci-fi combat: repulsor pulses, chest unibeam and an EMP burst.
 * Drones spark, tumble and power down — nothing graphic.
 */
export class Combat {
  group = new THREE.Group();
  lock: LockState = { target: null, progress: 0, locked: false, active: false };
  lockedTarget: Enemy | null = null;

  private bolts: Bolt[] = [];
  private cooldown = 0;
  private unibeamTimer = 0;
  private unibeamMesh: THREE.Mesh;
  private unibeamGlow: THREE.Mesh;
  private unibeamActive = 0;
  private handToggle = 0;
  private sinceDamageOnTarget = 0;
  private lockDropTimer = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private candidateList: Enemy[] = [];
  /** Fired when a shot disables a drone (score credit). */
  onKill: (enemy: Enemy) => void = () => {};

  constructor(
    private collision: CollisionWorld,
    private enemies: EnemyManager,
    private fx: Effects,
    private audio: Audio
  ) {
    const boltGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xcdf6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloGeo = new THREE.SphereGeometry(0.95, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });

    for (let i = 0; i < 44; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(boltGeo, boltMat));
      g.add(new THREE.Mesh(haloGeo, haloMat));
      g.visible = false;
      g.frustumCulled = false;
      this.group.add(g);
      this.bolts.push({ mesh: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, active: false, damage: COMBAT.boltDamage, fromHand: 0 });
    }

    const beamGeo = new THREE.CylinderGeometry(0.42, 0.16, 1, 12, 1, true).rotateX(Math.PI / 2);
    this.unibeamMesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xeaffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.unibeamMesh.visible = false;
    this.unibeamMesh.frustumCulled = false;
    this.group.add(this.unibeamMesh);

    this.unibeamGlow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.unibeamGlow.visible = false;
    this.unibeamGlow.frustumCulled = false;
    this.group.add(this.unibeamGlow);
  }

  reset(): void {
    for (const b of this.bolts) { b.active = false; b.mesh.visible = false; }
    this.lockedTarget = null;
    this.lock.target = null;
    this.lock.progress = 0;
    this.lock.locked = false;
    this.lock.active = false;
    this.cooldown = 0;
    this.unibeamTimer = 0;
    this.unibeamActive = 0;
    this.unibeamMesh.visible = false;
    this.unibeamGlow.visible = false;
  }

  /** Cycle to the next valid target (Tab / gesture point). */
  cycleTarget(cameraFwd: THREE.Vector3, heroPos: THREE.Vector3): void {
    const list = this.collectCandidates(cameraFwd, heroPos, 1e9);
    if (!list.length) { this.lockedTarget = null; return; }
    const currentIdx = this.lockedTarget ? list.indexOf(this.lockedTarget) : -1;
    const next = list[(currentIdx + 1) % list.length];
    this.lockedTarget = next;
    this.lock.target = next;
    this.lock.progress = 0.55;
    this.lock.locked = false;
    this.audio.lock();
  }

  private collectCandidates(cameraFwd: THREE.Vector3, heroPos: THREE.Vector3, coneOverride: number): Enemy[] {
    this.candidateList.length = 0;
    const cosCone = Math.cos((COMBAT.lockConeDeg * Math.PI) / 180);
    const locked = this.lockedTarget;
    for (const e of this.enemies.enemies) {
      if (!e.active || e.state === 'downed') continue;
      const to = this.tmp.subVectors(e.pos, heroPos);
      const dist = to.length();
      if (dist > COMBAT.lockRange) continue;
      to.multiplyScalar(1 / Math.max(0.001, dist));
      if (to.dot(cameraFwd) < cosCone && e !== locked) continue;
      if (!this.collision.losClear(heroPos, e.pos) && e !== locked) continue;
      this.candidateList.push(e);
    }
    // closest to the reticle first
    this.candidateList.sort((a, b) => {
      const da = this.tmp.subVectors(a.pos, heroPos).normalize().dot(cameraFwd);
      const db = this.tmp2.subVectors(b.pos, heroPos).normalize().dot(cameraFwd);
      return db - da;
    });
    void coneOverride;
    return this.candidateList;
  }

  update(
    dt: number,
    hero: FlightController,
    cameraFwd: THREE.Vector3,
    camera: THREE.Camera,
    wantFire: boolean,
    wantUnibeam: boolean,
    wantEmp: boolean,
    wantCycle: boolean
  ): void {
    this.cooldown -= dt;
    this.unibeamTimer -= dt;
    this.sinceDamageOnTarget += dt;

    if (wantCycle) this.cycleTarget(cameraFwd, hero.pos);

    /* ---------------- target acquisition ---------------- */
    if (!this.lockedTarget || !this.lockedTarget.active || this.lockedTarget.state === 'downed') {
      this.lockedTarget = null;
      this.lock.progress = 0;
    }
    if (!this.lockedTarget) {
      const list = this.collectCandidates(cameraFwd, hero.pos, COMBAT.lockConeDeg);
      if (list.length) {
        this.lockedTarget = list[0];
        this.lock.progress = 0.15;
        this.audio.lock();
      }
    }

    const target = this.lockedTarget;
    if (target) {
      const dist = target.pos.distanceTo(hero.pos);
      const to = this.tmp.subVectors(target.pos, hero.pos).multiplyScalar(1 / Math.max(0.001, dist));
      const inCone = to.dot(cameraFwd) > Math.cos(((COMBAT.lockConeDeg + 22) * Math.PI) / 180);
      const hasLos = this.collision.losClear(hero.pos, target.pos);
      const inRange = dist < COMBAT.lockRange * 1.25;
      if (inCone && hasLos && inRange) {
        this.lockDropTimer = COMBAT.lockDropTime;
      } else {
        this.lockDropTimer -= dt;
      }
      if (this.lockDropTimer > 0) {
        this.lock.progress = clamp(this.lock.progress + dt / COMBAT.lockTime, 0, 1);
      } else {
        this.lock.progress = clamp(this.lock.progress - dt * 1.4, 0, 1);
        if (this.lock.progress <= 0) {
          this.lockedTarget = null;
        }
      }
      const wasLocked = this.lock.locked;
      this.lock.locked = this.lock.progress >= 1;
      if (this.lock.locked && !wasLocked) this.audio.lockOn();
      this.lock.target = this.lockedTarget;
    } else {
      this.lock.locked = false;
      this.lock.progress = 0;
      this.lockDropTimer = 0;
    }
    this.lock.active = this.lockedTarget !== null;

    /* ---------------- fire repulsors ---------------- */
    if (wantFire && this.cooldown <= 0 && hero.energy > 0.5) {
      this.cooldown = COMBAT.boltCooldown;
      this.fireBolt(hero, camera, target);
    }

    /* ---------------- unibeam ---------------- */
    if (wantUnibeam && this.unibeamTimer <= 0 && hero.energy >= ENERGY.unibeamCost && target) {
      this.unibeamTimer = COMBAT.unibeamCooldown;
      hero.addEnergy(-ENERGY.unibeamCost);
      this.unibeamActive = 0.75;
      this.audio.unibeam();
      const dir = this.tmp2.subVectors(target.pos, hero.pos).normalize();
      const hitPoint = hero.pos.clone().addScaledVector(dir, Math.min(240, hero.pos.distanceTo(target.pos) + 6));
      this.fx.explosion(hitPoint, 1.4, 0x9fe8ff);
      this.enemies.damage(target, COMBAT.unibeamDamage, hero.pos, this.fx);
      this.fx.energyHit(target.pos, 0xbdf6ff);
    }
    if (this.unibeamActive > 0) {
      this.unibeamActive -= dt;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(hero.quaternion);
      const len = 120;
      this.unibeamMesh.visible = true;
      this.unibeamMesh.position.copy(hero.pos).addScaledVector(dir, len * 0.5).addScaledVector(this.faceNormal(hero), 0.5);
      this.unibeamMesh.quaternion.copy(hero.quaternion);
      this.unibeamMesh.scale.set(1, 1, len);
      this.unibeamGlow.visible = true;
      this.unibeamGlow.position.copy(hero.pos).addScaledVector(this.faceNormal(hero), 1.2);
      const t = clamp(this.unibeamActive / 0.75, 0, 1);
      (this.unibeamMesh.material as THREE.MeshBasicMaterial).opacity = t * 0.85;
      (this.unibeamGlow.material as THREE.MeshBasicMaterial).opacity = t * 0.5;
    } else {
      this.unibeamMesh.visible = false;
      this.unibeamGlow.visible = false;
    }

    /* ---------------- EMP pulse ---------------- */
    if (wantEmp && hero.energy >= ENERGY.empCost) {
      hero.addEnergy(-ENERGY.empCost);
      const n = this.enemies.stun(hero.pos, COMBAT.empRadius, COMBAT.empStunTime, this.fx);
      this.fx.empWave(hero.pos, COMBAT.empRadius);
      this.audio.emp();
      hero.applyDamage(0);
      if (n === 0) this.audio.empDry();
    }

    this.updateBolts(dt, hero);
  }

  private faceNormal(hero: FlightController): THREE.Vector3 {
    return this.tmp.set(0, 0, -1).applyQuaternion(hero.quaternion);
  }

  private fireBolt(hero: FlightController, camera: THREE.Camera, target: Enemy | null): void {
    const bolt = this.bolts.find((b) => !b.active);
    if (!bolt) return;
    this.handToggle = 1 - this.handToggle;
    bolt.fromHand = this.handToggle;

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(hero.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(hero.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hero.quaternion);
    const muzzle = hero.pos.clone()
      .addScaledVector(right, this.handToggle === 1 ? 0.62 : -0.62)
      .addScaledVector(up, -0.25)
      .addScaledVector(fwd, 1.1);

    const aim = new THREE.Vector3();
    if (target) {
      const lead = clamp(target.pos.distanceTo(hero.pos) / COMBAT.boltSpeed, 0, 0.9);
      aim.copy(target.pos).addScaledVector(target.vel, lead * COMBAT.braveLead).sub(muzzle).normalize();
    } else {
      aim.copy(fwd);
      // slight convergence toward the camera crosshair so shots feel true
      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      aim.lerp(camFwd, 0.55).normalize();
    }
    aim.x += (Math.random() - 0.5) * COMBAT.fireSpread * 8;
    aim.y += (Math.random() - 0.5) * COMBAT.fireSpread * 8;
    aim.normalize();

    bolt.pos.copy(muzzle);
    bolt.vel.copy(aim).multiplyScalar(COMBAT.boltSpeed);
    bolt.life = COMBAT.boltLife;
    bolt.damage = COMBAT.boltDamage;
    bolt.active = true;
    bolt.mesh.visible = true;
    bolt.mesh.position.copy(muzzle);
    bolt.mesh.scale.setScalar(0.85);
    this.fx.energyHit(muzzle, 0x8fe8ff);
    this.audio.repulsor(this.handToggle);
  }

  private updateBolts(dt: number, hero: FlightController): void {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }

      // gentle homing keeps the trigger satisfying without feeling automatic
      const target = this.lockedTarget;
      if (target && target.active && this.lock.locked) {
        const desired = new THREE.Vector3().subVectors(target.pos, b.pos).normalize().multiplyScalar(b.vel.length());
        b.vel.lerp(desired, damp(COMBAT.homingTurn, dt) * 0.35);
      }

      const step = b.vel.clone().multiplyScalar(dt);
      const next = b.pos.clone().add(step);
      const dir = b.vel.clone().normalize();

      const wallHit = this.collision.raycast(b.pos, dir, step.length() + 0.5);
      if (wallHit) {
        this.fx.impact(wallHit.point, wallHit.box ? new THREE.Vector3(0, 1, 0) : dir, 0.5);
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      b.pos.copy(next);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y += dt * 12;
      b.mesh.scale.setScalar(0.85 + Math.sin(b.life * 40) * 0.05);

      // missile interception + enemy hits
      this.enemies.interceptBolts(b.pos, 2.2, this.fx);
      let hitEnemy: Enemy | null = null;
      for (const e of this.enemies.enemies) {
        if (!e.active || e.state === 'downed') continue;
        if (e.pos.distanceToSquared(b.pos) < (e.def.radius + 1.6) * (e.def.radius + 1.6)) { hitEnemy = e; break; }
      }
      if (hitEnemy) {
        const downed = this.enemies.damage(hitEnemy, b.damage, hero.pos, this.fx);
        this.fx.energyHit(b.pos, 0x9fe8ff);
        this.audio.hitEnemy(downed);
        if (downed) {
          this.fx.explosion(hitEnemy.pos, 1.1, 0xffa040);
          this.audio.enemyDown();
          this.onKill(hitEnemy);
        }
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  get activeBoltCount(): number {
    return this.bolts.reduce((n, b) => n + (b.active ? 1 : 0), 0);
  }

  get unibeamReady(): boolean {
    return this.unibeamTimer <= 0;
  }
}
