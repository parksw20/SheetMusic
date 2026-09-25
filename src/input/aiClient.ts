import type { WorkerRequest, WorkerResponse } from './aiWorker';
import { createTranscriber, type Transcriber } from './basicPitch';
import type { TranscribedNote } from './onsets';

export interface AiTranscriber {
  transcribe: (audio22k: Float32Array, onsetThreshold: number) => Promise<TranscribedNote[]>;
  /** 계산 방식 (wasm, webgl, cpu). Web Worker에서 돌면 앞에 'worker/'가 붙는다 */
  backend: string;
}

let loading: Promise<AiTranscriber> | null = null;

/**
 * AI 인식기를 한 번만 불러온다. 앱을 열 때 미리 불러 두면 마이크를 켤 때 기다리지 않는다.
 * Web Worker에서 돌리고, Worker를 못 쓰면 메인 스레드에서 돌린다. 실패하면 다음 호출에서 다시 시도한다.
 */
export function preloadAi(modelUrl: string): Promise<AiTranscriber> {
  // Worker는 스크립트 위치 기준으로 주소를 풀기 때문에 절대 주소로 넘긴다
  const absolute = new URL(modelUrl, location.href).href;
  loading ??= loadInWorker(absolute)
    .catch((e) => {
      console.warn('Web Worker에서 AI를 불러오지 못해 메인 스레드에서 돌립니다', e);
      return createTranscriber(absolute).then(toAi);
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

function toAi(t: Transcriber): AiTranscriber {
  return { transcribe: t.transcribe, backend: t.backend };
}

function loadInWorker(modelUrl: string): Promise<AiTranscriber> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    const pending = new Map<number, { resolve: (n: TranscribedNote[]) => void; reject: (e: Error) => void }>();
    let nextId = 1;
    let ready = false;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'ready') {
        ready = true;
        resolve({
          backend: `worker/${m.backend}`,
          transcribe: (audio, onsetThreshold) =>
            new Promise((res, rej) => {
              const id = nextId++;
              pending.set(id, { resolve: res, reject: rej });
              const msg: WorkerRequest = { type: 'run', id, audio, onsetThreshold };
              worker.postMessage(msg, [audio.buffer]);
            }),
        });
      } else if (m.type === 'result') {
        pending.get(m.id)?.resolve(m.notes);
        pending.delete(m.id);
      } else if (m.id !== undefined) {
        pending.get(m.id)?.reject(new Error(m.message));
        pending.delete(m.id);
      } else if (!ready) {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      if (!ready) {
        worker.terminate();
        reject(new Error(e.message || 'Web Worker 오류'));
      }
    };
    const load: WorkerRequest = { type: 'load', modelUrl };
    worker.postMessage(load);
  });
}
