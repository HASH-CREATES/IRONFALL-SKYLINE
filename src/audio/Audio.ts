import { AUDIO } from '../config';
import { clamp } from '../util/Rng';

interface EngineParams {
  thrust: number;
  speedNorm: number;
  boostLevel: number;
  vertical: number;
  airborne: boolean;
}

/**
 * Entirely procedural audio — no copyrighted music or film sound effects.
 * Oscillators + shaped noise give the suit boot, engines, weapons and UI.
 */
export class Audio {
  ctx: AudioContext | null = null;
  muted = false;
  volumes = { master: AUDIO.master, engine: AUDIO.engine, ui: AUDIO.ui, music: AUDIO.music };
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  private windGain: GainNode | null = null;

  private musicTimer = 0;
  private musicStep = 0;
  private musicOn = false;
  private started = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volumes.master;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.volumes.ui;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.muted ? 0 : this.volumes.music;
      this.musicBus.connect(this.master);

      this.engineBus = this.ctx.createGain();
      this.engineBus.gain.value = 0;
      this.engineBus.connect(this.master);

      this.noiseBuffer = this.makeNoise();
      this.buildEngine();
      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  private makeNoise(): AudioBuffer {
    const len = Math.floor(this.ctx!.sampleRate * 2);
    const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'bandpass';
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 0.7;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.engineBus!);

    // noise core of the repulsors
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    noise.loop = true;
    noise.connect(this.engineFilter);
    noise.start();

    // low rumble pair
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 62;
    const oGain = ctx.createGain();
    oGain.gain.value = 0.22;
    this.engineOsc.connect(oGain);
    oGain.connect(this.engineGain);
    this.engineOsc.start();

    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'sine';
    this.engineSub.frequency.value = 38;
    const sGain = ctx.createGain();
    sGain.gain.value = 0.3;
    this.engineSub.connect(sGain);
    sGain.connect(this.engineGain);
    this.engineSub.start();

    // boost layer
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    const boostNoise = ctx.createBufferSource();
    boostNoise.buffer = this.noiseBuffer!;
    boostNoise.loop = true;
    const boostFilter = ctx.createBiquadFilter();
    boostFilter.type = 'highpass';
    boostFilter.frequency.value = 900;
    boostNoise.connect(boostFilter);
    boostFilter.connect(this.boostGain);
    this.boostGain.connect(this.engineBus!);
    boostNoise.start();

