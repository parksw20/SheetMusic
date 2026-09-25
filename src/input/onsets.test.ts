import { describe, expect, it } from 'vitest';
import { NoteTracker, OnsetJudge } from './onsets';
import { resampleTail } from './resample';

/** basic-pitch 결과 한 개 (창 시작 기준 초) */
const note = (pitchMidi: number, startTimeSeconds: number, amplitude = 0.8) => ({ pitchMidi, startTimeSeconds, amplitude });

describe('NoteTracker', () => {
  it('창이 겹쳐 같은 음이 여러 번 나와도 한 번만 낸다', () => {
    const t = new NoteTracker();
    // 절대 시간 3000ms에 시작한 도4가 세 창에 걸쳐 조금씩 다른 위치로 나온다
    const a = t.update([note(60, 1.5)], 1500);
    const b = t.update([note(60, 1.352)], 1650);
    const c = t.update([note(60, 1.198)], 1800);
    expect([...a, ...b, ...c].map((o) => [o.midi, Math.round(o.time)])).toEqual([[60, 3000]]);
  });

  it('같은 건반을 다시 치면 새 음으로 낸다', () => {
    const t = new NoteTracker();
    t.update([note(64, 1.0)], 1000);
    expect(t.update([note(64, 1.0)], 1500).map((o) => Math.round(o.time))).toEqual([2500]);
  });

  it('창 시작 직후에 시작하는 음(앞에서부터 울리던 음)과 마이크를 켜기 전 음은 버린다', () => {
    const t = new NoteTracker(2000);
    expect(t.update([note(60, 0.1), note(62, 0.5), note(64, 1.2)], 1000).map((o) => o.midi)).toEqual([64]);
  });

  it('화음은 같은 시간의 여러 음으로 나온다', () => {
    const t = new NoteTracker();
    expect(t.update([note(67, 1), note(48, 1), note(60, 1), note(64, 1)], 0).map((o) => o.midi).sort()).toEqual([48, 60, 64, 67]);
  });
});

describe('OnsetJudge', () => {
  /** 대기 모드 연습을 흉내 낸다: 단계의 음을 모두 맞히면 다음 단계로 */
  function practice(steps: number[][], batches: [number, number, number][][], wrongThreshold = 0.5) {
    const j = new OnsetJudge(wrongThreshold);
    let index = 0;
    let hit: number[] = [];
    const log: string[] = [];
    const expected = () => (index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : []);
    for (const batch of batches) {
      j.judgeBatch(
        batch.map(([midi, time, confidence]) => ({ midi, time, confidence })),
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

  it('쳐야 할 음은 약해도 맞음, 다른 음은 세기가 충분할 때만 틀림', () => {
    const { log } = practice([[60], [64], [64]], [[[60, 1000, 0.3]], [[62, 2000, 0.4]], [[62, 3000, 0.8]], []]);
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
