import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandSample } from '../input/types';

interface RawHand {
  landmarks: { x: number; y: number; z: number }[];
  side: 'left' | 'right';
  score: number;
}

/**
 * MediaPipe Tasks Vision HandLandmarker lifecycle.
 *
 * The WASM runtime and the 7.8 MB float16 model are VENDORED into /public so the
 * exhibition build runs fully offline. If the local files are missing (for
 * example a stripped static deploy) it falls back to the jsDelivr + Google
 * model CDN, and if that fails the game simply stays on keyboard control.
 */
export class HandTracker {
  private detector: HandLandmarker | null = null;
  private starting = false;
  video: HTMLVideoElement | null = null;
  stream: MediaStream | null = null;
  errorText = '';
  delegate: 'GPU' | 'CPU' = 'GPU';
  private source: 'local' | 'cdn' | 'none' = 'none';

  get ready(): boolean {
    return !!this.detector && !!this.video;
  }

  get assetSource(): 'local' | 'cdn' | 'none' {
    return this.source;
  }

  async start(): Promise<boolean> {
    if (this.starting) return false;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      this.stream = stream;
      const v = document.createElement('video');
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.id = 'gesture-source';
      await v.play();
      this.video = v;

      const base = import.meta.env.BASE_URL ?? '/';
      this.detector = await this.createDetector(
        `${base}mediapipe/wasm`,
        `${base}assets/models/hand_landmarker.task`,
        'local'
      );
      if (!this.detector) {
        this.detector = await this.createDetector(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          'cdn'
        );
      }
      if (!this.detector) throw new Error('hand landmarker unavailable');
      this.starting = false;
      return true;
    } catch (e) {
      this.starting = false;
      this.errorText = (e as Error)?.message ?? String(e);
      this.stop();
      return false;
    }
  }

  private async createDetector(wasmPath: string, modelPath: string, source: 'local' | 'cdn'): Promise<HandLandmarker | null> {
    try {
      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      const make = async (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        const d = await make('GPU');
        this.delegate = 'GPU';
        this.source = source;
        return d;
      } catch {
        const d = await make('CPU');
        this.delegate = 'CPU';
        this.source = source;
        return d;
      }
    } catch (e) {
      this.errorText = (e as Error)?.message ?? String(e);
      return null;
    }
  }

  stop(): void {
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    this.stream = null;
    if (this.video) {
      try { this.video.pause(); } catch { /* ignore */ }
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    try { this.detector?.close(); } catch { /* ignore */ }
    this.detector = null;
  }

  /** Runs one detection pass. Returns [] when nothing is visible. */
  detect(timestampMs: number): RawHand[] {
    if (!this.detector || !this.video || this.video.readyState < 2) return [];
    let result: ReturnType<HandLandmarker['detectForVideo']> | null = null;
    try {
      result = this.detector.detectForVideo(this.video, timestampMs);
    } catch {
      return [];
    }
    const out: RawHand[] = [];
    const lms = result?.landmarks ?? [];
    const handed = result?.handedness ?? [];
    for (let i = 0; i < lms.length; i++) {
      const cat = handed[i]?.[0];
      out.push({
        landmarks: lms[i].map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
        side: cat?.categoryName === 'Left' ? 'left' : 'right',
        score: cat?.score ?? 0.7,
      });
    }
    return out;
  }

  /** Average luminance estimate 0..1 for lighting guidance. */
  brightness(): number {
    if (!this.video) return 0;
    try {
      const c = this.brightCanvas ?? (this.brightCanvas = document.createElement('canvas'));
      c.width = 32;
      c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return 0;
      ctx.drawImage(this.video, 0, 0, 32, 24);
      const data = ctx.getImageData(0, 0, 32, 24).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      }
      return sum / (data.length / 4);
    } catch {
      return 0;
    }
  }

  private brightCanvas: HTMLCanvasElement | null = null;

  asSamples(raw: RawHand[]): HandSample[] {
    return raw.map((r) => ({
      side: r.side,
      landmarks: r.landmarks,
      center: palmCenter(r.landmarks),
      score: r.score,
      fingers: 0,
      indexExtended: false,
      pinch: 1,
      tiltX: 0,
      span: 0,
    }));
  }
}

function palmCenter(lms: HandSample['landmarks']): { x: number; y: number } {
  const idx = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of idx) {
    x += lms[i]?.x ?? 0;
    y += lms[i]?.y ?? 0;
  }
  return { x: x / idx.length, y: y / idx.length };
}
