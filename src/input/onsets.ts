/**
 * Basic Pitch 모델 출력에서 타건(건반을 누른 순간)을 뽑고, 쳐야 할 음과 비교해 판정한다.
 * 모델과 브라우저에 의존하지 않는 순수 로직이다.
 */

export const BASIC_PITCH = {
  sampleRate: 22050,
  /** 모델 입력 길이 (약 2초) */
  windowSamples: 43844,
  /** 출력 한 프레임이 차지하는 샘플 수 (초당 약 86프레임) */
  hop: 256,
  keys: 88,
  /** 0번 건반 = A0 = MIDI 21 */
  midiOffset: 21,
};

export interface NoteOnset {
  midi: number;
  /** 오디오 시간 (ms) */
  time: number;
  /** 모델이 준 타건 확률 0~1 */
  prob: number;
}

/** 같은 건반의 타건을 두 번 세지 않는 최소 간격 */
const MIN_GAP_MS = 120;

/**
 * 창을 겹쳐 가며 들어오는 모델 출력에서 새 타건만 뽑는다.
 * 창 끝부분 몇 프레임은 뒤쪽 맥락이 없어 부정확하므로 다음 창에서 확정한다.
 */
export class OnsetExtractor {
  private confirmedUntil: number;
  private lastEvent = new Map<number, number>();

  constructor(
    /** 이 확률보다 낮은 타건은 버린다 */
    private threshold: number,
    /** 창 끝에서 확정을 미루는 프레임 수. 모델은 뒤쪽 소리도 보고 판단하므로 끝부분은 확률이 낮게 나온다 */
    private edgeFrames = 18,
    /** 이 시간(ms) 이전 타건은 무시한다. 녹음 시작 직후 창 앞쪽이 0으로 채워져 생기는 가짜 타건을 막는다 */
    ignoreBeforeMs = -Infinity,
  ) {
    this.confirmedUntil = ignoreBeforeMs;
  }

  setThreshold(threshold: number) {
    this.threshold = threshold;
  }

  /** onsets: [프레임][88건반] 을 평평하게 편 배열, windowEndMs: 창 끝의 오디오 시간 */
  extract(onsets: Float32Array, nFrames: number, windowEndMs: number): NoteOnset[] {
    const { sampleRate, windowSamples, hop, keys, midiOffset } = BASIC_PITCH;
    const frameMs = (hop / sampleRate) * 1000;
    const windowStartMs = windowEndMs - (windowSamples / sampleRate) * 1000;
    const lastUsable = nFrames - 1 - this.edgeFrames;
    const found: NoteOnset[] = [];

    for (let f = 1; f <= lastUsable; f++) {
      const time = windowStartMs + f * frameMs;
      if (time <= this.confirmedUntil) continue;
      for (let k = 0; k < keys; k++) {
        const p = onsets[f * keys + k];
        if (p < this.threshold) continue;
        // 시간축 봉우리만 (앞뒤 프레임보다 크거나 같음)
        if (p < onsets[(f - 1) * keys + k] || p < onsets[(f + 1) * keys + k]) continue;
        const midi = k + midiOffset;
        const last = this.lastEvent.get(midi);
        if (last !== undefined && time - last < MIN_GAP_MS) continue;
        this.lastEvent.set(midi, time);
        found.push({ midi, time, prob: p });
      }
    }
    this.confirmedUntil = Math.max(this.confirmedUntil, windowStartMs + lastUsable * frameMs);
    return found.sort((a, b) => a.time - b.time);
  }
}

export type Verdict = 'hit' | 'wrong';

/** 맞힌 음과 이 시간 안에 들린 다른 음은 같은 화음이거나 그 배음으로 보고 틀림으로 세지 않는다 */
const CHORD_WINDOW_MS = 150;
/** 한 단계를 끝낸 타건과 이 시간 안에 들린 음으로는 다음 단계를 맞힐 수 없다 (같은 타건의 배음 등) */
const SAME_STRIKE_MS = 100;
/** 방금 맞힌 음이 다시 잡혀도 틀림으로 세지 않는 시간 */
const RECENT_HIT_MS = 500;

export class OnsetJudge {
  private hitTimes: number[] = [];
  private lastHit = -Infinity;
  private recentHits = new Map<number, number>();
  private prevExpected = new Set<number>();
  /** 지금 단계가 시작된 순간 (앞 단계를 끝낸 타건의 시간) */
  private stepStart = -Infinity;
  /** 틀림 후보. 화음의 다른 음이 다음 분석 묶음에 들어올 수 있어 한 묶음 늦게 판정한다 */
  private pending: NoteOnset[] = [];

  constructor(
    /** 기대하지 않은 음을 틀림으로 볼 최소 확률 (기대 음보다 엄격하게) */
    private wrongThreshold: number,
  ) {}

  setWrongThreshold(v: number) {
    this.wrongThreshold = v;
  }

  /**
   * 한 번의 분석에서 나온 타건들을 시간순으로 판정한다.
   * 맞음은 바로 알리고(연습 상태가 바로 바뀌어 다음 타건의 기대 음이 달라진다),
   * 틀림은 다음 묶음까지 본 뒤에 판정한다. 화음의 음들이 몇 ms 차이로 앞뒤에 들어오고,
   * 그 사이에 분석 묶음 경계가 끼기도 하기 때문이다.
   */
  judgeBatch(onsets: NoteOnset[], getExpected: () => number[], emit: (midi: number, verdict: Verdict) => void) {
    const pending: NoteOnset[] = [];
    for (const onset of onsets) {
      const expected = getExpected();
      if (expected.length === 0) continue;
      this.trackStep(expected);
      if (expected.includes(onset.midi)) {
        if (onset.time - this.stepStart < SAME_STRIKE_MS) continue; // 앞 단계를 끝낸 타건의 일부
        this.hitTimes.push(onset.time);
        if (this.hitTimes.length > 32) this.hitTimes.shift();
        this.recentHits.set(onset.midi, onset.time);
        this.lastHit = onset.time;
        emit(onset.midi, 'hit');
      } else {
        pending.push(onset);
      }
    }
    const ready = this.pending;
    this.pending = pending;
    // 지난 묶음의 후보 + 이번 묶음 후보 중 다음 묶음 맞음과 겹칠 수 없는 것(충분히 오래된 것)
    const latest = onsets.length ? onsets[onsets.length - 1].time : -Infinity;
    for (const onset of pending) if (latest - onset.time >= CHORD_WINDOW_MS) ready.push(onset);
    this.pending = pending.filter((o) => !ready.includes(o));
    for (const onset of ready) {
      if (getExpected().length === 0) continue;
      if (onset.prob < this.wrongThreshold) continue;
      if (this.hitTimes.some((t) => Math.abs(onset.time - t) < CHORD_WINDOW_MS)) continue;
      const recent = this.recentHits.get(onset.midi);
      if (recent !== undefined && onset.time - recent < RECENT_HIT_MS) continue;
      emit(onset.midi, 'wrong');
    }
  }

  /** 처음 보는 기대 음이 생기면 새 단계가 시작된 것으로 본다 */
  private trackStep(expected: number[]) {
    if (expected.some((m) => !this.prevExpected.has(m))) this.stepStart = this.lastHit;
    this.prevExpected = new Set(expected);
  }
}
