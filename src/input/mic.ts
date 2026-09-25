import { preferPlayAndRecord, preferPlayback } from '../audio/session';
import { loadBasicPitch, type BasicPitchRunner } from './basicPitch';
import { BASIC_PITCH, OnsetExtractor, OnsetJudge } from './onsets';
import { NoteVerifier, type Sensitivity } from './pitch';
import { resampleTail } from './resample';
import type { NoteListener } from './types';

/**
 * loading: AI 모델을 불러오는 중 (그동안 기본 방식으로 판정)
 * warming: 모델 준비 완료, 소리를 2초 모으는 중
 * ai: AI(Basic Pitch)로 판정 중
 * basic: AI를 쓸 수 없어 기본(스펙트럼) 방식으로 판정 중
 */
export type MicStatus = 'loading' | 'warming' | 'ai' | 'basic';

export interface MicOptions {
  listener: NoteListener;
  /** 지금 쳐야 하는(아직 안 친) 음. 비어 있으면 판정하지 않는다 */
  getExpected: () => number[];
  /** 입력 크기 0~1 (레벨 표시용) */
  onLevel: (level: number) => void;
  onStatus: (status: MicStatus) => void;
  /** 확실하게 들린 음 (연습 중이 아닐 때도 알려 준다. 인식 확인용) */
  onHeard: (midi: number) => void;
  /** AI 추론 한 번에 걸린 시간 (ms, 이동 평균). 기기 성능 확인용 */
  onInferenceMs?: (ms: number, backend: string) => void;
  sensitivity: Sensitivity;
}

export interface MicSession {
  setSensitivity: (s: Sensitivity) => void;
  stop: () => void;
}

const FFT_SIZE = 8192; // 기본 방식: 48kHz에서 약 170ms 창
const BASIC_INTERVAL_MS = 20;
/** AI 판정 주기. 추론이 이보다 오래 걸리면 자연히 건너뛴다 */
const AI_INTERVAL_MS = 150;

/**
 * 감도별 AI 기준값: 쳐야 할 음은 너그럽게, 틀린 음은 엄격하게.
 * 실제 피아노 녹음에서 타건은 작게 쳐도 0.86 이상이었고, 방 잡음은 여러 건반에 0.5~0.6짜리 가짜 타건을 만든다.
 */
const AI_THRESHOLDS: Record<Sensitivity, { expected: number; wrong: number }> = {
  low: { expected: 0.8, wrong: 0.92 },
  normal: { expected: 0.7, wrong: 0.85 },
  high: { expected: 0.55, wrong: 0.8 },
};
/** 이 확률 이상이면 "들린 음"으로 화면에 보여 준다 */
const HEARD_THRESHOLD = 0.7;

