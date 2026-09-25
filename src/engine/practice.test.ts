import { describe, expect, it } from 'vitest';
import type { NoteEvent, Step } from '../score/model';
import { createPractice, pressKey, summarize, type PracticeState } from './practice';

let id = 0;
const step = (startBeat: number, ...midis: number[]): Step => ({
  startBeat,
  notes: midis.map(
    (midi): NoteEvent => ({ id: id++, midi, startBeat, durationBeats: 1, staff: 1, measure: 1 }),
  ),
});

function play(s: PracticeState, keys: number[], t = 0) {
  const results = [];
  for (const k of keys) {
    const r = pressKey(s, k, (t += 500));
    s = r.state;
    results.push(r.result);
  }
  return { s, results };
}

describe('대기 모드 연습', () => {
  it('맞는 음을 치면 다음 Step으로 넘어가고 끝나면 3점이다', () => {
    const { s, results } = play(createPractice([step(0, 60), step(1, 62)]), [60, 62]);
    expect(results).toEqual(['hit', 'hit']);
    expect(s.finishedAt).not.toBeNull();
    expect(summarize(s)).toMatchObject({ accuracy: 100, stars: 3, cleanSteps: 2, seconds: 1 });
  });

  it('틀린 음은 기록하지만 진행하지 않는다', () => {
    const { s, results } = play(createPractice([step(0, 60), step(1, 62)]), [61, 60, 62]);
    expect(results).toEqual(['wrong', 'hit', 'hit']);
    expect(summarize(s)).toMatchObject({ correct: 2, wrong: 1, accuracy: 67, stars: 1, cleanSteps: 1 });
  });

  it('화음은 모든 음을 쳐야 넘어가고, 같은 음 반복은 무시한다', () => {
    let { s, results } = play(createPractice([step(0, 48, 60, 64), step(1, 62)]), [60, 60, 48]);
    expect(results).toEqual(['hit', 'repeat', 'hit']);
    expect(s.index).toBe(0);
    ({ s } = play(s, [64]));
    expect(s.index).toBe(1);
  });

  it('끝난 뒤의 입력은 무시한다', () => {
    const { s, results } = play(createPractice([step(0, 60)]), [60, 60]);
    expect(results).toEqual(['hit', 'ignored']);
    expect(s.correct).toBe(1);
  });
});
