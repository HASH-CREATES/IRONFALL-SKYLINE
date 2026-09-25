import * as THREE from 'three';

// Shared shader uniforms — one update point for time / sun / city look.
export const MAT_UNIFORMS = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.42, 0.72, 0.32).normalize() },
  uSunColor: { value: new THREE.Color(0xffd9b0) },
  uSkyColor: { value: new THREE.Color(0x18243c) },
  uGroundColor: { value: new THREE.Color(0x0b1018) },
  uNightMix: { value: 0.55 },
  uBlockSize: { value: 46.0 },
  uRoadWidth: { value: 13.0 },
  uFogNear: { value: 240.0 },
  uFogFar: { value: 1450.0 },
  uFogColor: { value: new THREE.Color(0x16202f) },
};

let uid = 0;

/* ------------------------------------------------------------------ *
 * BUILDINGS — instanced boxes with a fully procedural facade:         *
 * window cells, lit-window variance, per-instance tint, roof detail.  *
 * ------------------------------------------------------------------ */
const BUILDING_VERT = /* glsl */`
attribute vec3 aTint;
attribute vec2 aParam;
varying vec3 vTint;
varying vec3 vLocalM;
varying vec3 vScale;
varying float vRand;
varying float vStyle;
varying vec3 vLocalN;
`;

// NOTE: every injection below is a *function*; the call is spliced inside main()
// so it can legally touch diffuseColor / totalEmissiveRadiance.
const BUILDING_FRAG_HEAD = /* glsl */`
varying vec3 vTint;
varying vec3 vLocalM;
varying vec3 vScale;
varying float vRand;
varying float vStyle;
varying vec3 vLocalN;
`;

const BUILDING_FN = /* glsl */`
uniform float uNightMix;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSkyColor;

float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

vec3 icBuilding(out vec3 icEmissive){
  icEmissive = vec3(0.0);
  vec3 nRaw = normalize(vLocalN);
  vec3 n = abs(nRaw);
  bool roof = n.y > 0.7;
  vec3 col = vTint;
  float H = max(vScale.y, 1.0);
  float yWorld = vLocalM.y + H * 0.5;   // 0 at street level
  float hf = clamp(yWorld / H, 0.0, 1.0);
  // facade style: 0 = masonry/punched windows, 1 = glass curtain wall
  float glass = smoothstep(0.45, 0.75, vStyle);

  if (roof) {
    // rooftop patching: gravel + vents + service boxes
    float r = h21(floor(vLocalM.xz * 0.9));
    col *= 0.72 + r * 0.34;
    float vent = step(0.94, h21(floor(vLocalM.xz * 0.35) + vRand));
    col = mix(col, col * 0.55, vent);
  } else {
    vec2 uv;
    if (n.x > 0.5) uv = vec2(vLocalM.z, vLocalM.y);
    else if (n.z > 0.5) uv = vec2(vLocalM.x, vLocalM.y);
    else uv = vec2(vLocalM.x, vLocalM.z);

    // curtain wall = wider, tighter window grid; masonry = punched cells
    vec2 cellSize = mix(vec2(3.5, 3.9), vec2(2.6, 3.4), glass);
    vec2 cell = floor(vec2(uv.x / cellSize.x, uv.y / cellSize.y));
    vec2 f = fract(vec2(uv.x / cellSize.x, uv.y / cellSize.y));
    vec2 open = mix(vec2(0.12, 0.18), vec2(0.06, 0.10), glass);
    vec2 shut = mix(vec2(0.88, 0.85), vec2(0.94, 0.92), glass);
    float win = step(open.x, f.x) * step(f.x, shut.x) * step(open.y, f.y) * step(f.y, shut.y);

    float lit = h21(cell + vRand * 37.0);
    float flicker = 0.85 + 0.15 * sin(uTime * (0.4 + lit * 2.2) + lit * 30.0);
    float litAmt = step(mix(0.62, 0.47, glass) - uNightMix * 0.18, lit) * uNightMix;

    vec3 glassDay = mix(vec3(0.032, 0.045, 0.065), vec3(0.045, 0.065, 0.10), glass);
    // cheap but effective sky reflection: brighter where the panel faces the sun
    float facing = abs(dot(nRaw, normalize(uSunDir)));
    glassDay += uSkyColor * (0.08 + 0.26 * facing) * glass * (1.0 - uNightMix * 0.7);
    // horizontal floor slabs: thin darker seam every other row (facade rhythm)
    float slab = step(0.86, fract(uv.y / (cellSize.y * 2.0)));
    col *= 1.0 - slab * 0.16;
    vec3 glassNight = mix(vec3(0.9, 0.72, 0.42), vec3(0.55, 0.72, 0.95), step(0.5, h21(cell * 1.7 + 3.0))) * flicker;

    // weathering gradient: grime near street, washed clean toward the crown
    float grime = mix(0.78, 1.10, hf);
    vec3 facade = mix(col, col * 1.06, h21(cell * 1.3)) * grime;
    col = mix(facade, glassDay, win * (0.82 + 0.07 * glass));
    icEmissive += win * litAmt * glassNight;
    col += win * uNightMix * 0.015;

    // street-level storefront band: dark glazing + awning + night shop glow
    float shop = 1.0 - step(5.4, yWorld);
    col = mix(col, vec3(0.05, 0.058, 0.072), shop * 0.78);
    float awn = step(3.2, yWorld) * step(yWorld, 4.5);
    vec3 awnCol = mix(vec3(0.42, 0.11, 0.09), vec3(0.09, 0.24, 0.34), h21(vec2(floor(uv.x / 6.0), 11.0)));
    col = mix(col, awnCol, awn * 0.85 * (1.0 - glass * 0.55));
    icEmissive += vec3(1.0, 0.72, 0.45) * uNightMix * 0.5 * shop
      * step(0.55, h21(vec2(floor(uv.x / 6.0), 7.0))) * step(0.4, vStyle);

    // crown lighting on tall towers (aviation-style warm band near the top)
    float crown = step(H * 0.5 - 5.5, yWorld) * step(70.0, H);
    icEmissive += vec3(1.0, 0.58, 0.28) * crown * uNightMix
      * (0.5 + 0.28 * sin(uTime * 0.5 + vRand * 6.28));
  }

  return col;
}
`;

