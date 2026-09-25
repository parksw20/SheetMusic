import * as Tone from 'tone';
import type { NoteEvent } from '../score/model';
import { preferPlayback } from './session';

let synth: Tone.PolySynth | null = null;

/** 브라우저 정책상 사용자 동작(클릭/키 입력) 이후에 호출해야 소리가 난다. */
export async function ensureAudio(): Promise<void> {
  preferPlayback(); // await 전에, 클릭 처리 안에서 동기적으로 불러야 한다
  if (Tone.getContext().state !== 'running') await Tone.start();
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0.15, release: 1 },
    }).toDestination();
    synth.volume.value = -10;
  }
}

const freq = (midi: number) => Tone.Frequency(midi, 'midi').toFrequency();

export function noteOn(midi: number, velocity = 0.8): void {
  synth?.triggerAttack(freq(midi), Tone.now(), velocity);
}

export function noteOff(midi: number): void {
  synth?.triggerRelease(freq(midi), Tone.now());
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
      synth?.triggerAttackRelease(freq(n.midi), n.durationBeats * secPerBeat * 0.95, time, 0.7);
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
    synth?.releaseAll();
  };
}
