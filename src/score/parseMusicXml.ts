import type { NoteEvent, Score, Staff } from './model';

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function childText(el: Element, tag: string): string | undefined {
  for (const c of Array.from(el.children)) {
    if (c.tagName === tag) return c.textContent ?? undefined;
  }
  return undefined;
}

function hasChild(el: Element, tag: string): boolean {
  return Array.from(el.children).some((c) => c.tagName === tag);
}

/**
 * MusicXML(score-partwise)에서 연주할 음 목록을 뽑는다.
 * 첫 번째 파트만 사용하며, 붙임줄로 이어진 음은 하나로 합친다.
 */
export function parseMusicXml(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('MusicXML을 읽을 수 없습니다.');
  }

  const title =
    doc.querySelector('work > work-title')?.textContent ??
    doc.querySelector('movement-title')?.textContent ??
    '제목 없음';
  const composer = doc.querySelector('identification > creator[type="composer"]')?.textContent ?? '';
  const time = doc.querySelector('part attributes time');
  const beats = time?.querySelector('beats')?.textContent;
  const beatType = time?.querySelector('beat-type')?.textContent;
  const timeSignature = beats && beatType ? `${beats}/${beatType}` : '';
  const part = doc.querySelector('part');
  if (!part) throw new Error('MusicXML에 part가 없습니다.');

  let divisions = 1;
  let bpm = 0;
  let measureStart = 0; // 4분음표 단위
  const notes: NoteEvent[] = [];
  // 붙임줄이 시작된 음: key = `${staff}:${midi}`
  const openTies = new Map<string, NoteEvent>();

  Array.from(part.getElementsByTagName('measure')).forEach((measure, measureIndex) => {
    let cursor = 0; // 마디 안 위치 (divisions 단위)
    let maxCursor = 0;
    let lastNoteStart = 0;

    for (const el of Array.from(measure.children)) {
      switch (el.tagName) {
        case 'attributes': {
          const d = childText(el, 'divisions');
          if (d) divisions = Number(d);
          break;
        }
        case 'direction':
        case 'sound': {
          const sound = el.tagName === 'sound' ? el : el.querySelector('sound');
          const tempo = sound?.getAttribute('tempo');
          if (tempo && !bpm) bpm = Number(tempo);
          break;
        }
        case 'backup':
          cursor -= Number(childText(el, 'duration') ?? 0);
          break;
        case 'forward':
          cursor += Number(childText(el, 'duration') ?? 0);
          maxCursor = Math.max(maxCursor, cursor);
          break;
        case 'note': {
          if (hasChild(el, 'grace')) break; // 꾸밈음은 MVP에서 제외
          const duration = Number(childText(el, 'duration') ?? 0);
          const isChord = hasChild(el, 'chord');
          const start = isChord ? lastNoteStart : cursor;
          if (!isChord) {
            lastNoteStart = cursor;
            cursor += duration;
            maxCursor = Math.max(maxCursor, cursor);
          }

          const pitch = Array.from(el.children).find((c) => c.tagName === 'pitch');
          if (!pitch) break; // 쉼표

          const step = childText(pitch, 'step') ?? 'C';
          const alter = Number(childText(pitch, 'alter') ?? 0);
          const octave = Number(childText(pitch, 'octave') ?? 4);
          const midi = (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
          const staff = (Number(childText(el, 'staff') ?? 1) === 2 ? 2 : 1) as Staff;
          const ties = Array.from(el.children).filter((c) => c.tagName === 'tie');
          const tieStop = ties.some((t) => t.getAttribute('type') === 'stop');
          const tieStart = ties.some((t) => t.getAttribute('type') === 'start');
          const key = `${staff}:${midi}`;

          const startBeat = measureStart + start / divisions;
          const durationBeats = duration / divisions;
          const open = openTies.get(key);

          if (tieStop && open) {
            open.durationBeats = startBeat + durationBeats - open.startBeat;
            if (!tieStart) openTies.delete(key);
            break;
          }

          const note: NoteEvent = {
            id: notes.length,
            midi,
            startBeat,
            durationBeats,
            staff,
            measure: measureIndex + 1,
          };
          notes.push(note);
          if (tieStart) openTies.set(key, note);
          break;
        }
      }
    }
    measureStart += maxCursor / divisions;
  });

  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  notes.forEach((n, i) => (n.id = i));

  return { title, composer, bpm: bpm || 100, timeSignature, notes, totalBeats: measureStart };
}
