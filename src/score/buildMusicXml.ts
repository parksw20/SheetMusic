/**
 * 간단한 텍스트 표기법으로 적은 곡을 MusicXML(피아노 큰보표)로 만든다.
 * 내장 곡 생성(scripts/generate-songs.mjs, Node가 타입을 지우고 바로 읽는다)과
 * 음원으로 만든 악보(src/transcribe)에서 함께 쓴다. 그래서 다른 파일을 import하지 않는다.
 *
 * 토큰 형식: <음>:<길이>
 *   음    : C4, F#4, Bb3, 화음은 C4+E4+G4, 쉼표는 r
 *   길이  : w(온음표) h(2분) q(4분) e(8분) s(16분), 뒤에 '.'을 붙이면 점음표 (h.)
 */

export interface SongMeasure {
  /** 오른손(높은음자리표) */
  rh: string;
  /** 왼손(낮은음자리표) */
  lh: string;
}

export interface SongSpec {
  title: string;
  composer: string;
  tempo: number;
  /** 조표의 샵 개수, 플랫은 음수 */
  key?: number;
  /** [박자 수, 박 단위] 기본 [4, 4] */
  time?: [number, number];
  measures: SongMeasure[];
}

const DIVISIONS = 4; // 4분음표 하나 = 4 divisions
const TYPES: Record<string, [string, number]> = {
  w: ['whole', 16],
  h: ['half', 8],
  q: ['quarter', 4],
  e: ['eighth', 2],
  s: ['16th', 1],
};
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

interface Pitch {
  step: string;
  alter: number;
  octave: number;
}

export interface Token {
  pitches: Pitch[];
  duration: number;
  type: string;
  dotted: boolean;
  /** 손가락 번호 (pitches와 같은 순서) */
  fingers?: number[];
}

function parsePitch(text: string): Pitch {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(text);
  if (!m) throw new Error(`잘못된 음 표기: ${text}`);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { step: m[1], alter, octave: Number(m[3]) };
}

function parseToken(token: string): Token {
  const [pitchPart, durPart = ''] = token.split(':');
  const dotted = durPart.endsWith('.');
  const t = TYPES[dotted ? durPart.slice(0, -1) : durPart];
  if (!t) throw new Error(`잘못된 길이 표기: ${token}`);
  const duration = dotted ? t[1] * 1.5 : t[1];
  return { pitches: pitchPart === 'r' ? [] : pitchPart.split('+').map(parsePitch), duration, type: t[0], dotted };
}

function parseLine(line: string): Token[] {
  return line.trim().split(/\s+/).map(parseToken);
}

/** 흰 건반 기준 위치 (C4 = 28). 손 모양은 흰 건반 간격으로 생각하는 게 자연스럽다 */
const diatonic = (p: Pitch) => p.octave * 7 + STEPS.indexOf(p.step);

/**
 * 손가락 번호를 정한다 (한 손, 곡 전체).
 * 손은 "엄지 위치"에 놓이고 손가락 f는 엄지에서 f-1칸(흰 건반) 떨어진 음을 친다고 보고,
 * 손 위치를 옮기는 횟수와 거리가 가장 적은 번호를 동적 계획법으로 고른다.
 * 화음은 규칙으로 정한다 (오른손 1-3-5, 왼손 5-3-1 식).
 */
