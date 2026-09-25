import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import type { BasicPitch, NoteEventTime } from '@spotify/basic-pitch';

/** 공식 basic-pitch-ts의 입력 샘플레이트 */
export const BASIC_PITCH_SAMPLE_RATE = 22050;
/**
 * 한 번에 넣는 소리 길이 (약 1.81초).
 * evaluateModel은 앞에 3,840샘플의 0을 붙여 43,844샘플 창으로 자르므로, 이 길이면 모델을 한 번만 돌린다.
 * 결과는 창 앞뒤 15프레임(부정확한 부분)을 잘라 낸 뒤 돌려준다.
 */
export const BASIC_PITCH_INPUT_SAMPLES = 43844 - 3840;

/** outputToNotesPoly 설정 (공식 기본값: frameThresh 0.3, minNoteLen 5프레임) */
const FRAME_THRESHOLD = 0.3;
const MIN_NOTE_FRAMES = 5;

/**
 * 공식 API 그대로: evaluateModel로 모델을 돌리고, outputToNotesPoly → noteFramesToTime으로 음 목록을 만든다.
 */
export async function transcribeWith(
  basicPitch: BasicPitch,
  audio22k: Float32Array,
  onsetThreshold: number,
): Promise<NoteEventTime[]> {
  const { outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await basicPitch.evaluateModel(
    audio22k,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    () => {},
  );
  return noteFramesToTime(outputToNotesPoly(frames, onsets, onsetThreshold, FRAME_THRESHOLD, MIN_NOTE_FRAMES));
}

export interface Transcriber {
  /** 22,050Hz 소리를 음 목록으로 바꾼다 (시간은 입력 시작 기준 초) */
  transcribe: (audio22k: Float32Array, onsetThreshold: number) => Promise<NoteEventTime[]>;
  /** 고른 계산 방식 (webgl, wasm, cpu) */
  backend: string;
}

/**
 * Spotify 공식 basic-pitch-ts(@spotify/basic-pitch)로 음 인식기를 만든다.
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

  const { BasicPitch } = await import('@spotify/basic-pitch');
  const basicPitch = new BasicPitch(tf.loadGraphModel(modelUrl));
  const transcribe = (audio22k: Float32Array, onsetThreshold: number) =>
    transcribeWith(basicPitch, audio22k, onsetThreshold);
  // 첫 실행은 준비 시간이 들어가므로 미리 한 번 돌려 둔다
  await transcribe(new Float32Array(BASIC_PITCH_INPUT_SAMPLES), 0.5);
  return { transcribe, backend };
}
