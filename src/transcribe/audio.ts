import { preferPlayAndRecord } from '../audio/session';
import { acquireMicStream, releaseMicStream } from '../input/mic';

/** Basic Pitch 입력 샘플레이트 */
export const SAMPLE_RATE = 22050;
/** 한 번에 옮길 수 있는 최대 길이 (초). 길면 iPad에서 오래 걸리고 메모리를 많이 쓴다 */
export const MAX_SECONDS = 300;
/** 불러올 수 있는 음원 파일 길이 (초). 이 안에서 옮길 구간(최대 MAX_SECONDS)을 고른다 */
export const MAX_FILE_SECONDS = 1200;

/** 모노 소리를 22,050Hz로 바꾼다 (브라우저 내장 리샘플러) */
async function toMono22k(buffer: AudioBuffer, maxSeconds = MAX_SECONDS): Promise<Float32Array> {
  const seconds = Math.min(buffer.duration, maxSeconds);
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * SAMPLE_RATE)), SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination); // 여러 채널은 섞여서 모노가 된다
  src.start();
  const out = await offline.startRendering();
  return out.getChannelData(0);
}

/** 음원 파일(mp3, m4a, wav, 동영상 등)을 읽는다 */
export async function decodeFile(file: File): Promise<{ audio: Float32Array; seconds: number; trimmed: boolean }> {
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } catch {
    throw new Error('이 파일은 읽을 수 없어요. mp3, m4a, wav 파일을 써 보세요.');
  }
  const audio = await toMono22k(buffer, MAX_FILE_SECONDS);
  return { audio, seconds: audio.length / SAMPLE_RATE, trimmed: buffer.duration > MAX_FILE_SECONDS };
}

/** start~end초 구간만 잘라 낸다 (22,050Hz) */
export function sliceSeconds(audio: Float32Array, start: number, end: number): Float32Array {
  return audio.slice(Math.max(0, Math.floor(start * SAMPLE_RATE)), Math.min(audio.length, Math.ceil(end * SAMPLE_RATE)));
}

export interface Recorder {
  /** 녹음을 멈추고 22,050Hz 모노 소리를 돌려준다 */
  stop: () => Promise<Float32Array>;
  cancel: () => void;
}

/**
 * 마이크로 녹음한다 (유튜브 영상 소리를 스피커 → 마이크로 받는다).
 * 버튼 클릭 처리 안에서 불러야 iPad에서 동작한다.
 */
export async function startRecording(onLevel: (level: number) => void): Promise<Recorder> {
  preferPlayAndRecord();
  const ctx = new AudioContext();
  const resumed = ctx.resume().catch(() => undefined);
  const stream = await acquireMicStream();
  await resumed;
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  const chunks: Float32Array[] = [];
  let total = 0;
  node.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    if (total < ctx.sampleRate * (MAX_SECONDS + 5)) {
      chunks.push(new Float32Array(ch));
      total += ch.length;
    }
    let sum = 0;
    for (let i = 0; i < ch.length; i += 4) sum += ch[i] * ch[i];
    onLevel(Math.min(1, Math.max(0, (10 * Math.log10(sum / (ch.length / 4) + 1e-9) + 60) / 50)));
  };
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  const close = () => {
    node.disconnect();
    releaseMicStream(stream);
    void ctx.close();
  };
  return {
    cancel: close,
    stop: async () => {
      const sr = ctx.sampleRate;
      close();
      const buffer = new AudioBuffer({ length: Math.max(1, total), numberOfChannels: 1, sampleRate: sr });
      const data = buffer.getChannelData(0);
      let o = 0;
      for (const c of chunks) {
        data.set(c, o);
        o += c.length;
      }
      return toMono22k(buffer);
    },
  };
}
