import { describe, expect, it } from 'vitest';
import { midiToFreq, NoteVerifier, type Detection } from './pitch';

const SR = 48000;
const FFT = 8192;
const HOP = 1024; // 약 21ms마다 한 프레임 (브라우저에서 20ms 간격으로 읽는 것과 비슷)

interface Strike {
  midi: number;
  at: number; // 초
  gain?: number;
}

/** 피아노 비슷한 소리: 배음 6개, 빠른 어택, 지수 감쇠, 약한 잡음 */
function render(strikes: Strike[], seconds: number, noise = 0.0005): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SR));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = noise * rand();
  for (const s of strikes) {
    const f0 = midiToFreq(s.midi);
    const start = Math.floor(s.at * SR);
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.8) * (s.gain ?? 0.2);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
      out[i] += env * v;
    }
  }
  return out;
}

/** AnalyserNode와 같은 방식(블랙먼 창, dB)으로 스펙트럼 계산 */
function spectrum(signal: Float32Array, end: number): Float32Array {
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) {
    const x = signal[end - FFT + i] ?? 0;
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT) + 0.08 * Math.cos((4 * Math.PI * i) / FFT);
    re[i] = x * w;
  }
  fft(re, im);
  const db = new Float32Array(FFT / 2);
  for (let k = 0; k < FFT / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / FFT + 1e-12);
  return db;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** expected는 시간(초)에 따라 바뀔 수 있다 */
function run(signal: Float32Array, expected: (t: number) => number[]) {
  const v = new NoteVerifier(SR, FFT);
  const found: (Detection & { t: number })[] = [];
  for (let end = FFT; end <= signal.length; end += HOP) {
    const t = end / SR;
    for (const d of v.process(spectrum(signal, end), t * 1000, expected(t))) found.push({ ...d, t });
  }
  return found;
}

describe('NoteVerifier', () => {
  it('잡음만 있으면 아무것도 보고하지 않는다', () => {
    expect(run(render([], 1.5), () => [60])).toEqual([]);
  });

  it('기대한 음을 치면 곧바로 한 번 맞음으로 보고한다', () => {
    const found = run(render([{ midi: 60, at: 0.4 }], 1.5), () => [60]);
    expect(found.map((d) => [d.midi, d.expected])).toEqual([[60, true]]);
    expect(found[0].t - 0.4).toBeLessThan(0.1);
  });

  it('다른 음을 치면 그 음을 틀림으로 보고한다', () => {
    const found = run(render([{ midi: 60, at: 0.4 }], 1.5), () => [64]);
    expect(found.map((d) => [d.midi, d.expected])).toEqual([[60, false]]);
  });

  it('화음의 모든 음을 찾는다', () => {
    const chord = [60, 64, 67].map((midi) => ({ midi, at: 0.4 }));
    const found = run(render(chord, 1.5), () => [60, 64, 67]);
    expect(found.map((d) => d.midi).sort()).toEqual([60, 64, 67]);
    expect(found.every((d) => d.expected)).toBe(true);
  });

  it('같은 음을 다시 치면 다시 보고한다 (울리고 있는 음과 구분)', () => {
    const found = run(
      render([
        { midi: 64, at: 0.4 },
        { midi: 64, at: 1.0 },
      ], 2),
      () => [64],
    );
    expect(found.map((d) => d.midi)).toEqual([64, 64]);
    expect(found[1].t).toBeGreaterThan(1.0);
  });

  it('이전 음이 울리는 중에 새 음을 치면 새 음만 판정한다', () => {
    const found = run(
      render([
        { midi: 60, at: 0.4 },
        { midi: 64, at: 1.0 },
      ], 2),
      (t) => (t < 0.9 ? [60] : [62]),
    );
    expect(found.map((d) => [d.midi, d.expected])).toEqual([
      [60, true],
      [64, false],
    ]);
  });

  it('왼손 저음도 찾는다', () => {
    const found = run(render([{ midi: 43, at: 0.4 }], 1.5), () => [43]);
    expect(found.map((d) => [d.midi, d.expected])).toEqual([[43, true]]);
  });

  it('여리게 쳐도 찾는다', () => {
    const found = run(render([{ midi: 67, at: 0.4, gain: 0.02 }], 1.5), () => [67]);
    expect(found.map((d) => [d.midi, d.expected])).toEqual([[67, true]]);
  });

  it('주변 잡음이 큰 방에서도 기대 음을 찾고 잡음은 무시한다', () => {
    expect(run(render([], 1.5, 0.01), () => [60])).toEqual([]);
    const found = run(render([{ midi: 60, at: 0.4 }], 1.5, 0.01), () => [60]);
    expect(found.map((d) => [d.midi, d.expected])).toEqual([[60, true]]);
  });

  // 프레임 간격이 촘촘하면(브라우저 타이머 흔들림) 분석 창이 새 음으로 차오르는 동안 타건이 두 번 잡힐 수 있다
  it.each([HOP, 441, 256])('대기 모드에서 방금 친 음을 틀림으로 세지 않는다 (hop %i)', (hop) => {
    const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60];
    const signal = render(melody.map((midi, i) => ({ midi, at: 0.4 + i * 0.5 })), 0.4 + melody.length * 0.5 + 0.5);
    const v = new NoteVerifier(SR, FFT);
    let index = 0;
    const wrong: number[] = [];
    for (let end = FFT; end <= signal.length; end += hop) {
      const expected = index < melody.length ? [melody[index]] : [];
      for (const d of v.process(spectrum(signal, end), (end / SR) * 1000, expected)) {
        if (d.expected) index++;
        else wrong.push(d.midi);
      }
    }
    expect(wrong).toEqual([]);
    expect(index).toBe(melody.length);
  });
});
