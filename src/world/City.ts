import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CITY } from '../config';
import { CollisionWorld } from './Collision';
import { Rng, clamp } from '../util/Rng';
import {
  MAT_UNIFORMS, billboardAtlas, buildingMaterial, emissiveMaterial, groundMaterial, waterMaterial,
} from './Materials';

export type DistrictId =
  | 'downtown' | 'financial' | 'skyline' | 'industrial'
  | 'residential' | 'waterfront' | 'oldcity' | 'outskirts';

interface DistrictSpec {
  id: DistrictId;
  label: string;
  tint: number;
  tintAlt: number;
  hMin: number;
  hMax: number;
  split: number; // 1..3 blocks subdivision bias
  density: number; // 0..1 chance a sub-cell has a building
  metal: number;
}

export const DISTRICTS: Record<DistrictId, DistrictSpec> = {
  // NYC-real palette: limestone, pre-war brick, concrete, smoked glass
  downtown: { id: 'downtown', label: 'DOWNTOWN CORE', tint: 0xbfa882, tintAlt: 0x9d8a6c, hMin: 70, hMax: 205, split: 2, density: 0.93, metal: 0.35 },
  financial: { id: 'financial', label: 'FINANCIAL DISTRICT', tint: 0x7d95ad, tintAlt: 0x5b7085, hMin: 130, hMax: 268, split: 2, density: 0.95, metal: 0.55 },
  skyline: { id: 'skyline', label: 'HIGH-RISE SKYLINE', tint: 0x88a0bd, tintAlt: 0x6a8099, hMin: 150, hMax: 300, split: 2, density: 0.9, metal: 0.45 },
  industrial: { id: 'industrial', label: 'INDUSTRIAL BELT', tint: 0xa3855c, tintAlt: 0x7f6748, hMin: 18, hMax: 56, split: 1, density: 0.8, metal: 0.3 },
  residential: { id: 'residential', label: 'RESIDENTIAL', tint: 0xb6604a, tintAlt: 0x8f4a3a, hMin: 16, hMax: 62, split: 3, density: 0.82, metal: 0.12 },
  waterfront: { id: 'waterfront', label: 'WATERFRONT', tint: 0x7fa3a8, tintAlt: 0x64858a, hMin: 20, hMax: 96, split: 2, density: 0.78, metal: 0.28 },
  oldcity: { id: 'oldcity', label: 'OLD CITY', tint: 0xc9a06a, tintAlt: 0xa98356, hMin: 14, hMax: 38, split: 3, density: 0.88, metal: 0.08 },
  outskirts: { id: 'outskirts', label: 'INDUSTRIAL OUTSKIRTS', tint: 0x9a8d78, tintAlt: 0x7e7362, hMin: 12, hMax: 44, split: 1, density: 0.62, metal: 0.2 },
};

export interface Landmark {
  name: string;
  pos: THREE.Vector3;
  kind: 'ground' | 'roof' | 'air';
}

export interface ProtectTarget {
  name: string;
  pos: THREE.Vector3;
  integrity: number;
  alive: boolean;
  ring: THREE.Mesh;
}

interface TrafficCar {
  axis: 0 | 1;
  line: number;
  lane: number;
  dir: number;
  speed: number;
  t: number;
  bus: boolean;
  arterial: boolean;
}

const WORLD_HALF = (CITY.grid / 2) * CITY.blockSize;
// Hudson-style river channel between the west bank and the main island
const RIVER_MIN = -460;
const RIVER_MAX = -280;
// East River channel; the far bank is the visual "boro" strip
const EAST_RIVER_MIN = 700;
const EAST_RIVER_MAX = 840;
// Central Park rect (residential district)
const PARK_MIN_X = -40, PARK_MAX_X = 160, PARK_MIN_Z = 300, PARK_MAX_Z = 560;
// landmark footprints reserved before procedural towers are placed
const RESERVED_ZONES: { x: number; z: number; r: number }[] = [
  { x: -10, z: -170, r: 52 },   // EMPIRE SPIRE
  { x: -150, z: -330, r: 46 },  // CHRYSLER CROWN
  { x: -240, z: -40, r: 44 },   // FREEDOM SPIRE
  { x: -100, z: 150, r: 34 },   // FLATIRON WEDGE
];

export class City {
  group = new THREE.Group();
  collision = new CollisionWorld();

  buildings!: THREE.InstancedMesh;
  ground!: THREE.Mesh;
  water: THREE.Mesh[] = [];
  billboards!: THREE.InstancedMesh;

  landmarks: Landmark[] = [];
  landmarkMap = new Map<string, Landmark>();
  protectTargets: ProtectTarget[] = [];
  spawn = { pos: new THREE.Vector3(24, 190, 60), yaw: Math.PI };
  spawnPad!: THREE.Mesh;

  private rng = new Rng(CITY.seed);
  private heights: number[] = [];
  private districtGrid: DistrictId[] = [];
  private traffic: TrafficCar[] = [];
  private carMesh!: THREE.InstancedMesh;
  private busMesh: THREE.InstancedMesh | null = null;
  private carLightMesh!: THREE.InstancedMesh;
  private busLightMesh: THREE.InstancedMesh | null = null;
  private propGroups: THREE.Object3D[] = [];
  private beaconMat!: THREE.MeshStandardMaterial;
  private tmpObj = new THREE.Object3D();
  private tmpVec = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  private candidates: { x: number; z: number; w: number; d: number; h: number; district: DistrictId; roofProps: boolean; tier: number; glass: number }[] = [];

  constructor() {
    this.group.name = 'city';
    this.buildGround();
    this.buildWater();
    this.buildBuildings();
    this.buildRooftopDetails();
    this.buildStreets();
    this.buildHighways();
    this.buildBridges();
    this.buildLandmarks();
    this.buildTraffic();
    this.buildSkylineFill();
  }

  /* ------------------------------------------------------------------ */
  /* districts                                                            */
  /* ------------------------------------------------------------------ */

  districtAt(x: number, z: number): DistrictId {
    if (x < -300) return 'waterfront';
    if (x > 430) return 'outskirts';
    if (x > 250 || z < -430) return 'industrial';
    if (z < -220 && Math.abs(x) < 280) return 'skyline';
    if (Math.hypot(x - 120, z + 90) < 155) return 'financial';
    if (Math.hypot(x + 150, z - 200) < 130) return 'oldcity';
    if (z > 210) return 'residential';
    return 'downtown';
  }

  private districtLabel(id: DistrictId): string {
    return DISTRICTS[id].label;
  }

  labelAt(x: number, z: number): string {
    return this.districtLabel(this.districtAt(x, z));
  }

  /* ------------------------------------------------------------------ */
  /* ground + water                                                       */
  /* ------------------------------------------------------------------ */

