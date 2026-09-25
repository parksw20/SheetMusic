// 개발용: REPLAY_WAV=파일 REPLAY_STEPS='[[60],[62]]' npx vitest run src/input/replay.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { NoteVerifier, type Sensitivity } from './pitch';

const FFT = 8192;

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
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

function spectrum(x: Float32Array, end: number): Float32Array {
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT) + 0.08 * Math.cos((4 * Math.PI * i) / FFT);
    re[i] = (x[end - FFT + i] ?? 0) * w;
  }
  fft(re, im);
  const db = new Float32Array(FFT / 2);
  for (let k = 0; k < FFT / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / FFT + 1e-12);
  return db;
}

const wavPath = process.env.REPLAY_WAV;
it.skipIf(!wavPath)('replay', () => {
  const buf = readFileSync(wavPath!);
  const sr = buf.readUInt32LE(24);
  const n = (buf.length - 44) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;
  const steps: number[][] = JSON.parse(process.env.REPLAY_STEPS ?? '[]');
  const v = new NoteVerifier(sr, FFT, (process.env.REPLAY_SENS as Sensitivity) ?? 'normal');
  const lastOnset = () => (v as unknown as { lastOnset: number }).lastOnset;
  let index = 0;
  let hit: number[] = [];
  const log: string[] = [];
  let correct = 0, wrong = 0;
  const hop = Math.round(sr * 0.02);
  for (let end = FFT; end <= n; end += hop) {
    const t = (end / sr) * 1000;
    const expected = index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : [];
    const before = lastOnset();
    const res = v.process(spectrum(x, end), t, expected);
    if (lastOnset() !== before) log.push(`${t.toFixed(0)} onset (exp ${expected})`);
    for (const d of res) {
      log.push(`${t.toFixed(0)} ${d.expected ? 'HIT' : 'WRONG'} ${d.midi} (exp ${expected})`);
      if (d.expected) {
        correct++;
        hit.push(d.midi);
        if (steps[index].every((m) => hit.includes(m))) {
          index++;
          hit = [];
        }
      } else wrong++;
    }
  }
  log.push(`RESULT correct ${correct} wrong ${wrong} steps ${index}/${steps.length}`);
  writeFileSync(process.env.REPLAY_OUT ?? '/dev/stdout', log.join('\n') + '\n');
});
