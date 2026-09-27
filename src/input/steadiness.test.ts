import { describe, expect, it } from 'vitest';
import { isSteady, measureSteadiness, samplesNeeded } from './steadiness';

const SR = 48000;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** 피아노처럼: 음높이 고정, 배음 여러 개, 점점 작아짐 */
function piano(midis: number[], seconds = 0.5): Float32Array {
  const x = new Float32Array(Math.round(SR * seconds));
  for (const m of midis) {
    const f = hz(m);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      for (let h = 1; h <= 6; h++) x[i] += (Math.exp(-3 * t) / h) * Math.sin(2 * Math.PI * f * h * t * (1 + 0.0004 * h * h));
    }
  }
  return x;
}

/** 말하듯: 음높이가 0.2초에 반음쯤 미끄러지고 떨린다 */
function voice(midi: number, seconds = 0.5): Float32Array {
  const x = new Float32Array(Math.round(SR * seconds));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = hz(midi) * 2 ** ((-5 * t + 0.3 * Math.sin(2 * Math.PI * 5.5 * t)) / 12);
    phase += (2 * Math.PI * f) / SR;
    for (let h = 1; h <= 8; h++) x[i] += Math.sin(h * phase) / h;
  }
  return x;
}

describe('measureSteadiness', () => {
  it('피아노 음은 음높이가 고정돼 있다', () => {
    for (const m of [40, 60, 79]) {
      const s = measureSteadiness(piano([m]), SR, m)!;
      expect(s.driftCents).toBeLessThan(5);
      expect(isSteady(s)).toBe(true);
    }
  });

  it('화음 속의 한 음도 고정돼 있다고 잰다', () => {
    const chord = piano([60, 64, 67]);
    for (const m of [60, 64, 67]) expect(isSteady(measureSteadiness(chord, SR, m)!)).toBe(true);
  });

  it('음높이가 미끄러지는 목소리는 피아노가 아니다', () => {
    for (const m of [45, 57, 64]) {
      const s = measureSteadiness(voice(m), SR, m)!;
      expect(s.driftCents).toBeGreaterThan(20);
      expect(isSteady(s)).toBe(false);
    }
  });

  it('음 시작 뒤 소리가 모자라면 잴 수 없다', () => {
    expect(measureSteadiness(new Float32Array(samplesNeeded(SR) - 1), SR, 60)).toBeNull();
  });
});
