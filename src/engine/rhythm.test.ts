import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../score/model';
import { LATE_MS, RhythmSession, WINDOW_MS } from './rhythm';

const note = (id: number, midi: number, startBeat: number): NoteEvent => ({
  id,
  midi,
  startBeat,
  durationBeats: 1,
  staff: 1,
  measure: 1,
});

// 60BPM: 한 박 = 1000ms, 첫 박이 10000ms에
const song = () => new RhythmSession([note(0, 60, 0), note(1, 62, 1), note(2, 64, 2), note(3, 48, 2)], 10000, 1000);

describe('RhythmSession', () => {
  it('제때(±250ms) 친 음은 맞음, 110ms 안이면 정확', () => {
    const s = song();
    expect(s.play(60, 10050)?.mark).toBe('good');
    expect(s.play(62, 11200)?.mark).toBe('hit');
    expect(s.play(64, 12400)).toBeNull(); // 너무 늦음 → 틀림
    expect(s.wrong).toBe(1);
  });

  it('안 친 음은 여유 시간이 지나면 놓침', () => {
    const s = song();
    s.play(60, 10000);
    expect(s.advance(11000 + WINDOW_MS + LATE_MS - 1)).toEqual([]);
    expect(s.advance(11000 + WINDOW_MS + LATE_MS + 1).map((n) => n.midi)).toEqual([62]);
  });

  it('화음은 음마다 따로 맞힌다', () => {
    const s = song();
    expect(s.play(64, 12020)?.note.id).toBe(2);
    expect(s.play(48, 11990)?.note.id).toBe(3);
  });

  it('구간 반복: 구간 첫 박이 시작 시각에 온다', () => {
    const s = new RhythmSession([note(0, 60, 8), note(1, 62, 9)], 5000, 500, 8);
    expect(s.timeOf(s.notes[1])).toBe(5500);
    expect(s.beatAt(5250)).toBeCloseTo(8.5);
  });

  it('결과: 맞음/틀림/놓침으로 정확도와 별', () => {
    const s = song();
    s.play(60, 10000);
    s.play(62, 11000);
    s.play(64, 12000);
    s.play(48, 12000);
    s.advance(20000);
    const r = s.summary();
    expect(r).toMatchObject({ correct: 4, wrong: 0, missed: 0, accuracy: 100, stars: 3 });
  });

  it('마이크에 넘길 기대 음: 아직 판정 안 된 최근·곧 칠 음', () => {
    const s = song();
    expect(s.expected(9900).sort()).toEqual([60]);
    s.play(60, 10000);
    expect(s.expected(10900).sort()).toEqual([62]);
  });
});

describe('RhythmSession 평균 타이밍', () => {
  it('맞힌 음이 정해진 박보다 얼마나 늦었는지 (중앙값)', () => {
    const s = song();
    s.play(60, 10080);
    s.play(62, 11100);
    s.play(64, 12090);
    expect(s.summary().offsetMs).toBe(90);
    expect(song().summary().offsetMs).toBeNull();
  });
});
