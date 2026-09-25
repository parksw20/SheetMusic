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
 * TensorFlow.js는 크기가 커서 마이크를 켤 때만 동적으로 불러온다.
 *
 * 공식 코드는 TensorFlow.js의 기본 계산 방식(WebGL)을 쓰는데, GPU가 약하거나 없는 기기에서는
 * WebAssembly가 10배 이상 빠르다. 그래서 둘 다 돌려 보고 빠른 쪽을 고른다.
 */
export async function loadBasicPitch(modelUrl: string): Promise<Transcriber> {
  const tf = await import('@tensorflow/tfjs');
  const candidates: string[] = [];
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths({
      'tfjs-backend-wasm.wasm': wasmUrl,
      'tfjs-backend-wasm-simd.wasm': wasmSimdUrl,
      'tfjs-backend-wasm-threaded-simd.wasm': wasmThreadedUrl,
    });
    candidates.push('wasm');
  } catch {
    // WebAssembly를 못 쓰는 환경
  }
  candidates.push('webgl');

  // 모델 가중치는 지금 켜진 계산 방식에 올라가므로, 불러오기 전에 하나를 초기화해 둔다
  for (const backend of [...candidates, 'cpu']) {
    try {
      if (await tf.setBackend(backend)) break;
    } catch {
      // 다음 후보
    }
  }
  await tf.ready();

  const { BasicPitch } = await import('@spotify/basic-pitch');
  const basicPitch = new BasicPitch(tf.loadGraphModel(modelUrl));
  const transcribe = (audio22k: Float32Array, onsetThreshold: number) =>
    transcribeWith(basicPitch, audio22k, onsetThreshold);

  // 후보마다 두 번 돌려서(첫 번째는 준비 시간이 섞이므로 버림) 두 번째 시간을 잰다
  const silence = new Float32Array(BASIC_PITCH_INPUT_SAMPLES);
  let best = { backend: 'cpu', ms: Infinity };
  for (const backend of candidates) {
    try {
      if (!(await tf.setBackend(backend))) continue;
      await tf.ready();
      await transcribe(silence, 0.5);
      const t0 = performance.now();
      await transcribe(silence, 0.5);
      const ms = performance.now() - t0;
      if (ms < best.ms) best = { backend, ms };
    } catch (e) {
      console.warn(`${backend} 계산 방식을 쓸 수 없습니다`, e);
    }
  }
  await tf.setBackend(best.backend);
  await tf.ready();
  if (best.ms === Infinity) await transcribe(silence, 0.5);

  return { transcribe, backend: best.backend };
}
