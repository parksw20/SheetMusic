import { describe, expect, it } from 'vitest';
import { songXml } from '../score/buildMusicXml';
import { parseMusicXml } from '../score/parseMusicXml';
import { estimateKey, estimateTempo, notesToSong, type DetectedNote } from './quantize';

const note = (pitchMidi: number, start: number, dur: number, amplitude = 0.6): DetectedNote => ({
  pitchMidi,
  startTimeSeconds: start,
  durationSeconds: dur,
  amplitude,
});

/** 120BPM(4분음표 0.5초)으로 친 도레미파솔 + 왼손 도 */
function scale(offset = 0.37, jitter = 0.02): DetectedNote[] {
  const rh = [60, 62, 64, 65, 67, 65, 64, 62, 60].map((p, i) => note(p, offset + i * 0.5 + (i % 2 ? jitter : -jitter), 0.45));
  return [...rh, note(48, offset, 1.9), note(43, offset + 2, 1.9)];
}

describe('estimateTempo', () => {
  it('4분음표 간격 0.5초면 120BPM (배수인 60·240이 아니라)', () => {
    expect(estimateTempo(scale())).toBeGreaterThanOrEqual(116);
    expect(estimateTempo(scale())).toBeLessThanOrEqual(124);
  });
});

describe('estimateKey', () => {
  it('파와 시b가 많으면 F장조(플랫 1개)', () => {
    const f = [65, 67, 69, 70, 72, 70, 69, 67, 65].map((p, i) => note(p, i * 0.5, 0.4));
    expect(estimateKey(f)).toBe(-1);
  });
});

describe('notesToSong', () => {
  it('첫 음을 첫 박에 두고 16분음표 격자에 맞춰 양손 악보를 만든다', () => {
    const { song, bpm } = notesToSong(scale(), '테스트', 120);
    expect(bpm).toBe(120);
    expect(song.measures[0].rh).toBe('C4:q D4:q E4:q F4:q');
    expect(song.measures[1].rh).toBe('G4:q F4:q E4:q D4:q');
    expect(song.measures[0].lh).toBe('C3:w');
    expect(song.measures[2].rh).toBe('C4:q r:q r:h');
  });

  it('만든 곡은 MusicXML로 바뀌고 다시 읽으면 같은 음이 나온다', () => {
    const { song } = notesToSong(scale(), '테스트', 120);
    const score = parseMusicXml(songXml(song));
    expect(score.notes.filter((n) => n.staff === 1).map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60]);
    expect(score.notes.filter((n) => n.staff === 2).map((n) => n.midi)).toEqual([48, 43]);
  });

  it('약한 잡음 음은 뺀다', () => {
    const { noteCount } = notesToSong([...scale(), note(90, 1.1, 0.2, 0.05)], '테스트', 120);
    expect(noteCount).toBe(11);
  });

  it('8분음표 격자(기본): 16분음표 차이로 붙은 두 타건은 센 쪽만 남긴다', () => {
    // 120BPM, 16분음표 = 0.125초
    const notes = [note(60, 0, 0.45), note(64, 0.375, 0.5, 0.7), note(62, 0.5, 0.4, 0.3), note(65, 1, 0.45), note(67, 1.5, 0.45)];
    expect(notesToSong(notes, '테스트', 120).song.measures[0].rh).toBe('C4:q E4:q F4:q G4:q');
    expect(notesToSong(notes, '테스트', 120, undefined, 4, { grid: 16 }).song.measures[0].rh).toBe('C4:e. E4:s D4:q F4:q G4:q');
  });

  it('멜로디+베이스: 오른손은 맨 위, 왼손은 맨 아래 음만', () => {
    const notes = [note(60, 0, 1.9), note(64, 0, 1.9), note(67, 0, 1.9), note(48, 0, 1.9), note(55, 0, 1.9)];
    const { song } = notesToSong(notes, '테스트', 120, undefined, 4, { simplify: true });
    expect(song.measures[0].rh).toBe('G4:w');
    expect(song.measures[0].lh).toBe('C3:w');
  });

  it('음높이가 흔들리는 소리(목소리)는 뺀다', () => {
    const { noteCount } = notesToSong([...scale(), { ...note(72, 1.1, 0.4), wobble: 1.2 }], '테스트', 120);
    expect(noteCount).toBe(11);
  });
});
