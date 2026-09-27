// 중급: 양손 모두 움직임, 16분음표, 조표 여러 개, 3/8·12/8박자. 모두 저작권이 끝난 곡이다.
const rep = (n, s) => Array(n).fill(s).join(' ');
const alberti = (low, high, mid) => `${low}:e ${high}:e ${mid}:e ${high}:e`;

const ODE_A = ['E4:q E4:q F4:q G4:q', 'G4:q F4:q E4:q D4:q', 'C4:q C4:q D4:q E4:q'];
const ODE_C = alberti('C3', 'G3', 'E3');
const ODE_G = alberti('B2', 'G3', 'D3');

const ELISE_TURN = 'E5:s D#5:s E5:s B4:s D5:s C5:s';
const ELISE_A = { rh: 'A4:e r:s C4:s E4:s A4:s', lh: 'A2:s E3:s A3:s r:e.' };
const ELISE_E = { rh: 'B4:e r:s E4:s G#4:s B4:s', lh: 'E2:s E3:s G#3:s r:e.' };
const ELISE_PHRASE = [
  { rh: ELISE_TURN, lh: 'r:q.' },
  ELISE_A,
  ELISE_E,
  { rh: 'C5:e r:s E4:s E5:s D#5:s', lh: 'A2:s E3:s A3:s r:e.' },
  { rh: ELISE_TURN, lh: 'r:q.' },
  ELISE_A,
  { rh: 'B4:e r:s E4:s C5:s B4:s', lh: 'E2:s E3:s G#3:s r:e.' },
];

const CANON_BASS = ['D3:h A2:h', 'B2:h F#2:h', 'G2:h D2:h', 'G2:h A2:h'];
const canon = (rh) => rh.map((r, i) => ({ rh: r, lh: CANON_BASS[i] }));
const CANON_HALVES = ['F#5:h E5:h', 'D5:h C#5:h', 'B4:h A4:h', 'B4:h C#5:h'];

/**
 * 바흐 프렐류드 원곡 한 마디: 왼손 두 음(n1, n2), 오른손 세 음(n3~n5)을 두 번.
 * 16분음표가 빽빽해 한 줄 4마디에 들어가도록 원곡 한 마디를 2/4박자 두 마디로 나눠 적는다.
 */
const prelude = (n1, n2, n3, n4, n5) => {
  const half = { rh: `r:e ${n3}:s ${n4}:s ${n5}:s ${n3}:s ${n4}:s ${n5}:s`, lh: `${n1}+${n2}:h` };
  return [half, half];
};

const oct = (low, high) => rep(4, `${low}:e ${high}:e`);
const KORO = [
  { rh: 'E5:q B4:e C5:e D5:q C5:e B4:e', lh: oct('E2', 'E3') },
  { rh: 'A4:q A4:e C5:e E5:q D5:e C5:e', lh: oct('A2', 'A3') },
  { rh: 'B4:q. C5:e D5:q E5:q', lh: oct('E2', 'E3') },
  { rh: 'C5:q A4:q A4:h', lh: 'A2:e A3:e A2:e A3:e A2:h' },
  { rh: 'r:e D5:q F5:e A5:q G5:e F5:e', lh: oct('D2', 'D3') },
  { rh: 'E5:q. C5:e E5:q D5:e C5:e', lh: oct('C2', 'C3') },
  { rh: 'B4:q B4:e C5:e D5:q E5:q', lh: oct('E2', 'E3') },
  { rh: 'C5:q A4:q A4:h', lh: 'A2:e A3:e A2:e A3:e A2:h' },
];

