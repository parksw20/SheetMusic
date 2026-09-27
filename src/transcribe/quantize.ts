/**
 * AI가 찾은 음(초 단위)을 4/4박자 악보로 옮긴다.
 *  0. 잡음 거르기: 배경 소음보다 충분히 큰 순간에 시작한 음만, 같이 시작한 센 음의 배음(옥타브 위 약한 음)은 뺀다
 *  1. 템포: 타건 사이 간격이 8분음표의 배수에 가장 잘 맞는 빠르기 (보통 빠르기 쪽을 조금 선호)
 *  2. 첫 음을 첫 마디 첫 박으로 두고 16분음표 격자에 맞춘다. 사람이 치면 빠르기가 조금씩 흔들리므로
 *     격자를 음마다 조금씩 따라가게(위상 고정) 하고, 끝나면 전체에 직선을 맞춰 빠르기를 다시 구한다
 *  3. 가운데 도(C4) 이상은 오른손, 아래는 왼손
 *  4. 조표: 음들이 가장 많이 들어가는 장조
 * 붙임줄은 쓰지 않는다. 마디를 넘거나 표기할 수 없는 길이는 짧게 자르고 쉼표로 채운다 (연습에는 치는 순간만 중요).
 */
import type { SongMeasure, SongSpec } from '../score/buildMusicXml';

export interface DetectedNote {
  pitchMidi: number;
  startTimeSeconds: number;
  durationSeconds: number;
  amplitude: number;
  /** 시작 부분 음높이 흔들림 (반음). 목소리·비브라토는 크고 피아노는 거의 0 */
  wobble?: number;
}

export interface QuantizeOptions {
  /** 박자 격자: 8이면 8분음표, 16이면 16분음표까지 적는다 */
  grid?: 8 | 16;
  /** 오른손은 가장 높은 음(멜로디), 왼손은 가장 낮은 음(베이스)만 남긴다 */
  simplify?: boolean;
}

export interface QuantizeResult {
  song: SongSpec;
  bpm: number;
  noteCount: number;
}

/** 이보다 약한 음은 잡음으로 보고 뺀다 */
const MIN_AMPLITUDE = 0.2;
const MIN_DURATION = 0.05;
/** 이 시간 안에 시작한 음은 같은 순간(화음)으로 본다 */
const CLUSTER_SECONDS = 0.05;
const SPLIT_MIDI = 60;
const MAX_CHORD = 4;
const MAX_MEASURES = 300;

/** 음표로 적을 수 있는 길이 (16분음표 단위) → 토큰 길이 표기 */
const NOTE_VALUES: [number, string][] = [
  [16, 'w'],
  [12, 'h.'],
  [8, 'h'],
  [6, 'q.'],
  [4, 'q'],
  [3, 'e.'],
  [2, 'e'],
  [1, 's'],
];
const REST_VALUES = NOTE_VALUES.filter(([, t]) => !t.endsWith('.'));

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** 배음으로 보는 음정 (옥타브, 두 옥타브). 옥타브+5도는 실제 화음 음과 겹쳐서 넣지 않는다 */
const HARMONICS = [12, 24];
/** 같이 시작한 센 음보다 이 비율 이하로 약한 배음 자리 음은 뺀다 */
const HARMONIC_RATIO = 0.6;
/** 배경 소음보다 이만큼(dB) 큰 순간에 시작한 음만 인정한다 */
const NOISE_MARGIN_DB = 12;
/** 시작 부분 음높이가 이만큼(반음) 넘게 흔들리면 피아노가 아닌 소리(목소리 등)로 본다 */
const MAX_WOBBLE = 0.6;

