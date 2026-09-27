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
  /** 음높이 흔들림 (반음) */
  wobble?: number;
}

/** basic-pitch outputToNotesPoly → noteFramesToTime 결과 중 여기서 쓰는 값 */
export interface TranscribedNote {
  pitchMidi: number;
  startTimeSeconds: number;
  amplitude: number;
  /** 음높이 흔들림 (반음). 목소리 거르기에 쓴다. 모르면 없음 */
  wobble?: number;
}

/**
 * 같은 건반에서 이 시간 안에 다시 시작된 음은 같은 음으로 본다
 * (창이 겹쳐 같은 음이 여러 번 나오고, 빠른 확인 음과 확정 음의 위치가 조금 다르다)
 */
const SAME_NOTE_MS = 200;
/**
 * 창 시작 직후에 시작하는 음은 버린다. 창 앞에서부터 울리던 음을 새 음으로 잡는 경우이고,
 * 진짜 새 타건은 다음 창들에서 더 안쪽 위치로 다시 나온다.
 */
const WINDOW_HEAD_SECONDS = 0.25;

/** 창 끝(아직 확정 전) 구간에서 막 시작된 음 후보 (basicPitch.ts의 EdgeOnset) */
export interface EdgeCandidate {
  pitchMidi: number;
  startTimeSeconds: number;
  prob: number;
}

/**
 * 빠른 확인: 창 끝 구간의 후보 중 지금 쳐야 할 음이고 타건 확률이 fastThreshold 이상인 것을
 * 확정 음에 더한다. 확정은 창 끝 0.17초를 기다려야 하지만, 쳐야 할 음은 이렇게 먼저 맞힌다.
 * 기대하지 않은 음은 틀림 판정이 성급해지지 않게 확정될 때까지 기다린다.
 */
export function withFastNotes(
  notes: TranscribedNote[],
  edge: EdgeCandidate[],
  expected: number[],
  fastThreshold: number,
): TranscribedNote[] {
  const fast = edge
    .filter((e) => e.prob >= fastThreshold && expected.includes(e.pitchMidi))
    .map((e) => ({ pitchMidi: e.pitchMidi, startTimeSeconds: e.startTimeSeconds, amplitude: e.prob }));
  return fast.length ? [...notes, ...fast] : notes;
}

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
      found.push({ midi: n.pitchMidi, time, confidence: n.amplitude, wobble: n.wobble });
    }
    return found.sort((a, b) => a.time - b.time);
  }
}

/** 소리 크기 블록 길이 */
export const LEVEL_BLOCK_MS = 50;
/** 배경 소음 기준을 잡는 기간 (쉬지 않고 쳐도 그 사이 가장 조용한 순간이 들어가도록 길게) */
const FLOOR_HISTORY_MS = 30_000;
/** 이보다 작은 블록은 소리가 아예 없는 것(수집 시작 전 등)이라 배경 소음 계산에서 뺀다 */
const DIGITAL_SILENCE_DB = -100;
/** 들린 음은 배경 소음보다 이만큼(dB) 커야 한다 */
const FLOOR_MARGIN_DB = 10;

/**
 * 배경 소음에 가까운 소리에서 나온 음을 버린다.
 * 모델은 창마다 소리 크기를 맞춰(normalized log) 분석해서, 조용한 방의 잡음만 있는 창에서는 잡음이 크게 부풀려져
 * 가끔 가짜 타건(타건 확률 0.7 이상)을 만든다. 그 가짜 음이 곧 칠 음과 같으면 먼저 맞음이 되고, 진짜 타건은 틀림이 된다.
 * 절대 크기로는 거를 수 없어서(조용히 친 음 -32dB < 다른 방의 잡음 -38dB), 최근 30초 중 가장 조용한 순간을
 * 배경 소음으로 보고 음이 시작된 순간의 소리가 그보다 10dB 이상 클 때만 인정한다.
 * (하위 10%로 잡으면 빠른 곡을 쉬지 않고 칠 때 기준이 올라가 약하게 친 음을 버렸다)
 */
