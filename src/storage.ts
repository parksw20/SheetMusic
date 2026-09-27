import type { Sensitivity } from './input/pitch';
import type { HandFilter } from './score/model';

/** 이 기기의 브라우저에만 저장한다. 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 무시한다 */
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const BEST_KEY = 'sheetmusic.bestStars';

/** 곡별 최고 별점. 키는 `${곡 키}#${손}` */
export function loadBestStars(): Record<string, number> {
  return load(BEST_KEY, {});
}

export function saveBestStars(value: Record<string, number>): void {
  save(BEST_KEY, value);
}

/** wait: 맞는 음을 칠 때까지 기다린다, rhythm: 템포대로 흐르며 박자까지 본다 */
export type PracticeStyle = 'wait' | 'rhythm';

export interface Settings {
  hand: HandFilter;
  practiceStyle: PracticeStyle;
  sensitivity: Sensitivity;
  /** 악보에 손가락 번호 보기 */
  fingering: boolean;
  /** 왼손 번호를 오른손처럼 낮은 음부터 1로 (도1·솔5). 기본은 표준(엄지 1, 도5·솔1) */
  mirrorLeftHand: boolean;
  /** 연습 중 다음에 칠 음 이름 보기 */
  showHint: boolean;
  /** 마이크가 들은 음 이름을 위쪽 마이크 표시에 보기 */
  showHeard: boolean;
  /** 마이크 진단 줄 보기 */
  showDiagnostics: boolean;
  /** MIDI 건반으로 친 음을 스피커로도 내기 */
  soundForMidi: boolean;
}

const SETTINGS_KEY = 'sheetmusic.settings';
const DEFAULT_SETTINGS: Settings = {
  hand: 'both',
  practiceStyle: 'wait',
  sensitivity: 'normal',
  fingering: true,
  mirrorLeftHand: false,
  showHint: true,
  showHeard: false,
  showDiagnostics: false,
  soundForMidi: false,
};

export function loadSettings(): Settings {
  const saved = load<Partial<Settings>>(SETTINGS_KEY, {});
  // 예전 버전(0.8 이하)은 감도를 따로 문자열로 저장했다
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem('sheetmusic.micSensitivity');
  } catch {
    // 무시
  }
  const sensitivity = legacy === 'low' || legacy === 'high' || legacy === 'normal' ? { sensitivity: legacy as Sensitivity } : {};
  return { ...DEFAULT_SETTINGS, ...sensitivity, ...saved };
}

export function saveSettings(value: Settings): void {
  save(SETTINGS_KEY, value);
}

const LEVEL_KEY = 'sheetmusic.level';

/** 마지막으로 고른 난이도 */
export function loadLevel(): number | null {
  return load<number | null>(LEVEL_KEY, null);
}

export function saveLevel(level: number): void {
  save(LEVEL_KEY, level);
}

/** 음원으로 만든 악보 (이 기기에만 저장) */
export interface MySong {
  id: string;
  title: string;
  createdAt: number;
  xml: string;
}

const MY_SONGS_KEY = 'sheetmusic.mySongs';

export function loadMySongs(): MySong[] {
  return load<MySong[]>(MY_SONGS_KEY, []);
}

/** 저장 공간이 모자라면 false */
export function saveMySongs(songs: MySong[]): boolean {
  return save(MY_SONGS_KEY, songs);
}
