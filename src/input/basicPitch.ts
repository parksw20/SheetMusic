import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import type { NoteEventTime } from '@spotify/basic-pitch';

/** 공식 basic-pitch-ts의 입력 샘플레이트 */
export const BASIC_PITCH_SAMPLE_RATE = 22050;
/** outputToNotesPoly 설정 (공식 기본값: frameThresh 0.3, minNoteLen 5프레임) */
const FRAME_THRESHOLD = 0.3;
const MIN_NOTE_FRAMES = 5;

const FFT_HOP = 256;
const KEYS = 88;
const MIDI_OFFSET = 21;
/** 공식 모델이 받는 입력 길이(약 1.99초)와 그때의 프레임 수 */
const OFFICIAL_WINDOW = 43844;
const OFFICIAL_FRAMES = 172;
/**
 * 실제로 쓰는 입력 길이 (약 1.5초). 모델은 합성곱으로만 되어 있어 입력 길이만 바꿔 불러오면
 * 가중치 그대로 짧은 소리를 분석한다 (loadShortModel). 계산량이 입력 길이에 비례해 약 25% 빠르다.
 * 더 줄일 수는 없다: 앞단(CQT)이 소리를 8번 절반으로 줄인 뒤 양쪽에 128칸 거울 여백을 붙이는데,
 * 그러려면 줄인 소리가 128칸보다 길어야 한다 (33092 / 256 ≈ 129).
 * 2초 창과 비교하면 판정에 쓰는 창 끝 구간의 타건 확률 차이는 0.02 이하였다.
 */
export const BASIC_PITCH_WINDOW = 33092;
/** 입력 길이에 따른 모델 출력 프레임 수 (43844 → 172, 33092 → 130) */
export const windowFrames = (samples: number) => Math.floor(samples / FFT_HOP) + 1;
/**
 * 창 앞뒤에서 확정하지 않는 프레임 수 (공식 evaluateModel과 같은 15프레임 = 약 0.17초).
 * 모델은 앞뒤 소리를 함께 보고 판단해서 창 가장자리는 덜 정확하다.
 */
const TRIM_FRAMES = 15;
/** 창 끝 구간에서 "막 시작된 음" 후보로 볼 최소 타건 확률 */
const EDGE_MIN_PROB = 0.3;

/** 창 끝(아직 확정 전) 구간에서 막 시작된 음 후보 */
export interface EdgeOnset {
  pitchMidi: number;
  /** 창 시작 기준 초 */
  startTimeSeconds: number;
  /** 타건 확률 */
  prob: number;
}

export interface Analysis {
  /** 확정된 음 (공식 outputToNotesPoly 결과, 창 시작 기준 초) */
  notes: NoteEventTime[];
  /** 창 끝 0.17초 안에서 막 시작된 음 후보. 쳐야 할 음을 빨리 확인하는 데 쓴다 */
  edge: EdgeOnset[];
}

type GraphModel = import('@tensorflow/tfjs').GraphModel;

/**
 * 공식 모델을 직접 실행하고, 음 추출은 공식 outputToNotesPoly/noteFramesToTime으로 한다.
 * 공식 evaluateModel은 쓰지 않는 음높이 곡선(contour) 계산과 텐서 변환 때문에 두 배쯤 느려서
 * (420ms → 200ms) 입력 준비와 가장자리 자르기만 직접 한다.
 */