export function assignFingering(tokens: Token[], hand: 'rh' | 'lh'): void {
  const dir = hand === 'rh' ? 1 : -1;
  /** 이 음을 손가락 f로 칠 때의 엄지 위치 */
  const thumbAt = (d: number, f: number) => d - dir * (f - 1);

  interface Node {
    options: { fingers: number[]; thumb: number; lead: number; black: boolean[]; d: number }[];
    token: Token;
  }
  const nodes: Node[] = [];
  for (const token of tokens) {
    if (!token.pitches.length) continue;
    const ds = token.pitches.map(diatonic);
    if (ds.length === 1) {
      const black = token.pitches[0].alter !== 0;
      nodes.push({
        token,
        options: [1, 2, 3, 4, 5].map((f) => ({ fingers: [f], thumb: thumbAt(ds[0], f), lead: f, black: [black], d: ds[0] })),
      });
      continue;
    }
    // 화음: 낮은 음부터 순서대로
    const order = ds.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
    const low = order[0].d;
    const high = order[order.length - 1].d;
    const span = high - low;
    const fingers = new Array<number>(ds.length);
    const edge = Math.min(5, 1 + span);
    order.forEach(({ d, i }, k) => {
      let f: number;
      if (k === 0) f = hand === 'rh' ? 1 : edge;
      else if (k === order.length - 1) f = hand === 'rh' ? edge : 1;
      else {
        const fromThumb = hand === 'rh' ? d - low : high - d;
        f = Math.min(4, Math.max(2, 1 + fromThumb));
      }
      fingers[i] = f;
    });
    // 가운데 음이 같은 번호가 되지 않게 한 칸씩 민다
    const used = new Set<number>();
    order.forEach(({ i }) => {
      while (used.has(fingers[i]) && fingers[i] < 5) fingers[i]++;
      used.add(fingers[i]);
    });
    nodes.push({
      token,
      options: [{ fingers, thumb: hand === 'rh' ? low : high, lead: 0, black: token.pitches.map((p) => p.alter !== 0), d: 0 }],
    });
  }
  if (!nodes.length) return;

  const noteCost = (o: Node['options'][number]) =>
    o.fingers.reduce((c, f, i) => c + (o.black[i] ? (f === 1 ? 2 : f === 5 ? 0.5 : 0) : 0), 0);
  const moveCost = (a: Node['options'][number], b: Node['options'][number], sameNote: boolean) => {
    let c = 0;
    if (a.thumb !== b.thumb) c += 2 + Math.abs(a.thumb - b.thumb) * 0.3;
    // 다른 음을 같은 손가락으로 이어 치기
    if (a.lead && a.lead === b.lead && !sameNote) c += 3;
    // 손가락 넘기기(올라가며 번호가 작아지거나, 내려가며 커짐)는 초보에게 어려워 되도록 피한다
    if (a.lead && b.lead) {
      const up = (b.d - a.d) * dir;
      if ((up > 0 && b.lead < a.lead) || (up < 0 && b.lead > a.lead)) c += 1.5;
    }
    return c;
  };

  // 시작은 엄지가 도나 솔 자리에 오는 걸 조금 선호
  let cost = nodes[0].options.map((o) => noteCost(o) + ([0, 4].includes(((o.thumb % 7) + 7) % 7) ? 0 : 0.5));
  const back: number[][] = [];
  for (let n = 1; n < nodes.length; n++) {
    const prev = nodes[n - 1];
    const cur = nodes[n];
    const sameNote =
      prev.token.pitches.length === 1 &&
      cur.token.pitches.length === 1 &&
      diatonic(prev.token.pitches[0]) === diatonic(cur.token.pitches[0]);
    const next: number[] = [];
    const from: number[] = [];
    cur.options.forEach((o) => {
      let best = Infinity;
      let arg = 0;
      prev.options.forEach((p, j) => {
        const c = cost[j] + moveCost(p, o, sameNote) + (sameNote && p.lead !== o.lead ? 1 : 0);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      next.push(best + noteCost(o));
      from.push(arg);
    });
    cost = next;
    back.push(from);
  }
  let k = cost.indexOf(Math.min(...cost));
  for (let n = nodes.length - 1; n >= 0; n--) {
    nodes[n].token.fingers = nodes[n].options[k].fingers;
    if (n > 0) k = back[n - 1][k];
  }
}

function noteXml(token: Token, staff: number, voice: number, fingering: boolean): string {
  const tail = `<duration>${token.duration}</duration><voice>${voice}</voice><type>${token.type}</type>${token.dotted ? '<dot/>' : ''}<staff>${staff}</staff>`;
  if (!token.pitches.length) {
    const whole = token.type === 'whole' ? ' measure="yes"' : '';
    return `<note><rest${whole}/>${tail}</note>`;
  }
  const placement = staff === 1 ? 'above' : 'below';
  return token.pitches
    .map((p, i) => {
      const alterXml = p.alter ? `<alter>${p.alter}</alter>` : '';
      const finger = fingering && token.fingers?.[i];
      const notations = finger
        ? `<notations><technical><fingering placement="${placement}">${finger}</fingering></technical></notations>`
        : '';
      return `<note>${i > 0 ? '<chord/>' : ''}<pitch><step>${p.step}</step>${alterXml}<octave>${p.octave}</octave></pitch>${tail}${notations}</note>`;
    })
    .join('');
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 곡을 MusicXML로 만든다. 마디 길이가 박자와 다르면 오류를 낸다 */
export function songXml(song: SongSpec, options: { fingering?: boolean } = {}): string {
  const fingering = options.fingering ?? true;
  const [beats, beatType] = song.time ?? [4, 4];
  const measureLength = (beats * 16) / beatType;
  const rh = song.measures.map((m) => parseLine(m.rh));
  const lh = song.measures.map((m) => parseLine(m.lh));
  if (fingering) {
    assignFingering(rh.flat(), 'rh');
    assignFingering(lh.flat(), 'lh');
  }

  const measures = song.measures
    .map((_, i) => {
      const total = (tokens: Token[]) => tokens.reduce((s, t) => s + t.duration, 0);
      if (total(rh[i]) !== measureLength || total(lh[i]) !== measureLength) {
        throw new Error(
          `${song.title} ${i + 1}마디: 길이가 박자와 다름 (오른손 ${total(rh[i])}, 왼손 ${total(lh[i])}, 기대 ${measureLength})`,
        );
      }
      const attrs =
        i === 0
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${song.key ?? 0}</fifths></key>` +
            `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>` +
            `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` +
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${song.tempo}</per-minute></metronome></direction-type><sound tempo="${song.tempo}"/></direction>`
          : '';
      const right = rh[i].map((t) => noteXml(t, 1, 1, fingering)).join('');
      const left = lh[i].map((t) => noteXml(t, 2, 5, fingering)).join('');
      return `<measure number="${i + 1}">${attrs}${right}<backup><duration>${measureLength}</duration></backup>${left}</measure>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${escapeXml(song.title)}</work-title></work>
<identification><creator type="composer">${escapeXml(song.composer)}</creator></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${measures}
</part>
</score-partwise>
`;
}
