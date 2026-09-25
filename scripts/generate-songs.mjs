// 간단한 텍스트 표기법으로 적은 곡을 MusicXML(피아노 큰보표)로 변환한다.
// 사용법: npm run songs
//
// 토큰 형식: <음>:<길이>
//   음    : C4, F#4, Bb3, 화음은 C4+E4+G4, 쉼표는 r
//   길이  : w(온음표) h(2분) q(4분) e(8분) s(16분), 뒤에 '.'을 붙이면 점음표 (h.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIVISIONS = 4; // 4분음표 하나 = 4 divisions
const TYPES = { w: ['whole', 16], h: ['half', 8], q: ['quarter', 4], e: ['eighth', 2], s: ['16th', 1] };

const SONGS = [
  {
    file: 'c-position.musicxml',
    title: '도레미 연습 (오른손)',
    composer: '연습곡',
    tempo: 80,
    measures: [
      { rh: 'C4:q D4:q E4:q F4:q', lh: 'r:w' },
      { rh: 'G4:q F4:q E4:q D4:q', lh: 'r:w' },
      { rh: 'C4:q E4:q G4:q E4:q', lh: 'r:w' },
      { rh: 'C4:w', lh: 'r:w' },
    ],
  },
  {
    file: 'twinkle.musicxml',
    title: '작은 별 (Twinkle Twinkle Little Star)',
    composer: '프랑스 민요',
    tempo: 90,
    measures: [
      { rh: 'C4:q C4:q G4:q G4:q', lh: 'C3:w' },
      { rh: 'A4:q A4:q G4:h', lh: 'F3:h C3:h' },
      { rh: 'F4:q F4:q E4:q E4:q', lh: 'F3:h C3:h' },
      { rh: 'D4:q D4:q C4:h', lh: 'G3:h C3:h' },
      { rh: 'G4:q G4:q F4:q F4:q', lh: 'C3:h F3:h' },
      { rh: 'E4:q E4:q D4:h', lh: 'C3:h G3:h' },
      { rh: 'G4:q G4:q F4:q F4:q', lh: 'C3:h F3:h' },
      { rh: 'E4:q E4:q D4:h', lh: 'C3:h G3:h' },
      { rh: 'C4:q C4:q G4:q G4:q', lh: 'C3:w' },
      { rh: 'A4:q A4:q G4:h', lh: 'F3:h C3:h' },
      { rh: 'F4:q F4:q E4:q E4:q', lh: 'F3:h C3:h' },
      { rh: 'D4:q D4:q C4:h', lh: 'G3:h C3+E3:h' },
    ],
  },
  {
    file: 'ode-to-joy.musicxml',
    title: '환희의 송가 (Ode to Joy)',
    composer: 'L. v. Beethoven',
    tempo: 100,
    measures: [
      { rh: 'E4:q E4:q F4:q G4:q', lh: 'C3:w' },
      { rh: 'G4:q F4:q E4:q D4:q', lh: 'G2:w' },
      { rh: 'C4:q C4:q D4:q E4:q', lh: 'C3:w' },
      { rh: 'E4:q. D4:e D4:h', lh: 'G2:w' },
      { rh: 'E4:q E4:q F4:q G4:q', lh: 'C3:w' },
      { rh: 'G4:q F4:q E4:q D4:q', lh: 'G2:w' },
      { rh: 'C4:q C4:q D4:q E4:q', lh: 'C3:w' },
      { rh: 'D4:q. C4:e C4:h', lh: 'G2:h C3:h' },
    ],
  },
];

function parsePitch(text) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(text);
  if (!m) throw new Error(`잘못된 음 표기: ${text}`);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { step: m[1], alter, octave: Number(m[3]) };
}

function noteXml(token, staff, voice) {
  const [pitchPart, durPart] = token.split(':');
  const dotted = durPart.endsWith('.');
  const [type, base] = TYPES[dotted ? durPart.slice(0, -1) : durPart] ?? [];
  if (!type) throw new Error(`잘못된 길이 표기: ${token}`);
  const duration = dotted ? base * 1.5 : base;
  const tail = `<duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff>`;

  if (pitchPart === 'r') {
    const whole = durPart === 'w' ? ' measure="yes"' : '';
    return { xml: `<note><rest${whole}/>${tail}</note>`, duration };
  }
  const xml = pitchPart
    .split('+')
    .map((p, i) => {
      const { step, alter, octave } = parsePitch(p);
      const alterXml = alter ? `<alter>${alter}</alter>` : '';
      return `<note>${i > 0 ? '<chord/>' : ''}<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>${tail}</note>`;
    })
    .join('');
  return { xml, duration };
}

function staffXml(line, staff, voice) {
  let total = 0;
  const xml = line
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const n = noteXml(tok, staff, voice);
      total += n.duration;
      return n.xml;
    })
    .join('');
  return { xml, total };
}

function songXml(song) {
  const measures = song.measures
    .map((m, i) => {
      const rh = staffXml(m.rh, 1, 1);
      const lh = staffXml(m.lh, 2, 5);
      if (rh.total !== lh.total) throw new Error(`${song.title} ${i + 1}마디: 양손 길이가 다름`);
      const attrs =
        i === 0
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` +
            `<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
            `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` +
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${song.tempo}</per-minute></metronome></direction-type><sound tempo="${song.tempo}"/></direction>`
          : '';
      return `<measure number="${i + 1}">${attrs}${rh.xml}<backup><duration>${rh.total}</duration></backup>${lh.xml}</measure>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${song.title}</work-title></work>
<identification><creator type="composer">${song.composer}</creator></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${measures}
</part>
</score-partwise>
`;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'songs');
mkdirSync(outDir, { recursive: true });
for (const song of SONGS) {
  writeFileSync(join(outDir, song.file), songXml(song));
}
writeFileSync(
  join(outDir, 'index.json'),
  JSON.stringify(
    SONGS.map((s) => ({ file: s.file, title: s.title, composer: s.composer })),
    null,
    2,
  ) + '\n',
);
console.log(`${SONGS.length}곡 생성 완료 → ${outDir}`);
