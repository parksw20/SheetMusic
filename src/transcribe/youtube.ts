/** 유튜브 주소에서 영상 ID를 뽑는다 (watch?v=, youtu.be/, shorts/, embed/ 형식) */
export function parseYouTubeId(url: string): string | null {
  const text = url.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const u = new URL(text);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {
    // 주소가 아님
  }
  return null;
}

/** "1:23", "83", "1:02:03" → 초 */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 유튜브 IFrame Player API에서 쓰는 부분 */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void; onError?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
}

let api: Promise<YTNamespace> | null = null;

/** 유튜브 공식 IFrame Player API를 불러온다 */
export function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as Window & { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  api ??= new Promise((resolve, reject) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null;
      reject(new Error('유튜브에 연결하지 못했어요.'));
    };
    document.head.appendChild(script);
  });
  return api;
}

/** 주소에 nocoi가 있으면 교차 출처 격리를 끈 "유튜브 모드" 페이지 (public/coi-serviceworker.js 참고) */
export const YOUTUBE_MODE_HASH = '#transcribe-youtube';

export function youtubeModeUrl(): string {
  return `${location.pathname}?nocoi=1${YOUTUBE_MODE_HASH}`;
}

/** 유튜브 영상은 교차 출처 격리된 페이지에 넣을 수 없다 */
export function canEmbedYouTube(): boolean {
  return !self.crossOriginIsolated;
}
