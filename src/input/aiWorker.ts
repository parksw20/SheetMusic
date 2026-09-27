/// <reference lib="webworker" />
// Basic Pitch 인식을 메인 스레드 밖에서 돌린다.
// 한 번 분석에 수백 ms가 걸려서, 메인 스레드에서 돌리면 화면이 굳고 ScriptProcessor 수집이 끊긴다.
import { createTranscriber, type EdgeOnset, type FullNote, type Transcriber } from './basicPitch';

export type WorkerRequest =
  | { type: 'load'; modelUrl: string }
  | { type: 'run'; id: number; audio: Float32Array; onsetThreshold: number }
  | { type: 'transcribe'; id: number; audio: Float32Array };

export type WorkerResponse =
  | { type: 'ready'; backend: string; window: number }
  | { type: 'error'; message: string; id?: number }
  | { type: 'progress'; id: number; percent: number }
  | { type: 'transcribed'; id: number; notes: FullNote[] }
  | { type: 'result'; id: number; notes: { pitchMidi: number; startTimeSeconds: number; amplitude: number }[]; edge: EdgeOnset[] };

let transcriber: Promise<Transcriber> | null = null;
const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      transcriber ??= createTranscriber(m.modelUrl);
      const t = await transcriber;
      post({ type: 'ready', backend: t.backend, window: t.window });
    } catch (err) {
      transcriber = null;
      post({ type: 'error', message: String(err) });
    }
    return;
  }
  try {
    if (!transcriber) throw new Error('모델을 먼저 불러와야 합니다');
    if (m.type === 'transcribe') {
      const notes = await (await transcriber).transcribe(m.audio, (percent) => post({ type: 'progress', id: m.id, percent }));
      post({ type: 'transcribed', id: m.id, notes });
      return;
    }
    const { notes, edge } = await (await transcriber).analyze(m.audio, m.onsetThreshold);
    post({
      type: 'result',
      id: m.id,
      notes: notes.map(({ pitchMidi, startTimeSeconds, amplitude }) => ({ pitchMidi, startTimeSeconds, amplitude })),
      edge,
    });
  } catch (err) {
    post({ type: 'error', message: String(err), id: m.id });
  }
};
