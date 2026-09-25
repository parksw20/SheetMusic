import type { NoteListener } from './types';

// 외장 키보드(iPad 매직 키보드 등)로 연습할 때 쓴다.
// 한글 입력 상태에서도 동작하도록 e.key 대신 물리 키 위치(e.code)를 쓴다.
// 아랫줄(A S D F ...)이 흰 건반, 윗줄(W E T Y U ...)이 검은 건반.
const KEY_TO_OFFSET: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/**
 * 컴퓨터 키보드를 피아노처럼 쓴다. Z/X로 옥타브를 내리고 올린다.
 * getBaseMidi는 현재 기준 음(A 키의 음)을 돌려준다.
 */
export function listenComputerKeyboard(
  listener: NoteListener,
  getBaseMidi: () => number,
  onOctaveShift: (delta: number) => void,
): () => void {
  const down = new Map<string, number>();

  const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      onOctaveShift(e.code === 'KeyZ' ? -12 : 12);
      return;
    }
    const off = KEY_TO_OFFSET[e.code];
    if (off === undefined) return;
    e.preventDefault();
    const midi = getBaseMidi() + off;
    down.set(e.code, midi);
    listener({ type: 'on', midi, velocity: 0.8, source: 'keyboard' });
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const midi = down.get(e.code);
    if (midi === undefined) return;
    down.delete(e.code);
    listener({ type: 'off', midi, velocity: 0, source: 'keyboard' });
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