export function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.16,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = MAT_UNIFORMS.uTime;
    shader.uniforms.uNightMix = MAT_UNIFORMS.uNightMix;
    shader.uniforms.uSunDir = MAT_UNIFORMS.uSunDir;
    shader.uniforms.uSkyColor = MAT_UNIFORMS.uSkyColor;
    shader.vertexShader = BUILDING_VERT + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vTint = aTint;
      vRand = aParam.x;
      vStyle = aParam.y;
      vLocalN = normal;
      vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vLocalM = position * vScale;`
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', BUILDING_FRAG_HEAD + BUILDING_FN + '\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 icEmissive = vec3(0.0);
        diffuseColor.rgb = icBuilding(icEmissive);
        totalEmissiveRadiance += icEmissive;`
      );
  };
  mat.customProgramCacheKey = () => `IRONFALL-buildings-${uid++}`;
  return mat;
}

/* ------------------------------------------------------------------ *
 * GROUND — one plane, world-space street grid, asphalt + markings.    *
 * ------------------------------------------------------------------ */
const GROUND_FN = /* glsl */`
varying vec3 vWorldPos;
uniform float uBlockSize;
uniform float uRoadWidth;
uniform float uNightMix;
uniform float uTime;

float h21(vec2 p){ return fract(sin(dot(p, vec2(23.7, 91.3))) * 4137.5); }

vec3 icGround(vec2 worldXZ){
  vec2 p = worldXZ;
  vec2 g = abs(fract(p / uBlockSize + 0.5) - 0.5) * uBlockSize;
  float roadMask = 1.0 - step(uRoadWidth * 0.5, min(g.x, g.y));

  vec2 gp = abs(fract(p / (uBlockSize * 2.0) + 0.5) - 0.5) * uBlockSize * 2.0;
  float arterial = 1.0 - step(uRoadWidth * 0.95, min(gp.x, gp.y));

  vec3 asphalt = vec3(0.048, 0.052, 0.062) * (0.85 + h21(floor(p * 0.6)) * 0.4);
  vec3 sidewalk = vec3(0.135, 0.142, 0.152) * (0.9 + h21(floor(p * 0.25)) * 0.25);
  vec3 plaza = vec3(0.10, 0.11, 0.125);

  vec3 col = sidewalk;
  // block interiors become plazas/lots with a checker of texture
  col = mix(col, plaza, step(0.5, h21(floor(p / (uBlockSize * 0.5))) * 0.4 + 0.3));

  col = mix(col, asphalt, roadMask * 0.94);
  col = mix(col, asphalt * 0.94, arterial * (1.0 - roadMask));

  // lane markings on roads
  vec2 lane = fract(p / vec2(uBlockSize * 0.5, 6.5));
  float dash = step(0.55, lane.x) * step(0.44, lane.y) * step(lane.y, 0.56);
  float centerLine = roadMask * dash * (1.0 - arterial);
  col += centerLine * vec3(0.55, 0.5, 0.32);

  // crosswalk bands at intersections
  float ix = 1.0 - step(uRoadWidth * 0.62, min(g.x, g.y));
  float iy = step(uRoadWidth * 0.42, min(g.x, g.y));
  float stripes = step(0.5, fract((g.x + g.y) / 3.0));
  col += ix * iy * stripes * 0.16;

  return col;
}
`;

export function groundMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.04 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBlockSize = MAT_UNIFORMS.uBlockSize;
    shader.uniforms.uRoadWidth = MAT_UNIFORMS.uRoadWidth;
    shader.uniforms.uNightMix = MAT_UNIFORMS.uNightMix;
    shader.uniforms.uTime = MAT_UNIFORMS.uTime;
    shader.vertexShader =
      'varying vec3 vWorldPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', GROUND_FN + '\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= icGround(vWorldPos.xz) * 2.2;`
      );
  };
  mat.customProgramCacheKey = () => `IRONFALL-ground-${uid++}`;
  return mat;
}

