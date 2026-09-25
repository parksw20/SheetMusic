import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import { BASIC_PITCH } from './onsets';

export interface Activations {
  /** [프레임][88건반] 타건 확률 */
  onsets: Float32Array;
  nFrames: number;
}

export type BasicPitchRunner = ((audio22k: Float32Array) => Promise<Activations>) & {
  /** 고른 계산 방식 (webgl, wasm, cpu) */
  backend: string;
};

/**
 * Spotify Basic Pitch 모델(TensorFlow.js)을 불러온다.
 * TensorFlow.js는 크기가 커서 마이크를 켤 때만 동적으로 불러온다.
 *
 * GPU(WebGL)와 WebAssembly로 한 번씩 돌려 보고 더 빠른 쪽을 쓴다.
 * (GPU가 약하거나 없는 기기에서는 WebAssembly가 10배 이상 빠르다)
 */
export async function loadBasicPitch(modelUrl: string): Promise<BasicPitchRunner> {
  const tf = await import('@tensorflow/tfjs-core');
  const { loadGraphModel } = await import('@tensorflow/tfjs-converter');
  await import('@tensorflow/tfjs-backend-cpu');
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
  try {
    await import('@tensorflow/tfjs-backend-webgl');
    candidates.push('webgl');
  } catch {
    // WebGL을 못 쓰는 환경
  }

  // 모델 가중치는 지금 켜진 계산 방식에 올라가므로, 불러오기 전에 하나를 초기화해 둔다
  for (const backend of [...candidates, 'cpu']) {
    try {
      if (await tf.setBackend(backend)) break;
    } catch {
      // 다음 후보
    }
  }
  await tf.ready();
  const model = await loadGraphModel(modelUrl);
  const { windowSamples, keys } = BASIC_PITCH;

  const execute = async (audio22k: Float32Array): Promise<Activations> => {
    if (audio22k.length !== windowSamples) throw new Error(`입력 길이는 ${windowSamples}이어야 합니다`);
    const onsetsTensor = tf.tidy(() => {
      const input = tf.tensor3d(audio22k, [1, windowSamples, 1]);
      return model.execute(input, 'Identity_2') as import('@tensorflow/tfjs-core').Tensor;
    });
    const onsets = (await onsetsTensor.data()) as Float32Array;
    const nFrames = onsetsTensor.shape[1] ?? onsets.length / keys;
    onsetsTensor.dispose();
    return { onsets, nFrames };
  };

  // 후보마다 두 번 돌려서(첫 번째는 준비 시간이 섞이므로 버림) 두 번째 시간을 잰다
  const silence = new Float32Array(windowSamples);
  let best = { backend: 'cpu', ms: Infinity };
  for (const backend of candidates) {
    try {
      if (!(await tf.setBackend(backend))) continue;
      await tf.ready();
      await execute(silence);
      const t0 = performance.now();
      await execute(silence);
      const ms = performance.now() - t0;
      if (ms < best.ms) best = { backend, ms };
    } catch (e) {
      console.warn(`${backend} 계산 방식을 쓸 수 없습니다`, e);
    }
  }
  await tf.setBackend(best.backend);
  await tf.ready();
  if (best.ms === Infinity) await execute(silence);

  return Object.assign(execute, { backend: best.backend });
}
