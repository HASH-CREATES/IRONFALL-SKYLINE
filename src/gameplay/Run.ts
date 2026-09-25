import { clamp } from '../util/Rng';

export interface RunSummary {
  mission: string;
  completed: boolean;
  score: number;
  kills: number;
  distanceKm: number;
  topSpeed: number;
  peakAltitude: number;
  timeSeconds: number;
  crashes: number;
  damageTaken: number;
  best: number;
}

/** Aggregate run statistics, score and difficulty pacing. */
export class Run {
  score = 0;
  kills = 0;
  distanceFlown = 0;
  topSpeed = 0;
  peakAltitude = 0;
  crashes = 0;
  damageTaken = 0;
  boostsUsed = 0;
  missionTime = 0;
  missionId = '';
  missionName = '';
  missionIndex = 0;
  completed = false;
  private boostWasOn = false;

  start(missionId: string, missionName: string, missionIndex: number): void {
    this.score = 0;
    this.kills = 0;
    this.distanceFlown = 0;
    this.topSpeed = 0;
    this.peakAltitude = 0;
    this.crashes = 0;
    this.damageTaken = 0;
    this.boostsUsed = 0;
    this.missionTime = 0;
    this.missionId = missionId;
    this.missionName = missionName;
    this.missionIndex = missionIndex;
    this.completed = false;
    this.boostWasOn = false;
  }

  update(dt: number, distance: number, speed: number, altitude: number, boostLevel: number): void {
    this.missionTime += dt;
    this.distanceFlown += distance;
    if (speed > this.topSpeed) this.topSpeed = speed;
    if (altitude > this.peakAltitude) this.peakAltitude = altitude;
    if (boostLevel > 0.5 && !this.boostWasOn) {
      this.boostsUsed++;
      this.boostWasOn = true;
    } else if (boostLevel < 0.3) {
      this.boostWasOn = false;
    }
  }

  registerKill(score: number): void {
    this.kills++;
    this.score += score;
  }

  registerCrash(): void {
    this.crashes++;
    this.score = Math.max(0, this.score - 25);
  }

  registerDamage(amount: number): void {
    this.damageTaken += amount;
  }

  addScore(n: number): void {
    this.score += n;
  }

  difficulty(): number {
    return 1 + this.missionIndex * 0.14;
  }

  /** Time + speed + accuracy bonuses on mission completion. */
  finish(bonus: number): void {
    this.completed = true;
    this.score += bonus;
  }

  summary(): RunSummary {
    return {
      mission: this.missionName,
      completed: this.completed,
      score: Math.round(this.score),
      kills: this.kills,
      distanceKm: this.distanceFlown / 1000,
      topSpeed: this.topSpeed,
      peakAltitude: this.peakAltitude,
      timeSeconds: this.missionTime,
      crashes: this.crashes,
      damageTaken: Math.round(this.damageTaken),
      best: this.saveBest(Math.round(this.score)),
    };
  }

  private saveBest(score: number): number {
    try {
      const key = `IRONFALL.best.${this.missionId}`;
      const prev = Number(localStorage.getItem(key) ?? 0);
      const best = clamp(Math.max(prev, score), 0, 9e6);
      localStorage.setItem(key, String(best));
      return Math.round(best);
    } catch {
      return score;
    }
  }

  static bestFor(missionId: string): number {
    try {
      return Number(localStorage.getItem(`IRONFALL.best.${missionId}`) ?? 0);
    } catch {
      return 0;
    }
  }
}