export class LevelGate {
  private blocks: { time: number; db: number }[] = [];

  /** LEVEL_BLOCK_MS 길이 블록 하나의 크기(dBFS)를 넣는다. time: 블록이 끝나는 오디오 시간(ms) */
  add(time: number, db: number) {
    if (db < DIGITAL_SILENCE_DB) return;
    this.blocks.push({ time, db });
    while (this.blocks.length && this.blocks[0].time < time - FLOOR_HISTORY_MS) this.blocks.shift();
  }

  /** 배경 소음 크기 (dBFS) */
  floor(): number {
    let min = Infinity;
    for (const b of this.blocks) min = Math.min(min, b.db);
    return min === Infinity ? -Infinity : min;
  }

  /** 이 시간(ms)에 시작된 음이 배경 소음보다 충분히 큰 소리인가 */
  allows(onsetMs: number): boolean {
    let peak = -Infinity;
    for (const b of this.blocks) if (b.time > onsetMs - LEVEL_BLOCK_MS && b.time <= onsetMs + 4 * LEVEL_BLOCK_MS) peak = Math.max(peak, b.db);
    if (peak === -Infinity) return true; // 소리 크기 정보가 없으면 거르지 않는다
    return peak >= this.floor() + FLOOR_MARGIN_DB;
  }
}

export type Verdict = 'hit' | 'wrong';

/** 맞힌 음과 이 시간 안에 들린 다른 음은 같은 화음이거나 그 배음으로 보고 틀림으로 세지 않는다 */
const CHORD_WINDOW_MS = 150;
/** 한 단계를 끝낸 타건과 이 시간 안에 들린 음으로는 다음 단계를 맞힐 수 없다 (같은 타건의 배음 등) */
const SAME_STRIKE_MS = 100;
/** 방금 맞힌 음이 다시 잡혀도 틀림으로 세지 않는 시간 */
const RECENT_HIT_MS = 500;
/**
 * 음높이가 이만큼(반음) 이상 흔들리면 사람 목소리로 보고 틀림으로 세지 않는다.
 * 피아노 음은 0~0.33, 목소리는 떨림과 억양 때문에 0.67 이상이었다 (합성 목소리 + 실제 피아노 녹음으로 잰 값).
 */
export const VOICE_WOBBLE = 0.6;

/**
 * 틀림 후보가 피아노 소리인지 원래 소리로 확인한다 (steadiness.ts).
 * true 피아노, false 목소리 등 음높이가 흔들리는 소리, null 음 시작 뒤 소리가 아직 덜 모임(다음 묶음에 다시 본다).
 */
export type SteadyCheck = (onset: NoteOnset) => boolean | null;

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
    /** 있으면 음높이 흔들림(wobble) 대신 이것으로 목소리를 거른다 */
    private steadyCheck?: SteadyCheck,
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
      if (!this.steadyCheck && (onset.wobble ?? 0) >= VOICE_WOBBLE) continue;
      if (this.hitTimes.some((t) => Math.abs(onset.time - t) < CHORD_WINDOW_MS)) continue;
      const recent = this.recentHits.get(onset.midi);
      if (recent !== undefined && onset.time - recent < RECENT_HIT_MS) continue;
      if (this.steadyCheck) {
        const steady = this.steadyCheck(onset);
        if (steady === null) {
          this.pending.push(onset);
          continue;
        }
        if (!steady) continue;
      }
      emit(onset.midi, 'wrong', onset);
    }
  }

  /** 처음 보는 기대 음이 생기면 새 단계가 시작된 것으로 본다 */
  private trackStep(expected: number[]) {
    if (expected.some((m) => !this.prevExpected.has(m))) this.stepStart = this.lastHit;
    this.prevExpected = new Set(expected);
  }
}
