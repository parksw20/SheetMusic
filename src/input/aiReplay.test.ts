// 개발용: 실제 녹음 WAV를 Basic Pitch 판정으로 재생해 본다 (실시간과 같은 방식으로 창을 겹쳐 실행)
// AI_REPLAY_WAV=파일 AI_REPLAY_STEPS='[[60],[62]]' npx vitest run src/input/aiReplay.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { BASIC_PITCH, OnsetExtractor, OnsetJudge } from './onsets';
import { resampleTail } from './resample';

const wavPath = process.env.AI_REPLAY_WAV;

it.skipIf(!wavPath)(
  'ai replay',
  async () => {
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-cpu');
    const { loadGraphModel } = await import('@tensorflow/tfjs-converter');
    await tf.setBackend('cpu');
    const json = JSON.parse(readFileSync('public/models/basic-pitch/model.json', 'utf8'));
    const weights = readFileSync('public/models/basic-pitch/group1-shard1of1.bin');
    const model = await loadGraphModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
      }),
    );

    const buf = readFileSync(wavPath!);
    const sr = buf.readUInt32LE(24);
    const n = (buf.length - 44) / 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;

    const steps: number[][] = JSON.parse(process.env.AI_REPLAY_STEPS ?? '[]');
    const expThr = Number(process.env.AI_EXP ?? 0.5);
    const wrongThr = Number(process.env.AI_WRONG ?? 0.8);
    const hopMs = Number(process.env.AI_HOP ?? 150);
    const need = Math.ceil((BASIC_PITCH.windowSamples / BASIC_PITCH.sampleRate) * sr) + 2;
    const firstMs = (need / sr) * 1000;
    const extractor = new OnsetExtractor(expThr, Number(process.env.AI_EDGE ?? 18), firstMs - 2000 + 300);
    const judge = new OnsetJudge(wrongThr);

    let index = 0;
    let hit: number[] = [];
    let correct = 0,
      wrong = 0;
    const log: string[] = [];
    for (let end = need; end <= n; end += Math.round((hopMs / 1000) * sr)) {
      const slice = x.subarray(Math.max(0, end - need), end);
      const audio = resampleTail(slice, sr, BASIC_PITCH.sampleRate, BASIC_PITCH.windowSamples);
      const out = tf.tidy(() => model.execute(tf.tensor3d(audio, [1, BASIC_PITCH.windowSamples, 1]), 'Identity_2')) as import('@tensorflow/tfjs-core').Tensor;
      const onsets = (await out.data()) as Float32Array;
      const nFrames = out.shape[1]!;
      out.dispose();
      const nowMs = (end / sr) * 1000;
      const found = extractor.extract(onsets, nFrames, nowMs);
      const expectedNow = () => (index < steps.length ? steps[index].filter((m) => !hit.includes(m)) : []);
      for (const o of found) log.push(`${o.time.toFixed(0)} (+${(nowMs - o.time).toFixed(0)}ms) m${o.midi} p${o.prob.toFixed(2)}`);
      judge.judgeBatch(found, expectedNow, (midi, v) => {
        log.push(`  → ${v} ${midi} exp[${expectedNow()}]`);
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
