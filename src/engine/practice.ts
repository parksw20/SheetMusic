import type { Step } from '../score/model';

/**
 * 대기 모드 연습 세션.
 * 현재 Step의 음을 모두 칠 때까지 다음으로 넘어가지 않는다.
 * React state에서 쓰기 쉽도록 불변 객체로 다룬다.
 */
export interface PracticeState {
  steps: Step[];
  index: number;
  /** 현재 Step에서 이미 맞게 친 MIDI 번호 */
  hit: number[];
  /** 현재 Step에서 틀린 적이 있는지 */
  stepHadMistake: boolean;
  correct: number;
  wrong: number;
  /** 한 번도 틀리지 않고 통과한 Step 수 */
  cleanSteps: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type PressResult = 'hit' | 'wrong' | 'repeat' | 'ignored';

export function createPractice(steps: Step[]): PracticeState {
  return {
    steps,
    index: 0,
    hit: [],
    stepHadMistake: false,
    correct: 0,
    wrong: 0,
    cleanSteps: 0,
    startedAt: null,
    finishedAt: steps.length === 0 ? 0 : null,
  };
}

export function isFinished(s: PracticeState): boolean {
  return s.finishedAt !== null;
}

export function currentStep(s: PracticeState): Step | undefined {
  return s.steps[s.index];
}

export function pressKey(
  s: PracticeState,
  midi: number,
  now: number,
): { state: PracticeState; result: PressResult } {
  const step = currentStep(s);
  if (!step || isFinished(s)) return { state: s, result: 'ignored' };

  const startedAt = s.startedAt ?? now;
  const expected = step.notes.some((n) => n.midi === midi);

  if (!expected) {
    return {
      state: { ...s, startedAt, wrong: s.wrong + 1, stepHadMistake: true },
      result: 'wrong',
    };
  }
  if (s.hit.includes(midi)) return { state: { ...s, startedAt }, result: 'repeat' };

  const hit = [...s.hit, midi];
  const correct = s.correct + 1;
  const stepDone = step.notes.every((n) => hit.includes(n.midi));

  if (!stepDone) return { state: { ...s, startedAt, hit, correct }, result: 'hit' };

  const index = s.index + 1;
  return {
    state: {
      ...s,
      startedAt,
      index,
      hit: [],
      correct,
      stepHadMistake: false,
      cleanSteps: s.cleanSteps + (s.stepHadMistake ? 0 : 1),
      finishedAt: index >= s.steps.length ? now : null,
    },
    result: 'hit',
  };
}

export interface PracticeResult {
  /** 0~100 */
  accuracy: number;
  /** 0~3 */
  stars: number;
  correct: number;
  wrong: number;
  cleanSteps: number;
  totalSteps: number;
  seconds: number;
}

export function summarize(s: PracticeState): PracticeResult {
  const attempts = s.correct + s.wrong;
  const accuracy = attempts === 0 ? 0 : Math.round((s.correct / attempts) * 100);
  const stars = accuracy >= 95 ? 3 : accuracy >= 80 ? 2 : accuracy >= 60 ? 1 : 0;
  const end = s.finishedAt ?? s.startedAt ?? 0;
  return {
    accuracy,
    stars,
    correct: s.correct,
    wrong: s.wrong,
    cleanSteps: s.cleanSteps,
    totalSteps: s.steps.length,
    seconds: s.startedAt === null ? 0 : Math.round((end - s.startedAt) / 1000),
  };
}