export async function analyzeWith(model: GraphModel, audio: Float32Array, onsetThreshold: number): Promise<Analysis> {
  const tf = await import('@tensorflow/tfjs');
  const { outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');
  const [framesT, onsetsT] = tf.tidy(
    () => model.execute(tf.tensor3d(audio, [1, audio.length, 1]), ['Identity_1', 'Identity_2']) as import('@tensorflow/tfjs').Tensor[],
  );
  const [frames, onsets] = (await Promise.all([framesT.data(), onsetsT.data()])) as Float32Array[];
  const nFrames = framesT.shape[1] ?? frames.length / KEYS;
  framesT.dispose();
  onsetsT.dispose();

  const rows = (d: Float32Array, from: number, to: number) => {
    const out: number[][] = [];
    for (let f = from; f < to; f++) out.push(Array.from(d.subarray(f * KEYS, (f + 1) * KEYS)));
    return out;
  };
  const frameSec = FFT_HOP / BASIC_PITCH_SAMPLE_RATE;
  const last = nFrames - TRIM_FRAMES;
  const notes = noteFramesToTime(
    outputToNotesPoly(rows(frames, TRIM_FRAMES, last), rows(onsets, TRIM_FRAMES, last), onsetThreshold, FRAME_THRESHOLD, MIN_NOTE_FRAMES),
  ).map((n) => ({ ...n, startTimeSeconds: n.startTimeSeconds + TRIM_FRAMES * frameSec }));

  // 창 끝 구간: 건반마다 가장 높은 타건 봉우리 (마지막 프레임은 올라가는 중이면 후보)
  const best = new Map<number, EdgeOnset>();
  for (let f = last; f < nFrames; f++) {
    for (let k = 0; k < KEYS; k++) {
      const p = onsets[f * KEYS + k];
      if (p < EDGE_MIN_PROB || p < onsets[(f - 1) * KEYS + k]) continue;
      if (f + 1 < nFrames && p < onsets[(f + 1) * KEYS + k]) continue;
      const midi = k + MIDI_OFFSET;
      if ((best.get(midi)?.prob ?? 0) < p) best.set(midi, { pitchMidi: midi, startTimeSeconds: f * frameSec, prob: p });
    }
  }
  return { notes, edge: [...best.values()] };
}

export interface Transcriber {
  /** 22,050Hz 소리 한 창(window 샘플)을 분석한다 (시간은 창 시작 기준 초) */
  analyze: (audio22k: Float32Array, onsetThreshold: number) => Promise<Analysis>;
  /** 고른 계산 방식 (wasm, webgpu, webgl, cpu). wasm이 여러 스레드를 쓰면 'wasm×4'처럼 표시 */
  backend: string;
  /** 모델 입력 길이 (샘플 수, 22,050Hz) */
  window: number;
}

type Tf = typeof import('@tensorflow/tfjs');

/**
 * 공식 모델 파일을 입력 길이만 BASIC_PITCH_WINDOW로 바꿔 불러온다. 가중치는 건드리지 않는다.
 * 바꾸는 곳: 입력 자리(Placeholder)의 길이, 입력을 펴는 Reshape의 길이(43844),
 * 출력 3개(note, onset, contour)를 모양 잡는 Reshape의 프레임 수(172).
 * 모델 파일이 예상과 다르면(다른 버전 등) 오류를 내고, 그때는 공식 그대로(2초 창) 불러온다.
 */
export function shortModelArtifacts(
  json: any,
  bin: ArrayBuffer,
): import('@tensorflow/tfjs').io.ModelArtifacts {
  json = structuredClone(json);
  bin = bin.slice(0);
  const placeholder = json.modelTopology.node.find((n: { op: string }) => n.op === 'Placeholder');
  const dim = placeholder?.attr?.shape?.shape?.dim;
  if (dim?.[1]?.size !== String(OFFICIAL_WINDOW)) throw new Error('예상과 다른 모델 입력');
  dim[1].size = String(BASIC_PITCH_WINDOW);

  const manifest = json.weightsManifest[0];
  const view = new DataView(bin);
  let offset = 0;
  let patched = 0;
  for (const spec of manifest.weights as { name: string; shape: number[]; dtype: string; quantization?: unknown }[]) {
    if (spec.quantization || (spec.dtype !== 'float32' && spec.dtype !== 'int32')) throw new Error('예상과 다른 가중치 형식');
    const patch = (from: number, to: number) => {
      if (view.getInt32(offset, true) !== from) throw new Error(`예상과 다른 값: ${spec.name}`);
      view.setInt32(offset, to, true);
      patched++;
    };
    if (spec.name.endsWith('/flatten_audio_ch_1/reshape/Reshape/shape/1')) patch(OFFICIAL_WINDOW, BASIC_PITCH_WINDOW);
    else if (/\/(note|onset|contour)\/reshape_\d+\/Reshape\/shape\/1$/.test(spec.name)) patch(OFFICIAL_FRAMES, windowFrames(BASIC_PITCH_WINDOW));
    offset += spec.shape.reduce((x, y) => x * y, 1) * 4;
  }
  if (patched !== 4 || offset !== bin.byteLength) throw new Error('예상과 다른 모델 구조');
  return { modelTopology: json.modelTopology, weightSpecs: manifest.weights, weightData: bin };
}

async function loadShortModel(tf: Tf, modelUrl: string): Promise<GraphModel> {
  const absolute = new URL(modelUrl, location.href);
  const json = await (await fetch(absolute)).json();
  const bin = await (await fetch(new URL(json.weightsManifest[0].paths[0], absolute))).arrayBuffer();
  return tf.loadGraphModel(tf.io.fromMemory(shortModelArtifacts(json, bin)));
}

/** 백엔드 비교용 소리: 도·미·솔 화음을 창 가운데에서 친다 */
function testChord(samples: number): Float32Array {
  const x = new Float32Array(samples);
  const start = Math.floor(samples / 2);
  for (const f of [261.63, 329.63, 392]) {
    for (let i = start; i < samples; i++) {
      const t = (i - start) / BASIC_PITCH_SAMPLE_RATE;
      for (let h = 1; h <= 4; h++) x[i] += (0.1 / h) * Math.exp(-3 * t) * Math.sin(2 * Math.PI * f * h * t);
    }
  }
  return x;
}

interface Loaded {
  model: GraphModel;
  window: number;
}

async function loadModel(tf: Tf, modelUrl: string): Promise<Loaded> {
  try {
    return { model: await loadShortModel(tf, modelUrl), window: BASIC_PITCH_WINDOW };
  } catch (e) {
    console.warn('짧은 창으로 불러오지 못해 공식 그대로(2초 창) 불러옵니다', e);
    return { model: await tf.loadGraphModel(modelUrl), window: OFFICIAL_WINDOW };
  }
}

/** 한 번 준비 실행 후 3번 돌려 가운데 시간(ms)과 결과를 돌려준다 */
async function benchmark(loaded: Loaded) {
  const audio = testChord(loaded.window);
  await analyzeWith(loaded.model, audio, 0.5);
  const times: number[] = [];
  let result: Analysis | null = null;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    result = await analyzeWith(loaded.model, audio, 0.5);
    times.push(performance.now() - t0);
  }
  return { ms: times.sort((a, b) => a - b)[1], result: result! };
}

