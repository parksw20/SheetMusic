import type { SongEntry } from '../songs';

/** 곡마다 어울리는 그림 문자. 없으면 난이도별 기본 그림 */
const MOTIFS: Record<string, string> = {
  'c-position': '🎹',
  mary: '🐑',
  'lightly-row': '🦋',
  'etude-rh-steps': '🪜',
  'etude-down-steps': '🛝',
  'etude-lh-steps': '🫲',
  'etude-thirds': '🐸',
  'etude-echo': '📣',
  'etude-rests': '😴',
  'etude-long-notes': '🎈',
  'etude-march': '🥁',
  'etude-waltz': '💃',
  'etude-eighths': '🚶',
  'etude-g-position': '🎯',
  'etude-black-key': '🐧',
  'etude-hands-together': '🙌',
  'etude-lh-accompany': '🎸',
  'hot-cross-buns': '🥐',
  'alle-meine-entchen': '🦆',
  'aunt-rhody': '🦢',
  'au-clair-de-la-lune': '🌙',
  'london-bridge': '🌉',
  'frere-jacques': '🛎️',
  'old-macdonald': '🚜',
  'yankee-doodle': '🎩',
  'this-old-man': '👴',
  augustin: '🎠',
  'row-your-boat': '🚣',
  'three-blind-mice': '🐭',
  'itsy-bitsy-spider': '🕷️',
  'oh-susanna': '🪕',
  'jingle-bells-verse': '🛷',
  'when-the-saints': '🎺',
  twinkle: '⭐',
  'ode-to-joy': '🎉',
  'jingle-bells': '⛄',
  'largo-new-world': '🏡',
  clementine: '🌊',
  'brahms-lullaby': '🌛',
  'amazing-grace': '🕊️',
  sakura: '🌸',
  'auld-lang-syne': '🥂',
  'silent-night': '🌟',
  'joy-to-the-world': '🎄',
  'deck-the-halls': '🎁',
  'we-wish-you': '🎅',
  'minuet-in-g': '👑',
  'ode-to-joy-full': '🎆',
  korobeiniki: '🧱',
  'carol-of-the-bells': '🔔',
  greensleeves: '🍃',
  'symphony-40': '🎻',
  'mountain-king': '🏔️',
  'canon-in-d': '💒',
  'fur-elise': '💌',
  'prelude-in-c': '🎼',
  'moonlight-sonata': '🌕',
};
const LEVEL_MOTIF: Record<number, string> = { 0: '🎧', 1: '🎵', 2: '🎶', 3: '🎼' };

/** 부드러운 두 색 그라데이션 */
const PALETTES: [string, string][] = [
  ['#ffd9c2', '#ff9f8a'],
  ['#d7e8ff', '#8fb3ff'],
  ['#dff5e3', '#8fd6a6'],
  ['#fbe3ff', '#d69cf5'],
  ['#fff1c2', '#ffc76b'],
  ['#d9f3f5', '#7fcfd9'],
  ['#e6e3ff', '#9d97f0'],
  ['#ffe0ea', '#f59bb6'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 곡 카드 그림: 곡마다 정해진 색과 그림 문자, 뒤에 옅은 오선과 음표 무늬 */
export function SongCover({ song }: { song: SongEntry }) {
  const id = song.key.replace(/\.musicxml$/, '').replace(/^my:/, '');
  const h = hash(song.key);
  const [from, to] = PALETTES[h % PALETTES.length];
  const motif = MOTIFS[id] ?? LEVEL_MOTIF[song.level] ?? '🎵';
  const gid = `g${h.toString(36)}`;
  const tilt = (h % 7) - 3;
  return (
    <svg className="cover" viewBox="0 0 100 100" role="img" aria-label={song.title}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      <g stroke="#fff" strokeOpacity="0.45" strokeWidth="0.8" transform={`rotate(${tilt} 50 50)`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1="-10" x2="110" y1={70 + i * 4} y2={70 + i * 4} />
        ))}
      </g>
      <g fill="#fff" fillOpacity="0.5" transform={`rotate(${tilt} 50 50)`}>
        <ellipse cx={18 + (h % 11)} cy="80" rx="3.2" ry="2.4" transform={`rotate(-20 ${18 + (h % 11)} 80)`} />
        <ellipse cx={74 + (h % 9)} cy="74" rx="3.2" ry="2.4" transform={`rotate(-20 ${74 + (h % 9)} 74)`} />
      </g>
      <text x="50" y="52" fontSize="42" textAnchor="middle" dominantBaseline="central">
        {motif}
      </text>
    </svg>
  );
}
