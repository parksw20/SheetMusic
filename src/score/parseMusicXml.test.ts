import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSteps, filterByHand, midiToName } from './model';
import { parseMusicXml } from './parseMusicXml';

const song = (file: string) => readFileSync(`public/songs/${file}`, 'utf8');

const wrap = (measures: string) => `<?xml version="1.0"?>
<score-partwise><work><work-title>T</work-title></work><part id="P1">${measures}</part></score-partwise>`;

describe('parseMusicXml', () => {
  it('제목, 템포, 음을 읽는다', () => {
    const score = parseMusicXml(song('twinkle.musicxml'));
    expect(score.title).toContain('작은 별');
    expect(score.bpm).toBe(90);
    expect(score.timeSignature).toBe('4/4');
    expect(score.totalBeats).toBe(48);
    const rh = filterByHand(score.notes, 'right').slice(0, 4).map((n) => midiToName(n.midi));
    expect(rh).toEqual(['C4', 'C4', 'G4', 'G4']);
  });

  it('backup으로 왼손을 같은 마디 시작에 맞춘다', () => {
    const score = parseMusicXml(song('twinkle.musicxml'));
    const first = buildSteps(score.notes)[0];
    expect(first.startBeat).toBe(0);
    expect(first.notes.map((n) => midiToName(n.midi))).toEqual(['C3', 'C4']);
  });

  it('점음표와 8분음표 위치를 계산한다', () => {
    const score = parseMusicXml(song('ode-to-joy.musicxml'));
    const m4 = filterByHand(score.notes, 'right').filter((n) => n.measure === 4);
    expect(m4.map((n) => [midiToName(n.midi), n.startBeat, n.durationBeats])).toEqual([
      ['E4', 12, 1.5],
      ['D4', 13.5, 0.5],
      ['D4', 14, 2],
    ]);
  });

  it('화음과 임시표를 처리한다', () => {
    const score = parseMusicXml(
      wrap(`<measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
        <note><chord/><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration></note>
        <note><rest/><duration>1</duration></note>
        <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration></note>
      </measure>`),
    );
    expect(score.notes.map((n) => [midiToName(n.midi), n.startBeat])).toEqual([
      ['C4', 0],
      ['F#4', 0],
      ['A#3', 3],
    ]);
  });

  it('붙임줄로 이어진 음은 하나로 합친다', () => {
    const score = parseMusicXml(
      wrap(`<measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><rest/><duration>3</duration></note>
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/></note>
      </measure><measure number="2">
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note>
        <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration></note>
      </measure>`),
    );
    expect(score.notes.map((n) => [midiToName(n.midi), n.startBeat, n.durationBeats])).toEqual([
      ['G4', 3, 3],
      ['A4', 6, 2],
    ]);
  });
});
