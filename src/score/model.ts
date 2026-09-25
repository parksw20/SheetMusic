/** 1 = 오른손(높은음자리 보표), 2 = 왼손(낮은음자리 보표) */
export type Staff = 1 | 2;

export interface NoteEvent {
  id: number;
  /** MIDI 노트 번호 (가운데 도 C4 = 60) */
  midi: number;
  /** 곡 시작부터의 위치, 4분음표 단위 */
  startBeat: number;
  durationBeats: number;
  staff: Staff;
  measure: number;
}

/** 같은 시점에 함께 쳐야 하는 음들의 묶음 */
export interface Step {
  startBeat: number;
  notes: NoteEvent[];
}

export interface Score {
  title: string;
  composer: string;
  bpm: number;
  notes: NoteEvent[];
  totalBeats: number;
}

export type HandFilter = 'both' | 'right' | 'left';

export function filterByHand(notes: NoteEvent[], hand: HandFilter): NoteEvent[] {
  if (hand === 'both') return notes;
  const staff: Staff = hand === 'right' ? 1 : 2;
  return notes.filter((n) => n.staff === staff);
}

/** 시작 시점이 같은 음들을 하나의 Step으로 묶는다 */
export function buildSteps(notes: NoteEvent[]): Step[] {
  const byStart = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const key = Math.round(n.startBeat * 1000) / 1000;
    const group = byStart.get(key);
    if (group) group.push(n);
    else byStart.set(key, [n]);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startBeat, group]) => ({ startBeat, notes: group.sort((a, b) => a.midi - b.midi) }));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToSolfege(midi: number): string {
  return SOLFEGE[midi % 12];
}

export function isBlackKey(midi: number): boolean {
  return NOTE_NAMES[midi % 12].includes('#');
}
