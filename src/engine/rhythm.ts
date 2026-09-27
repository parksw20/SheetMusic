import type { NoteEvent } from '../score/model';
import type { PracticeResult } from './practice';

/**
 * 박자 맞추기 연습: 커서가 템포대로 흘러가고, 음마다 제때 쳤는지 본다.
 *  - 정해진 시각 ±WINDOW_MS 안에 같은 음을 치면 맞음 (±GOOD_MS 안이면 "정확")
 *  - 그 시간이 지나도록 안 치면 놓침, 기대하지 않은 음이면 틀림
 * 마이크는 인식이 0.3~0.6초 늦게 끝나므로, 놓침은 여유(LATE_MS)를 두고 판정한다.
 * 음의 시각은 입력이 알려 준 실제 타건 시각(NoteInput.time)으로 비교한다.
 */
export const WINDOW_MS = 250;
export const GOOD_MS = 110;
/** 놓침 판정을 미루는 시간 (마이크 인식 지연) */
export const LATE_MS = 900;

export type NoteMark = 'hit' | 'good' | 'miss';

export interface RhythmResult extends PracticeResult {
  missed: number;
  good: number;
}

export class RhythmSession {
  readonly notes: NoteEvent[];
  private status = new Map<number, NoteMark>();
  wrong = 0;
  private offsets: number[] = [];

  constructor(
    notes: NoteEvent[],
    /** 첫 박(beatOffset)이 울려야 하는 시각 (performance.now 기준 ms) */
    readonly startAt: number,
    readonly msPerBeat: number,
    /** 구간 반복일 때 구간 첫 박. 이 박이 startAt에 온다 */
    readonly beatOffset = 0,
  ) {
    this.notes = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  }

  timeOf(n: NoteEvent): number {
    return this.startAt + (n.startBeat - this.beatOffset) * this.msPerBeat;
  }

  /** 지금 커서가 있어야 할 박 */
  beatAt(now: number): number {
    return this.beatOffset + (now - this.startAt) / this.msPerBeat;
  }

  get endAt(): number {
    const last = this.notes[this.notes.length - 1];
    return last ? this.timeOf(last) + WINDOW_MS : this.startAt;
  }

  markOf(id: number): NoteMark | undefined {
    return this.status.get(id);
  }

  /** 친 음 하나를 판정한다. 맞으면 그 음, 틀리면 null */
  play(midi: number, time: number): { note: NoteEvent; mark: NoteMark } | null {
    let best: NoteEvent | null = null;
    let bestDist = Infinity;
    for (const n of this.notes) {
      if (n.midi !== midi || this.status.has(n.id)) continue;
      const d = Math.abs(time - this.timeOf(n));
      if (d <= WINDOW_MS && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    if (!best) {
      this.wrong++;
      return null;
    }
    const mark: NoteMark = bestDist <= GOOD_MS ? 'good' : 'hit';
    this.status.set(best.id, mark);
    this.offsets.push(time - this.timeOf(best));
    return { note: best, mark };
  }

  /** 시간이 지나 놓친 음들을 확정한다 (새로 놓친 음을 돌려준다) */
  advance(now: number): NoteEvent[] {
    const missed: NoteEvent[] = [];
    for (const n of this.notes) {
      if (this.status.has(n.id)) continue;
      if (this.timeOf(n) + WINDOW_MS + LATE_MS < now) {
        this.status.set(n.id, 'miss');
        missed.push(n);
      }
    }
    return missed;
  }

  finished(now: number): boolean {
    return now > this.endAt + LATE_MS;
  }

  /** 지금 들릴 수 있는 음 (아직 판정 안 된, 최근·곧 칠 음). 마이크 판정에 넘긴다 */
  expected(now: number): number[] {
    const out = new Set<number>();
    for (const n of this.notes) {
      if (this.status.has(n.id)) continue;
      const t = this.timeOf(n);
      if (t > now + WINDOW_MS) break;
      if (t >= now - WINDOW_MS - LATE_MS) out.add(n.midi);
    }
    return [...out];
  }

  summary(): RhythmResult {
    let hits = 0;
    let good = 0;
    let missed = 0;
    for (const m of this.status.values()) {
      if (m === 'miss') missed++;
      else {
        hits++;
        if (m === 'good') good++;
      }
    }
    const total = this.notes.length;
    const accuracy = total + this.wrong === 0 ? 0 : Math.round((hits / (total + this.wrong)) * 100);
    const stars = accuracy >= 95 ? 3 : accuracy >= 80 ? 2 : accuracy >= 60 ? 1 : 0;
    return {
      accuracy,
      stars,
      correct: hits,
      wrong: this.wrong,
      cleanSteps: good,
      totalSteps: total,
      seconds: Math.round((this.endAt - this.startAt) / 1000),
      missed,
      good,
    };
  }
}
