import type * as THREE from 'three';
import { PERF } from '../config';
import { clamp } from '../util/Rng';

/** Frame-time sampler + renderer counters. Drives adaptive quality. */
export class Perf {
  fps = 60;
  frameMs = 16.7;
  worstMs = 16.7;
  drawCalls = 0;
  triangles = 0;
  programs = 0;
  geometries = 0;
  textures = 0;
  pixelRatio = 1;

  private acc = 0;
  private n = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private cooldown = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.pixelRatio = Math.min(devicePixelRatio || 1, PERF.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  sample(dt: number): void {
    const ms = dt * 1000;
    this.acc += ms;
    this.n++;
    this.frameMs = this.frameMs * 0.9 + ms * 0.1;
    this.worstMs = Math.max(this.worstMs * 0.96, ms);
    if (this.n >= 12) {
      const avg = this.acc / this.n;
      this.fps = Math.round(1000 / Math.max(0.001, avg));
      this.acc = 0;
      this.n = 0;
      if (avg > 1000 / PERF.acceptFps) this.slowFrames++;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (avg < 1000 / (PERF.targetFps + 8)) this.fastFrames++;
      else this.fastFrames = Math.max(0, this.fastFrames - 1);
    }
    this.cooldown -= dt;
    const info = this.renderer.info;
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs?.length ?? 0;
    this.geometries = info.memory.geometries;
    this.textures = info.memory.textures;
  }

  /** -1 = lower quality, +1 = raise quality, 0 = hold. */
  recommend(): -1 | 0 | 1 {
    if (this.cooldown > 0) return 0;
    if (this.slowFrames >= 4 && this.pixelRatio > PERF.adaptiveMinPixelRatio) {
      this.cooldown = 2.5;
      this.slowFrames = 0;
      return -1;
    }
    if (this.fastFrames >= 8 && this.pixelRatio < Math.min(devicePixelRatio || 1, PERF.maxPixelRatio)) {
      this.cooldown = 3.5;
      this.fastFrames = 0;
      return 1;
    }
    return 0;
  }

  setPixelRatio(r: number): void {
    this.pixelRatio = clamp(r, PERF.adaptiveMinPixelRatio, PERF.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
  }
}
