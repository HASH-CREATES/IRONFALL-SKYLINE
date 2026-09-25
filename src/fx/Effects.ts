import * as THREE from 'three';
import { clamp } from '../util/Rng';

const MAX_PARTICLES = 1400;

/**
 * Pooled visual effects: sparks, explosions, dust, repulsor energy, speed
 * streaks and the boost ribbon. One Points draw call covers every burst.
 */
export class Effects {
  group = new THREE.Group();

  private points: THREE.Points;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pSize: Float32Array;
  private pAlpha: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMaxLife: Float32Array;
  private pGravity: Float32Array;
  private pDrag: Float32Array;
  private cursor = 0;

  private streaks: THREE.LineSegments;
  private streakPos: Float32Array;
  private streakCol: Float32Array;
  private streakSeed: Float32Array;
  private streakCount = 72;
  private streakEnergy = 0;

  private trail: THREE.Line;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private trailHistory: THREE.Vector3[] = [];
  private trailIndex = 0;
  private readonly trailLength = 46;

  private rings: THREE.Mesh[] = [];
  private ringLife: number[] = [];

  constructor() {
    /* ---------- particles ---------- */
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pGravity = new Float32Array(MAX_PARTICLES);
    this.pDrag = new Float32Array(MAX_PARTICLES);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    geo.setDrawRange(0, MAX_PARTICLES);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: { value: Math.min(2, devicePixelRatio || 1) } },
      vertexShader: /* glsl */`
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelRatio;
        void main(){
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (420.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5 || vAlpha <= 0.0) discard;
          float a = smoothstep(0.5, 0.12, d) * vAlpha;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.group.add(this.points);

    /* ---------- speed streaks ---------- */
    this.streakPos = new Float32Array(this.streakCount * 6);
    this.streakCol = new Float32Array(this.streakCount * 6);
    this.streakSeed = new Float32Array(this.streakCount * 4);
    for (let i = 0; i < this.streakCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 3.2 + Math.random() * 8.5;
      this.streakSeed[i * 4 + 0] = Math.cos(ang) * rad;
      this.streakSeed[i * 4 + 1] = Math.sin(ang) * rad;
      this.streakSeed[i * 4 + 2] = Math.random() * 26 - 8;
      this.streakSeed[i * 4 + 3] = 5 + Math.random() * 16;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(this.streakCol, 3));
    sGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const sMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.streaks = new THREE.LineSegments(sGeo, sMat);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 9;
    this.group.add(this.streaks);

    /* ---------- boost ribbon ---------- */
    for (let i = 0; i < this.trailLength; i++) this.trailHistory.push(new THREE.Vector3());
    this.trailPos = new Float32Array(this.trailLength * 3);
    this.trailCol = new Float32Array(this.trailLength * 3);
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const tMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.trail = new THREE.Line(tGeo, tMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 8;
    this.group.add(this.trail);

    /* ---------- expanding shock rings ---------- */
    const ringGeo = new THREE.TorusGeometry(1, 0.06, 4, 40).rotateX(Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xd8f6ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.visible = false;
      this.group.add(m);
      this.rings.push(m);
      this.ringLife.push(0);
    }
  }

  private spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.Color, size: number, life: number, gravity = 0, drag = 1.2
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 3] = color.r; this.pCol[i * 3 + 1] = color.g; this.pCol[i * 3 + 2] = color.b;
    this.pSize[i] = size;
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pAlpha[i] = 1;
    this.pGravity[i] = gravity;
    this.pDrag[i] = drag;
  }

  sparkBurst(pos: THREE.Vector3, power: number, color = 0xffd08a, count = 26): void {
    const c = new THREE.Color(color);
    const n = Math.min(count, 90);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const speed = 6 + Math.random() * 16 * power;
      const tint = c.clone().lerp(new THREE.Color(0xffffff), Math.random() * 0.4);
      this.spawn(
        pos.x + dir.x * 0.6, pos.y + dir.y * 0.6, pos.z + dir.z * 0.6,
        dir.x * speed, dir.y * speed + 2, dir.z * speed,
        tint, 0.5 + Math.random() * 1.1, 0.35 + Math.random() * 0.55, 14, 0.9
      );
    }
  }

  explosion(pos: THREE.Vector3, scale = 1, color = 0xffab4a): void {
    const c = new THREE.Color(color);
    const n = Math.round(48 * clamp(scale, 0.5, 2));
    // white-hot core flash
    for (let i = 0; i < Math.round(10 * scale); i++) {
      this.spawn(pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4,
        new THREE.Color(0xfff6e0), (2.6 + Math.random() * 3.4) * scale, 0.14 + Math.random() * 0.12, 0, 2.4);
    }
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize();
      const speed = (7 + Math.random() * 22) * scale;
      const tint = c.clone().lerp(new THREE.Color(0xfff1c8), Math.random() * 0.6);
      this.spawn(
        pos.x, pos.y, pos.z,
        dir.x * speed, dir.y * speed, dir.z * speed,
        tint, (1.0 + Math.random() * 2.2) * scale, 0.5 + Math.random() * 0.9, 8, 1.4
      );
    }
    // smoke
    for (let i = 0; i < Math.round(14 * scale); i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
      this.spawn(
        pos.x, pos.y, pos.z,
        dir.x * 4, dir.y * 5 + 2, dir.z * 4,
        new THREE.Color(0x3a3a40), (4 + Math.random() * 6) * scale, 1.1 + Math.random(), 1.2, 0.6
      );
    }
    this.shockRing(pos, scale * 2.4, color);
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, power: number): void {
    const tint = new THREE.Color(0xfff0d0);
    for (let i = 0; i < Math.round(18 + power * 10); i++) {
      const dir = normal.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1
      )).normalize();
      const speed = 5 + Math.random() * 18 * power;
      this.spawn(
        pos.x, pos.y, pos.z,
        dir.x * speed, dir.y * speed, dir.z * speed,
        tint, 0.6 + Math.random(), 0.3 + Math.random() * 0.4, 16, 1.2
      );
    }
    this.shockRing(pos, 1.6 + power * 1.4, 0xffe0a0);
  }

  splash(pos: THREE.Vector3, power = 1): void {
    for (let i = 0; i < 40; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.2, Math.random() - 0.5).normalize();
      this.spawn(
        pos.x, pos.y + 0.5, pos.z,
        dir.x * 10 * power, dir.y * 16 * power, dir.z * 10 * power,
        new THREE.Color(0xcfe8ff), 2.5 + Math.random() * 5, 0.7 + Math.random(), 18, 0.5
      );
    }
  }

  energyHit(pos: THREE.Vector3, color = 0x7fe8ff): void {
    for (let i = 0; i < 22; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const speed = 6 + Math.random() * 16;
      this.spawn(pos.x, pos.y, pos.z, dir.x * speed, dir.y * speed, dir.z * speed,
        new THREE.Color(color), 0.7 + Math.random(), 0.28 + Math.random() * 0.4, 4, 2.2);
    }
  }

  empWave(pos: THREE.Vector3, radius: number): void {
    this.shockRing(pos, radius, 0x9fe8ff);
    this.sparkBurst(pos, 1.4, 0xbdf3ff, 30);
  }

  /** Iron Man signature: continuous repulsor emission from the palms while hovering. */
  repulsorFlow(palmL: THREE.Vector3, palmR: THREE.Vector3, intensity: number): void {
    if (intensity <= 0.05) return;
    const c = new THREE.Color(0x9fdcff);
    const n = Math.round(2 + intensity * 3);
    for (let k = 0; k < 2; k++) {
      const p = k === 0 ? palmL : palmR;
      for (let i = 0; i < n; i++) {
        const spread = 0.55;
        this.spawn(
          p.x + (Math.random() - 0.5) * 0.2, p.y, p.z + (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * spread, -3.5 - Math.random() * 3.5 * intensity, (Math.random() - 0.5) * spread,
          c.clone().lerp(new THREE.Color(0xeaf8ff), Math.random() * 0.5),
          0.5 + Math.random() * 0.7, 0.16 + Math.random() * 0.2, 0, 1.6
        );
      }
    }
  }

  /** Boot/repulsor downwash kicking up ground dust when near the deck. */
  downwashDust(pos: THREE.Vector3, groundY: number, intensity: number): void {
    if (intensity <= 0.02) return;
    const h = pos.y - groundY;
    if (h > 14 || h < 0.4) return;
    const fall = 1 - h / 14;
    const n = Math.round(3 + fall * intensity * 7);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.6 + Math.random() * 1.6;
      this.spawn(
        pos.x + Math.cos(ang) * rad, groundY + 0.25, pos.z + Math.sin(ang) * rad,
        Math.cos(ang) * (4 + fall * 9), 0.6 + Math.random() * 1.4, Math.sin(ang) * (4 + fall * 9),
        new THREE.Color(0x9d9484), 1.8 + Math.random() * 2.6, 0.5 + Math.random() * 0.5, 0.4, 1.1
      );
    }
  }

  private ringTargets: number[] = new Array(10).fill(10);

  private shockRing(pos: THREE.Vector3, target: number, color: number): void {
    const idx = this.ringLife.indexOf(0);
    const i = idx === -1 ? 0 : idx;
    const m = this.rings[i];
    m.position.copy(pos);
    m.visible = true;
    m.scale.setScalar(0.6);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.7;
    this.ringLife[i] = 1;
    this.ringTargets[i] = target;
  }

  /** Called every frame with the hero state so streaks/trail follow flight. */
  update(dt: number, heroPos: THREE.Vector3, heroQuat: THREE.Quaternion, velocity: THREE.Vector3, boostLevel: number, speedNorm: number): void {
    /* particles */
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) { this.pAlpha[i] = 0; continue; }
      anyAlive = true;
      this.pLife[i] -= dt;
      const l = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      this.pAlpha[i] = l * l;
      const drag = Math.max(0, 1 - this.pDrag[i] * dt);
      this.pVel[i * 3] *= drag;
      this.pVel[i * 3 + 1] = this.pVel[i * 3 + 1] * drag - this.pGravity[i] * dt;
      this.pVel[i * 3 + 2] *= drag;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    const pgeo = this.points.geometry;
    if (anyAlive || this.cursor > 0) {
      (pgeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (pgeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (pgeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (pgeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    }

    /* streaks — strongest in boost / dive */
    const target = clamp(speedNorm * 1.15 + boostLevel * 0.75, 0, 1.6);
    this.streakEnergy += (target - this.streakEnergy) * Math.min(1, dt * 5);
    this.streaks.visible = this.streakEnergy > 0.14;
    if (this.streaks.visible) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(heroQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(heroQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(heroQuat);
      const len = 8 + this.streakEnergy * 34;
      const alpha = clamp(this.streakEnergy - 0.12, 0, 1);
      for (let i = 0; i < this.streakCount; i++) {
        const ox = this.streakSeed[i * 4 + 0];
        const oy = this.streakSeed[i * 4 + 1];
        const oz = this.streakSeed[i * 4 + 2];
        const roll = performance.now() * 0.0016;
        const ca = Math.cos(roll + i * 0.61);
        const sa = Math.sin(roll + i * 0.61);
        const rx = ox * ca - oy * sa;
        const ry = ox * sa + oy * ca;
        const base = new THREE.Vector3()
          .addScaledVector(right, rx)
          .addScaledVector(up, ry)
          .addScaledVector(forward, oz * 0.6)
          .add(heroPos);
        const tail = base.clone().addScaledVector(forward, longSeed(this.streakSeed, i, len));
        this.streakPos[i * 6 + 0] = base.x;
        this.streakPos[i * 6 + 1] = base.y;
        this.streakPos[i * 6 + 2] = base.z;
        this.streakPos[i * 6 + 3] = tail.x;
        this.streakPos[i * 6 + 4] = tail.y;
        this.streakPos[i * 6 + 5] = tail.z;
        const bright = alpha * (0.35 + this.streakSeed[i * 4 + 3] / 22);
        this.streakCol[i * 6 + 0] = bright * 0.55;
        this.streakCol[i * 6 + 1] = bright * 0.8;
        this.streakCol[i * 6 + 2] = bright;
        this.streakCol[i * 6 + 3] = 0;
        this.streakCol[i * 6 + 4] = 0;
        this.streakCol[i * 6 + 5] = 0;
      }
      (this.streaks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.streaks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    /* boost ribbon */
    const hist = this.trailHistory[this.trailIndex];
    hist.copy(heroPos);
    this.trailIndex = (this.trailIndex + 1) % this.trailLength;
    const show = boostLevel > 0.12 || speedNorm > 0.5;
    this.trail.visible = show;
    if (show) {
      for (let i = 0; i < this.trailLength; i++) {
        const idx = (this.trailIndex + i) % this.trailLength;
        const p = this.trailHistory[idx];
        this.trailPos[i * 3] = p.x;
        this.trailPos[i * 3 + 1] = p.y;
        this.trailPos[i * 3 + 2] = p.z;
        const t = 1 - i / this.trailLength;
        const a = t * t * clamp(boostLevel * 1.4 + speedNorm * 0.5, 0, 1);
        this.trailCol[i * 3] = 0.45 * a;
        this.trailCol[i * 3 + 1] = 0.75 * a;
        this.trailCol[i * 3 + 2] = 1.0 * a;
      }
      (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.trail.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    /* rings */
    for (let i = 0; i < this.rings.length; i++) {
      if (!this.rings[i].visible) continue;
      this.ringLife[i] -= dt * 1.35;
      const m = this.rings[i];
      const t = 1 - Math.max(0, this.ringLife[i]);
      const target = this.ringTargets[i];
      m.scale.setScalar(1 + t * target);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.ringLife[i]) * 0.65;
      if (this.ringLife[i] <= 0) m.visible = false;
    }
    void velocity;
  }

  setPixelRatio(r: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = r;
  }
}

function longSeed(seed: Float32Array, i: number, len: number): number {
  return -(len * (0.45 + (seed[i * 4 + 3] % 7) / 10));
}
