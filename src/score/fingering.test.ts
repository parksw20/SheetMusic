import { describe, expect, it } from 'vitest';
import { mirrorLeftFingering } from './fingering';

const note = (staff: number, finger: number) =>
  `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>${staff}</staff><notations><technical><fingering placement="below">${finger}</fingering></technical></notations></note>`;

describe('mirrorLeftFingering', () => {
  it('왼손 번호만 뒤집는다 (도5·솔1 → 도1·솔5)', () => {
    const xml = note(1, 1) + note(2, 5) + note(2, 1) + note(2, 3);
    const out = mirrorLeftFingering(xml);
    expect([...out.matchAll(/>(\d)<\/fingering>/g)].map((m) => m[1])).toEqual(['1', '1', '5', '3']);
  });
});
