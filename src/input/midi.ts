import type { NoteListener } from './types';

export interface MidiConnection {
  /** 연결된 입력 장치 이름 목록 */
  devices: () => string[];
  disconnect: () => void;
}

export function isMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/**
 * Web MIDI로 모든 입력 장치를 듣는다. 장치를 꽂거나 빼면 자동으로 다시 연결한다.
 * (Chrome/Edge/Android 지원, iOS Safari 미지원)
 */
export async function connectMidi(
  listener: NoteListener,
  onDevicesChange?: (names: string[]) => void,
): Promise<MidiConnection> {
  const access = await navigator.requestMIDIAccess();

  const onMessage = (e: MIDIMessageEvent) => {
    if (!e.data || e.data.length < 3) return;
    const [status, midi, velocity] = e.data;
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      listener({ type: 'on', midi, velocity: velocity / 127, source: 'midi' });
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      listener({ type: 'off', midi, velocity: 0, source: 'midi' });
    }
  };

  const devices = () => Array.from(access.inputs.values()).map((i) => i.name ?? 'MIDI 장치');
  const attach = () => {
    access.inputs.forEach((input) => (input.onmidimessage = onMessage));
    onDevicesChange?.(devices());
  };
  attach();
  access.onstatechange = attach;

  return {
    devices,
    disconnect: () => {
      access.onstatechange = null;
      access.inputs.forEach((input) => (input.onmidimessage = null));
    },
  };
}
