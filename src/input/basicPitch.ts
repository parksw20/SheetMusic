import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import type { NoteEventTime } from '@spotify/basic-pitch';

/** 공식 basic-pitch-ts의 입력 샘플레이트 */
export const BASIC_PITCH_SAMPLE_RATE = 22050;
/** outputToNotesPoly 설정 (공식 기본값: frameThresh 0.3, minNoteLen 5프레임) */
const FRAME_THRESHOLD = 0.3;
const MIN_NOTE_FRAMES = 5;

/** 모델 입력 길이 (약 1.99초). 모델이 이 길이만 받는다 */
export const BASIC_PITCH_WINDOW = 43844;
const FFT_HOP = 256;
const KEYS = 88;
const MIDI_OFFSET = 21;
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
  if (audio.length !== BASIC_PITCH_WINDOW) throw new Error(`입력 길이는 ${BASIC_PITCH_WINDOW}이어야 합니다`);
  const [framesT, onsetsT] = tf.tidy(
    () => model.execute(tf.tensor3d(audio, [1, BASIC_PITCH_WINDOW, 1]), ['Identity_1', 'Identity_2']) as import('@tensorflow/tfjs').Tensor[],
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
  /** 22,050Hz 소리 한 창(BASIC_PITCH_WINDOW)을 분석한다 (시간은 창 시작 기준 초) */
  analyze: (audio22k: Float32Array, onsetThreshold: number) => Promise<Analysis>;
  /** 고른 계산 방식 (webgl, wasm, cpu) */
  backend: string;
}

/**
 * Spotify 공식 basic-pitch-ts(@spotify/basic-pitch)의 모델과 음 추출 함수로 음 인식기를 만든다.
 * TensorFlow.js는 크기가 커서 동적으로 불러온다. 앱에서는 Web Worker 안에서 돌린다 (aiWorker.ts).
 *
 * 계산 방식은 WebAssembly를 먼저 쓴다. iPad/iPhone의 WebGL은 16비트 부동소수로 계산해
 * 모델 결과가 틀어질 수 있고, 셰이더 준비에도 몇 초가 걸린다. WebAssembly를 못 쓸 때만 WebGL, CPU 순으로 쓴다.
 */
export async function createTranscriber(modelUrl: string): Promise<Transcriber> {
  const tf = await import('@tensorflow/tfjs');
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths({
      'tfjs-backend-wasm.wasm': wasmUrl,
      'tfjs-backend-wasm-simd.wasm': wasmSimdUrl,
      'tfjs-backend-wasm-threaded-simd.wasm': wasmThreadedUrl,
    });
  } catch {
    // WebAssembly 백엔드를 못 불러옴
  }

  let backend = '';
  for (const candidate of ['wasm', 'webgl', 'cpu']) {
    try {
      if (await tf.setBackend(candidate)) {
        await tf.ready();
        backend = candidate;
        break;
      }
    } catch {
      // 다음 후보
    }
  }
  if (!backend) throw new Error('TensorFlow.js 계산 방식을 하나도 쓸 수 없습니다');

  const model = await tf.loadGraphModel(modelUrl);
  const analyze = (audio22k: Float32Array, onsetThreshold: number) => analyzeWith(model, audio22k, onsetThreshold);
  // 첫 실행은 준비 시간이 들어가므로 미리 한 번 돌려 둔다
  await analyze(new Float32Array(BASIC_PITCH_WINDOW), 0.5);
  return { analyze, backend };
}
