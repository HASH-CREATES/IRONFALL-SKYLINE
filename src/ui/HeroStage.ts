import * as THREE from 'three';
import { ironManBank } from '../player/IronManModel';

/* ------------------------------------------------------------------ *
 * HERO STAGE — full-bleed crimson showroom.
 * The entire landing background is a crimson-lit stage; the Iron Man
 * model rotates on the right, premium copy sits on the left (DOM layer
 * above). The figure stands directly on the reflective floor — no pad,
 * no backdrop type. The stage is opaque, so the city never shows
 * through on the landing page.
 * ------------------------------------------------------------------ */

export class HeroStage {
  root: HTMLDivElement;
  private canvasHolder: HTMLDivElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private model: THREE.Group | null = null;
  private emissives: THREE.MeshStandardMaterial[] = [];
  private raf = 0;
  private time = 0;
  private mx = 0;
  private my = 0;
  private visible = false;
  private started = false;
  /** true once the GLB load settled (success or offline fallback) */
  private modelReady = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ihs-stage ic-hidden';
    this.root.innerHTML = `
      <div class="ihs-bg" aria-hidden="true"></div>
      <div class="ihs-beam" aria-hidden="true"></div>
      <div class="ihs-canvas" aria-hidden="true"></div>
      <span class="ihs-corner tl"></span>
      <span class="ihs-corner tr"></span>
      <span class="ihs-corner bl"></span>
      <span class="ihs-corner br"></span>
      <div class="ihs-plaque">
        <span class="ihs-plaque-rule"></span>
        <span class="ihs-plaque-txt">MK-1 EXTREMIS<em>Showroom 01 — Exhibition Frame</em></span>
        <span class="ihs-plaque-rule"></span>
      </div>
    `;
    this.canvasHolder = this.root.querySelector('.ihs-canvas') as HTMLDivElement;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
    this.camera.position.set(0, 1.32, 4.35);
    this.camera.lookAt(0, 1.0, 0);

    // gate: never start the stage before the model has settled
    ironManBank.ready.then(() => {
      this.modelReady = true;
      this.tryStart();
    });
  }

  private tryStart(): void {
    if (this.started || !this.visible || !this.modelReady) return;
    this.started = true;

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.canvasHolder.appendChild(this.renderer.domElement);
    } catch {
      return; // no WebGL2: crimson wall + outline type still carry the design
    }

    /* ---- showroom lighting -------------------------------------- */
    const key = new THREE.SpotLight(0xfff1de, 60, 14, 0.62, 0.55, 1.6);
    key.position.set(0.4, 5.2, 2.2);
    key.target.position.set(0, 0.9, 0);
    this.scene.add(key, key.target);
    const wallBounce = new THREE.PointLight(0xff4a38, 9, 9, 1.8);
    wallBounce.position.set(0, 1.5, -1.9);
    this.scene.add(wallBounce);
    const floorBounce = new THREE.PointLight(0xff3a2e, 4, 7, 2);
    floorBounce.position.set(-1.6, 0.4, 0.6);
    this.scene.add(floorBounce);
    const arc = new THREE.PointLight(0xcfeaff, 3.2, 6, 2);
    arc.position.set(1.4, 1.3, 1.6);
    this.scene.add(arc);
    this.scene.add(new THREE.AmbientLight(0x48202a, 1.1));

    /* ---- no floor disc: the crimson backdrop already carries a dark
     *      floor band; a disc just reads as a clipped slab here ------- */

    /* ---- soft contact shadow on the floor (no pad) ---------------- */
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: HeroStage.blobTexture(), transparent: true, opacity: 0.5, depthWrite: false }),
    );
    blob.position.y = 0.004;
    this.scene.add(blob);

    /* ---- the figure ---------------------------------------------- */
    const inst = ironManBank.instantiate();
    if (inst) {
      this.model = inst.root;
      this.emissives = inst.emissives;
      this.model.position.set(0, 0, 0);
      this.model.rotation.y = -0.42;
      this.scene.add(this.model);
    }

    this.resize();
    this.loop();
  }

  /** Radial soft blob used as the figure's contact shadow. */
  private static blobTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = this.canvasHolder.clientWidth || 560;
    const h = this.canvasHolder.clientHeight || 560;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || !this.renderer) return;
    this.time += 0.016;

    // continuous slow rotation + mouse parallax on the camera
    if (this.model) this.model.rotation.y += 0.0048;
    const px = this.mx * 0.45;
    const py = this.my * 0.2;
    this.camera.position.x += ((px + Math.sin(this.time * 0.07) * 0.24) - this.camera.position.x) * 0.04;
    this.camera.position.y += ((1.32 - py) - this.camera.position.y) * 0.04;
    this.camera.lookAt(0, 1.0, 0);

    // arc reactor breathing
    const pulse = 2.1 + Math.sin(this.time * 2.2) * 0.7;
    for (const m of this.emissives) m.emissiveIntensity = pulse;

    this.renderer.render(this.scene, this.camera);
  };

  show(): void {
    this.visible = true;
    this.root.classList.remove('ic-hidden');
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.tryStart();
    this.resize();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('ic-hidden');
    this.root.classList.remove('on');
  }

  parallax(nx: number, ny: number): void {
    this.mx = nx;
    this.my = ny;
  }

  resizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(this.canvasHolder);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
  }
}
