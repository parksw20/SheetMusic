/**
 * 마이크 스펙트럼으로 "쳐야 할 음이 들렸는가"를 판정한다.
 *
 * 임의의 소리를 악보로 받아 적는(전사) 대신, 앱이 이미 알고 있는 기대 음만 확인한다.
 *  1. 스펙트럼 변화량(spectral flux)으로 새 타건(onset)을 찾는다.
 *  2. 타건 직후, 기대 음의 기본 주파수 에너지가 타건 전보다 충분히 커졌으면 "맞음".
 *     (이미 울리고 있던 음은 커지지 않으므로 같은 음 연타도 구분된다)
 *  3. 기대 음이 하나도 안 들리고 다른 음이 뚜렷하면 그 음을 "틀림"으로 보고한다.
 *
 * 입력은 AnalyserNode.getFloatFrequencyData 형식(dB, 길이 fftSize/2)이다.
 */

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export type Sensitivity = 'low' | 'normal' | 'high';

interface Tuning {
  /** 타건으로 볼 최소 flux (잡음 바닥 위 bin들의 dB 증가량 합) */
  minFlux: number;
  /** 기대 음이 타건 전보다 커져야 하는 양 (dB) */
  riseDb: number;
  /** 틀린 음으로 판정할 때 필요한 증가량 (dB) */
  wrongRiseDb: number;
}

const TUNING: Record<Sensitivity, Tuning> = {
  low: { minFlux: 400, riseDb: 10, wrongRiseDb: 18 },
  normal: { minFlux: 200, riseDb: 7, wrongRiseDb: 15 },
  high: { minFlux: 100, riseDb: 5, wrongRiseDb: 12 },
};

const MIN_HZ = 50;
const MAX_HZ = 5000;
/** flux 계산에서 잡음으로 보고 버리는 기준 (잡음 바닥 위 dB) */
const FLUX_GATE_DB = 10;
/** 음 주변에서 봉우리를 찾을 범위 (±반음의 절반보다 조금 좁게) */
const SEARCH_CENTS = 40;
/** 타건 뒤 기대 음을 찾는 시간 */
const WINDOW_MS = 350;
/** 타건 뒤 틀린 음 판정을 내리기까지 기다리는 시간 (화음이 조금 늦게 들어오는 것 허용) */
const WRONG_DELAY_MS = 120;
/** 타건 전 기준 레벨을 잡는 구간 */
const BASELINE_MS = 150;
/** 방금 맞힌 음은 이 시간 동안 틀린 음 후보에서 뺀다 (소리가 아직 커지는 중일 수 있음) */
const RECENT_HIT_MS = 500;
/** 이미 울리던 음을 다시 쳤을 때 필요한 증가량 (dB) */
const REPEAT_RISE_DB = 3;
/** 틀린 음 후보 범위 */
const CANDIDATES = { from: 36, to: 96 };

export interface Detection {
  midi: number;
  /** true면 기대 음, false면 틀린 음 */
  expected: boolean;
}

interface Onset {
  t: number;
  pre: Float32Array[];
  emitted: Set<number>;
  judged: boolean;
}

export class NoteVerifier {
  private readonly binHz: number;
  private readonly lo: number;
  private readonly hi: number;
  private tuning: Tuning;
  private prev: Float32Array | null = null;
  private history: { t: number; db: Float32Array }[] = [];
  private fluxHistory: number[] = [];
  private lastOnset = -Infinity;
  private onset: Onset | null = null;
  private recentHits = new Map<number, number>();
  /**
   * 연속 타건 사이 최소 간격 = 분석 창 길이.
   * 새 음이 창을 채우는 동안(약 170ms)은 flux가 계속 높아서 타건이 여러 번 잡히기 때문이다.
   */
  private readonly refractoryMs: number;

  constructor(sampleRate: number, fftSize: number, sensitivity: Sensitivity = 'normal') {
    this.binHz = sampleRate / fftSize;
    this.refractoryMs = (fftSize / sampleRate) * 1000;
    this.lo = Math.max(1, Math.floor(MIN_HZ / this.binHz));
    this.hi = Math.min(fftSize / 2 - 1, Math.ceil(MAX_HZ / this.binHz));
    this.tuning = TUNING[sensitivity];
  }

  setSensitivity(s: Sensitivity) {
    this.tuning = TUNING[s];
  }

  /** 주파수 근처(±SEARCH_CENTS) 봉우리의 dB */
  private peak(db: Float32Array, hz: number): number {
    const ratio = 2 ** (SEARCH_CENTS / 1200);
    const a = Math.max(this.lo, Math.floor(hz / ratio / this.binHz));
    const b = Math.min(this.hi, Math.ceil((hz * ratio) / this.binHz));
    let max = -Infinity;
    for (let i = a; i <= b; i++) if (db[i] > max) max = db[i];
    return max;
  }

  /** 음 하나의 레벨(dB): 기본 주파수 근처 봉우리. 낮은 음은 2배음도 함께 본다. */
  level(db: Float32Array, midi: number): number {
    const f0 = midiToFreq(midi);
    const fundamental = this.peak(db, f0);
    // 피아노 저음은 기본음보다 배음이 더 크게 잡히는 경우가 많다
    return midi < 48 ? Math.max(fundamental, this.peak(db, f0 * 2) - 3) : fundamental;
  }

