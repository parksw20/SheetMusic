import { describe, expect, it } from 'vitest';
import { LevelGate, NoteTracker, OnsetJudge, withFastNotes } from './onsets';
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

describe('withFastNotes', () => {
  const edge = (pitchMidi: number, startTimeSeconds: number, prob: number) => ({ pitchMidi, startTimeSeconds, prob });

  it('창 끝의 후보는 쳐야 할 음이고 확률이 충분할 때만 더한다', () => {
    const merged = withFastNotes([note(60, 1.0)], [edge(62, 1.9, 0.8), edge(64, 1.9, 0.9), edge(65, 1.9, 0.4)], [62, 65], 0.7);
    expect(merged.map((n) => n.pitchMidi)).toEqual([60, 62]);
  });

  it('빠른 확인으로 낸 음은 다음 창에서 확정돼도 다시 내지 않는다', () => {
    const t = new NoteTracker();
    // 창 끝에서 먼저 잡힌 레4(절대 3900ms)가 다음 창에서 조금 다른 위치로 확정된다
    const a = t.update(withFastNotes([], [edge(62, 1.9, 0.8)], [62], 0.55), 2000);
    const b = t.update(withFastNotes([note(62, 1.52)], [], [], 0.55), 2400);
    expect([...a, ...b].map((o) => [o.midi, Math.round(o.time)])).toEqual([[62, 3900]]);
  });
});

describe('LevelGate', () => {
  /** 50ms마다 크기를 넣는다: 조용한 방(-55dB)에서 2초에 피아노(-20dB)를 친다 */
  function room(noiseDb: number, strikes: number[], strikeDb: number) {
    const g = new LevelGate();
    for (let t = 50; t <= 4000; t += 50) g.add(t, strikes.some((s) => t > s && t <= s + 300) ? strikeDb : noiseDb);
    return g;
  }

  it('잡음만 있는 순간의 음은 버리고, 친 순간의 음은 인정한다', () => {
    const g = room(-55, [2000], -20);
    expect(g.allows(1000)).toBe(false);
    expect(g.allows(2000)).toBe(true);
  });

  it('작게 쳐도 배경 소음보다 충분히 크면 인정한다 (절대 크기가 아니라 소음과의 차이로 판단)', () => {
    expect(room(-65, [2000], -34).allows(2000)).toBe(true);
    expect(room(-38, [2000], -17).allows(2000)).toBe(true);
    expect(room(-38, [2000], -17).allows(1000)).toBe(false);
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

  it('음높이가 흔들리는 음(사람 목소리)은 틀림으로 세지 않는다', () => {
    const j = new OnsetJudge(0.5);
    const log: string[] = [];
    const batches = [[{ midi: 57, time: 1000, confidence: 0.9, wobble: 1.33 }], [{ midi: 59, time: 2000, confidence: 0.9, wobble: 0 }], []];
    for (const b of batches) j.judgeBatch(b, () => [60], (m, v) => log.push(`${v} ${m}`));
    expect(log).toEqual(['wrong 59']);
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