const sameNotes = (a: Analysis, b: Analysis) =>
  a.notes.length === b.notes.length &&
  a.notes.every((n, i) => n.pitchMidi === b.notes[i].pitchMidi && Math.abs(n.startTimeSeconds - b.notes[i].startTimeSeconds) < 0.03);

/**
 * Spotify 공식 basic-pitch-ts(@spotify/basic-pitch)의 모델과 음 추출 함수로 음 인식기를 만든다.
 * TensorFlow.js는 크기가 커서 동적으로 불러온다. 앱에서는 Web Worker 안에서 돌린다 (aiWorker.ts).
 *
 * 계산 방식:
 *  - WebAssembly를 기본으로 쓴다. 페이지가 교차 출처 격리(coi-serviceworker) 상태면 여러 스레드로 돈다.
 *  - WebGPU가 있으면 한 번 재 보고, WebAssembly와 같은 음을 찾으면서 더 빠를 때만 WebGPU를 쓴다.
 *  - iPad/iPhone의 WebGL은 16비트 부동소수로 계산해 결과가 틀어질 수 있어 WebAssembly를 못 쓸 때만 쓴다.
 */
export async function createTranscriber(modelUrl: string): Promise<Transcriber> {
  const tf = await import('@tensorflow/tfjs');
  let wasmThreads = () => 1;
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths({
      'tfjs-backend-wasm.wasm': wasmUrl,
      'tfjs-backend-wasm-simd.wasm': wasmSimdUrl,
      'tfjs-backend-wasm-threaded-simd.wasm': wasmThreadedUrl,
    });
    // 여러 스레드는 교차 출처 격리 상태에서만 켜진다. 스레드 수는 tfjs가 코어 수의 절반(최대 4)으로 정한다
    // (보조 스레드 묶음 크기가 빌드에 그렇게 고정돼 있다). iPad Pro 12.9 4세대(8코어)는 4개
    wasmThreads = () => wasm.getThreadsCount();
  } catch {
    // WebAssembly 백엔드를 못 불러옴
  }
  const use = async (name: string) => {
    try {
      if (!(await tf.setBackend(name))) return false;
      await tf.ready();
      return true;
    } catch {
      return false;
    }
  };
  const label = (name: string) => (name === 'wasm' && wasmThreads() > 1 ? `wasm×${wasmThreads()}` : name);
  const done = (name: string, loaded: Loaded): Transcriber => ({
    analyze: (audio22k, onsetThreshold) => analyzeWith(loaded.model, audio22k, onsetThreshold),
    backend: label(name),
    window: loaded.window,
  });

  if (await use('wasm')) {
    const wasm = await loadModel(tf, modelUrl);
    const base = await benchmark(wasm);
    // WebGPU는 쓸 수 있는 GPU(어댑터)가 있을 때만 재 본다
    const gpu = (globalThis.navigator as (Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }) | undefined)?.gpu;
    if (gpu && (await gpu.requestAdapter().catch(() => null))) {
      let other: Loaded | null = null;
      try {
        await import('@tensorflow/tfjs-backend-webgpu');
        if (await use('webgpu')) {
          other = await loadModel(tf, modelUrl);
          const trial = await benchmark(other);
          console.info(`AI 계산 방식 비교: wasm ${base.ms.toFixed(0)}ms, webgpu ${trial.ms.toFixed(0)}ms`);
          if (other.window === wasm.window && sameNotes(base.result, trial.result) && trial.ms < base.ms * 0.9) {
            wasm.model.dispose();
            return done('webgpu', other);
          }
        }
      } catch (e) {
        console.warn('WebGPU를 쓸 수 없습니다', e);
      }
      other?.model.dispose();
      await use('wasm');
    }
    return done('wasm', wasm);
  }

  for (const name of ['webgl', 'cpu']) {
    if (!(await use(name))) continue;
    const loaded = await loadModel(tf, modelUrl);
    // 첫 실행은 준비 시간이 들어가므로 미리 한 번 돌려 둔다
    await analyzeWith(loaded.model, new Float32Array(loaded.window), 0.5);
    return done(name, loaded);
  }
  throw new Error('TensorFlow.js 계산 방식을 하나도 쓸 수 없습니다');
}
