const BEST_KEY = 'sheetmusic.bestStars';

/** 곡별 최고 별점. 키는 `${곡 파일}#${손}` */
export function loadBestStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveBestStars(value: Record<string, number>): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(value));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 무시
  }
}

const ZOOM_KEY = 'sheetmusic.zoom';
/** iPad 가로 화면에서 멀리서도 잘 보이는 기본 배율 */
const DEFAULT_ZOOM = 1.4;

export function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z > 0 ? z : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function saveZoom(value: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(value));
  } catch {
    // 무시
  }
}