/* ------------------------------------------------------------------ *
 * WATER — animated ripples + sky reflection approximation.            *
 * ------------------------------------------------------------------ */
const WATER_FN = /* glsl */`
varying vec3 vWorldPos;
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uSunDir;
uniform float uNightMix;

vec3 icWater(vec2 worldXZ){
  vec2 p = worldXZ;
  float w =
    sin(p.x * 0.22 + uTime * 0.9) * 0.5 +
    sin(p.y * 0.31 - uTime * 0.7) * 0.5 +
    sin((p.x + p.y) * 0.11 + uTime * 1.3) * 0.35;
  w *= 0.5;
  float fres = clamp(0.35 + w * 0.55, 0.0, 1.0);
  vec3 deep = vec3(0.016, 0.035, 0.055);
  vec3 col = mix(deep, uSkyColor * 0.85, fres);
  vec3 h = normalize(vec3(
    0.06 * cos(p.x * 0.22 + uTime * 0.9) + 0.04 * cos((p.x + p.y) * 0.11 + uTime * 1.3),
    1.0,
    0.06 * cos(p.y * 0.31 - uTime * 0.7) + 0.04 * cos((p.x + p.y) * 0.11 + uTime * 1.3)
  ));
  float spec = pow(max(dot(h, normalize(uSunDir)), 0.0), 42.0);
  col += spec * vec3(1.0, 0.85, 0.6) * (0.55 + uNightMix * 0.2);
  return col;
}
`;

export function waterMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.94,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = MAT_UNIFORMS.uTime;
    shader.uniforms.uSkyColor = MAT_UNIFORMS.uSkyColor;
    shader.uniforms.uSunDir = MAT_UNIFORMS.uSunDir;
    shader.uniforms.uNightMix = MAT_UNIFORMS.uNightMix;
    shader.vertexShader =
      'varying vec3 vWorldPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', WATER_FN + '\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= icWater(vWorldPos.xz) * 1.6;`
      );
  };
  mat.customProgramCacheKey = () => `IRONFALL-water-${uid++}`;
  return mat;
}

/* ------------------------------------------------------------------ *
 * EMISSIVE PROP MATERIAL — pulses for signs, beacons, traffic lights. *
 * ------------------------------------------------------------------ */
export function emissiveMaterial(
  color: number | THREE.Color,
  intensity = 1.6,
  blink = 0
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.2,
  });
  if (blink > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = MAT_UNIFORMS.uTime;
      shader.uniforms.uBlink = { value: blink };
      shader.vertexShader =
        'varying float vBlinkSeed;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vBlinkSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.211);
          #else
            vBlinkSeed = 0.0;
          #endif`
        );
      shader.fragmentShader =
        'varying float vBlinkSeed;\nuniform float uTime;\nuniform float uBlink;\n' +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float bl = 0.25 + 0.75 * step(0.5, fract(uTime * uBlink + vBlinkSeed));
          totalEmissiveRadiance *= bl;`
        );
    };
    mat.customProgramCacheKey = () => `IRONFALL-emissive-blink-${uid++}`;
  }
  return mat;
}

/** 2x4 atlas of original fictional in-world billboards (procedurally drawn). */
export function billboardAtlas(): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cells = [
    { bg: '#101c3a', fg: '#66f2ff', label: 'IRONFALL', sub: 'INDUSTRIES' },
    { bg: '#3a0a12', fg: '#ffd54a', label: 'SKYLINE', sub: 'NOVA COLA' },
    { bg: '#26062e', fg: '#ff6bd5', label: 'NULL', sub: 'SYNDICATE' },
    { bg: '#062b1c', fg: '#7dffb0', label: 'EXPRESS', sub: 'METRO 04' },
    { bg: '#2a1604', fg: '#ffab4a', label: 'DAILY BUGLE', sub: 'ROOFTOP EDITION' },
    { bg: '#041a30', fg: '#ff5c7a', label: 'STARK EXPO', sub: 'NOW OPEN' },
    { bg: '#1c0434', fg: '#b48cff', label: 'AURORA', sub: 'NIGHT LINE' },
    { bg: '#300404', fg: '#ff8a3c', label: 'SUNSET GRILL', sub: '24 HOURS' },
  ];
  // 4x4 atlas now: eight double-height billboard designs
  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const w = size / 2;
    const h = size / 4;
    const x = col * w;
    const y = row * h;
    ctx.fillStyle = cell.bg;
    ctx.fillRect(x, y, w, h);
    // neon glow: the label colour bleeds onto the board
    ctx.strokeStyle = cell.fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
    ctx.shadowColor = cell.fg;
    ctx.shadowBlur = 18;
    ctx.fillStyle = cell.fg;
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(cell.label, x + w / 2, y + h / 2 + 2);
    ctx.shadowBlur = 8;
    ctx.font = '17px monospace';
    ctx.globalAlpha = 0.85;
    ctx.fillText(cell.sub, x + w / 2, y + h / 2 + 30);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Dot-hash helper for CPU-side variety. */
export function noise2(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
