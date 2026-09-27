/**
 * 피아노 소리인지 사람 목소리인지 가린다.
 *
 * 피아노 줄은 한 번 치면 음높이가 딱 고정되어 배음 주파수가 몇 센트(반음의 1/100)도 움직이지 않는다.
 * 말소리와 노래는 억양·떨림 때문에 같은 순간에도 음높이가 계속 미끄러진다.
 * 음이 시작된 뒤 0.03~0.18초 사이 네 순간에서 배음마다 정확한 주파수를 위상 차이(phase vocoder)로 재고,
 * 가장 또렷한 배음들이 얼마나 움직였는지 본다. 배음마다 따로 재므로 다른 건반과 같이 쳐도(화음) 된다.
 *
 * 녹음으로 잰 값: 피아노 0.7~6.4센트(화음 포함), 말소리 16~680센트.
 */

/** 이보다 음높이가 많이 움직이면(센트) 피아노가 아니다 */
export const MAX_DRIFT_CENTS = 12;
/** 배음 봉우리가 주변보다 이만큼 커야 또렷한 음으로 본다 (말소리의 숨소리·자음은 봉우리가 뭉툭하다) */
export const MIN_PROMINENCE = 4;
/** 음 시작부터 잴 순간들 (초) */
const TIMES = [0.03, 0.08, 0.13, 0.18];
const MAX_HARMONIC = 6;
const MAX_FREQ = 4000;

export interface Steadiness {
  /** 가장 또렷한 두 배음 중 덜 움직인 쪽의 움직임 (센트) */
  driftCents: number;
  /** 가장 또렷한 배음의 돌출도 (봉우리 / 주변 중앙값) */
  prominence: number;
}

/** 샘플레이트에 맞는 분석 길이: 약 0.09초 (2의 거듭제곱) */
export function frameSize(sampleRate: number): number {
  return 2 ** Math.round(Math.log2(sampleRate * 0.093));
}

/** 음 시작부터 이만큼(샘플)의 소리가 있어야 잴 수 있다 */
export function samplesNeeded(sampleRate: number): number {
  const n = frameSize(sampleRate);
  return Math.ceil(TIMES[TIMES.length - 1] * sampleRate) + n + n / 16;
}

/**
 * samples[0]이 음이 시작된 순간인 소리에서 midi 음의 흔들림을 잰다.
 * 소리가 모자라면 null.
 */
export function measureSteadiness(samples: Float32Array, sampleRate: number, midi: number): Steadiness | null {
  const n = frameSize(sampleRate);
  const hop = n / 16;
  if (samples.length < samplesNeeded(sampleRate)) return null;
  const window = hann(n);
  const spectra = TIMES.map((t) => {
    const i = Math.round(t * sampleRate);
    return [spectrum(samples, i, window), spectrum(samples, i + hop, window)] as const;
  });

  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const tracks: { cents: number[]; prominence: number }[] = [];
  for (let h = 1; h <= MAX_HARMONIC && f0 * h <= MAX_FREQ; h++) {
    const fh = f0 * h;
    const k0 = (fh * n) / sampleRate;
    const lo = Math.max(1, Math.min(Math.floor(k0 * 2 ** (-0.5 / 12)), Math.floor(k0) - 1));
    const hi = Math.min(n / 2 - 14, Math.max(Math.ceil(k0 * 2 ** (0.5 / 12)), Math.floor(k0) + 1));
    if (hi <= lo) continue;
    const cents: number[] = [];
    let prominence = Infinity;
    for (const [a, b] of spectra) {
      let k = lo;
      for (let j = lo + 1; j <= hi; j++) if (a.mag[j] > a.mag[k]) k = j;
      // 두 순간의 위상 차이 → 봉우리의 정확한 주파수
      let dphi = Math.atan2(b.im[k], b.re[k]) - Math.atan2(a.im[k], a.re[k]) - (2 * Math.PI * k * hop) / n;
      dphi -= 2 * Math.PI * Math.round(dphi / (2 * Math.PI));
      const f = ((k + (dphi * n) / (2 * Math.PI * hop)) * sampleRate) / n;
      cents.push(f > 0 ? 1200 * Math.log2(f / fh) : 1200);
      const around = Array.from(a.mag.subarray(Math.max(1, k - 12), k + 13)).sort((x, y) => x - y);
      prominence = Math.min(prominence, a.mag[k] / (around[around.length >> 1] + 1e-12));
    }
    tracks.push({ cents, prominence });
  }
  if (!tracks.length) return null;
  tracks.sort((a, b) => b.prominence - a.prominence);
  const drift = (c: number[]) => Math.max(...c) - Math.min(...c);
  return {
    driftCents: Math.min(...tracks.slice(0, 2).map((t) => drift(t.cents))),
    prominence: tracks[0].prominence,
  };
}

/** 피아노처럼 음높이가 고정된 또렷한 음이면 true */
export function isSteady(s: Steadiness): boolean {
  return s.driftCents <= MAX_DRIFT_CENTS && s.prominence >= MIN_PROMINENCE;
}

const hannCache = new Map<number, Float32Array>();
function hann(n: number): Float32Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

interface Spectrum {
  re: Float64Array;
  im: Float64Array;
  mag: Float64Array;
}

/** samples[start..start+n)에 창을 씌운 FFT (radix-2) */
function spectrum(samples: Float32Array, start: number, window: Float32Array): Spectrum {
  const n = window.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (samples[start + i] ?? 0) * window[i];
  // 비트 뒤집기
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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const half = n / 2 + 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { re, im, mag };
}
