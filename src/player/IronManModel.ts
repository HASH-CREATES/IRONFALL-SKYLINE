import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* ------------------------------------------------------------------ *
 * IRON MAN — user-supplied 3D model (Iron+Man.zip: OBJ/MTL/FBX/BLEND,
 * converted to GLB for the browser). 504k tris, static pose, materials:
 * red / yellow / arc / white / glss.
 *
 * Used where a static figure shines: the landing hero-stage, the Armory
 * display, and grounded in-game presence. The flying rig remains the
 * articulated procedural MK-1 (the GLB has no skeleton).
 * ------------------------------------------------------------------ */

export interface IronManInstance {
  root: THREE.Group;
  /** Emissive meshes (arc reactor, eyes) — pulsing/boost effects. */
  emissives: THREE.MeshStandardMaterial[];
}

class IronManBank {
  private proto: THREE.Group | null = null;
  private emissives: THREE.MeshStandardMaterial[] = [];
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new GLTFLoader()
      .loadAsync('assets/models/hero/ironman.glb')
      .then((gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
          if (!mat) return;
          // OBJ import: convert legacy colors to a PBR hero look
          mat.metalness = 0.85;
          mat.roughness = Math.min(0.45, mat.roughness || 0.35);
          mat.envMapIntensity = 1.35;
          if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.2) {
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.2);
            this.emissives.push(mat);
          }
        });
        this.proto = scene;
      })
      .catch(() => {
        /* offline/blocked: instances resolve null, callers degrade gracefully */
      });
  }

  /** Returns an independent clone placed at origin, feet on y=0, or null. */
  instantiate(): IronManInstance | null {
    if (!this.proto) return null;
    const root = this.proto.clone(true) as THREE.Group;
    return { root, emissives: this.emissives };
  }
}

export const ironManBank = new IronManBank();
