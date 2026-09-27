import type { WorkerRequest, WorkerResponse } from './aiWorker';
import { createTranscriber, type EdgeOnset, type FullNote, type Transcriber } from './basicPitch';
import type { TranscribedNote } from './onsets';

export interface AiAnalysis {
  notes: TranscribedNote[];
  edge: EdgeOnset[];
}

export interface AiTranscriber {
  /** 22,050Hz 소리 한 창(window 샘플)을 분석한다. audio는 Worker로 넘겨서 이후에 쓸 수 없다 */
  analyze: (audio22k: Float32Array, onsetThreshold: number) => Promise<AiAnalysis>;
  /** Web Worker에서 돌면 true (메인 스레드를 막지 않아 쉬지 않고 돌려도 된다) */
  inWorker: boolean;
  /** 계산 방식 (wasm, webgl, cpu). Web Worker에서 돌면 앞에 'worker/'가 붙는다 */
  backend: string;
  /** 모델 입력 길이 (샘플 수, 22,050Hz) */
  window: number;
  /** 긴 음원 전체를 악보용으로 옮긴다. audio는 Worker로 넘겨서 이후에 쓸 수 없다 */
  transcribe: (audio22k: Float32Array, onProgress: (percent: number) => void) => Promise<FullNote[]>;
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
  return { analyze: t.analyze, transcribe: t.transcribe, backend: t.backend, window: t.window, inWorker: false };
}

interface Pending {
  resolve: (value: never) => void;
  reject: (e: Error) => void;
  progress?: (percent: number) => void;
}

function loadInWorker(modelUrl: string): Promise<AiTranscriber> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    const pending = new Map<number, Pending>();
    let nextId = 1;
    let ready = false;
    const request = <T>(msg: WorkerRequest & { id: number }, transfer: Transferable[], progress?: (p: number) => void) =>
      new Promise<T>((res, rej) => {
        pending.set(msg.id, { resolve: res as (v: never) => void, reject: rej, progress });
        worker.postMessage(msg, transfer);
      });

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'ready') {
        ready = true;
        resolve({
          backend: `worker/${m.backend}`,
          window: m.window,
          inWorker: true,
          analyze: (audio, onsetThreshold) =>
            request<AiAnalysis>({ type: 'run', id: nextId++, audio, onsetThreshold }, [audio.buffer]),
          transcribe: (audio, onProgress) =>
            request<FullNote[]>({ type: 'transcribe', id: nextId++, audio }, [audio.buffer], onProgress),
        });
      } else if (m.type === 'progress') {
        pending.get(m.id)?.progress?.(m.percent);
      } else if (m.type === 'result') {
        pending.get(m.id)?.resolve({ notes: m.notes, edge: m.edge } as never);
        pending.delete(m.id);
      } else if (m.type === 'transcribed') {
        pending.get(m.id)?.resolve(m.notes as never);
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
