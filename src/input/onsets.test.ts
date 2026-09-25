import { describe, expect, it } from 'vitest';
import { BASIC_PITCH, OnsetExtractor, OnsetJudge } from './onsets';
import { resampleTail } from './resample';

const { keys, midiOffset, hop, sampleRate, windowSamples } = BASIC_PITCH;
const N_FRAMES = 172;
const FRAME_MS = (hop / sampleRate) * 1000;
const WINDOW_MS = (windowSamples / sampleRate) * 1000;

/** 창 끝 시간 endMs 기준으로, 주어진 (midi, 절대시간, 확률) 타건이 들어 있는 모델 출력을 만든다 */
function activations(endMs: number, hits: [number, number, number][]): Float32Array {
  const a = new Float32Array(N_FRAMES * keys);
  const startMs = endMs - WINDOW_MS;
  for (const [midi, time, prob] of hits) {
    const f = Math.round((time - startMs) / FRAME_MS);
    if (f < 0 || f >= N_FRAMES) continue;
    const k = midi - midiOffset;
    a[f * keys + k] = prob;
    if (f > 0) a[(f - 1) * keys + k] = prob * 0.5;
    if (f + 1 < N_FRAMES) a[(f + 1) * keys + k] = prob * 0.5;
  }
  return a;
}

describe('OnsetExtractor', () => {
  it('창을 겹쳐 여러 번 봐도 같은 타건은 한 번만 낸다', () => {
    const ex = new OnsetExtractor(0.5, 10);
    const hits: [number, number, number][] = [[60, 3000, 0.9]];
    const all = [3100, 3250, 3400, 3550, 3700].flatMap((end) => ex.extract(activations(end, hits), N_FRAMES, end));
    expect(all.map((o) => o.midi)).toEqual([60]);
    expect(Math.abs(all[0].time - 3000)).toBeLessThan(FRAME_MS);
  });

  it('창 끝부분(뒤쪽 맥락이 부족한 프레임)은 다음 창에서 확정한다', () => {
    const ex = new OnsetExtractor(0.5, 10);
    const hits: [number, number, number][] = [[64, 3000, 0.9]];
    expect(ex.extract(activations(3050, hits), N_FRAMES, 3050)).toEqual([]);
    expect(ex.extract(activations(3200, hits), N_FRAMES, 3200).map((o) => o.midi)).toEqual([64]);
  });

  it('기준보다 낮은 확률과 시작 직후 구간은 버린다', () => {
    const ex = new OnsetExtractor(0.5, 10, 2500);
    const hits: [number, number, number][] = [
      [60, 2400, 0.9], // 시작 직후
      [62, 2800, 0.3], // 약함
      [64, 2900, 0.8],
    ];
    expect(ex.extract(activations(3300, hits), N_FRAMES, 3300).map((o) => o.midi)).toEqual([64]);
  });

  it('화음은 같은 시간의 여러 건반으로 나온다', () => {
    const ex = new OnsetExtractor(0.5, 10);
    const hits: [number, number, number][] = [48, 60, 64, 67].map((m) => [m, 3000, 0.9]);
    expect(ex.extract(activations(3400, hits), N_FRAMES, 3400).map((o) => o.midi)).toEqual([48, 60, 64, 67]);
  });
});

describe('OnsetJudge', () => {
  /** 대기 모드 연습을 흉내 낸다: 단계의 음을 모두 맞히면 다음 단계로 */
  function practice(steps: number[][], batches: [number, number, number][][], wrongThreshold = 0.8) {
    const j = new OnsetJudge(wrongThreshold);
    let index = 0;
    let hit: number[] = [];
    const log: string[] = [];
    const expected = () => (index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : []);
    for (const batch of batches) {
      j.judgeBatch(
        batch.map(([midi, time, prob]) => ({ midi, time, prob })),
        expected,
        (midi, verdict) => {
          log.push(`${verdict} ${midi}`);
          if (verdict !== 'hit') return;
          hit.push(midi);
          if (steps[index].every((m) => hit.includes(m))) {
            index++;
            hit = [];
          }
        },
      );
    }
    return { log, index };
  }

  it('쳐야 할 음은 확률이 낮아도 맞음, 다른 음은 확실할 때만 틀림', () => {
    const { log } = practice([[60], [64], [64]], [[[60, 1000, 0.5]], [[62, 2000, 0.6]], [[62, 3000, 0.9]], []]);
    expect(log).toEqual(['hit 60', 'wrong 62']);
  });

  it('화음의 다른 음이 몇 ms 먼저 들어와도 틀림으로 세지 않는다', () => {
    const { log } = practice([[60], [67]], [[[48, 1000, 0.9], [60, 1012, 0.9]]]);
    expect(log).toEqual(['hit 60']);
  });

  it('화음의 음이 분석 묶음 경계로 나뉘어 들어와도 틀림으로 세지 않는다', () => {
    const { log } = practice([[60], [67]], [[[48, 1000, 0.9]], [[60, 1012, 0.9]], [[67, 2000, 0.9]]]);
    expect(log).toEqual(['hit 60', 'hit 67']);
  });

  it('틀림은 한 묶음 늦게라도 결국 알린다', () => {
    const { log } = practice([[60], [60]], [[[62, 1000, 0.9]], [[60, 1600, 0.9]]]);
    expect(log).toEqual(['hit 60', 'wrong 62']);
  });

  it('앞 단계를 끝낸 타건의 배음으로 다음 단계를 미리 맞히지 않는다', () => {
    // 솔3+레4 화음을 칠 때 솔3의 2배음(솔4)이 함께 잡혀도, 다음 단계(솔4)는 새로 쳐야 맞음
    const { log, index } = practice(
      [[55, 62], [67]],
      [[[55, 1000, 0.9], [62, 1000, 0.9], [67, 1000, 0.85]], [[67, 1800, 0.9]]],
    );
    expect(log).toEqual(['hit 55', 'hit 62', 'hit 67']);
    expect(index).toBe(2);
  });

  it('연습 중이 아니면(기대 음 없음) 판정하지 않는다', () => {
    expect(practice([], [[[60, 0, 1]]]).log).toEqual([]);
  });
});

describe('resampleTail', () => {
  it('48kHz 사인파를 22.05kHz로 바꿔도 주파수가 유지된다', () => {
    const f = 440;
    const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * f * i) / 48000));
    const y = resampleTail(x, 48000, 22050, 22050);
    let crossings = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(438);
    expect(crossings).toBeLessThanOrEqual(442);
  });

  it('입력이 짧으면 앞을 0으로 채운다', () => {
    const y = resampleTail(new Float32Array([1, 1, 1, 1]), 22050, 22050, 8);
    expect(Array.from(y.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(y[7]).toBeCloseTo(1);
  });
});
