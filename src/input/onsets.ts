/**
 * 공식 basic-pitch-ts가 찾아 준 음들을 연습 흐름에 맞게 다룬다.
 *  - NoteTracker: 창을 겹쳐 가며 여러 번 나오는 같은 음을 한 번만 내보낸다
 *  - OnsetJudge: 지금 쳐야 할 음과 비교해 맞음/틀림을 정한다
 * 모델과 브라우저에 의존하지 않는 순수 로직이다.
 */

export interface NoteOnset {
  midi: number;
  /** 음이 시작된 오디오 시간 (ms) */
  time: number;
  /** 음의 세기 0~1 (basic-pitch의 amplitude: 음이 울리는 동안의 평균 활성도) */
  confidence: number;
}

/** basic-pitch outputToNotesPoly → noteFramesToTime 결과 중 여기서 쓰는 값 */
export interface TranscribedNote {
  pitchMidi: number;
  startTimeSeconds: number;
  amplitude: number;
}

/** 같은 건반에서 이 시간 안에 다시 시작된 음은 같은 음으로 본다 (창이 겹쳐 같은 음이 여러 번 나옴) */
const SAME_NOTE_MS = 150;
/**
 * 창 시작 직후에 시작하는 음은 버린다. 창 앞에서부터 울리던 음을 새 음으로 잡는 경우이고,
 * 진짜 새 타건은 다음 창들(0.15초마다)에서 더 안쪽 위치로 다시 나온다.
 */
const WINDOW_HEAD_SECONDS = 0.25;

export class NoteTracker {
  private lastStart = new Map<number, number>();

  constructor(
    /** 이 시간(ms) 이전에 시작된 음은 무시한다 (마이크를 켜기 전·켜는 순간의 소리) */
    private ignoreBeforeMs = -Infinity,
  ) {}

  /** notes: 창 하나의 인식 결과, windowStartMs: 그 창의 시작 오디오 시간 */
  update(notes: TranscribedNote[], windowStartMs: number): NoteOnset[] {
    const found: NoteOnset[] = [];
    for (const n of [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)) {
      if (n.startTimeSeconds < WINDOW_HEAD_SECONDS) continue;
      const time = windowStartMs + n.startTimeSeconds * 1000;
      if (time < this.ignoreBeforeMs) continue;
      const last = this.lastStart.get(n.pitchMidi);
      if (last !== undefined && time < last + SAME_NOTE_MS) continue;
      this.lastStart.set(n.pitchMidi, time);
      found.push({ midi: n.pitchMidi, time, confidence: n.amplitude });
    }
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
    /** 기대하지 않은 음을 틀림으로 볼 최소 세기 (약한 잡음을 틀림으로 세지 않게) */
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
  judgeBatch(
    onsets: NoteOnset[],
    getExpected: () => number[],
    emit: (midi: number, verdict: Verdict, onset: NoteOnset) => void,
  ) {
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
        emit(onset.midi, 'hit', onset);
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
      if (onset.confidence < this.wrongThreshold) continue;
      if (this.hitTimes.some((t) => Math.abs(onset.time - t) < CHORD_WINDOW_MS)) continue;
      const recent = this.recentHits.get(onset.midi);
      if (recent !== undefined && onset.time - recent < RECENT_HIT_MS) continue;
      emit(onset.midi, 'wrong', onset);
    }
  }

  /** 처음 보는 기대 음이 생기면 새 단계가 시작된 것으로 본다 */
  private trackStep(expected: number[]) {
    if (expected.some((m) => !this.prevExpected.has(m))) this.stepStart = this.lastHit;
    this.prevExpected = new Set(expected);
  }
}