    // aero wind
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = this.noiseBuffer!;
    windNoise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 1400;
    windNoise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.engineBus!);
    windNoise.start();
  }

  /* ------------------------------------------------------------------ */
  /* engine mixing                                                        */
  /* ------------------------------------------------------------------ */

  update(dt: number, p: EngineParams): void {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    const target = p.airborne ? clamp(0.09 + p.thrust * 0.3 + p.speedNorm * 0.34 + p.boostLevel * 0.3, 0, 0.85) : 0.05;
    this.engineBus!.gain.setTargetAtTime(this.muted ? 0 : target * this.volumes.engine, now, 0.18);

    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(240 + p.speedNorm * 1500 + p.thrust * 320, now, 0.25);
    }
    if (this.engineOsc) this.engineOsc.frequency.setTargetAtTime(48 + p.speedNorm * 58 + p.thrust * 18, now, 0.3);
    if (this.engineSub) this.engineSub.frequency.setTargetAtTime(30 + p.speedNorm * 26, now, 0.3);
    if (this.boostGain) this.boostGain.gain.setTargetAtTime(p.boostLevel * 0.35, now, 0.12);
    if (this.windGain) this.windGain.gain.setTargetAtTime(p.speedNorm * 0.3 + Math.abs(p.vertical) * 0.05, now, 0.2);

    if (this.musicOn) this.stepMusic(dt);
  }

  /* ------------------------------------------------------------------ */
  /* one-shots                                                            */
  /* ------------------------------------------------------------------ */

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.4, slide = 0, bus: GainNode | null = null): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(bus ?? this.sfxBus!);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, type: BiquadFilterType, freq: number, vol: number, sweepTo?: number): void {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus!);
    src.start();
    src.stop(ctx.currentTime + dur + 0.03);
  }

  boot(): void {
    this.ensure();
    this.tone(90, 0.9, 'sine', 0.35, 60);
    this.tone(180, 0.6, 'triangle', 0.16, 120);
    setTimeout(() => this.tone(660, 0.16, 'square', 0.1, -60), 320);
    setTimeout(() => this.tone(880, 0.22, 'square', 0.1, 120), 520);
    setTimeout(() => this.noiseBurst(0.5, 'highpass', 900, 0.1, 2400), 620);
  }

  click(): void {
    this.ensure();
    this.tone(1250, 0.05, 'square', 0.09, -320);
    this.noiseBurst(0.03, 'highpass', 3200, 0.05);
  }

  hover(): void {
    this.tone(420, 0.08, 'sine', 0.05, 80);
  }

  activate(): void {
    this.ensure();
    this.noiseBurst(0.7, 'bandpass', 380, 0.22, 1800);
    this.tone(120, 0.55, 'sawtooth', 0.16, 180);
    setTimeout(() => this.tone(1040, 0.3, 'triangle', 0.12, 320), 260);
  }

  takeoff(): void {
    this.noiseBurst(0.85, 'lowpass', 260, 0.34, 1600);
    this.tone(150, 0.8, 'sawtooth', 0.18, 420);
    this.tone(70, 1.0, 'sine', 0.22, 20);
  }

  land(): void {
    this.noiseBurst(0.28, 'lowpass', 420, 0.3, 90);
    this.tone(85, 0.3, 'sine', 0.26, -30);
    setTimeout(() => this.tone(320, 0.22, 'triangle', 0.12, -120), 90);
  }

  brake(): void {
    this.noiseBurst(0.5, 'bandpass', 1600, 0.2, 320);
  }

  boostShort(): void {
    this.noiseBurst(0.5, 'highpass', 700, 0.24, 3200);
    this.tone(520, 0.4, 'sawtooth', 0.12, 420);
  }

  repulsor(hand: number): void {
    this.tone(hand === 1 ? 1450 : 1230, 0.12, 'square', 0.14, -680);
    this.noiseBurst(0.09, 'bandpass', 2200, 0.1, 900);
  }

  hitEnemy(downed: boolean): void {
    this.tone(downed ? 420 : 780, 0.16, 'triangle', 0.16, downed ? -220 : 160);
    this.noiseBurst(0.12, 'bandpass', 1400, 0.12, 500);
  }

  enemyDown(): void {
    this.noiseBurst(0.7, 'lowpass', 900, 0.3, 120);
    this.tone(260, 0.6, 'sawtooth', 0.16, -180);
    setTimeout(() => this.tone(180, 0.5, 'sine', 0.14, -90), 120);
  }

  lock(): void {
    this.tone(900, 0.05, 'square', 0.08, 200);
  }

  lockOn(): void {
    this.tone(1500, 0.06, 'square', 0.12, 260);
    setTimeout(() => this.tone(1900, 0.09, 'square', 0.12, -200), 70);
  }

  unibeam(): void {
    this.noiseBurst(1.1, 'bandpass', 600, 0.3, 2600);
    this.tone(180, 1.0, 'sawtooth', 0.2, 220);
    this.tone(90, 1.2, 'sine', 0.24, 40);
  }

  emp(): void {
    this.noiseBurst(1.2, 'lowpass', 2400, 0.34, 90);
    this.tone(1600, 0.7, 'sine', 0.2, -1450);
  }

  empDry(): void {
    this.tone(240, 0.2, 'square', 0.1, -120);
  }

  warning(): void {
    this.tone(620, 0.16, 'square', 0.16, 0);
    setTimeout(() => this.tone(500, 0.22, 'square', 0.16, 0), 170);
  }

  lowEnergy(): void {
    this.tone(320, 0.1, 'triangle', 0.14, -60);
  }

  crash(): void {
    this.noiseBurst(0.5, 'lowpass', 700, 0.4, 80);
    this.tone(60, 0.5, 'sine', 0.3, -20);
  }

  missionComplete(): void {
    this.ensure();
    [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.2), i * 130));
    setTimeout(() => this.noiseBurst(0.8, 'highpass', 1200, 0.12, 3600), 500);
  }

  missionFail(): void {
    [420, 360, 300, 240].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'sawtooth', 0.16, -40), i * 170));
  }

  waypointReached(): void {
    this.tone(1180, 0.14, 'triangle', 0.16, 240);
    setTimeout(() => this.tone(1560, 0.18, 'triangle', 0.14, 160), 110);
  }

  splash(): void {
    this.noiseBurst(0.6, 'lowpass', 1800, 0.26, 200);
  }

  /* ------------------------------------------------------------------ */
  /* procedural music                                                     */
  /* ------------------------------------------------------------------ */

  startMusic(): void {
    this.ensure();
    this.musicOn = true;
    this.musicStep = 0;
    this.musicTimer = 0;
  }

  stopMusic(): void {
    this.musicOn = false;
  }

  private stepMusic(dt: number): void {
    if (!this.ctx || !this.musicBus) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 6.4;

    // slow minor-ish pad progression, entirely synthesised
    const roots = [110, 98, 87.3, 98];
    const root = roots[this.musicStep % roots.length];
    this.musicStep++;
    const now = this.ctx.currentTime;

    const play = (freq: number, detune: number, level: number, dur: number) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      const f = this.ctx!.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(level, now + 1.6);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      o.connect(f);
      f.connect(g);
      g.connect(this.musicBus!);
      o.start(now);
      o.stop(now + dur + 0.1);
    };

    play(root, -6, 0.05, 6.2);
    play(root * 1.5, 7, 0.035, 6.0);
    play(root * 2.0, -11, 0.022, 5.6);

    // sub pulse on the downbeat
    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = root * 0.5;
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.linearRampToValueAtTime(0.09, now + 0.06);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    sub.connect(sg);
    sg.connect(this.musicBus);
    sub.start(now);
    sub.stop(now + 1.0);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volumes.master, this.ctx.currentTime, 0.05);
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(muted ? 0 : this.volumes.music, this.ctx.currentTime, 0.05);
  }

  setVolumes(v: Partial<typeof this.volumes>): void {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, this.ctx.currentTime, 0.05);
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(this.volumes.ui, this.ctx.currentTime, 0.05);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.muted ? 0 : this.volumes.music, this.ctx.currentTime, 0.05);
  }

  get running(): boolean {
    return this.started;
  }
}