  /**
   * 옆 반음보다 크거나 같은 진짜 봉우리인지.
   * 타건 순간의 넓은 대역 잡음이나 옆 음에서 새어 나온 에너지를 걸러낸다.
   */
  private isPeak(db: Float32Array, midi: number, allowed: number[]): boolean {
    const f0 = midiToFreq(midi);
    const own = this.peak(db, f0);
    return [-1, 1].every(
      (d) => allowed.includes(midi + d) || own >= this.peak(db, f0 * 2 ** (d / 12)),
    );
  }

  process(db: Float32Array, t: number, expected: number[]): Detection[] {
    const { frameMax, floor } = this.stats(db);
    const flux = this.prev ? this.flux(db, this.prev, floor) : 0;
    this.prev = db;

    const recent = this.fluxHistory.slice(-30).sort((a, b) => a - b);
    const median = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
    const isOnset = flux > Math.max(this.tuning.minFlux, median * 3) && t - this.lastOnset > this.refractoryMs;
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > 60) this.fluxHistory.shift();

    if (isOnset) {
      this.lastOnset = t;
      this.onset = {
        t,
        pre: this.history.filter((h) => t - h.t <= BASELINE_MS).map((h) => h.db),
        emitted: new Set(),
        judged: false,
      };
    }
    this.history.push({ t, db });
    while (this.history.length && t - this.history[0].t > BASELINE_MS + 50) this.history.shift();

    const on = this.onset;
    if (!on) return [];
    if (t - on.t > WINDOW_MS) {
      this.onset = null;
      return [];
    }

    // 타건 직전 레벨. 여러 프레임 중 가장 작은 값을 써서 잡음에 덜 흔들리게 한다.
    const baseline = (midi: number) =>
      on.pre.length ? Math.min(...on.pre.map((p) => this.level(p, midi))) : floor;
    const out: Detection[] = [];

    for (const midi of expected) {
      if (on.emitted.has(midi)) continue;
      const lv = this.level(db, midi);
      const base = baseline(midi);
      // 이미 울리던 음을 다시 친 경우(연타)는 증가 폭이 작으므로 기준을 낮춘다
      const needRise = base >= floor + 20 ? REPEAT_RISE_DB : this.tuning.riseDb;
      if (
        lv - base >= needRise &&
        lv >= frameMax - 30 &&
        lv >= floor + 20 &&
        this.isPeak(db, midi, expected)
      ) {
        on.emitted.add(midi);
        this.recentHits.set(midi, t);
        out.push({ midi, expected: true });
      }
    }

    if (!on.judged && on.emitted.size === 0 && t - on.t >= WRONG_DELAY_MS) {
      on.judged = true;
      for (const [m, at] of this.recentHits) if (t - at >= RECENT_HIT_MS) this.recentHits.delete(m);
      const recent = [...this.recentHits.keys()];
      const wrong = this.strongestNew(db, baseline, frameMax, floor, recent);
      if (wrong !== null && !expected.includes(wrong)) {
        on.emitted.add(wrong);
        out.push({ midi: wrong, expected: false });
      }
    }
    return out;
  }

  /** 타건 뒤 가장 뚜렷하게 새로 커진 음 (배음 가중합으로 옥타브 혼동을 줄인다) */
  private strongestNew(
    db: Float32Array,
    baseline: (midi: number) => number,
    frameMax: number,
    floor: number,
    exclude: number[],
  ): number | null {
    let best: number | null = null;
    let bestScore = 0;
    for (let m = CANDIDATES.from; m <= CANDIDATES.to; m++) {
      if (exclude.includes(m)) continue;
      const lv = this.level(db, m);
      const rise = lv - baseline(m);
      if (rise < this.tuning.wrongRiseDb || lv < frameMax - 12 || lv < floor + 25) continue;
      if (!this.isPeak(db, m, [])) continue;
      // 기본음 + 3배음 지지: 한 옥타브 아래 음은 3배음(=원래 음의 1.5배)이 없어서 점수가 낮다
      const third = this.level(db, m + 19) - baseline(m + 19);
      const score = rise + 0.5 * Math.max(0, third) + (lv - frameMax) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /**
   * 잡음 바닥보다 FLUX_GATE_DB 이상 큰 부분만 보고 증가량을 더한다.
   * 평균이 아니라 합을 쓰므로 여린 음 하나(봉우리 수십 개)도 잡히고, 잡음 흔들림은 무시된다.
   */
  private flux(db: Float32Array, prev: Float32Array, floor: number): number {
    const gate = floor + FLUX_GATE_DB;
    let sum = 0;
    for (let i = this.lo; i <= this.hi; i++) {
      const d = Math.max(db[i], gate) - Math.max(prev[i], gate);
      if (d > 0 && Number.isFinite(d)) sum += d;
    }
    return sum;
  }

  private stats(db: Float32Array): { frameMax: number; floor: number } {
    const values: number[] = [];
    let frameMax = -Infinity;
    for (let i = this.lo; i <= this.hi; i++) {
      const v = Number.isFinite(db[i]) ? db[i] : -200;
      values.push(v);
      if (v > frameMax) frameMax = v;
    }
    values.sort((a, b) => a - b);
    return { frameMax, floor: values[Math.floor(values.length / 2)] };
  }
}
