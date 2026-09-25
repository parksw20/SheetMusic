import { NoteVerifier, type Sensitivity } from './pitch';
import type { NoteListener } from './types';

export interface MicSession {
  setSensitivity: (s: Sensitivity) => void;
  stop: () => void;
}

const FFT_SIZE = 8192; // 48kHz에서 약 170ms 창, 주파수 해상도 약 5.9Hz
const INTERVAL_MS = 20;

export function isMicSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * 마이크로 피아노 소리를 듣고, 기대 음이 들리면 noteOn 이벤트를 보낸다.
 * getExpected는 지금 쳐야 하는(아직 안 친) 음 목록을 돌려준다. 비어 있으면 판정하지 않는다.
 * onLevel은 입력 크기(0~1)를 알려준다. 레벨 표시용.
 *
 * 사용자 동작(버튼 클릭) 안에서 호출해야 하고, HTTPS(또는 localhost)에서만 동작한다.
 */
export async function startMic(
  listener: NoteListener,
  getExpected: () => number[],
  onLevel: (level: number) => void,
  sensitivity: Sensitivity,
): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // 음성 통화용 처리를 끄지 않으면 지속음이 깎이고 음량이 출렁인다
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const verifier = new NoteVerifier(ctx.sampleRate, FFT_SIZE, sensitivity);
  const time = new Float32Array(analyser.fftSize);

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (let i = time.length - 2048; i < time.length; i++) sum += time[i] * time[i];
    const rms = Math.sqrt(sum / 2048);
    onLevel(Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 50))); // -60dB~-10dB → 0~1

    const expected = getExpected();
    const db = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(db);
    for (const d of verifier.process(db, performance.now(), expected)) {
      if (expected.length === 0) continue; // 연습 중이 아닐 때는 보고하지 않는다
      listener({ type: 'on', midi: d.midi, velocity: 0.8, source: 'mic' });
    }
  }, INTERVAL_MS);

  return {
    setSensitivity: (s) => verifier.setSensitivity(s),
    stop: () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      onLevel(0);
    },
  };
}
