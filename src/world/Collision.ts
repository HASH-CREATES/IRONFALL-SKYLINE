import * as THREE from 'three';

export interface CollisionBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  kind: number; // 0 building, 1 deck/solid prop, 2 water-blocking wall
  id: number;
}

export interface Hit {
  box: CollisionBox;
  normal: THREE.Vector3;
  depth: number;
}

export interface RayHit {
  box: CollisionBox;
  dist: number;
  point: THREE.Vector3;
}

const CELL = 34;

/**
 * Axis-aligned spatial hash used for hero/enemy collision, surface queries and
 * projectile raycasts against the city. Buildings stay axis-aligned by design.
 */
export class CollisionWorld {
  private cells = new Map<number, CollisionBox[]>();
  all: CollisionBox[] = [];
  private nextId = 1;

  private key(ix: number, iz: number): number {
    return ix * 16384 + iz;
  }

  addBox(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    kind = 0
  ): CollisionBox {
    const box: CollisionBox = { minX, minY, minZ, maxX, maxY, maxZ, kind, id: this.nextId++ };
    this.all.push(box);
    const ix0 = Math.floor(minX / CELL), ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL), iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(box);
      }
    }
    return box;
  }

  /** Unique boxes overlapping the given AABB (dedup by id). */
  gather(minX: number, minZ: number, maxX: number, maxZ: number, out: CollisionBox[]): CollisionBox[] {
    out.length = 0;
    const ix0 = Math.floor(minX / CELL), ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL), iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (out.indexOf(b) === -1) out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Highest solid surface directly beneath (x,z). Returns 0 for street level when
   * nothing is overhead, or null when outside the terrain footprint.
   */
  surfaceHeightAt(x: number, z: number, ignoreAboveY = Infinity): number | null {
    const tmp: CollisionBox[] = [];
    this.gather(x, z, x, z, tmp);
    let best: number | null = 0;
    for (const b of tmp) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY > ignoreAboveY) continue;
      if (best === null || b.maxY > best) best = b.maxY;
    }
    return best;
  }

  /** Nearest box top at or below referenceY (what you would stand on). */
  supportHeightAt(x: number, z: number, referenceY: number, tolerance = 0.9): number | null {
    const tmp: CollisionBox[] = [];
    this.gather(x, z, x, z, tmp);
    let best: number | null = null;
    for (const b of tmp) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY > referenceY + tolerance) continue;
      if (best === null || b.maxY > best) best = b.maxY;
    }
    return best;
  }

  /** All boxes whose AABB contains the point (roof test helper). */
  boxTopAt(x: number, z: number): number | null {
    return this.surfaceHeightAt(x, z);
  }

  /**
   * Deepest overlap of a sphere with any box; returns corrected normal + depth.
   * Standard closest-point-on-AABB resolution — cheap and stable for flight.
   */
  resolveSphere(pos: THREE.Vector3, radius: number, out: Hit): Hit | null {
    const tmp: CollisionBox[] = [];
    this.gather(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, tmp);
    let best: Hit | null = null;
    for (const b of tmp) {
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cy = Math.max(b.minY, Math.min(pos.y, b.maxY));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 > radius * radius) continue;

      let nx = 0, ny = 0, nz = 0, depth = 0;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = dx / d; ny = dy / d; nz = dz / d;
        depth = radius - d;
      } else {
        // sphere centre inside the box: escape along the shallowest axis
        const px = Math.min(pos.x - b.minX, b.maxX - pos.x);
        const py = Math.min(pos.y - b.minY, b.maxY - pos.y);
        const pz = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
        if (px <= py && px <= pz) { nx = pos.x < (b.minX + b.maxX) * 0.5 ? -1 : 1; depth = px + radius; }
        else if (py <= pz) { ny = pos.y < (b.minY + b.maxY) * 0.5 ? -1 : 1; depth = py + radius; }
        else { nz = pos.z < (b.minZ + b.maxZ) * 0.5 ? -1 : 1; depth = pz + radius; }
      }
      if (!best || depth > best.depth) {
        best = best || { box: b, normal: new THREE.Vector3(), depth: 0 };
        best.box = b;
        best.normal.set(nx, ny, nz);
        best.depth = depth;
      }
    }
    if (best) out.box = best.box, out.normal.copy(best.normal), out.depth = best.depth;
    return best ? out : null;
  }

  /** True when a sphere overlaps solid geometry. */
  overlaps(pos: THREE.Vector3, radius: number): boolean {
    const hit: Hit = { box: this.all[0], normal: new THREE.Vector3(), depth: 0 };
    return this.resolveSphere(pos, radius, hit) !== null;
  }

  private rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: CollisionBox): number {
    const invx = 1 / (dx || 1e-9), invy = 1 / (dy || 1e-9), invz = 1 / (dz || 1e-9);
    let t1 = (b.minX - ox) * invx, t2 = (b.maxX - ox) * invx;
    let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (b.minY - oy) * invy; t2 = (b.maxY - oy) * invy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (b.minZ - oz) * invz; t2 = (b.maxZ - oz) * invz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < 0 || tmin > tmax) return -1;
    return tmin < 0 ? 0 : tmin;
  }

  /** March along the ray gathering cells, then exact slab tests. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out?: RayHit): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxDist;
    const seen = new Set<number>();
    const step = CELL * 0.5;
    const count = Math.ceil(maxDist / step);
    for (let i = 0; i <= count; i++) {
      const t = i * step;
      const sx = origin.x + dir.x * t;
      const sz = origin.z + dir.z * t;
      const list = this.cells.get(this.key(Math.floor(sx / CELL), Math.floor(sz / CELL)));
      if (!list) continue;
      for (const b of list) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        const ht = this.rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b);
        if (ht >= 0 && ht < bestT) {
          bestT = ht;
          if (out) { best = out; out.box = b; out.dist = ht; out.point.set(origin.x + dir.x * ht, origin.y + dir.y * ht, origin.z + dir.z * ht); }
          else best = { box: b, dist: ht, point: new THREE.Vector3(origin.x + dir.x * ht, origin.y + dir.y * ht, origin.z + dir.z * ht) };
        }
      }
    }
    return best;
  }

  /** Line of sight test used by enemy AI and the missile lock. */
  losClear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = new THREE.Vector3().subVectors(b, a);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.multiplyScalar(1 / dist);
    const hit = this.raycast(a, dir, dist);
    return !hit || hit.dist >= dist - 0.5;
  }
}