const TAP_WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('sheetmusic-tap', Tap);
`;

export function isMicSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * 마이크로 피아노 소리를 듣고, 쳐야 할 음이 들리면 noteOn 이벤트를 보낸다.
 * 버튼 클릭 처리 안에서 호출해야 한다 (iOS는 사용자 동작 중에 만든 오디오만 허용).
 * HTTPS(또는 localhost)에서만 동작한다.
 */
export async function startMic(opts: MicOptions): Promise<MicSession> {
  // await 전에, 클릭 처리 안에서 동기적으로 오디오를 준비한다
  preferPlayAndRecord();
  const ctx = new AudioContext();
  const resumed = ctx.resume().catch(() => undefined);
  opts.onStatus('loading');
  const modelPromise = loadBasicPitch(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`).catch((e) => {
    console.warn('Basic Pitch 모델을 불러오지 못했습니다', e);
    return null;
  });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // 음성 통화용 처리를 끄지 않으면 지속음이 깎이고 음량이 출렁인다
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    void ctx.close();
    preferPlayback();
    throw e;
  }
  await resumed;

  const sr = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  // Safari는 출력(destination)까지 이어지지 않은 노드를 처리하지 않는다. 소리 없이(음량 0) 이어 둔다
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  analyser.connect(sink);

  // 최근 3초의 원본 소리
  const ring = new Float32Array(Math.ceil(sr * 3));
  let written = 0;
  const push = (chunk: Float32Array) => {
    for (let i = 0; i < chunk.length; i++) ring[(written + i) % ring.length] = chunk[i];
    written += chunk.length;
  };
  const recent = (count: number) => {
    const out = new Float32Array(count);
    const start = written - count;
    for (let i = 0; i < count; i++) {
      const j = start + i;
      if (j >= 0) out[i] = ring[j % ring.length];
    }
    return out;
  };

  let tapNode: AudioNode;
  try {
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'sheetmusic-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data);
    tapNode = node;
  } catch {
    // AudioWorklet이 없는 이전 브라우저
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
    tapNode = node;
  }
  source.connect(tapNode);
  tapNode.connect(sink);

  // ── 기본 방식 (스펙트럼): AI를 쓸 수 없을 때만 판정한다 ──
  // (실제 피아노 소리에서는 AI보다 오판정이 많아서, AI를 불러오는 몇 초 동안에는 판정하지 않는다)
  const basic = new NoteVerifier(sr, FFT_SIZE, opts.sensitivity);
  const timeData = new Float32Array(analyser.fftSize);
  let useBasic = false;
  const basicTimer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (let i = timeData.length - 2048; i < timeData.length; i++) sum += timeData[i] * timeData[i];
    const rms = Math.sqrt(sum / 2048);
    opts.onLevel(Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 50))); // -60dB~-10dB → 0~1
    if (!useBasic) return;

    const expected = opts.getExpected();
    const db = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(db);
    for (const d of basic.process(db, performance.now(), expected)) {
      if (expected.length === 0) continue;
      opts.listener({ type: 'on', midi: d.midi, velocity: 0.8, source: 'mic' });
    }
  }, BASIC_INTERVAL_MS);

  // ── AI 방식 (Basic Pitch) ──
  let thresholds = AI_THRESHOLDS[opts.sensitivity];
  const judge = new OnsetJudge(thresholds.wrong);
  let extractor: OnsetExtractor | null = null;
  let runner: BasicPitchRunner | null = null;
  let busy = false;
  let stopped = false;
  let avgMs = 0;
  const need = Math.ceil((BASIC_PITCH.windowSamples / BASIC_PITCH.sampleRate) * sr) + 2;

  void modelPromise.then((r) => {
    if (stopped) return;
    runner = r;
    useBasic = !r;
    opts.onStatus(r ? 'warming' : 'basic');
  });

  const aiTimer = window.setInterval(async () => {
    if (!runner || busy || written < need) return;
    busy = true;
    try {
      const endMs = (written / sr) * 1000;
      const audio = resampleTail(recent(need), sr, BASIC_PITCH.sampleRate, BASIC_PITCH.windowSamples);
      const t0 = performance.now();
      const { onsets, nFrames } = await runner(audio);
      if (stopped) return;
      const ms = performance.now() - t0;
      avgMs = avgMs ? avgMs * 0.8 + ms * 0.2 : ms;
      opts.onInferenceMs?.(avgMs, runner.backend);
      if (!extractor) {
        // 첫 창은 통째로 버린다 (마이크를 켜기 전의 0 구간, 켜는 순간의 잡음). 이후 새로 들어온 소리부터 판정한다
        extractor = new OnsetExtractor(thresholds.expected, undefined, endMs);
        opts.onStatus('ai');
        return;
      }
      const found = extractor.extract(onsets, nFrames, endMs);
      for (const o of found) if (o.prob >= HEARD_THRESHOLD) opts.onHeard(o.midi);
      judge.judgeBatch(found, opts.getExpected, (midi) =>
        opts.listener({ type: 'on', midi, velocity: 0.8, source: 'mic' }),
      );
    } catch (e) {
      console.warn('Basic Pitch 실행 오류, 기본 방식으로 바꿉니다', e);
      runner = null;
      useBasic = true;
      opts.onStatus('basic');
    } finally {
      busy = false;
    }
  }, AI_INTERVAL_MS);

  return {
    setSensitivity: (s) => {
      basic.setSensitivity(s);
      thresholds = AI_THRESHOLDS[s];
      extractor?.setThreshold(thresholds.expected);
      judge.setWrongThreshold(thresholds.wrong);
    },
    stop: () => {
      stopped = true;
      preferPlayback();
      window.clearInterval(basicTimer);
      window.clearInterval(aiTimer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      opts.onLevel(0);
    },
  };
}