  private buildGround(): void {
    const size = WORLD_HALF * 2 + 200;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geo, groundMaterial());
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    // terrain skirt so the world edge does not read as a floating plane
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(WORLD_HALF + 420, WORLD_HALF + 700, 240, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 1, metalness: 0, side: THREE.DoubleSide })
    );
    skirt.position.y = -120;
    this.group.add(skirt);
  }

  private buildWater(): void {
    const waterMat = waterMaterial();
    const river = new THREE.Mesh(new THREE.PlaneGeometry(RIVER_MAX - RIVER_MIN, WORLD_HALF * 2 + 300, 1, 1), waterMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set((RIVER_MIN + RIVER_MAX) / 2, 0.6, 0);
    this.water.push(river);
    this.group.add(river);

    const bay = new THREE.Mesh(new THREE.PlaneGeometry(340, 360, 1, 1), waterMat);
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(RIVER_MIN - 150, 0.6, 400);
    this.water.push(bay);
    this.group.add(bay);

    // east channel + far-boro waterline
    const east = new THREE.Mesh(new THREE.PlaneGeometry(EAST_RIVER_MAX - EAST_RIVER_MIN, WORLD_HALF * 2 + 300, 1, 1), waterMat);
    east.rotation.x = -Math.PI / 2;
    east.position.set((EAST_RIVER_MIN + EAST_RIVER_MAX) / 2, 0.6, 0);
    this.water.push(east);
    this.group.add(east);
  }

  isWater(x: number, z: number): boolean {
    if (x > RIVER_MIN && x < RIVER_MAX) return true;
    if (x > EAST_RIVER_MIN && x < EAST_RIVER_MAX) return true;
    if (x < RIVER_MIN && z > 230) return true; // bay
    return false;
  }

  /** True when a footprint intersects a landmark/park reservation. */
  private inReservedZone(x: number, z: number): boolean {
    for (const r of RESERVED_ZONES) {
      if (Math.hypot(x - r.x, z - r.z) < r.r) return true;
    }
    if (x > PARK_MIN_X - 20 && x < PARK_MAX_X + 20 && z > PARK_MIN_Z - 20 && z < PARK_MAX_Z + 20) return true;
    return false;
  }

  get worldHalf(): number {
    return WORLD_HALF;
  }

  /* ------------------------------------------------------------------ */
  /* buildings                                                            */
  /* ------------------------------------------------------------------ */

  private buildBuildings(): void {
    const bs = CITY.blockSize;
    const half = CITY.grid / 2;
    const margin = CITY.roadWidth / 2 + 4.5;

    for (let ix = -half; ix < half; ix++) {
      for (let iz = -half; iz < half; iz++) {
        const cx = (ix + 0.5) * bs;
        const cz = (iz + 0.5) * bs;
        const district = this.districtAt(cx, cz);
        this.districtGrid.push(district);

        if (this.isWater(cx, cz)) continue;
        if (this.inReservedZone(cx, cz)) continue;

        const spec = DISTRICTS[district];
        const coreDist = Math.hypot(cx, cz);
        const skyFalloff = clamp(1 - (coreDist - 180) / 460, 0.34, 1.05);
        const inner = bs / 2 - margin;

        // central park block
        const isPark = district === 'residential' && Math.abs(cx + 190) < 30 && Math.abs(cz - 330) < 30;
        if (isPark) continue;

        const split = spec.split + (this.rng.next() < 0.22 ? 1 : 0);
        const cells = Math.max(1, split);
        const cellSize = (inner * 2) / cells;

        for (let a = 0; a < cells; a++) {
          for (let b = 0; b < cells; b++) {
            if (!this.rng.chance(spec.density)) continue;
            const px = cx - inner + cellSize * (a + 0.5);
            const pz = cz - inner + cellSize * (b + 0.5);
            const gap = CITY.minGap * 0.5 + this.rng.range(0.6, 3.4);

            let w = cellSize - gap - this.rng.range(0, cellSize * 0.14);
            let d = cellSize - gap - this.rng.range(0, cellSize * 0.14);
            if (district === 'oldcity') { w *= 0.82; d *= 0.82; }
            if (district === 'industrial') { d *= 1.18; }
            w = clamp(w, 7, 44);
            d = clamp(d, 7, 44);
            if (w < 6 || d < 6) continue;

            const t = this.rng.next();
            const base = spec.hMin + (spec.hMax - spec.hMin) * (0.35 + t * 0.65);
            let h = base * (district === 'oldcity' ? 1 : skyFalloff);
            if (this.rng.chance(0.1)) h *= this.rng.range(1.25, 1.7);
            h = clamp(h, 8, 320);

      const sentinel = this.rng.next();
      this.candidates.push({
        x: px, z: pz, w, d, h, district,
        roofProps: sentinel > 0.12,
        // tiered setback crowns on the tallest towers — Manhattan silhouettes
        tier: h > 120 && this.rng.chance(0.45) ? this.rng.int(1, 2) : 0,
        glass: this.rng.chance(district === 'financial' || district === 'skyline' ? 0.72 : district === 'downtown' ? 0.45 : 0.18) ? 1 : 0,
      });
          }
        }
      }
    }

    const count = this.candidates.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const paramAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    geo.setAttribute('aTint', tintAttr);
    geo.setAttribute('aParam', paramAttr);

    const mat = buildingMaterial();
    this.buildings = new THREE.InstancedMesh(geo, mat, count);
    this.buildings.name = 'buildings';
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.buildings.frustumCulled = true;

    // tiered crowns are separate thin boxes stacked on the tower roof
    const tierGeo = new THREE.BoxGeometry(1, 1, 1);
    const tierMat = buildingMaterial();
    const tierMats: THREE.Matrix4[] = [];
    const tierTint: number[] = [];

    let i = 0;
    for (const c of this.candidates) {
      this.tmpObj.position.set(c.x, c.h / 2, c.z);
      this.tmpObj.rotation.set(0, c.district === 'oldcity' && this.rng.chance(0.5) ? Math.PI / 2 : 0, 0);
      this.tmpObj.scale.set(c.w, c.h, c.d);
      this.tmpObj.updateMatrix();
      this.buildings.setMatrixAt(i, this.tmpObj.matrix);

      const spec = DISTRICTS[c.district];
      // wide per-building value variance keeps the skyline varied, not monotone
      const warm = this.rng.range(0.78, 1.3);
      this.tmpColor.setHex(this.rng.chance(0.48) ? spec.tintAlt : spec.tint);
      // occasional accent buildings: red brick, cream limestone, deep glass
      const acc = this.rng.range(0, 1);
      if (acc < 0.07) this.tmpColor.setHex(0x7a4034);
      else if (acc < 0.14) this.tmpColor.setHex(0xbfb198);
      else if (acc < 0.19) this.tmpColor.setHex(0x40586c);
      this.tmpColor.multiplyScalar(warm);
      tintAttr.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      paramAttr.setXY(i, this.rng.next(), c.glass);
      this.heights.push(c.h);

      this.collision.addBox(
        c.x - c.w / 2, 0, c.z - c.d / 2,
        c.x + c.w / 2, c.h, c.z + c.d / 2,
        0
      );
      i++;

      // stacked setback crown (collision solid too — you can land on it)
      if (c.tier > 0) {
        let tw = c.w, td = c.d, ty = c.h;
        for (let t = 0; t < c.tier; t++) {
          const th = Math.min(14 + t * 6, c.h * 0.14);
          tw *= this.rng.range(0.62, 0.78);
          td *= this.rng.range(0.62, 0.78);
          ty += th;
          this.tmpObj.position.set(c.x, ty - th / 2, c.z);
          this.tmpObj.rotation.set(0, 0, 0);
          this.tmpObj.scale.set(tw, th, td);
          this.tmpObj.updateMatrix();
          tierMats.push(this.tmpObj.matrix.clone());
          const tWarm = this.rng.range(0.9, 1.12);
          this.tmpColor.setHex(this.rng.chance(0.5) ? spec.tintAlt : spec.tint).multiplyScalar(tWarm);
          tierTint.push(this.tmpColor.getHex());
          this.collision.addBox(c.x - tw / 2, ty - th, c.z - td / 2, c.x + tw / 2, ty, c.z + td / 2, 0);
        }
      }
    }
    if (tierMats.length) {
      const tCount = tierMats.length;
      const tTintAttr = new THREE.InstancedBufferAttribute(new Float32Array(tCount * 3), 3);
      const tParamAttr = new THREE.InstancedBufferAttribute(new Float32Array(tCount * 2), 2);
      tierGeo.setAttribute('aTint', tTintAttr);
      tierGeo.setAttribute('aParam', tParamAttr);
      const tMesh = new THREE.InstancedMesh(tierGeo, tierMat, tCount);
      tMesh.name = 'building-tiers';
      tMesh.castShadow = true;
      tMesh.receiveShadow = true;
      tMesh.frustumCulled = true;
      tierMats.forEach((m, k) => tMesh.setMatrixAt(k, m));
      tierMats.forEach((_, k) => {
        this.tmpColor.setHex(tierTint[k]);
        tTintAttr.setXYZ(k, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
        tParamAttr.setXY(k, this.rng.next(), 1); // glass crowns read best
      });
      tTintAttr.needsUpdate = true;
      tParamAttr.needsUpdate = true;
      this.group.add(tMesh);
    }
    tintAttr.needsUpdate = true;
    paramAttr.needsUpdate = true;
    this.group.add(this.buildings);

    // threat-free AI hint: remember the tallest rooftops for missions
    this.sortedByHeight = this.candidates
      .map((c, idx) => ({ c, idx }))
      .sort((a, b) => b.c.h - a.c.h);
  }

  sortedByHeight: { c: { x: number; z: number; w: number; d: number; h: number; district: DistrictId; roofProps: boolean; tier: number; glass: number }; idx: number }[] = [];

  /* ------------------------------------------------------------------ */
  /* rooftop detail                                                       */
  /* ------------------------------------------------------------------ */

  private buildRooftopDetails(): void {
    // rooftop boxes (AC/vents/sheds)
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.85, metalness: 0.3 });
    const units: THREE.Matrix4[] = [];

    // helipads
    const padGeo = mergeGeometries([
      new THREE.CylinderGeometry(9, 9, 0.5, 20).translate(0, 0.25, 0),
      new THREE.TorusGeometry(7.4, 0.32, 6, 24).rotateX(Math.PI / 2).translate(0, 0.62, 0),
    ])!;
    const padMat = emissiveMaterial(0xc9721f, 0.5);
    const pads: THREE.Matrix4[] = [];

    // antennas + beacons
    const antennaGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.28, 0.42, 14, 6).translate(0, 7, 0),
      new THREE.BoxGeometry(2.6, 0.32, 0.32).translate(0, 11.5, 0),
      new THREE.BoxGeometry(0.32, 0.32, 2.6).translate(0, 12.6, 0),
    ])!;
    const antennas: THREE.Matrix4[] = [];
    const beaconGeo = new THREE.SphereGeometry(0.75, 8, 8);
    const beacons: THREE.Matrix4[] = [];

    // water towers
    const towerGeo = mergeGeometries([
      new THREE.CylinderGeometry(2.6, 2.6, 7, 10).translate(0, 3.5, 0),
      new THREE.CylinderGeometry(2.9, 2.9, 0.5, 10).translate(0, 7.2, 0),
      new THREE.CylinderGeometry(0.5, 0.5, 4, 6).translate(0, 8.6, 0),
    ])!;
    const towers: THREE.Matrix4[] = [];

    for (const c of this.candidates) {
      if (!c.roofProps) continue;
      const top = c.h;
      const area = c.w * c.d;
      const unitCount = clamp(Math.floor(area / 90), 0, 3);
      for (let k = 0; k < unitCount; k++) {
        const ux = c.x + this.rng.range(-c.w * 0.32, c.w * 0.32);
        const uz = c.z + this.rng.range(-c.d * 0.32, c.d * 0.32);
        const s = this.rng.range(2.4, 5.4);
        this.tmpObj.position.set(ux, top + s / 2 * 0.6, uz);
        this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI), 0);
        this.tmpObj.scale.set(s, s * 0.6, s * this.rng.range(0.7, 1.3));
        this.tmpObj.updateMatrix();
        units.push(this.tmpObj.matrix.clone());
      }

      if (top > 60 && this.rng.chance(0.16)) {
        this.tmpObj.position.set(c.x + this.rng.range(-c.w * 0.2, c.w * 0.2), top, c.z + this.rng.range(-c.d * 0.2, c.d * 0.2));
        this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI), 0);
        this.tmpObj.scale.setScalar(this.rng.range(0.9, 1.5));
        this.tmpObj.updateMatrix();
        pads.push(this.tmpObj.matrix.clone());
      }
      if (top > 90 && this.rng.chance(0.3)) {
        this.tmpObj.position.set(c.x + this.rng.range(-c.w * 0.25, c.w * 0.25), top, c.z + this.rng.range(-c.d * 0.25, c.d * 0.25));
        this.tmpObj.rotation.set(0, 0, 0);
        this.tmpObj.scale.setScalar(this.rng.range(0.8, 1.4));
        this.tmpObj.updateMatrix();
        antennas.push(this.tmpObj.matrix.clone());
        this.tmpObj.position.y = top + 13.6;
        this.tmpObj.updateMatrix();
        beacons.push(this.tmpObj.matrix.clone());
      }
      if (this.rng.chance(0.1) && area > 260) {
        this.tmpObj.position.set(c.x, top, c.z);
        this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI), 0);
        this.tmpObj.scale.setScalar(this.rng.range(0.8, 1.2));
        this.tmpObj.updateMatrix();
        towers.push(this.tmpObj.matrix.clone());
      }
    }

    const mkInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string) => {
      if (!mats.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, mats.length);
      m.name = name;
      mats.forEach((mx, i) => m.setMatrixAt(i, mx));
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      this.propGroups.push(m);
      return m;
    };

    mkInstanced(boxGeo, unitMat, units, 'roof-units');
    mkInstanced(padGeo, padMat, pads, 'helipads');
    mkInstanced(antennaGeo, unitMat, antennas, 'antennas');
    this.beaconMat = emissiveMaterial(0xff3344, 2.4, 1.1);
    mkInstanced(beaconGeo, this.beaconMat, beacons, 'beacons');
    mkInstanced(towerGeo, unitMat, towers, 'water-towers');
  }

  /* ------------------------------------------------------------------ */
  /* street furniture                                                     */
  /* ------------------------------------------------------------------ */

  private buildStreets(): void {
    const bs = CITY.blockSize;
    const half = this.worldHalf;
    const lampPoleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.22, 0.3, 9.2, 6).translate(0, 4.6, 0),
      new THREE.CylinderGeometry(0.16, 0.16, 3.4, 5).rotateZ(Math.PI / 2).translate(1.6, 9.1, 0),
    ])!;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.7, metalness: 0.6 });
    const headGeo = new THREE.BoxGeometry(1.5, 0.42, 0.9);
    const headMat = emissiveMaterial(0xffcf9a, 2.0);

    const poles: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];

    const arterialStep = 4;
    for (let k = -CITY.grid / 2; k <= CITY.grid / 2; k += arterialStep) {
      const line = (k) * bs;
      for (let along = -half + 20; along < half; along += 62) {
        for (const side of [-1, 1]) {
          // road running along X (line is a Z coordinate), lamps face inward
          if (Math.abs(line) < half - 4) {
            this.tmpObj.position.set(along, 0, line + side * (CITY.roadWidth / 2 - 0.7));
            this.tmpObj.rotation.set(0, side > 0 ? Math.PI : 0, 0);
            this.tmpObj.scale.setScalar(1);
            this.tmpObj.updateMatrix();
            poles.push(this.tmpObj.matrix.clone());
          }
          // road running along Z
          this.tmpObj.position.set(line + side * (CITY.roadWidth / 2 - 0.7), 0, along);
          this.tmpObj.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
          this.tmpObj.scale.setScalar(1);
          this.tmpObj.updateMatrix();
          poles.push(this.tmpObj.matrix.clone());
        }
      }
    }

    // lamp heads are placed from the recorded pole matrices so arm/head always line up
    for (const m of poles) {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      m.decompose(pos, quat, scale);
      const offset = new THREE.Vector3(1.6, 9.1, 0).applyQuaternion(quat);
      this.tmpObj.position.copy(pos).add(offset);
      this.tmpObj.quaternion.copy(quat);
      this.tmpObj.scale.setScalar(1);
      this.tmpObj.updateMatrix();
      heads.push(this.tmpObj.matrix.clone());
    }

    this.instanced(lampPoleGeo, poleMat, poles, 'street-poles');
    this.instanced(headGeo, headMat, heads, 'street-heads');

    // trees (residential / old city / parks)
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.4, 5).translate(0, 1.7, 0);
    const leafGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(3.1, 0).translate(0, 5.4, 0),
      new THREE.IcosahedronGeometry(2.2, 0).translate(1.4, 4.2, 0.6),
    ])!;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2c241c, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1d3320, roughness: 0.9 });
    const trunks: THREE.Matrix4[] = [];
    const leaves: THREE.Matrix4[] = [];
    for (let k = -CITY.grid / 2; k <= CITY.grid / 2; k += 2) {
      for (let along = -half + 30; along < half; along += 44) {
        for (const side of [-1, 1]) {
          const onZRoad = this.rng.chance(0.5);
          const x = onZRoad ? k * bs + side * (CITY.roadWidth / 2 + 2.2) : along;
          const z = onZRoad ? along : k * bs + side * (CITY.roadWidth / 2 + 2.2);
          const dist = this.districtAt(x, z);
          if (dist !== 'residential' && dist !== 'oldcity' && dist !== 'downtown') continue;
          if (this.rng.chance(0.62)) continue;
          const s = this.rng.range(0.7, 1.35);
          this.tmpObj.position.set(x, 0, z);
          this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI * 2), 0);
          this.tmpObj.scale.set(s, this.rng.range(0.85, 1.3), s);
          this.tmpObj.updateMatrix();
          trunks.push(this.tmpObj.matrix.clone());
          leaves.push(this.tmpObj.matrix.clone());
        }
      }
    }
    // central park cluster
    for (let i = 0; i < 60; i++) {
      const x = -190 + this.rng.range(-22, 22);
      const z = 330 + this.rng.range(-22, 22);
      const s = this.rng.range(0.8, 1.5);
      this.tmpObj.position.set(x, 0, z);
      this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI * 2), 0);
      this.tmpObj.scale.set(s, this.rng.range(0.9, 1.4), s);
      this.tmpObj.updateMatrix();
      trunks.push(this.tmpObj.matrix.clone());
      leaves.push(this.tmpObj.matrix.clone());
    }
    this.instanced(trunkGeo, trunkMat, trunks, 'trunks');
    this.instanced(leafGeo, leafMat, leaves, 'leaves');

    // traffic lights at arterial intersections
    const tlGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.18, 0.24, 7.4, 6).translate(0, 3.7, 0),
      new THREE.CylinderGeometry(0.14, 0.14, 4.2, 5).rotateZ(Math.PI / 2).translate(2.1, 7.2, 0),
      new THREE.BoxGeometry(1.0, 2.4, 0.7).translate(3.9, 6.6, 0),
    ])!;
    const tlMat = new THREE.MeshStandardMaterial({ color: 0x1e2a22, roughness: 0.6, metalness: 0.5 });
    const tlBulbGeo = new THREE.BoxGeometry(0.26, 0.7, 0.32);
    const tlRed = emissiveMaterial(0xff2b2b, 2.6, 0.55);
    const tlAmber = emissiveMaterial(0xffb02b, 2.2, 0.55);
    const tlGreen = emissiveMaterial(0x35ff88, 2.2, 0.55);
    const tls: THREE.Matrix4[] = [], bulbsR: THREE.Matrix4[] = [], bulbsA: THREE.Matrix4[] = [], bulbsG: THREE.Matrix4[] = [];
    for (let k = -CITY.grid / 2; k <= CITY.grid / 2; k += arterialStep) {
      for (let k2 = -CITY.grid / 2; k2 <= CITY.grid / 2; k2 += arterialStep) {
        const bx = k * bs, bz = k2 * bs;
        if (Math.abs(bx) > half - 6 || Math.abs(bz) > half - 6) continue;
        for (const q of [0, 1]) {
          const cs = Math.cos(q * Math.PI / 2);
          const sn = Math.sin(q * Math.PI / 2);
          const ox = (CITY.roadWidth / 2 + 0.7) * cs;
          const oz = (CITY.roadWidth / 2 + 0.7) * sn;
          this.tmpObj.position.set(bx + ox, 0, bz + oz);
          this.tmpObj.rotation.set(0, q * Math.PI / 2, 0);
          this.tmpObj.scale.setScalar(1);
          this.tmpObj.updateMatrix();
          tls.push(this.tmpObj.matrix.clone());
          const push = (arr: THREE.Matrix4[], y: number) => {
            const p = new THREE.Vector3(3.9 * cs, y, -3.9 * sn).add(this.tmpObj.position);
            const o = new THREE.Object3D();
            o.position.copy(p);
            o.rotation.set(0, q * Math.PI / 2, 0);
            o.updateMatrix();
            arr.push(o.matrix.clone());
          };
          push(bulbsR, 7.2);
          push(bulbsA, 6.6);
          push(bulbsG, 6.0);
        }
      }
    }
    this.instanced(tlGeo, tlMat, tls, 'traffic-lights');
    this.instanced(tlBulbGeo, tlRed, bulbsR, 'tl-red');
    this.instanced(tlBulbGeo, tlAmber, bulbsA, 'tl-amber');
    this.instanced(tlBulbGeo, tlGreen, bulbsG, 'tl-green');

    // billboards on building faces (2 cols x 4 rows atlas — 8 designs)
    const atlas = billboardAtlas();
    const bbMat = new THREE.MeshStandardMaterial({
      map: atlas, emissiveMap: atlas, emissiveIntensity: 2.1, emissive: 0xffffff,
      roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, transparent: false,
    });
    // one instanced mesh per atlas cell, each with UVs remapped into that cell
    const bbGeoBase = new THREE.PlaneGeometry(1, 1);
    const count = 48;
    const CELL_COUNT = 8;
    const groups: THREE.Matrix4[][] = Array.from({ length: CELL_COUNT }, () => []);
    let placed = 0;
    const roofed = this.sortedByHeight.slice(0, 260);
    for (const r of roofed) {
      if (placed >= count) break;
      if (r.c.h < 70 || this.rng.chance(0.72)) continue;
      const cell = placed % CELL_COUNT;
      const side = this.rng.int(0, 3);
      const w = Math.min(r.c.w, r.c.d) * 0.9;
      const hgt = Math.min(w * 0.62, r.c.h * 0.5);
      const y = this.rng.range(0.35, 0.75) * r.c.h;
      const off = 0.4;
      let x = r.c.x, z = r.c.z, ry = 0;
      if (side === 0) { z = r.c.z + r.c.d / 2 + off; ry = 0; }
      else if (side === 1) { z = r.c.z - r.c.d / 2 - off; ry = Math.PI; }
      else if (side === 2) { x = r.c.x + r.c.w / 2 + off; ry = Math.PI / 2; }
      else { x = r.c.x - r.c.w / 2 - off; ry = -Math.PI / 2; }
      this.tmpObj.position.set(x, y, z);
      this.tmpObj.rotation.set(0, ry, 0);
      this.tmpObj.scale.set(w, hgt, 1);
      this.tmpObj.updateMatrix();
      groups[cell].push(this.tmpObj.matrix.clone());
      placed++;
    }
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!groups[c].length) continue;
      const g = bbGeoBase.clone();
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const cols = 2, rows = 4;
      const u = (c % cols) / cols, v = 1 - Math.floor(c / cols) / rows - 1 / rows;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u + uv.getX(i) / cols, v + uv.getY(i) / rows);
      }
      uv.needsUpdate = true;
      const mesh = new THREE.InstancedMesh(g, bbMat, groups[c].length);
      groups[c].forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `billboards-${c}`;
      this.group.add(mesh);
      this.propGroups.push(mesh);
      if (c === 0) this.billboards = mesh;
    }
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string): THREE.InstancedMesh | null {
    if (!mats.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, mats.length);
    m.name = name;
    mats.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true;
    m.frustumCulled = false;
    this.group.add(m);
    this.propGroups.push(m);
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* highway decks                                                        */
  /* ------------------------------------------------------------------ */

  private buildHighways(): void {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.88, metalness: 0.2 });
    const lampMat = emissiveMaterial(0x54f0ff, 1.8);
    const half = this.worldHalf * 0.72;

    const makeDeck = (axis: 0 | 1, offset: number, y: number, length: number) => {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(axis === 0 ? length : 24, 1.6, axis === 0 ? 24 : length), deckMat);
      deck.position.set(axis === 0 ? 0 : offset, y, axis === 0 ? offset : 0);
      deck.receiveShadow = true;
      this.group.add(deck);
      if (axis === 0) this.collision.addBox(-length / 2, y - 0.8, offset - 12, length / 2, y + 0.8, offset + 12, 1);
      else this.collision.addBox(offset - 12, y - 0.8, -length / 2, offset + 12, y + 0.8, length / 2, 1);

      // barriers
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(axis === 0 ? length : 1.2, 1.4, axis === 0 ? 1.2 : length),
          new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7, metalness: 0.35 })
        );
        bar.position.set(
          axis === 0 ? 0 : offset + side * 12,
          y + 1.2,
          axis === 0 ? offset + side * 12 : 0
        );
        this.group.add(bar);
      }

      // pillars
      const pillarGeo = new THREE.BoxGeometry(4.6, y, 5.4);
      const pillars: THREE.Matrix4[] = [];
      for (let p = -length / 2 + 30; p < length / 2; p += 68) {
        this.tmpObj.position.set(axis === 0 ? p : offset, y / 2, axis === 0 ? offset : p);
        this.tmpObj.rotation.set(0, axis === 0 ? Math.PI / 2 : 0, 0);
        this.tmpObj.scale.set(1, 1, 1);
        this.tmpObj.updateMatrix();
        pillars.push(this.tmpObj.matrix.clone());
        if (axis === 0) this.collision.addBox(p - 2.3, 0, offset - 2.7, p + 2.3, y, offset + 2.7, 1);
        else this.collision.addBox(offset - 2.7, 0, p - 2.3, offset + 2.7, y, p + 2.3, 1);
      }
      this.instanced(pillarGeo, deckMat, pillars, 'highway-pillars');

      // guide lights along the deck edge (helps read the corridor at speed)
      const lights: THREE.Matrix4[] = [];
      const lampGeo = new THREE.BoxGeometry(0.7, 0.18, 0.7);
      for (let p = -length / 2 + 12; p < length / 2; p += 24) {
        for (const side of [-1, 1]) {
          this.tmpObj.position.set(axis === 0 ? p : offset + side * 11.4, y + 1.1, axis === 0 ? offset + side * 11.4 : p);
          this.tmpObj.rotation.set(0, 0, 0);
          this.tmpObj.scale.setScalar(1);
          this.tmpObj.updateMatrix();
          lights.push(this.tmpObj.matrix.clone());
        }
      }
      this.instanced(lampGeo, lampMat, lights, 'highway-lights');
    };

    makeDeck(0, 214, 36, half * 2);
    makeDeck(1, -214, 46, half * 2);
    makeDeck(0, -120, 30, half * 1.35);
  }

  /* ------------------------------------------------------------------ */
  /* bridges over the river                                                */
  /* ------------------------------------------------------------------ */

  private buildBridges(): void {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.85, metalness: 0.25 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.6 });
    const lampMat = emissiveMaterial(0xffcf9a, 1.6);

    for (const z of [-120, 210]) {
      const y = 16;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(RIVER_MAX - RIVER_MIN + 60, 2.2, 26), deckMat);
      deck.position.set((RIVER_MIN + RIVER_MAX) / 2, y, z);
      deck.receiveShadow = true;
      this.group.add(deck);
      this.collision.addBox(
        (RIVER_MIN + RIVER_MAX) / 2 - (RIVER_MAX - RIVER_MIN + 60) / 2, y - 1.1, z - 13,
        (RIVER_MIN + RIVER_MAX) / 2 + (RIVER_MAX - RIVER_MIN + 60) / 2, y + 1.1, z + 13,
        1
      );

      for (const px of [RIVER_MIN + 30, (RIVER_MIN + RIVER_MAX) / 2]) {
        for (const side of [-1, 1]) {
          const pylon = new THREE.Mesh(new THREE.BoxGeometry(7, 74, 7), deckMat);
          pylon.position.set(px, 36, z + side * 13);
          this.group.add(pylon);
          this.collision.addBox(px - 3.5, 0, z + side * 13 - 3.5, px + 3.5, 74, z + side * 13 + 3.5, 1);
        }
        // cables
        for (let c = -14; c <= 14; c += 3.5) {
          const len = Math.abs(c);
          const h = 56 - len * 1.4;
          if (h < 6) continue;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), cableMat);
          seg.position.set(px + c, 20 + h / 2, z);
          this.group.add(seg);
        }
      }
      // bridge lamps
      const lamps: THREE.Matrix4[] = [];
      const lampGeo = new THREE.BoxGeometry(1.1, 0.4, 1.1);
      for (let x = RIVER_MIN - 20; x < RIVER_MAX + 20; x += 15) {
        for (const side of [-1, 1]) {
          this.tmpObj.position.set(x, y + 3.4, z + side * 12);
          this.tmpObj.updateMatrix();
          lamps.push(this.tmpObj.matrix.clone());
        }
      }
      this.instanced(lampGeo, lampMat, lamps, 'bridge-lamps');
    }
  }

  /* ------------------------------------------------------------------ */
  /* landmarks + mission anchors                                          */
  /* ------------------------------------------------------------------ */

  private buildLandmarks(): void {
    // ---- Zero Point Spire: hero launch platform, downtown anchor
    const spireX = 24, spireZ = 60;
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.42, metalness: 0.72 });
    const spireGlass = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.18, metalness: 0.85, emissive: 0x0d2436, emissiveIntensity: 0.5 });

    const seg = (w: number, h: number, y: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
      m.position.set(spireX, y, spireZ);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.collision.addBox(spireX - w / 2, y - h / 2, spireZ - w / 2, spireX + w / 2, y + h / 2, spireZ + w / 2, 0);
      return m;
    };
    seg(56, 150, 75, spireMat);
    seg(46, 60, 180, spireGlass);
    // observation deck (spawn platform)
    seg(70, 6, 213, spireMat);
    seg(36, 66, 246, spireGlass);
    seg(10, 90, 320, spireMat);
    // spire mast + beacon
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 60, 8), spireGlass);
    mast.position.set(spireX, 392, spireZ);
    this.group.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 12), emissiveMaterial(0xff3b3b, 3.2, 0.9));
    beacon.position.set(spireX, 424, spireZ);
    this.group.add(beacon);

    // launch pad marker on the deck
    this.spawnPad = new THREE.Mesh(
      mergeGeometries([
        new THREE.CylinderGeometry(11, 11, 0.6, 28).translate(0, 0.3, 0),
        new THREE.TorusGeometry(9.4, 0.5, 6, 32).rotateX(Math.PI / 2).translate(0, 0.9, 0),
        new THREE.TorusGeometry(5.2, 0.34, 6, 28).rotateX(Math.PI / 2).translate(0, 0.9, 0),
      ])!,
      emissiveMaterial(0x54f0ff, 2.2)
    );
    this.spawnPad.position.set(spireX, 216, spireZ + 18);
    this.group.add(this.spawnPad);
    this.collision.addBox(spireX - 11, 216, spireZ + 7, spireX + 11, 216.6, spireZ + 29, 1);
    this.spawn.pos.set(spireX, 217, spireZ + 18);
    this.spawn.yaw = Math.PI;

    this.addLandmark('ZERO POINT SPIRE', new THREE.Vector3(spireX, 218, spireZ + 18), 'roof');

    // ---- cooling stacks / power plant (industrial)
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x3b3630, roughness: 0.95 });
    for (const [sx, sz, r, h] of [[352, -60, 22, 96], [396, -20, 18, 78], [330, 30, 15, 66]] as const) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 18, 1, true), stackMat);
      st.position.set(sx, h / 2, sz);
      this.group.add(st);
      this.collision.addBox(sx - r, 0, sz - r, sx + r, h, sz + r, 1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.85, 0.7, 5, 20).rotateX(Math.PI / 2), emissiveMaterial(0xff8a2a, 1.4));
      ring.position.set(sx, h - 4, sz);
      this.group.add(ring);
    }
    this.addLandmark('POWER PLANT', new THREE.Vector3(360, 70, -20), 'air');

    // ---- harbor cranes + docks (waterfront)
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xc8952f, roughness: 0.7, metalness: 0.4 });
    const dockMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const cz = -240 + i * 120;
      const cx = -350;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(90, 2.4, 34), dockMat);
      pier.position.set(cx - 30, 3, cz);
      this.group.add(pier);
      this.collision.addBox(cx - 75, 1.8, cz - 17, cx + 15, 4.2, cz + 17, 1);

      const crane = new THREE.Group();
      const parts = [
        [4, 46, 4, 0, 23, 0],
        [46, 3, 4, -6, 46, 0],
        [3, 22, 3, 14, 34, 0],
      ] as const;
      for (const [w, h, d, x, y, z] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), craneMat);
        m.position.set(x, y, z);
        crane.add(m);
      }
      const hook = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), craneMat);
      hook.position.set(14, 22, 0);
      crane.add(hook);
      crane.position.set(cx - 34, 4, cz);
      this.group.add(crane);
      this.collision.addBox(cx - 36, 0, cz - 2, cx - 32, 46, cz + 2, 1);
    }
    this.addLandmark('HARBOR DOCKS', new THREE.Vector3(-380, 5, 0), 'ground');

    // ---- stadium (residential / outskirts mix)
    const stadiumMat = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.85 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(62, 70, 34, 24, 1, true), stadiumMat);
    bowl.position.set(-90, 17, 430);
    this.group.add(bowl);
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const px = -90 + Math.cos(ang) * 66;
      const pz = 430 + Math.sin(ang) * 66;
      this.collision.addBox(px - 7, 0, pz - 7, px + 7, 34, pz + 7, 1);
    }
    this.addLandmark('IRONFALL STADIUM', new THREE.Vector3(-90, 36, 430), 'roof');

    // ---- relay / comms array (outskirts)
    const relayMat = new THREE.MeshStandardMaterial({ color: 0x2e3339, roughness: 0.5, metalness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const rx = 520 + i * 22;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 6, 70, 8), relayMat);
      m.position.set(rx, 35, 140 - i * 26);
      this.group.add(m);
      this.collision.addBox(rx - 6, 0, 140 - i * 26 - 6, rx + 6, 70, 140 - i * 26 + 6, 1);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), relayMat);
      dish.position.set(rx, 74, 140 - i * 26);
      dish.rotation.x = Math.PI * 0.72;
      this.group.add(dish);
    }
    this.addLandmark('RELAY STATION', new THREE.Vector3(545, 76, 100), 'roof');

    // ---- old city square
    // ---- EMPIRE SPIRE — art-deco setback tower with lit crown (reserved zone at -10,-170)
    {
      const ex = -10, ez = -170;
      const mat = new THREE.MeshStandardMaterial({ color: 0x363b45, roughness: 0.5, metalness: 0.65 });
      const setbacks: [number, number][] = [[44, 0], [34, 120], [26, 190], [17, 250]];
      let topY = 0;
      for (const [w2, y] of setbacks) {
        const hh = (setbacks[setbacks.length - 1][1] + 90 - y);
        const m2 = new THREE.Mesh(new THREE.BoxGeometry(w2, hh, w2), mat);
        m2.position.set(ex, y + hh / 2, ez);
        m2.castShadow = true;
        m2.receiveShadow = true;
        this.group.add(m2);
        this.collision.addBox(ex - w2 / 2, y, ez - w2 / 2, ex + w2 / 2, y + hh, ez + w2 / 2, 0);
        topY = y + hh;
      }
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, 46, 8), mat);
      mast.position.set(ex, topY + 23, ez);
      this.group.add(mast);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(21, 6, 21), emissiveMaterial(0xffd9a0, 2.4));
      crown.position.set(ex, topY - 12, ez);
      this.group.add(crown);
      this.addLandmark('EMPIRE SPIRE', new THREE.Vector3(ex, topY, ez), 'roof');
    }

    // ---- CHRYSLER CROWN — tiered arch crown, reserved zone at -150,-330
    {
      const cx2 = -150, cz2 = -330;
      const mat = new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.45, metalness: 0.7 });
      let y = 0;
      for (let t = 0; t < 6; t++) {
        const w2 = 40 - t * 5.4;
        const hh = 40 + t * 8;
        const m2 = new THREE.Mesh(new THREE.BoxGeometry(w2, hh, w2), mat);
        m2.position.set(cx2, y + hh / 2, cz2);
        m2.castShadow = true;
        m2.receiveShadow = true;
        this.group.add(m2);
        this.collision.addBox(cx2 - w2 / 2, y, cz2 - w2 / 2, cx2 + w2 / 2, y + hh, cz2 + w2 / 2, 0);
        y += hh;
      }
      for (let a = 0; a < 7; a++) {
        const aw = 14 - a * 1.7;
        const arc = new THREE.Mesh(
          mergeGeometries([
            new THREE.BoxGeometry(aw, 3.2, aw * 0.55),
            new THREE.TorusGeometry(aw * 0.34, 0.5, 4, 12, Math.PI).rotateX(Math.PI / 2),
          ])!,
          emissiveMaterial(0xf2f6ff, 1.9),
        );
        arc.position.set(cx2, y + 4 + a * 4.4, cz2);
        this.group.add(arc);
      }
      const tip = new THREE.Mesh(new THREE.ConeGeometry(2.4, 26, 8), mat);
      tip.position.set(cx2, y + 42, cz2);
      this.group.add(tip);
      this.collision.addBox(cx2 - 2.4, y, cz2 - 2.4, cx2 + 2.4, y + 55, cz2 + 2.4, 0);
      this.addLandmark('CHRYSLER CROWN', new THREE.Vector3(cx2, y, cz2), 'roof');
    }

    // ---- FREEDOM SPIRE — tapered glass monolith with mast, reserved zone at -240,-40
    {
      const fx = -240, fz = -40;
      const mat = new THREE.MeshStandardMaterial({ color: 0x20282f, roughness: 0.18, metalness: 0.9, emissive: 0x0a1c2c, emissiveIntensity: 0.4 });
      const m2 = new THREE.Mesh(new THREE.CylinderGeometry(15, 25, 300, 4, 1), mat);
      m2.position.set(fx, 150, fz);
      m2.rotation.y = Math.PI / 4;
      m2.castShadow = true;
      m2.receiveShadow = true;
      this.group.add(m2);
      this.collision.addBox(fx - 19, 0, fz - 19, fx + 19, 300, fz + 19, 0);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.4, 70, 8), mat);
      mast.position.set(fx, 335, fz);
      this.group.add(mast);
      this.addLandmark('FREEDOM SPIRE', new THREE.Vector3(fx, 302, fz), 'roof');
    }

    // ---- FLATIRON WEDGE — triangular prismatic block, reserved zone at -100,150
    {
      const wx = -100, wz = 150;
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.75, metalness: 0.25 });
      const shape = new THREE.Shape();
      shape.moveTo(-26, 30);
      shape.lineTo(-26, -30);
      shape.lineTo(34, 0);
      shape.closePath();
      const geoW = new THREE.ExtrudeGeometry(shape, { depth: 84, bevelEnabled: false });
      geoW.rotateX(-Math.PI / 2);
      geoW.rotateY(Math.PI / 2);
      const m2 = new THREE.Mesh(geoW, mat);
      m2.position.set(wx, 42, wz);
      m2.castShadow = true;
      m2.receiveShadow = true;
      this.group.add(m2);
      this.collision.addBox(wx - 26, 0, wz - 28, wx + 30, 84, wz + 28, 0);
      this.addLandmark('FLATIRON WEDGE', new THREE.Vector3(wx, 86, wz), 'roof');
    }

    // ---- LIBERTY ISLE — statue plinth in the bay (original heroic figure)
    {
      const ix = RIVER_MIN - 210, iz = 300;
      const isle = new THREE.Mesh(new THREE.CylinderGeometry(46, 54, 7, 22), new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.9 }));
      isle.position.set(ix, 3.5, iz);
      this.group.add(isle);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 20), new THREE.MeshStandardMaterial({ color: 0x3d3a34, roughness: 0.85 }));
      plinth.position.set(ix, 22, iz);
      plinth.castShadow = true;
      this.group.add(plinth);
      this.collision.addBox(ix - 10, 0, iz - 10, ix + 10, 37, iz + 10, 0);
      const figure = new THREE.Group();
      const robeMat = new THREE.MeshStandardMaterial({ color: 0x3f8a7d, roughness: 0.65, metalness: 0.35, emissive: 0x0c2b24, emissiveIntensity: 0.5 });
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 8.5, 34, 10), robeMat);
      robe.position.y = 17;
      figure.add(robe);
      const headS = new THREE.Mesh(new THREE.SphereGeometry(3.0, 12, 10), robeMat);
      headS.position.y = 37;
      figure.add(headS);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.5, 5, 14), robeMat);
      crown.position.y = 39;
      crown.rotation.x = Math.PI / 2.4;
      figure.add(crown);
      const armUp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 22, 8), robeMat);
      armUp.position.set(2.5, 46, 0);
      armUp.rotation.z = -0.35;
      figure.add(armUp);
      const torchFlame = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), emissiveMaterial(0xffc46a, 3.4, 0.85));
      torchFlame.position.set(6.2, 58, 0);
      figure.add(torchFlame);
      const tablet = new THREE.Mesh(new THREE.BoxGeometry(6, 9, 2.4), robeMat);
      tablet.position.set(-5, 30, 0);
      tablet.rotation.z = 0.28;
      figure.add(tablet);
      figure.position.set(ix, 37, iz);
      figure.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.group.add(figure);
      this.addLandmark('LIBERTY ISLE', new THREE.Vector3(ix, 40, iz), 'air');
    }

    this.buildPark();
    this.buildHelicopterTraffic();
    this.addLandmark('OLD CITY SQUARE', new THREE.Vector3(-150, 2, 200), 'ground');
    this.addLandmark('FINANCIAL PLAZA', new THREE.Vector3(120, 2, -90), 'ground');

    // protect targets for CITY DEFENSE — pick 3 tall downtown roofs the player must guard
    const wanted: [string, number, number][] = [
      ['MERIDIAN TOWER', -60, -30],
      ['AXIOM TOWER', 90, 40],
      ['CIVIC SPIRE', -10, 180],
    ];
    for (const [name, x, z] of wanted) {
      const h = this.roofAt(x, z);
      const pos = new THREE.Vector3(x, h + 12, z);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(16, 1.1, 6, 30).rotateX(Math.PI / 2),
        emissiveMaterial(0x54f0ff, 1.6)
      );
      ring.position.copy(pos);
      this.group.add(ring);
      this.protectTargets.push({ name, pos, integrity: 100, alive: true, ring });
      this.addLandmark(name, pos, 'roof');
    }
  }

  /** Highest rooftop at (x,z), falling back to street level. */
  roofAt(x: number, z: number): number {
    let best = 0;
    for (const c of this.candidates) {
      if (x < c.x - c.w / 2 || x > c.x + c.w / 2) continue;
      if (z < c.z - c.d / 2 || z > c.z + c.d / 2) continue;
      if (c.h > best) best = c.h;
    }
    return best;
  }

  /** Central Park: lawn, pond, dense tree cover. */
  private buildPark(): void {
    const cxm = (PARK_MIN_X + PARK_MAX_X) / 2;
    const czm = (PARK_MIN_Z + PARK_MAX_Z) / 2;
    const pw = PARK_MAX_X - PARK_MIN_X;
    const pd = PARK_MAX_Z - PARK_MIN_Z;

    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, pd),
      new THREE.MeshStandardMaterial({ color: 0x2c4826, roughness: 1 }),
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(cxm, 0.25, czm);
    lawn.receiveShadow = true;
    this.group.add(lawn);

    const pond = new THREE.Mesh(new THREE.PlaneGeometry(pw * 0.3, pd * 0.22), waterMaterial());
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cxm + pw * 0.2, 0.45, czm - pd * 0.25);
    this.water.push(pond);
    this.group.add(pond);

    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 4, 5).translate(0, 2, 0);
    const leafGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(3.4, 0).translate(0, 6.2, 0),
      new THREE.IcosahedronGeometry(2.3, 0).translate(1.6, 4.8, 0.7),
      new THREE.IcosahedronGeometry(2.0, 0).translate(-1.4, 5.1, -0.6),
    ])!;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2c241c, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5629, roughness: 0.9 });
    const trunks: THREE.Matrix4[] = [];
    const leaves: THREE.Matrix4[] = [];
    for (let i = 0; i < 210; i++) {
      const x = this.rng.range(PARK_MIN_X + 6, PARK_MAX_X - 6);
      const z = this.rng.range(PARK_MIN_Z + 6, PARK_MAX_Z - 6);
      const s = this.rng.range(0.75, 1.6);
      this.tmpObj.position.set(x, 0, z);
      this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI * 2), 0);
      this.tmpObj.scale.set(s, this.rng.range(0.9, 1.5), s);
      this.tmpObj.updateMatrix();
      trunks.push(this.tmpObj.matrix.clone());
      leaves.push(this.tmpObj.matrix.clone());
    }
    this.instanced(trunkGeo, trunkMat, trunks, 'park-trunks');
    this.instanced(leafGeo, leafMat, leaves, 'park-leaves');

    this.addLandmark('CENTRAL PARK', new THREE.Vector3(cxm, 2, czm), 'ground');
  }

  /** City helicopter traffic — CC0 kazuma model on patrol loops. */
  private buildHelicopterTraffic(): void {
    new GLTFLoader().loadAsync('assets/models/helicopter.glb').then((gltf) => {
      const proto = gltf.scene;
      const box = new THREE.Box3().setFromObject(proto);
      const size = box.getSize(new THREE.Vector3());
      const s = 7.5 / (Math.max(size.x, size.z) || 1);
      proto.scale.setScalar(s);
      proto.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      for (let i = 0; i < 5; i++) {
        const heli = proto.clone(true);
        const alt = 95 + i * 34;
        const rad = 170 + i * 85;
        const speed = 0.05 + i * 0.012;
        this.helis.push({ root: heli, alt, rad, speed, phase: (i / 5) * Math.PI * 2, center: i % 2 === 0 ? 0.25 : Math.PI * 0.85 });
        this.group.add(heli);
      }
    }).catch(() => { /* offline: helicopters simply do not spawn */ });
  }

  private addLandmark(name: string, pos: THREE.Vector3, kind: Landmark['kind']): void {
    const lm: Landmark = { name, pos, kind };
    this.landmarks.push(lm);
    this.landmarkMap.set(name, lm);
  }

  /* ------------------------------------------------------------------ */
  /* traffic                                                              */
  /* ------------------------------------------------------------------ */

  private buildTraffic(): void {
    const carGeo = mergeGeometries([
      new THREE.BoxGeometry(2.1, 0.85, 4.6).translate(0, 0.75, 0),
      new THREE.BoxGeometry(1.85, 0.72, 2.3).translate(0, 1.45, -0.2),
    ])!;
    const busGeo = mergeGeometries([
      new THREE.BoxGeometry(2.6, 1.15, 9.5).translate(0, 1.0, 0),
      new THREE.BoxGeometry(2.5, 0.55, 8.6).translate(0, 1.75, 0),
    ])!;
    const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.7 });
    const busMat = new THREE.MeshStandardMaterial({ color: 0x9a7b30, roughness: 0.6, metalness: 0.3 });
    const lightGeo = new THREE.BoxGeometry(1.8, 0.26, 0.16);
    const busLightGeo = new THREE.BoxGeometry(2.3, 0.26, 0.16);
    const headMat = emissiveMaterial(0xfff0cf, 2.6);

    const count = 300;
    const busCount = 36;
    this.traffic = [];
    const bs = CITY.blockSize;
    for (let i = 0; i < count; i++) {
      const axis: 0 | 1 = this.rng.chance(0.5) ? 0 : 1;
      const lineIdx = this.rng.int(-CITY.grid / 2 + 1, CITY.grid / 2 - 1);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const line = lineIdx * bs;
      // cars skip the river line; buses run only on arterial roads
      if (this.isWater(line, 0)) continue;
      const arterial = ((lineIdx % 4) + 4) % 4 === 0;
      this.traffic.push({
        axis, line, lane: dir * 3.4, dir,
        speed: this.rng.range(9, 19), t: this.rng.range(-this.worldHalf, this.worldHalf),
        bus: false, arterial,
      });
    }
    for (let i = 0; i < busCount; i++) {
      const axis: 0 | 1 = this.rng.chance(0.5) ? 0 : 1;
      const lineIdx = this.rng.int(-CITY.grid / 2 + 1, CITY.grid / 2 - 1);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const line = lineIdx * bs;
      if (this.isWater(line, 0)) continue;
      this.traffic.push({
        axis, line, lane: dir * 6.4, dir,
        speed: this.rng.range(7, 11), t: this.rng.range(-this.worldHalf, this.worldHalf),
        bus: true, arterial: true,
      });
    }

    const carTotal = this.traffic.filter((t) => !t.bus).length;
    const busTotal = this.traffic.length - carTotal;
    this.carMesh = new THREE.InstancedMesh(carGeo, carMat, Math.max(1, carTotal));
    this.carMesh.name = 'cars';
    this.carMesh.frustumCulled = false;
    this.carMesh.castShadow = true;
    this.group.add(this.carMesh);
    if (busTotal > 0) {
      this.busMesh = new THREE.InstancedMesh(busGeo, busMat, busTotal);
      this.busMesh.name = 'buses';
      this.busMesh.frustumCulled = false;
      this.busMesh.castShadow = true;
      this.group.add(this.busMesh);
    }

    this.carLightMesh = new THREE.InstancedMesh(lightGeo, headMat, Math.max(1, carTotal) * 2);
    this.carLightMesh.name = 'car-lights';
    this.carLightMesh.frustumCulled = false;
    this.group.add(this.carLightMesh);

    // per-car paint: NYC yellow cabs + neutral street mix (instance colors)
    const cabYellow = new THREE.Color(0xf2c230);
    const paints = [0xd8d9dd, 0x23262b, 0x8e9298, 0x5e6772, 0x7a2f26, 0x2e4a68, 0xe8e6df];
    for (let i = 0; i < carTotal; i++) {
      const paint = this.rng.chance(0.16) ? cabYellow : new THREE.Color(paints[this.rng.int(0, paints.length - 1)]);
      this.carMesh.setColorAt(i, paint);
    }
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;
    if (busTotal > 0) {
      this.busLightMesh = new THREE.InstancedMesh(busLightGeo, headMat, busTotal * 2);
      this.busLightMesh.name = 'bus-lights';
      this.busLightMesh.frustumCulled = false;
      this.group.add(this.busLightMesh);
    }
  }

  private updateTraffic(dt: number): void {
    const half = this.worldHalf;
    let ci = 0, bi = 0;
    for (const c of this.traffic) {
      c.t += c.speed * c.dir * dt;
      if (c.t > half) c.t = -half;
      if (c.t < -half) c.t = half;
      const x = c.axis === 0 ? c.t : c.line + c.lane;
      const z = c.axis === 0 ? c.line + c.lane : c.t;
      const rotY = c.axis === 0 ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      this.tmpObj.position.set(x, 0, z);
      this.tmpObj.rotation.set(0, rotY, 0);
      this.tmpObj.scale.setScalar(1);
      this.tmpObj.updateMatrix();

      const fwd = c.axis === 0 ? new THREE.Vector3(c.dir, 0, 0) : new THREE.Vector3(0, 0, c.dir);
      const mesh = c.bus ? this.busMesh : this.carMesh;
      const lights = c.bus ? this.busLightMesh : this.carLightMesh;
      const at = c.bus ? 4.7 : 2.3;
      if (mesh) {
        mesh.setMatrixAt(c.bus ? bi : ci, this.tmpObj.matrix);
        for (let k = 0; k < 2; k++) {
          const p = new THREE.Vector3(x + fwd.x * (k === 0 ? at : -at), 0.62, z + fwd.z * (k === 0 ? at : -at));
          this.tmpObj.position.copy(p);
          this.tmpObj.updateMatrix();
          lights!.setMatrixAt((c.bus ? bi : ci) * 2 + k, this.tmpObj.matrix);
        }
      }
      if (c.bus) bi++; else ci++;
    }
    if (this.carMesh.instanceMatrix) this.carMesh.instanceMatrix.needsUpdate = true;
    this.carLightMesh.instanceMatrix.needsUpdate = true;
    if (this.busMesh) this.busMesh.instanceMatrix.needsUpdate = true;
    if (this.busLightMesh) this.busLightMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ */
  /* distant skyline filler beyond the playfield                          */
  /* ------------------------------------------------------------------ */

  private buildSkylineFill(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 1, metalness: 0 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < 190; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(this.worldHalf + 120, this.worldHalf + 640);
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      if (this.isWater(x, z)) continue; // no towers rising out of the rivers
      const h = this.rng.range(40, 260);
      const w = this.rng.range(24, 70);
      this.tmpObj.position.set(x, h / 2, z);
      this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI), 0);
      this.tmpObj.scale.set(w, h, w);
      this.tmpObj.updateMatrix();
      mats.push(this.tmpObj.matrix.clone());
    }
    const m = this.instanced(geo, mat, mats, 'skyline-fill');
    if (m) m.receiveShadow = false;

    this.buildBoroStrips();
    this.buildEastRiverBridge();
    this.buildAerialAmbience();
  }

  /** Mid-rise far banks: the boro across the East River + the Jersey shore. */
  private buildBoroStrips(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.95, metalness: 0.05 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats: THREE.Matrix4[] = [];
    const strip = (xMin: number, xMax: number, zMin: number, zMax: number, count: number, hMin: number, hMax: number) => {
      for (let i = 0; i < count; i++) {
        const x = this.rng.range(xMin, xMax);
        const z = this.rng.range(zMin, zMax);
        if (this.isWater(x, z)) continue;
        const h = this.rng.range(hMin, hMax);
        const w = this.rng.range(18, 44);
        const d = this.rng.range(18, 44);
        this.tmpObj.position.set(x, h / 2, z);
        this.tmpObj.rotation.set(0, this.rng.range(0, Math.PI), 0);
        this.tmpObj.scale.set(w, h, d);
        this.tmpObj.updateMatrix();
        mats.push(this.tmpObj.matrix.clone());
      }
    };
    strip(EAST_RIVER_MAX + 30, EAST_RIVER_MAX + 420, -WORLD_HALF - 60, WORLD_HALF + 60, 90, 16, 95); // boro east
    strip(RIVER_MIN - 560, RIVER_MIN - 60, -WORLD_HALF - 80, WORLD_HALF + 80, 80, 14, 80);          // jersey west
    const m = this.instanced(geo, mat, mats, 'boro-strips');
    if (m) m.receiveShadow = false;
  }

  /** Brooklyn-bridge-style suspension crossing over the east channel. */
  private buildEastRiverBridge(): void {
    const z = 40;
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.85, metalness: 0.3 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x555c64, roughness: 0.5, metalness: 0.7 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.9 });
    const lampMat = emissiveMaterial(0xffcf9a, 1.5);

    const x0 = EAST_RIVER_MIN - 90;
    const x1 = EAST_RIVER_MAX + 90;
    const len = x1 - x0;
    const cxm = (x0 + x1) / 2;
    const y = 26;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 30), deckMat);
    deck.position.set(cxm, y, z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);
    this.collision.addBox(x0, y - 1.3, z - 15, x1, y + 1.3, z + 15, 1);

    // gothic stone towers + main cables
    for (const tx of [EAST_RIVER_MIN + 40, EAST_RIVER_MAX - 40]) {
      for (const s of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 108, 9), stoneMat);
        tower.position.set(tx, 54, z + s * 12);
        tower.castShadow = true;
        this.group.add(tower);
        this.collision.addBox(tx - 5, 0, z + s * 12 - 4.5, tx + 5, 108, z + s * 12 + 4.5, 1);
        // pointed cap
        const cap = new THREE.Mesh(new THREE.ConeGeometry(5.4, 12, 4), stoneMat);
        cap.position.set(tx, 114, z + s * 12);
        cap.rotation.y = Math.PI / 4;
        this.group.add(cap);
      }
      // main cable drape between/behind towers
      for (const s of [-1, 1]) {
        const cz = z + s * 12;
        const midDrop = 62;
        const segments = 26;
        let prev = new THREE.Vector3(tx - (len / 2) * 0.55, 100, cz);
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const px = tx - (len / 2) * 0.55 + t * len * 0.55;
          const arc = 1 - Math.pow(2 * t - 1, 2); // parabola, 0 at ends, 1 mid
          const py = 100 - midDrop * (1 - arc);
          const next = new THREE.Vector3(px, py, cz);
          const midPt = prev.clone().add(next).multiplyScalar(0.5);
          const dirV = next.clone().sub(prev);
          const segLen = dirV.length();
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, segLen, 5), cableMat);
          seg.position.copy(midPt);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV.normalize());
          this.group.add(seg);
          // vertical suspenders every other segment
          if (i % 2 === 0 && py > y + 4) {
            const drop = py - (y + 1);
            const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, drop, 4), cableMat);
            hang.position.set(px, y + 1 + drop / 2, cz);
            this.group.add(hang);
          }
          prev = next;
        }
      }
    }

    // deck lamps
    const lamps: THREE.Matrix4[] = [];
    const lampGeo = new THREE.BoxGeometry(1.1, 0.4, 1.1);
    for (let x = x0 + 10; x < x1; x += 16) {
      for (const side of [-1, 1]) {
        this.tmpObj.position.set(x, y + 3.4, z + side * 13.6);
        this.tmpObj.updateMatrix();
        lamps.push(this.tmpObj.matrix.clone());
      }
    }
    this.instanced(lampGeo, lampMat, lamps, 'east-bridge-lamps');

    this.addLandmark('EAST SIDE BRIDGE', new THREE.Vector3(cxm, y + 10, z), 'air');
  }

  /* ------------------------------------------------------------------ */
  /* aerial ambience: patrol blimps + sky signs                            */
  /* ------------------------------------------------------------------ */

  private buildAerialAmbience(): void {
    // Null Syndicate patrol blimps with cone searchlights
    const hullGeo = new THREE.CapsuleGeometry(6, 22, 6, 12);
    hullGeo.rotateZ(Math.PI / 2);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.4 });
    const finGeo = mergeGeometries([
      new THREE.BoxGeometry(0.4, 5, 8).translate(0, 0, -14),
      new THREE.BoxGeometry(0.4, 5, 8).translate(0, 0, 14),
      new THREE.BoxGeometry(0.4, 8, 5).translate(0, 2.5, 0),
    ])!;
    const searchGeo = new THREE.ConeGeometry(9, 46, 12, 1, true);
    searchGeo.translate(0, -23, 0);
    searchGeo.rotateX(Math.PI);
    const searchMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide,
    });
    const coreMat = emissiveMaterial(0xff2b2b, 2.0);
    const coreGeo = new THREE.SphereGeometry(1.1, 8, 8);

    for (let i = 0; i < 3; i++) {
      const blimp = new THREE.Group();
      blimp.add(new THREE.Mesh(hullGeo, hullMat));
      blimp.add(new THREE.Mesh(finGeo, hullMat));
      const beam = new THREE.Mesh(searchGeo, searchMat);
      beam.position.y = -4;
      blimp.add(beam);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(0, 1, 0);
      blimp.add(core);
      blimp.position.set(
        this.rng.range(-320, 420),
        this.rng.range(330, 430),
        this.rng.range(-360, 420)
      );
      const speed = this.rng.range(1.6, 3.0) * (this.rng.chance(0.5) ? 1 : -1);
      this.blimps.push({ root: blimp, speed, phase: this.rng.range(0, Math.PI * 2), beam });
      this.group.add(blimp);
    }

    // sky-high billboard rings around the skyline (visible from everywhere)
    const atlas = billboardAtlas();
    const skyBbMat = new THREE.MeshStandardMaterial({
      map: atlas, emissiveMap: atlas, emissiveIntensity: 1.8, emissive: 0xffffff,
      roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide,
    });
    const bbGeo = new THREE.PlaneGeometry(64, 34);
    const skyMats: THREE.Matrix4[] = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + this.rng.range(-0.2, 0.2);
      const rad = this.rng.range(this.worldHalf + 40, this.worldHalf + 140);
      this.tmpObj.position.set(Math.cos(ang) * rad, this.rng.range(180, 300), Math.sin(ang) * rad);
      this.tmpObj.rotation.set(0, -ang + Math.PI / 2, 0);
      this.tmpObj.scale.setScalar(1);
      this.tmpObj.updateMatrix();
      skyMats.push(this.tmpObj.matrix.clone());
    }
    // four sky boards, each sampling a distinct cell of the 2x4 atlas
    const skyCells = [0, 3, 4, 7];
    for (let c = 0; c < 4; c++) {
      const slice = skyMats.slice(c * 2, c * 2 + 2);
      if (!slice.length) continue;
      const cellIdx = skyCells[c];
      const g = bbGeo.clone();
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const u = (cellIdx % 2) / 2;
      const v = 1 - Math.floor(cellIdx / 2) / 4 - 1 / 4;
      for (let i2 = 0; i2 < uv.count; i2++) uv.setXY(i2, u + uv.getX(i2) / 2, v + uv.getY(i2) / 4);
      uv.needsUpdate = true;
      const mesh = new THREE.InstancedMesh(g, skyBbMat, slice.length);
      slice.forEach((mx, k) => mesh.setMatrixAt(k, mx));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `sky-billboard-${c}`;
      this.group.add(mesh);
    }
  }

  blimps: { root: THREE.Group; speed: number; phase: number; beam: THREE.Mesh }[] = [];
  private helis: { root: THREE.Object3D; alt: number; rad: number; speed: number; phase: number; center: number }[] = [];

  /* ------------------------------------------------------------------ */
  /* runtime                                                              */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    MAT_UNIFORMS.uTime.value += dt;
    this.updateTraffic(dt);
    const pulse = 1 + Math.sin(MAT_UNIFORMS.uTime.value * 1.8) * 0.06;
    this.spawnPad.scale.set(pulse, 1, pulse);
    for (const t of this.protectTargets) {
      t.ring.rotation.z += dt * 0.35;
      (t.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = t.alive ? 1.4 + Math.sin(MAT_UNIFORMS.uTime.value * 2.4) * 0.5 : 0.15;
    }
    // helicopters orbit the city on traffic loops
    const clock = MAT_UNIFORMS.uTime.value;
    for (const h of this.helis) {
      h.phase += h.speed * dt;
      const ang = h.phase + h.center;
      h.root.position.set(Math.cos(ang) * h.rad, h.alt + Math.sin(clock * 0.7 + h.rad) * 2.5, Math.sin(ang) * h.rad);
      h.root.rotation.y = -ang + Math.PI;
    }
    // blimps drift on slow loops, beams sweeping the streets below
    for (const b of this.blimps) {
      b.phase += dt * 0.05;
      b.root.position.x += Math.cos(b.phase) * b.speed * dt;
      b.root.position.z += Math.sin(b.phase * 0.7) * b.speed * dt;
      b.root.rotation.y = Math.atan2(
        Math.cos(b.phase) * b.speed,
        Math.sin(b.phase * 0.7) * b.speed
      ) + Math.PI / 2;
      b.root.rotation.z = Math.sin(b.phase * 1.3) * 0.04;
      b.beam.rotation.z = Math.sin(b.phase * 2.1) * 0.5;
    }
  }

  /** Highest reachable surface at (x,z) at or below referenceY. */
  supportAt(x: number, z: number, referenceY: number): number {
    const h = this.collision.supportHeightAt(x, z, referenceY);
    return h === null ? 0 : h;
  }

  /** Straight-line roof height for spawn/mission planning (ignores bridges). */
  rooftopAt(x: number, z: number): number {
    return this.roofAt(x, z);
  }
}