export function clean(notes: DetectedNote[]): DetectedNote[] {
  const kept = notes
    .filter(
      (n) =>
        n.amplitude >= MIN_AMPLITUDE &&
        n.durationSeconds >= MIN_DURATION &&
        n.pitchMidi >= 21 &&
        n.pitchMidi <= 108 &&
        (n.wobble ?? 0) < MAX_WOBBLE,
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  return kept.filter(
    (n) =>
      !kept.some(
        (p) =>
          p !== n &&
          Math.abs(p.startTimeSeconds - n.startTimeSeconds) < CLUSTER_SECONDS &&
          HARMONICS.includes(n.pitchMidi - p.pitchMidi) &&
          n.amplitude < p.amplitude * HARMONIC_RATIO,
      ),
  );
}

/**
 * 소리 크기로 잡음 음을 거른다. AI는 구간마다 소리 크기를 맞춰 분석해서, 조용한 부분의 잡음을 음으로 착각하기도 한다.
 * 가장 조용한 5% 구간을 배경 소음으로 보고, 음이 시작된 순간(0.25초 안)이 그보다 충분히 커야 남긴다.
 */
export function gateByLevel(notes: DetectedNote[], audio: Float32Array, sampleRate: number): DetectedNote[] {
  const block = Math.round(sampleRate * 0.05);
  const db: number[] = [];
  for (let i = 0; i + block <= audio.length; i += block) {
    let e = 0;
    for (let j = i; j < i + block; j++) e += audio[j] * audio[j];
    db.push(10 * Math.log10(e / block + 1e-12));
  }
  if (db.length < 4) return notes;
  const sorted = db.filter((d) => d > -100).sort((a, b) => a - b);
  if (!sorted.length) return notes;
  const floor = sorted[Math.floor(sorted.length * 0.05)];
  return notes.filter((n) => {
    const from = Math.max(0, Math.floor(n.startTimeSeconds / 0.05) - 1);
    const to = Math.min(db.length - 1, from + 5);
    let peak = -Infinity;
    for (let k = from; k <= to; k++) peak = Math.max(peak, db[k]);
    return peak >= floor + NOISE_MARGIN_DB;
  });
}

/** 타건 시각 묶음 (화음은 하나로) */
function onsetTimes(notes: DetectedNote[]): number[] {
  const times: number[] = [];
  for (const n of notes) {
    if (!times.length || n.startTimeSeconds - times[times.length - 1] > CLUSTER_SECONDS) times.push(n.startTimeSeconds);
  }
  return times;
}

/** 빠르기(BPM) 추정 */
export function estimateTempo(notes: DetectedNote[]): number {
  const times = onsetTimes(clean(notes));
  // 바로 옆 타건뿐 아니라 2~4개 건너 간격도 본다 (사람이 치는 미세한 흔들림이 평균돼 덜 민감해진다)
  const iois: number[] = [];
  for (let i = 0; i < times.length; i++) {
    for (let k = 1; k <= 4 && i + k < times.length; k++) {
      const d = times[i + k] - times[i];
      if (d >= 0.08 && d <= 2.5) iois.push(d);
    }
  }
  if (iois.length < 3) return 90;
  let best = 90;
  let bestScore = -Infinity;
  for (let bpm = 50; bpm <= 180; bpm += 0.5) {
    const eighth = 60 / bpm / 2;
    let fit = 0;
    for (const d of iois) {
      const r = d / eighth;
      const k = Math.round(r);
      const dev = r < 0.5 ? 1 : Math.abs(r - k);
      // 4분음표 배수(8분음표 짝수 개)로 떨어지면 조금 더 쳐준다: 같은 간격을 점4분음표보다 4분음표로 읽게
      fit += Math.exp(-(dev * dev) / 0.05) * (k % 2 === 0 ? 1 : 0.65);
    }
    const prior = Math.exp(-(Math.log2(bpm / 100) ** 2) / (2 * 0.7 * 0.7));
    const score = (fit / iois.length) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return Math.round(best);
}

/** 음들이 가장 많이 들어가는 장조의 조표 (샵 개수, 플랫은 음수) */
export function estimateKey(notes: DetectedNote[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let fifths = -5; fifths <= 5; fifths++) {
    const tonic = (((fifths * 7) % 12) + 12) % 12;
    const scale = new Set(MAJOR.map((s) => (tonic + s) % 12));
    let score = 0;
    for (const n of notes) score += scale.has(n.pitchMidi % 12) ? n.durationSeconds : -n.durationSeconds;
    score -= Math.abs(fifths) * 0.01; // 같으면 조표가 적은 쪽
    if (score > bestScore) {
      bestScore = score;
      best = fifths;
    }
  }
  return best;
}

function pitchName(midi: number, flats: boolean): string {
  return `${(flats ? FLAT_NAMES : SHARP_NAMES)[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** 쉼표로 채운다. 박 위치에 맞춰 (마디 안 위치 from부터) 읽기 쉬운 길이로 나눈다 */
function rests(from: number, length: number): string[] {
  const out: string[] = [];
  let pos = from;
  const end = from + length;
  while (pos < end) {
    const [v, t] = REST_VALUES.find(([v]) => v <= end - pos && pos % v === 0)!;
    out.push(`r:${t}`);
    pos += v;
  }
  return out;
}

interface Event {
  slot: number;
  length: number;
  pitches: number[];
}

/** 한 손의 음들을 마디별 토큰 줄로 */
function handLines(events: Event[], measures: number, flats: boolean, SLOTS: number): string[] {
  const lines: string[] = [];
  for (let m = 0; m < measures; m++) {
    const start = m * SLOTS;
    const end = start + SLOTS;
    const inside = events.filter((e) => e.slot >= start && e.slot < end);
    const tokens: string[] = [];
    let pos = start;
    inside.forEach((e, i) => {
      if (e.slot > pos) tokens.push(...rests(pos - start, e.slot - pos));
      const next = inside[i + 1]?.slot ?? end;
      const room = Math.min(next - e.slot, end - e.slot);
      // 다음 음 바로 앞에서 조금 일찍 뗀 음은 다음 음까지 이어진 것으로 본다
      const length = room - e.length <= Math.max(1, e.length * 0.25) ? room : Math.min(e.length, room);
      const [value, type] = NOTE_VALUES.find(([v]) => v <= length)!;
      const chord = [...e.pitches].sort((a, b) => a - b).map((p) => pitchName(p, flats)).join('+');
      tokens.push(`${chord}:${type}`);
      pos = e.slot + value;
    });
    if (pos < end) tokens.push(...rests(pos - start, end - pos));
    lines.push(tokens.join(' '));
  }
  return lines;
}

/**
 * 타건 시각 묶음마다 16분음표 칸 번호를 정한다. 격자는 칸을 정할 때마다 실제 시각 쪽으로 조금 끌려가서
 * (위상 고정 루프) 연주가 조금 빨라지거나 느려져도 박이 밀리지 않는다.
 */
function assignSlots(times: number[], sixteenth: number): number[] {
  let anchorTime = times[0];
  let anchorSlot = 0;
  let step = sixteenth;
  return times.map((t, i) => {
    if (i === 0) return 0;
    const slot = Math.max(anchorSlot + 1, anchorSlot + Math.round((t - anchorTime) / step));
    const predicted = anchorTime + (slot - anchorSlot) * step;
    const err = t - predicted;
    // 박 위치는 절반만큼, 빠르기는 조금씩 따라간다 (한 번 튄 타건에 휘둘리지 않게)
    step += (0.15 * err) / (slot - anchorSlot);
    step = Math.min(sixteenth * 1.15, Math.max(sixteenth * 0.87, step));
    anchorTime = predicted + 0.5 * err;
    anchorSlot = slot;
    return slot;
  });
}

/** 칸 번호와 시각에 직선을 맞춰 16분음표 길이(초)를 구한다 */
function fitSixteenth(times: number[], slots: number[]): number | null {
  const n = times.length;
  if (n < 4) return null;
  const ms = slots.reduce((a, b) => a + b, 0) / n;
  const mt = times.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    cov += (slots[i] - ms) * (times[i] - mt);
    v += (slots[i] - ms) ** 2;
  }
  return v > 0 ? cov / v : null;
}

/**
 * 찾은 음들을 곡(SongSpec)으로. bpm을 주면 그 빠르기로 박을 나눈다.
 * audio(22,050Hz)를 주면 배경 소음 크기로 잡음 음을 먼저 거른다.
 * 8분음표 격자(기본)에서는 서로 다른 타건이 같은 칸에 떨어지면 화음으로 합치지 않고 센 쪽만 남긴다
 * (빠른 꾸밈음·잔음이 두꺼운 화음이 되어 마디가 넘치는 것을 막는다).
 */
export function notesToSong(
  raw: DetectedNote[],
  title: string,
  bpm?: number,
  audio?: { samples: Float32Array; sampleRate: number },
  /** 한 마디 박 수 (4/4 또는 3/4) */
  beats: 3 | 4 = 4,
  options: QuantizeOptions = {},
): QuantizeResult {
  const { grid = 8, simplify = false } = options;
  /** 한 칸(16분음표) 단위로 본 격자 간격 */
  const unit = grid === 8 ? 2 : 1;
  const SLOTS = beats * 4;
  const gated = audio ? gateByLevel(raw, audio.samples, audio.sampleRate) : raw;
  const notes = clean(gated);
  if (!notes.length) throw new Error('음을 찾지 못했어요. 피아노 소리가 크게 들어가게 다시 해 보세요.');
  const fixedTempo = bpm !== undefined;
  bpm ??= estimateTempo(notes);
  const times = onsetTimes(notes);
  let slots = assignSlots(times, 60 / bpm / 4);
  if (!fixedTempo) {
    // 자동 빠르기면 전체에 맞춘 빠르기로 한 번 더
    const fitted = fitSixteenth(times, slots);
    if (fitted && fitted > 0) {
      bpm = Math.round(60 / fitted / 4);
      slots = assignSlots(times, 60 / bpm / 4);
    }
  }
  const onsetOf = (t: number) => {
    let k = 0;
    while (k + 1 < times.length && times[k + 1] <= t + 1e-9) k++;
    return k;
  };
  const key = estimateKey(notes);
  const flats = key < 0;

  /** 손 → 칸 → 타건 묶음 번호 → 음 */
  type Group = { pitches: Map<number, number>; length: number; loud: number };
  const byHand: Record<'rh' | 'lh', Map<number, Map<number, Group>>> = { rh: new Map(), lh: new Map() };
  const sixteenth = 60 / bpm / 4;
  for (const n of notes) {
    const k = onsetOf(n.startTimeSeconds);
    const slot = Math.round(slots[k] / unit) * unit;
    if (slot >= MAX_MEASURES * SLOTS) break;
    const hand = n.pitchMidi >= SPLIT_MIDI ? 'rh' : 'lh';
    const length = Math.max(unit, Math.round(n.durationSeconds / sixteenth / unit) * unit);
    const groups = byHand[hand].get(slot) ?? new Map<number, Group>();
    const g = groups.get(k) ?? { pitches: new Map<number, number>(), length: 0, loud: 0 };
    g.pitches.set(n.pitchMidi, Math.max(g.pitches.get(n.pitchMidi) ?? 0, n.amplitude));
    g.length = Math.max(g.length, length);
    g.loud = Math.max(g.loud, n.amplitude);
    groups.set(k, g);
    byHand[hand].set(slot, groups);
  }
  const toEvents = (map: Map<number, Map<number, Group>>, hand: 'rh' | 'lh'): Event[] =>
    [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([slot, groups]) => {
        // 같은 칸에 떨어진 타건 중 가장 센 것 (16분음표 격자에서는 칸마다 하나뿐이다)
        const ev = [...groups.values()].reduce((a, b) => (b.loud > a.loud ? b : a));
        // 화음이 너무 두꺼우면 센 음 위주로 남긴다
        let pitches = [...ev.pitches.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_CHORD)
          .map(([p]) => p);
        if (simplify) pitches = [hand === 'rh' ? Math.max(...pitches) : Math.min(...pitches)];
        return { slot, length: ev.length, pitches };
      });
  const rh = toEvents(byHand.rh, 'rh');
  const lh = toEvents(byHand.lh, 'lh');
  const lastSlot = Math.max(...[...rh, ...lh].map((e) => e.slot + 1));
  const measures = Math.min(MAX_MEASURES, Math.max(1, Math.ceil(lastSlot / SLOTS)));
  const right = handLines(rh, measures, flats, SLOTS);
  const left = handLines(lh, measures, flats, SLOTS);
  const songMeasures: SongMeasure[] = right.map((r, i) => ({ rh: r, lh: left[i] }));

  return {
    song: { title, composer: '음원으로 만든 악보', tempo: Math.round(bpm), key, time: [beats, 4], measures: songMeasures },
    bpm: Math.round(bpm),
    noteCount: rh.reduce((a, e) => a + e.pitches.length, 0) + lh.reduce((a, e) => a + e.pitches.length, 0),
  };
}