const KING = (o) => {
  const up = (n) => n.replace(/(\d)/, (d) => String(Number(d) + o));
  const line = (s) => s.split(' ').map((t) => { const [p, d] = t.split(':'); return `${up(p)}:${d}`; }).join(' ');
  return [
    { rh: line('B3:e C#4:e D4:e E4:e F#4:e D4:e F#4:q'), lh: 'B2:q F#3:q B2:q F#3:q' },
    { rh: line('E#4:e C#4:e E#4:q E4:e C4:e E4:q'), lh: 'C#3:q G#3:q C3:q G3:q' },
    { rh: line('B3:e C#4:e D4:e E4:e F#4:e D4:e F#4:e B4:e'), lh: 'B2:q F#3:q B2:q F#3:q' },
    { rh: line('A4:e F#4:e D4:e F#4:e A4:h'), lh: 'D3:q A3:q D3:q A3:q' },
  ];
};

const MOTIF = 'Bb4:q A4:e Bb4:e G4:q';
const BELL_BASS = ['G2:h.', 'F2:h.', 'Eb2:h.', 'D2:h.'];

export const LEVEL3 = [
  {
    file: 'ode-to-joy-full.musicxml',
    title: '환희의 송가 (전곡, 양손)',
    composer: 'L. v. Beethoven',
    tempo: 100,
    measures: [
      ...ODE_A.map((rh, i) => ({ rh, lh: [ODE_C + ' ' + ODE_C, ODE_G + ' ' + ODE_G, ODE_C + ' ' + ODE_C][i] })),
      { rh: 'E4:q. D4:e D4:h', lh: ODE_G + ' ' + ODE_G },
      ...ODE_A.map((rh, i) => ({ rh, lh: [ODE_C + ' ' + ODE_C, ODE_G + ' ' + ODE_G, ODE_C + ' ' + ODE_C][i] })),
      { rh: 'D4:q. C4:e C4:h', lh: ODE_G + ' C3:h' },
      { rh: 'D4:q D4:q E4:q C4:q', lh: ODE_G + ' ' + ODE_C },
      { rh: 'D4:q E4:e F4:e E4:q C4:q', lh: ODE_G + ' ' + ODE_C },
      { rh: 'D4:q E4:e F4:e E4:q D4:q', lh: ODE_G + ' ' + ODE_G },
      { rh: 'C4:q D4:q G3:h', lh: ODE_C + ' G2:h' },
      ...ODE_A.map((rh, i) => ({ rh, lh: [ODE_C + ' ' + ODE_C, ODE_G + ' ' + ODE_G, ODE_C + ' ' + ODE_C][i] })),
      { rh: 'D4:q. C4:e C4:h', lh: ODE_G + ' C3+E3+G3:h' },
    ],
  },
  {
    file: 'korobeiniki.musicxml',
    title: '코로베이니키 (Korobeiniki)',
    composer: '러시아 민요',
    tempo: 120,
    measures: [...KORO, ...KORO.slice(0, 7), { rh: 'C5:q A4:q A4:h', lh: 'A2:e A3:e A2:e A3:e A2+E3+A3:h' }],
  },
  {
    file: 'carol-of-the-bells.musicxml',
    title: '종소리 캐럴 (Shchedryk, Carol of the Bells)',
    composer: 'M. Leontovych',
    tempo: 110,
    key: -2,
    time: [3, 4],
    measures: [
      ...[0, 1, 2, 3, 0, 1, 2, 3].map((i) => ({ rh: MOTIF, lh: BELL_BASS[i] })),
      ...[0, 1, 2, 3].map((i) => ({ rh: 'D5:q C5:e D5:e Bb4:q', lh: BELL_BASS[i] })),
      ...[0, 1, 2, 3].map((i) => ({ rh: MOTIF, lh: BELL_BASS[i] })),
      { rh: 'G4:h.', lh: 'G2+D3:h.' },
    ],
  },
  {
    file: 'greensleeves.musicxml',
    title: '그린슬리브스 (Greensleeves)',
    composer: '영국 민요',
    tempo: 90,
    time: [3, 4],
    measures: [
      { rh: 'r:h A4:q', lh: 'r:h.' },
      { rh: 'C5:h D5:q', lh: 'A2:h.' },
      { rh: 'E5:q. F5:e E5:q', lh: 'A2:h.' },
      { rh: 'D5:h B4:q', lh: 'G2:h.' },
      { rh: 'G4:q. A4:e B4:q', lh: 'G2:h.' },
      { rh: 'C5:h A4:q', lh: 'A2:h.' },
      { rh: 'A4:q. G#4:e A4:q', lh: 'A2:h.' },
      { rh: 'B4:h G#4:q', lh: 'E2:h.' },
      { rh: 'E4:h A4:q', lh: 'E2:h.' },
      { rh: 'C5:h D5:q', lh: 'A2:h.' },
      { rh: 'E5:q. F5:e E5:q', lh: 'A2:h.' },
      { rh: 'D5:h B4:q', lh: 'G2:h.' },
      { rh: 'G4:q. A4:e B4:q', lh: 'G2:h.' },
      { rh: 'C5:q. B4:e A4:q', lh: 'A2:h.' },
      { rh: 'G#4:q. F#4:e G#4:q', lh: 'E2:h.' },
      { rh: 'A4:h.', lh: 'A2:h.' },
      { rh: 'G5:h.', lh: 'C3:h.' },
      { rh: 'G5:q. F#5:e E5:q', lh: 'C3:h.' },
      { rh: 'D5:h B4:q', lh: 'G2:h.' },
      { rh: 'G4:q. A4:e B4:q', lh: 'G2:h.' },
      { rh: 'C5:h A4:q', lh: 'A2:h.' },
      { rh: 'A4:q. G#4:e A4:q', lh: 'A2:h.' },
      { rh: 'B4:h G#4:q', lh: 'E2:h.' },
      { rh: 'E4:h.', lh: 'E2:h.' },
      { rh: 'G5:h.', lh: 'C3:h.' },
      { rh: 'G5:q. F#5:e E5:q', lh: 'C3:h.' },
      { rh: 'D5:h B4:q', lh: 'G2:h.' },
      { rh: 'G4:q. A4:e B4:q', lh: 'G2:h.' },
      { rh: 'C5:q. B4:e A4:q', lh: 'A2:h.' },
      { rh: 'G#4:q. F#4:e G#4:q', lh: 'E2:h.' },
      { rh: 'A4:h.', lh: 'A2+E3:h.' },
    ],
  },
  {
    file: 'symphony-40.musicxml',
    title: '교향곡 40번 1악장 주제',
    composer: 'W. A. Mozart',
    tempo: 110,
    key: -2,
    measures: [
      { rh: 'r:h r:q Eb5:e D5:e', lh: 'r:w' },
      { rh: 'D5:q Eb5:e D5:e D5:q Eb5:e D5:e', lh: rep(2, 'G2:e D3:e G3:e D3:e') },
      { rh: 'D5:q Bb5:q r:q Bb5:e A5:e', lh: rep(2, 'G2:e D3:e G3:e D3:e') },
      { rh: 'G5:q G5:e F5:e Eb5:q Eb5:e D5:e', lh: rep(2, 'C3:e G3:e C4:e G3:e') },
      { rh: 'C5:q C5:q r:q D5:e C5:e', lh: rep(2, 'D3:e A3:e D4:e A3:e') },
      { rh: 'C5:q D5:e C5:e C5:q D5:e C5:e', lh: rep(2, 'D3:e A3:e D4:e A3:e') },
      { rh: 'C5:q A5:q r:q A5:e G5:e', lh: rep(2, 'D3:e A3:e D4:e A3:e') },
      { rh: 'F#5:q F#5:e Eb5:e D5:q D5:e C5:e', lh: rep(2, 'D3:e A3:e D4:e A3:e') },
      { rh: 'Bb4:q Bb4:q r:h', lh: 'G2:e D3:e G3:e D3:e G2+G3:h' },
    ],
  },
  {
    file: 'mountain-king.musicxml',
    title: '산왕의 궁전에서 (In the Hall of the Mountain King)',
    composer: 'E. Grieg',
    tempo: 100,
    key: 2,
    measures: [...KING(0), ...KING(1), { rh: 'B4:w', lh: 'B2+F#3:w' }],
  },
  {
    file: 'canon-in-d.musicxml',
    title: '캐논 (Canon in D, 쉬운 편곡)',
    composer: 'J. Pachelbel',
    tempo: 70,
    key: 2,
    measures: [
      ...canon(CANON_HALVES),
      ...canon(['D4:q F#4:q A4:q G4:q', 'F#4:q D4:q F#4:q E4:q', 'D4:q B3:q D4:q A4:q', 'G4:q B4:q A4:q G4:q']),
      ...canon(CANON_HALVES),
      { rh: 'D5:w', lh: 'D2+D3:w' },
    ],
  },
  {
    file: 'fur-elise.musicxml',
    title: '엘리제를 위하여 (Für Elise, 첫 부분)',
    composer: 'L. v. Beethoven',
    tempo: 60,
    time: [3, 8],
    measures: [
      { rh: 'r:e r:e E5:s D#5:s', lh: 'r:q.' },
      ...ELISE_PHRASE,
      { rh: 'A4:e r:e E5:s D#5:s', lh: 'A2:s E3:s A3:s r:e.' },
      ...ELISE_PHRASE,
      { rh: 'A4:q.', lh: 'A2:s E3:s A3:s r:e.' },
    ],
  },
  {
    file: 'prelude-in-c.musicxml',
    title: '프렐류드 C장조 (평균율 1권 1번, 쉬운 편곡)',
    composer: 'J. S. Bach',
    tempo: 70,
    time: [2, 4],
    measures: [
      prelude('C3', 'E3', 'G4', 'C5', 'E5'),
      prelude('C3', 'D3', 'A4', 'D5', 'F5'),
      prelude('B2', 'D3', 'G4', 'D5', 'F5'),
      prelude('C3', 'E3', 'G4', 'C5', 'E5'),
      prelude('C3', 'E3', 'A4', 'E5', 'A5'),
      prelude('C3', 'D3', 'F#4', 'A4', 'D5'),
      prelude('B2', 'D3', 'G4', 'D5', 'G5'),
      prelude('B2', 'C3', 'E4', 'G4', 'C5'),
      prelude('A2', 'C3', 'E4', 'G4', 'C5'),
      prelude('D2', 'A2', 'D4', 'F#4', 'C5'),
      prelude('G2', 'B2', 'D4', 'G4', 'B4'),
      prelude('C3', 'E3', 'G4', 'C5', 'E5'),
    ].flat().concat({ rh: 'C4+E4+G4+C5:h', lh: 'C2+C3:h' }),
  },
  {
    // 원곡은 4/4박자 셋잇단음표. 셋잇단을 8분음표로 적고, 한 줄 4마디에 들어가도록 원곡 한 마디를 6/8박자 두 마디로 나눈다
    file: 'moonlight-sonata.musicxml',
    title: '월광 소나타 1악장 (도입부)',
    composer: 'L. v. Beethoven',
    tempo: 50,
    key: 4,
    time: [6, 8],
    measures: [
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'C#2+C#3:h.' },
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'C#2+C#3:h.' },
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'B1+B2:h.' },
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'B1+B2:h.' },
      { rh: rep(2, 'A3:e C#4:e E4:e'), lh: 'A1+A2:h.' },
      { rh: rep(2, 'A3:e D4:e F#4:e'), lh: 'F#1+F#2:h.' },
      { rh: 'G#3:e B#3:e F#4:e G#3:e C#4:e E4:e', lh: 'G#1+G#2:h.' },
      { rh: 'G#3:e C#4:e D#4:e F#3:e B#3:e D#4:e', lh: 'G#1+G#2:h.' },
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'C#2+C#3:h.' },
      { rh: rep(2, 'G#3:e C#4:e E4:e'), lh: 'C#2+C#3:h.' },
      { rh: 'G#3+C#4+E4:h.', lh: 'C#2+C#3:h.' },
    ],
  },
].map((s) => ({ ...s, level: 3 }));
