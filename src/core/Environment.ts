import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA, PERF, type QualityLevel } from '../config';
import { MAT_UNIFORMS } from '../world/Materials';
import { clamp } from '../util/Rng';

/** Final cinematic grade: saturation, contrast, vignette, film grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSaturation: { value: 1.16 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.022 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;

    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // filmic contrast around mid grey
      col = (col - 0.5) * uContrast + 0.5;

      // gentle saturation lift (luma-weighted)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // warm highlights / cool shadows — subtle teal-orange grade
      col += vec3(0.012, 0.004, -0.008) * (1.0 - luma);
      col += vec3(0.014, 0.008, 0.0) * luma * luma;

      // vignette
      vec2 q = vUv - 0.5;
      float vig = 1.0 - dot(q, q) * uVignette * 2.2;
      col *= clamp(vig, 0.0, 1.0);

      // fine animated grain (kills banding, adds film texture)
      float g = (h21(vUv * vec2(1613.0, 971.0) + fract(uTime) * 43.7) - 0.5) * uGrain;
      col += g;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Atmosphere, lighting and the restrained post stack. Time of day is a single
 * dial (0 = noon, 1 = deep night) that drives sky, fog, sun and window lights.
 */
export class Environment {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  grade: ShaderPass | null = null;
  quality: QualityLevel = 'high';
  private sky: THREE.Mesh;
  private clouds: THREE.Mesh;
  private renderPass: RenderPass;
  private outputPass: OutputPass;
  private nightMix = 0.55;
  private sunDir = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, aspect: number) {
    this.scene = scene;
    this.renderer = renderer;
    try {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.pmrem.compileEquirectangularShader();
    } catch {
      this.pmrem = null;
    }
    scene.background = null;
    scene.fog = new THREE.FogExp2(0x16202f, 0.00085);

    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1a2028, 0.9);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffd0a0, 2.3);
    this.sun.position.set(320, 520, 220);
    this.sun.castShadow = false; // enabled by quality tier in setQuality()
    this.sun.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1100;
    this.sun.shadow.camera.left = -170;
    this.sun.shadow.camera.right = 170;
    this.sun.shadow.camera.top = 170;
    this.sun.shadow.camera.bottom = -170;
    this.sun.shadow.bias = -0.0006;      // tight frustum tolerates less bias
    this.sun.shadow.normalBias = 0.6;    // kills acne on the instanced towers
    // Soft filtered penumbra: VSM blurs the whole shadow map (ideal for the
    // instanced-city scale); PCFSoft is the fallback everywhere else.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    this.sun.shadow.radius = 4;
    this.sun.shadow.blurSamples = 8;
    scene.add(this.sun);
    scene.add(this.sun.target);

    const fill = new THREE.DirectionalLight(0x4d8ecf, 0.5);
    fill.position.set(-420, 260, -320);
    scene.add(fill);

    this.sky = this.buildSky();
    scene.add(this.sky);
    this.clouds = this.buildClouds();
    scene.add(this.clouds);

    // ---- post stack: MSAA + HDR half-float target (kills jaggies + banding),
    // then bloom → tone-map/output → cinematic grade
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, new THREE.Camera());
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.5, 0.85, 0.78);
    this.composer.addPass(this.bloom);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;    void aspect;
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(3400, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uNight: { value: 0.55 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.72, 0.3).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform float uNight;
        uniform float uTime;
        uniform vec3 uSunDir;

        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        void main(){
          vec3 d = normalize(vDir);
          float up = clamp(d.y, -1.0, 1.0);

          vec3 dayHigh = vec3(0.16, 0.36, 0.62);
          // warm horizon band pushes the day sky toward golden hour
          vec3 dayLow  = vec3(0.72, 0.62, 0.50);
          vec3 nightHigh = vec3(0.012, 0.028, 0.062);
          vec3 nightLow  = vec3(0.10, 0.13, 0.20);

          vec3 high = mix(dayHigh, nightHigh, uNight);
          vec3 low = mix(dayLow, nightLow, uNight);
          vec3 col = mix(low, high, pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), 0.85));

          // sun / moon disc + glow
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          float glow = pow(sd, 26.0) * 1.4 + pow(sd, 5.0) * 0.22;
          vec3 sunCol = mix(vec3(1.0, 0.86, 0.62), vec3(0.72, 0.8, 1.0), uNight);
          col += sunCol * glow * (1.0 - uNight * 0.55);
          // hard solar disc so the light source has a real shape in the sky
          float disc = smoothstep(0.99965, 0.99985, sd);
          col += sunCol * disc * 3.2 * (1.0 - uNight * 0.7);

          // horizon haze
          float horizon = pow(1.0 - abs(up), 6.0);
          col += mix(vec3(0.36, 0.42, 0.5), vec3(0.14, 0.18, 0.26), uNight) * horizon * 0.35;

          // stars
          if (uNight > 0.32 && up > 0.0) {
            vec2 sp = floor(d.xz / max(0.0025, 0.0009) * 0.6 + d.yy);
            float st = step(0.9965, h21(sp * 3.17));
            float tw = 0.65 + 0.35 * sin(uTime * 3.0 + h21(sp) * 40.0);
            col += vec3(0.85, 0.9, 1.0) * st * tw * (uNight - 0.32) * 2.4 * smoothstep(0.0, 0.5, up);
          }

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -1000;
    return m;
  }

  private buildClouds(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 0.55 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vWorld;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uNight;

        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = h21(i), b = h21(i + vec2(1,0)), c = h21(i + vec2(0,1)), d = h21(i + vec2(1,1));
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
        }
        float fbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; }
          return s;
        }

        void main(){
          vec2 p = vWorld.xz * 0.00055 + vec2(uTime * 0.0022, uTime * 0.0011);
          float f = fbm(p * 3.4);
          float f2 = fbm(p * 8.0 + 21.3);
          float density = smoothstep(0.52, 0.86, f * 0.72 + f2 * 0.38);

          // fade near the plane's own horizon to avoid a visible hard rim
          float rim = 1.0 - smoothstep(2600.0, 4300.0, length(vWorld.xz));

          vec3 col = mix(vec3(0.92, 0.94, 0.98), vec3(0.09, 0.12, 0.19), uNight);
          col *= 0.75 + f2 * 0.5;
          float alpha = density * rim * (0.62 - uNight * 0.34);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 380;
    m.frustumCulled = false;
    m.renderOrder = -900;
    return m;
  }

  /**
   * Metals are physically black without an environment to reflect, so the sky is
   * baked into a small PMREM probe whenever the time of day changes. This is what
   * makes the armour, drones and glass towers read as metal instead of plastic.
   */
  private buildEnvMap(high: THREE.Color, horizon: THREE.Color, ground: THREE.Color): void {
    if (!this.pmrem) return;
    const w = 128, h = 64;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `#${high.getHexString()}`);
    grad.addColorStop(0.5, `#${horizon.getHexString()}`);
    grad.addColorStop(1, `#${ground.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // sun / moon blob projected into the equirect
    const u = (Math.atan2(this.sunDir.z, this.sunDir.x) / (Math.PI * 2) + 0.5) * w;
    const v = (Math.asin(clamp(this.sunDir.y, -1, 1)) / Math.PI + 0.5) * h;
    const sunCol = this.nightMix > 0.5 ? '255,255,255' : '255,236,200';
    const blob = ctx.createRadialGradient(u, h - v, 1, u, h - v, 16);
    blob.addColorStop(0, `rgba(${sunCol},${1 - this.nightMix * 0.4})`);
    blob.addColorStop(1, `rgba(${sunCol},0)`);
    ctx.fillStyle = blob;
    ctx.fillRect(u - 18, h - v - 18, 36, 36);

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    try {
      const rt = this.pmrem.fromEquirectangular(tex);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    } catch {
      // environment probes are an enhancement, never a hard requirement
    }
    tex.dispose();
  }

  setNight(mix: number): void {
    this.nightMix = clamp(mix, 0, 1);
    MAT_UNIFORMS.uNightMix.value = this.nightMix;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uNight.value = this.nightMix;
    (this.clouds.material as THREE.ShaderMaterial).uniforms.uNight.value = this.nightMix;

    const angle = 0.22 + this.nightMix * Math.PI * 0.42;
    this.sunDir.set(Math.cos(angle) * 0.75, Math.sin(angle), 0.35).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(760);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uSunDir.value.copy(this.sunDir);
    MAT_UNIFORMS.uSunDir.value.copy(this.sunDir);

    this.sun.color.copy(new THREE.Color(0xffd9b0).lerp(new THREE.Color(0x9fb4e0), this.nightMix * 0.85));
    this.sun.intensity = 2.6 - this.nightMix * 1.6; // harder key light

    this.hemi.color.copy(new THREE.Color(0x9fc4ff).lerp(new THREE.Color(0x2a3a5c), this.nightMix));
    this.hemi.groundColor.copy(new THREE.Color(0x1a2028));

    const fogColor = new THREE.Color(0x2a3852).lerp(new THREE.Color(0x10161f), this.nightMix * 0.6);
    (this.scene.fog as THREE.FogExp2).color.copy(fogColor);
    (this.scene.fog as THREE.FogExp2).density = 0.00042 + this.nightMix * 0.0002;
    MAT_UNIFORMS.uFogColor.value.copy(fogColor);
    MAT_UNIFORMS.uSkyColor.value.copy(new THREE.Color(0x9fc4ff).lerp(new THREE.Color(0x2a3550), this.nightMix).multiplyScalar(0.8));

    // ambient floor: keeps unlit faces of the city readable instead of pure black
    this.hemi.intensity = 0.62 - this.nightMix * 0.16; // low ambient = contrast
    this.buildEnvMap(
      new THREE.Color(0x1a3358).lerp(new THREE.Color(0x060a12), this.nightMix),
      new THREE.Color(0x8fa8c8).lerp(new THREE.Color(0x161f2c), this.nightMix),
      new THREE.Color(0x1a1e24)
    );
  }

  setQuality(level: QualityLevel, renderer: THREE.WebGLRenderer): void {
    this.quality = level;
    const bloomOn = level !== 'low';
    if (this.bloom) this.bloom.enabled = bloomOn;
    if (this.grade) this.grade.enabled = level !== 'low';
    // Medium keeps sun shadows on (hero/drones ground onto streets); only Low drops them.
    const shadowsOn = level !== 'low';
    this.sun.castShadow = shadowsOn;
    renderer.shadowMap.enabled = shadowsOn;
    if (level === 'high') {
      this.sun.shadow.radius = 6;
      this.sun.shadow.blurSamples = 12;
      this.bloom!.strength = 0.5;
      (this.scene.fog as THREE.FogExp2).density = 0.00042;
    } else if (level === 'medium') {
      this.sun.shadow.radius = 3;
      this.bloom!.strength = 0.4;
      (this.scene.fog as THREE.FogExp2).density = 0.00038;
    } else {
      (this.scene.fog as THREE.FogExp2).density = 0.00034;
    }
  }

  update(dt: number, focus: THREE.Vector3): void {
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    (this.clouds.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    if (this.grade) (this.grade.uniforms as { uTime: { value: number } }).uTime.value += dt;
    this.sky.position.set(focus.x, 0, focus.z);
    this.clouds.position.set(focus.x, 380, focus.z);
    // shadow frustum follows the hero so a small map covers the action
    this.sun.position.set(focus.x + this.sunDir.x * 380, focus.y + this.sunDir.y * 380, focus.z + this.sunDir.z * 380);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, usePost: boolean): void {
    if (usePost && this.composer && this.bloom?.enabled !== false) {
      this.renderPass.camera = camera;
      this.composer.render();
    } else {
      renderer.render(this.scene, camera);
    }
  }

  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    if (this.bloom) this.bloom.setSize(width, height);
  }

  get fovBase(): number {
    return CAMERA.fovBase;
  }
}
