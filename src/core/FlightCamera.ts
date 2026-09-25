import * as THREE from 'three';
import { CAMERA } from '../config';
import { clamp, damp } from '../util/Rng';
import type { City } from '../world/City';

export interface CameraSubject {
  pos: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  visualRoll: number;
  boostLevel: number;
  speed: number;
  fovBoostAdd: number;
  airborne: boolean;
  landing: boolean;
}

const V = {
  fwd: new THREE.Vector3(),
  up: new THREE.Vector3(),
  desired: new THREE.Vector3(),
  look: new THREE.Vector3(),
  lookSmooth: new THREE.Vector3(),
  offset: new THREE.Vector3(),
  upTilt: new THREE.Vector3(),
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  tmp: new THREE.Vector3(),
  eye: new THREE.Vector3(),
};

/**
 * Cinematic chase camera: velocity look-ahead, speed/boost FOV, banking horizon,
 * collision-aware pull-in, impact shake and target focus framing.
 */
export class FlightCamera {
  camera: THREE.PerspectiveCamera;
  private fovTarget = CAMERA.fovBase;
  private dist = CAMERA.distBase;
  private lookSmooth = new THREE.Vector3();
  private shake = 0;
  private shakeOffset = new THREE.Vector3();
  private focusWeight = 0;
  private focusPoint = new THREE.Vector3();
  private initialized = false;
  private rollSmooth = 0;

  constructor(aspect: number, private city: City) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, 0.35, 4200);
    this.camera.rotation.order = 'YXZ';
  }

  addShake(amount: number): void {
    this.shake = clamp(this.shake + amount, 0, 2.2);
  }

  focusOn(point: THREE.Vector3 | null, weight = 0.4): void {
    if (point) {
      this.focusPoint.copy(point);
      this.focusWeight = weight;
    } else {
      this.focusWeight = 0;
    }
  }

  /** Snap the camera to a subject (used on respawn / mission start). */
  snap(subject: CameraSubject): void {
    this.computeDesired(subject);
    this.camera.position.copy(V.desired);
    this.lookSmooth.copy(V.look);
    this.camera.lookAt(V.look);
    this.initialized = true;
    this.shake = 0;
  }

  private computeDesired(subject: CameraSubject): void {
    const q = subject.quaternion;
    V.fwd.set(0, 0, -1).applyQuaternion(q);
    V.up.set(0, 1, 0).applyQuaternion(q);

    const speedT = clamp(subject.speed / CAMERA.fovSpeedMax / 2.2, 0, 1);
    this.dist = CAMERA.distBase + subject.speed * CAMERA.distSpeed + subject.boostLevel * CAMERA.distBoost;
    const height = CAMERA.heightBase + speedT * 0.9 - subject.boostLevel * 0.35;

    // blend the camera's up vector toward the body up so dives/loops read correctly
    V.upTilt.set(0, 1, 0).lerp(V.up, 0.42).normalize();

    V.offset.copy(V.upTilt).multiplyScalar(height).addScaledVector(V.fwd, -this.dist);
    V.desired.copy(subject.pos).add(V.offset);

    // keep the camera out of the masonry
    const fromHero = V.tmp.copy(V.desired).sub(subject.pos);
    const wantDist = fromHero.length();
    fromHero.multiplyScalar(1 / wantDist);
    const hit = this.city.collision.raycast(subject.pos, fromHero, wantDist + 0.6);
    if (hit && hit.dist < wantDist) {
      V.desired.copy(subject.pos).addScaledVector(fromHero, Math.max(4.4, hit.dist - 0.9));
    }

    V.look.copy(subject.pos).addScaledVector(subject.velocity, CAMERA.lookAhead);
    V.look.y += 1.0;
    if (this.focusWeight > 0) {
      V.look.lerp(this.focusPoint, this.focusWeight * 0.55);
    }

    let fov = CAMERA.fovBase + speedT * CAMERA.fovSpeedMax + subject.boostLevel * CAMERA.fovBoost;
    const diveT = clamp(V.fwd.y * -1, 0, 1);
    fov += diveT * CAMERA.fovDive;
    if (subject.landing) fov += CAMERA.landingFov;
    fov += subject.fovBoostAdd;
    this.fovTarget = fov;
  }

  update(dt: number, subject: CameraSubject): void {
    this.computeDesired(subject);
    if (!this.initialized) {
      this.snap(subject);
      return;
    }

    const posLerp = damp(CAMERA.posLerp + subject.boostLevel * 1.6, dt);
    this.camera.position.lerp(V.desired, posLerp);
    this.lookSmooth.lerp(V.look, damp(CAMERA.rotLerp, dt));

    // shake decays fast and never breaks readability
    this.shake = Math.max(0, this.shake - CAMERA.shakeDecay * dt * this.shake * 0.5 - dt * 0.35);
    const amp = this.shake * this.shake * 0.55;
    this.shakeOffset.set(
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp * 0.5
    );

    // banked horizon: roll the camera's up axis around the suit's flight axis
    this.rollSmooth += (subject.visualRoll * 0.85 - this.rollSmooth) * damp(6, dt);
    const heroFwd = V.fwd.set(0, 0, -1).applyQuaternion(subject.quaternion);
    const upVec = V.upTilt.set(0, 1, 0).applyAxisAngle(heroFwd, this.rollSmooth);
    V.eye.copy(this.camera.position).add(this.shakeOffset);
    V.m.lookAt(V.eye, this.lookSmooth, upVec);
    V.q.setFromRotationMatrix(V.m);
    this.camera.quaternion.slerp(V.q, damp(CAMERA.rotLerp * 1.35, dt));

    const fovNow = this.camera.fov + (this.fovTarget - this.camera.fov) * damp(CAMERA.fovLerp, dt);
    if (Math.abs(fovNow - this.camera.fov) > 0.005) {
      this.camera.fov = fovNow;
      this.camera.updateProjectionMatrix();
    }

    if (this.focusWeight > 0) this.focusWeight = Math.max(0, this.focusWeight - dt * 0.25);
  }

  /** Slow cinematic orbit for the landing page / brief backdrops. */
  cinematic(dt: number, center: THREE.Vector3, t: number, radius = 90, height = 26): void {
    const a = t * 0.085;
    const breathe = 1 + Math.sin(t * 0.16) * 0.06;
    this.camera.position.set(
      center.x + Math.cos(a) * radius * breathe,
      center.y + height + Math.sin(t * 0.23) * 3.2,
      center.z + Math.sin(a) * radius * breathe
    );
    // hold the hero just off-centre so the city keeps moving behind the UI
    this.lookSmooth.set(
      center.x + Math.sin(t * 0.09) * 1.1,
      center.y + 0.9 + Math.sin(t * 0.31) * 0.5,
      center.z + Math.cos(t * 0.07) * 1.1
    );
    this.camera.lookAt(this.lookSmooth);
    const fovNow = this.camera.fov + (58 - this.camera.fov) * damp(2.2, dt);
    if (Math.abs(fovNow - this.camera.fov) > 0.005) {
      this.camera.fov = fovNow;
      this.camera.updateProjectionMatrix();
    }
  }

  applyAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
