import type { MySong } from './storage';
import { CURRENT } from './version';

/**
 * 곡 목록과 악보 파일 주소. GitHub Pages는 브라우저가 파일을 10분까지 그대로 쓰게 해서,
 * 새로 배포해도 예전 곡 목록이 보일 수 있다. 빌드마다 다른 값을 붙여 항상 이번 배포의 파일을 받는다.
 */
const songUrl = (name: string) => `${import.meta.env.BASE_URL}songs/${name}?v=${CURRENT.commit}`;

export interface SongEntry {
  /** 곡을 구분하는 키 (내장 곡은 파일 이름, 내 악보는 'my:' + id) */
  key: string;
  title: string;
  composer: string;
  /** 1 입문, 2 초급, 3 중급, 0 내 악보 */
  level: number;
  levelName: string;
  /** 내장 곡 파일 (public/songs/) */
  file?: string;
  /** 내 악보는 MusicXML을 바로 들고 있다 */
  xml?: string;
}

export const MY_LEVEL = 0;
export const MY_LEVEL_NAME = '내 악보';

interface IndexEntry {
  file: string;
  title: string;
  composer: string;
  level: number;
  levelName: string;
}

export async function fetchBuiltinSongs(): Promise<SongEntry[]> {
  const r = await fetch(songUrl('index.json'), { cache: 'no-cache' });
  const list = (await r.json()) as IndexEntry[];
  return list.map((s) => ({ ...s, key: s.file }));
}

export function mySongEntries(songs: MySong[]): SongEntry[] {
  return songs.map((s) => ({
    key: `my:${s.id}`,
    title: s.title,
    composer: '음원으로 만든 악보',
    level: MY_LEVEL,
    levelName: MY_LEVEL_NAME,
    xml: s.xml,
  }));
}

export async function loadSongXml(song: SongEntry): Promise<string> {
  if (song.xml) return song.xml;
  const r = await fetch(songUrl(song.file!));
  if (!r.ok) throw new Error('악보를 불러오지 못했습니다.');
  return r.text();
}

/** 곡 제목에서 괄호 속 원제를 떼어 카드에 짧게 보여 준다 */
export function splitTitle(title: string): { main: string; sub: string } {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(title);
  return m ? { main: m[1], sub: m[2] } : { main: title, sub: '' };
}
