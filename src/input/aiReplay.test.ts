// 개발용: 실제 녹음 WAV를 공식 basic-pitch-ts 인식 + 판정으로 재생해 본다 (실시간과 같은 방식으로 창을 겹쳐 실행)
// AI_REPLAY_WAV=파일 AI_REPLAY_STEPS='[[60],[62]]' npx vitest run src/input/aiReplay.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { BASIC_PITCH_INPUT_SAMPLES, BASIC_PITCH_SAMPLE_RATE, transcribeWith } from './basicPitch';
import { NoteTracker, OnsetJudge } from './onsets';
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
    const { BasicPitch } = await import('@spotify/basic-pitch');
    const json = JSON.parse(readFileSync('public/models/basic-pitch/model.json', 'utf8'));
    const weights = readFileSync('public/models/basic-pitch/group1-shard1of1.bin');
    const basicPitch = new BasicPitch(
      tf.loadGraphModel(
        tf.io.fromMemory({
          modelTopology: json.modelTopology,
          weightSpecs: json.weightsManifest[0].weights,
          weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
        }),
      ),
    );

    const buf = readFileSync(wavPath!);
    const sr = buf.readUInt32LE(24);
    const n = (buf.length - 44) / 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;

    const steps: number[][] = JSON.parse(process.env.AI_REPLAY_STEPS ?? '[]');
    const onsetThr = Number(process.env.AI_ONSET ?? 0.7);
    const wrongThr = Number(process.env.AI_WRONG ?? 0.5);
    const hop = Math.round((Number(process.env.AI_HOP ?? 150) / 1000) * sr);
    const need = Math.ceil((BASIC_PITCH_INPUT_SAMPLES / BASIC_PITCH_SAMPLE_RATE) * sr) + 2;
    const windowMs = (BASIC_PITCH_INPUT_SAMPLES / BASIC_PITCH_SAMPLE_RATE) * 1000;
    const tracker = new NoteTracker((need / sr) * 1000);
    const judge = new OnsetJudge(wrongThr);

    let index = 0;
    let hit: number[] = [];
    let correct = 0;
    let wrong = 0;
    const log: string[] = [];
    const expected = () => (index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : []);
    for (let end = need; end <= n; end += hop) {
      const audio = resampleTail(x.subarray(end - need, end), sr, BASIC_PITCH_SAMPLE_RATE, BASIC_PITCH_INPUT_SAMPLES);
      const nowMs = (end / sr) * 1000;
      const found = tracker.update(await transcribeWith(basicPitch, audio, onsetThr), nowMs - windowMs);
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
    log.push(`RESULT correct ${correct} wrong ${wrong} steps ${index}/${steps.length}`);
    writeFileSync(process.env.AI_REPLAY_OUT ?? '/dev/stdout', log.join('\n') + '\n');
  },
  600_000,
);
