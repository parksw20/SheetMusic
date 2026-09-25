/**
 * iOS/iPadOS는 무음 모드(벨소리 끔)일 때 Web Audio 소리를 막는다.
 * 오디오 세션을 '재생' 종류로 바꾸면 무음 모드에서도 소리가 난다.
 * 사용자 동작(클릭) 안에서 동기적으로 호출해야 한다.
 */

type AudioSessionType = 'auto' | 'playback' | 'play-and-record' | 'ambient' | 'transient' | 'transient-solo';
interface AudioSession {
  type: AudioSessionType;
}

function session(): AudioSession | undefined {
  return (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
}

let silentElement: HTMLAudioElement | null = null;

/** 0.1초 길이의 무음 WAV */
function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** 재생용 세션으로 바꾼다. 마이크를 쓰는 중이면 건드리지 않는다. */
export function preferPlayback(): void {
  const s = session();
  if (s) {
    if (s.type !== 'play-and-record') s.type = 'playback';
    return;
  }
  // audioSession이 없는 이전 iOS: <audio> 요소를 재생하면 세션이 '재생'으로 바뀐다
  if (!silentElement && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    silentElement = new Audio(silentWavUrl());
    silentElement.loop = true;
    silentElement.setAttribute('playsinline', '');
    void silentElement.play().catch(() => {
      silentElement = null;
    });
  }
}

/** 마이크를 켤 때: 녹음과 재생을 함께 하는 세션 (이 종류도 무음 모드에서 소리가 난다) */
export function preferPlayAndRecord(): void {
  const s = session();
  if (s) s.type = 'play-and-record';
}
