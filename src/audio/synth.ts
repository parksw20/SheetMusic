import * as Tone from 'tone';
import type { NoteEvent } from '../score/model';
import { preferPlayback } from './session';

/**
 * 실제 그랜드 피아노 녹음(Salamander Grand Piano)으로 소리를 낸다. public/piano/에 3반음 간격 음만 있고
 * 사이 음은 Tone.Sampler가 음높이를 바꿔 만든다. 피아노 소리를 받기 전이나 못 받으면 간단한 합성음을 쓴다.
 */
const SAMPLES = ['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7'];
/** 처음 한 번 피아노 소리를 받는 동안 기다리는 최대 시간 */
const LOAD_WAIT_MS = 8000;

let piano: Tone.Sampler | null = null;
let pianoLoading: Promise<boolean> | null = null;
let fallback: Tone.PolySynth | null = null;

function instrument(): Tone.Sampler | Tone.PolySynth | null {
  return piano?.loaded ? piano : fallback;
}

/** 브라우저 정책상 사용자 동작(클릭/키 입력) 이후에 호출해야 소리가 난다. */
export async function ensureAudio(): Promise<void> {
  preferPlayback(); // await 전에, 클릭 처리 안에서 동기적으로 불러야 한다
  if (Tone.getContext().state !== 'running') await Tone.start();
  if (!fallback) {
    fallback = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0.15, release: 1 },
    }).toDestination();
    fallback.volume.value = -10;
  }
  pianoLoading ??= new Promise<boolean>((resolve) => {
    piano = new Tone.Sampler({
      urls: Object.fromEntries(SAMPLES.map((n) => [n, `${n.replace('#', 's')}.mp3`])),
      baseUrl: `${import.meta.env.BASE_URL}piano/`,
      release: 1.2,
      onload: () => resolve(true),
      onerror: () => resolve(false),
    }).toDestination();
    piano.volume.value = -4;
  });
  await Promise.race([pianoLoading, new Promise((r) => setTimeout(r, LOAD_WAIT_MS))]);
}

const noteName = (midi: number) => Tone.Frequency(midi, 'midi').toNote();

export function noteOn(midi: number, velocity = 0.8): void {
  instrument()?.triggerAttack(noteName(midi), Tone.now(), velocity);
}

export function noteOff(midi: number): void {
  instrument()?.triggerRelease(noteName(midi), Tone.now());
}

/**
 * 악보를 재생한다. onBeat는 각 음이 시작될 때 그 위치(박)로 호출된다.
 * 반환값을 호출하면 재생을 멈춘다.
 */
export function playNotes(
  notes: NoteEvent[],
  bpm: number,
  onBeat: (beat: number) => void,
  onEnd: () => void,
): () => void {
  const transport = Tone.getTransport();
  const draw = Tone.getDraw();
  transport.stop();
  transport.cancel();

  const secPerBeat = 60 / bpm;
  const beats = [...new Set(notes.map((n) => n.startBeat))];
  for (const n of notes) {
    transport.schedule((time) => {
      instrument()?.triggerAttackRelease(noteName(n.midi), n.durationBeats * secPerBeat * 0.95, time, 0.7);
    }, n.startBeat * secPerBeat);
  }
  for (const b of beats) {
    transport.schedule((time) => draw.schedule(() => onBeat(b), time), b * secPerBeat);
  }
  const last = Math.max(0, ...notes.map((n) => n.startBeat + n.durationBeats));
  transport.schedule((time) => draw.schedule(onEnd, time), last * secPerBeat + 0.3);
  transport.start('+0.1');

  return () => {
    transport.stop();
    transport.cancel();
    instrument()?.releaseAll();
  };
}

let clicker: Tone.NoiseSynth | null = null;

/**
 * 박자 맞추기 전에 한 마디를 센다 (딱딱 소리). 음높이가 없는 잡음 소리라 마이크 음 인식에 음으로 잡히지 않는다.
 * delaySec 뒤에 첫 소리, 이후 msPerBeat 간격으로 count번. 첫 소리는 조금 세게.
 */
export function playClicks(count: number, msPerBeat: number, delaySec: number): () => void {
  clicker ??= new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).toDestination();
  clicker.volume.value = -12;
  const start = Tone.now() + Math.max(0.05, delaySec);
  for (let i = 0; i < count; i++) clicker.triggerAttackRelease(0.03, start + (i * msPerBeat) / 1000, i === 0 ? 1 : 0.6);
  return () => clicker?.triggerRelease();
}

