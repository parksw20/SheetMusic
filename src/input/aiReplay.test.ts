// 개발용: 실제 녹음 WAV를 공식 basic-pitch-ts 인식 + 판정으로 재생해 본다 (실시간과 같은 방식으로 창을 겹쳐 실행)
// AI_REPLAY_WAV=파일 AI_REPLAY_STEPS='[[60],[62]]' npx vitest run src/input/aiReplay.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { analyzeWith, BASIC_PITCH_SAMPLE_RATE, BASIC_PITCH_WINDOW, shortModelArtifacts } from './basicPitch';
import { LEVEL_BLOCK_MS, LevelGate, NoteTracker, OnsetJudge, withFastNotes } from './onsets';
import { isSteady, measureSteadiness, samplesNeeded } from './steadiness';
import { resampleTail } from './resample';

const wavPath = process.env.AI_REPLAY_WAV;

it.skipIf(!wavPath)(
  'ai replay',
  async () => {
    const tf = await import('@tensorflow/tfjs');
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(process.cwd() + '/node_modules/@tensorflow/tfjs-backend-wasm/dist/');
    await tf.setBackend('wasm');
    await tf.ready();
    const json = JSON.parse(readFileSync('public/models/basic-pitch/model.json', 'utf8'));
    const weights = readFileSync('public/models/basic-pitch/group1-shard1of1.bin');
    const model = await tf.loadGraphModel(
      tf.io.fromMemory(shortModelArtifacts(json, weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength))),
    );

    const buf = readFileSync(wavPath!);
    const sr = buf.readUInt32LE(24);
    const n = (buf.length - 44) / 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;

    const steps: number[][] = JSON.parse(process.env.AI_REPLAY_STEPS ?? '[]');
    const onsetThr = Number(process.env.AI_ONSET ?? 0.7);
    const wrongThr = Number(process.env.AI_WRONG ?? 0.5);
    const fastThr = Number(process.env.AI_FAST ?? onsetThr);
    // 실시간에서는 추론이 끝나자마자 다음 추론을 하므로, 간격 = 기기의 추론 시간
    const hop = Math.round((Number(process.env.AI_HOP ?? 200) / 1000) * sr);
    const need = Math.ceil((BASIC_PITCH_WINDOW / BASIC_PITCH_SAMPLE_RATE) * sr) + 2;
    const windowMs = (BASIC_PITCH_WINDOW / BASIC_PITCH_SAMPLE_RATE) * 1000;
    const tracker = new NoteTracker((need / sr) * 1000);
    const gate = new LevelGate();
    const blk = Math.round((sr * LEVEL_BLOCK_MS) / 1000);
    let gated = 0;
    for (let b = blk; b <= n; b += blk) {
      if (b < need) {
        let e = 0;
        for (let i = b - blk; i < b; i++) e += x[i] * x[i];
        gate.add((b / sr) * 1000, 10 * Math.log10(e / blk + 1e-12));
      }
    }
    let written = 0;
    const span = samplesNeeded(sr);
    const judge = new OnsetJudge(
      wrongThr,
      process.env.AI_NO_STEADY
        ? undefined
        : (o) => {
            const from = Math.round((o.time / 1000) * sr);
            if (from + span > written) return null;
            const st = measureSteadiness(x.subarray(from, from + span), sr, o.midi);
            if (st) log.push(`  steady? m${o.midi} @${o.time.toFixed(0)} drift ${st.driftCents.toFixed(1)}c prom ${st.prominence.toFixed(1)}`);
            return st ? isSteady(st) : true;
          },
    );

    let index = 0;
    let hit: number[] = [];
    let correct = 0;
    let wrong = 0;
    const log: string[] = [];
    const expected = () => (index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : []);
    for (let end = need; end <= n; end += hop) {
      const audio = resampleTail(x.subarray(end - need, end), sr, BASIC_PITCH_SAMPLE_RATE, BASIC_PITCH_WINDOW);
      const nowMs = (end / sr) * 1000;
      written = end;
      const { notes, edge } = await analyzeWith(model, audio, onsetThr);
      // 실시간과 같게: 지금(end)까지의 소리 크기만 안다
      for (let b = Math.floor((end - hop) / blk) * blk + blk; b <= end; b += blk) {
        if (b < need || b - blk < 0) continue;
        let e = 0;
        for (let i = b - blk; i < b; i++) e += x[i] * x[i];
        gate.add((b / sr) * 1000, 10 * Math.log10(e / blk + 1e-12));
      }
      const all = tracker.update(withFastNotes(notes, edge, expected(), fastThr), nowMs - windowMs);
      const found = all.filter((o) => gate.allows(o.time));
      for (const o of all) if (!found.includes(o)) { gated++; log.push(`${o.time.toFixed(0)} m${o.midi} a${o.confidence.toFixed(2)} (소음 크기라 버림)`); }
      for (const o of found) log.push(`${o.time.toFixed(0)} (+${(nowMs - o.time).toFixed(0)}ms) m${o.midi} a${o.confidence.toFixed(2)}`);
      judge.judgeBatch(found, expected, (midi, v, o) => {
        log.push(`  → ${v} ${midi} a${o.confidence.toFixed(2)} @${o.time.toFixed(0)} exp[${expected()}]`);
        if (v === 'hit') {
          correct++;
          hit.push(midi);
          if (steps[index].every((m) => hit.includes(m))) {
            index++;
            hit = [];
          }
        } else wrong++;
      });
    }
    log.push(`RESULT correct ${correct} wrong ${wrong} steps ${index}/${steps.length} gated ${gated}`);
    writeFileSync(process.env.AI_REPLAY_OUT ?? '/dev/stdout', log.join('\n') + '\n');
  },
  600_000,
);
