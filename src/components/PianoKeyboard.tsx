import { useRef } from 'react';
import { KEYBOARD_HINT } from '../input/computerKeyboard';
import { isBlackKey, midiToSolfege } from '../score/model';

interface Props {
  from: number;
  to: number;
  /** 지금 쳐야 하는 음 */
  expected: number[];
  /** 현재 Step에서 이미 맞게 친 음 */
  hit: number[];
  /** 눌려 있는 음 */
  pressed: Set<number>;
  /** 방금 틀린 음 */
  wrong: number | null;
  showNames: boolean;
  /** 컴퓨터 키보드 A 키에 해당하는 음 */
  keyboardBase: number;
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
}

/** 화면 건반. 마우스/터치로 칠 수 있고, 쳐야 할 음과 결과를 색으로 보여준다. */
export function PianoKeyboard(props: Props) {
  const { from, to, expected, hit, pressed, wrong, showNames, keyboardBase, onNoteOn, onNoteOff } = props;
  const active = useRef(new Map<number, number>()); // pointerId → midi

  const whites: number[] = [];
  for (let m = from; m <= to; m++) if (!isBlackKey(m)) whites.push(m);
  const whiteWidth = 100 / whites.length;

  const keyClass = (m: number) => {
    const cls = ['key', isBlackKey(m) ? 'black' : 'white'];
    if (wrong === m) cls.push('wrong');
    else if (hit.includes(m)) cls.push('hit');
    else if (expected.includes(m)) cls.push('expected');
    if (pressed.has(m)) cls.push('pressed');
    return cls.join(' ');
  };

  const down = (e: React.PointerEvent, m: number) => {
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    active.current.set(e.pointerId, m);
    onNoteOn(m);
  };
  const up = (e: React.PointerEvent) => {
    const m = active.current.get(e.pointerId);
    if (m === undefined) return;
    active.current.delete(e.pointerId);
    onNoteOff(m);
  };
  // 누른 채로 다른 건반으로 미끄러지면(글리산도) 음을 바꾼다
  const enter = (e: React.PointerEvent, m: number) => {
    const prev = active.current.get(e.pointerId);
    if (prev === undefined || prev === m) return;
    onNoteOff(prev);
    active.current.set(e.pointerId, m);
    onNoteOn(m);
  };

  const label = (m: number) => {
    const hint = KEYBOARD_HINT[m - keyboardBase];
    return (
      <span className="label">
        {showNames && <span className="name">{midiToSolfege(m)}</span>}
        {hint && <span className="hint">{hint}</span>}
      </span>
    );
  };

  return (
    <div className="piano" onPointerUp={up} onPointerCancel={up} onPointerLeave={up}>
      {whites.map((m, i) => (
        <div
          key={m}
          className={keyClass(m)}
          style={{ left: `${i * whiteWidth}%`, width: `${whiteWidth}%` }}
          onPointerDown={(e) => down(e, m)}
          onPointerEnter={(e) => enter(e, m)}
        >
          {label(m)}
        </div>
      ))}
      {whites.map((w, i) =>
        w + 1 <= to && isBlackKey(w + 1) ? (
          <div
            key={w + 1}
            className={keyClass(w + 1)}
            style={{ left: `${(i + 1) * whiteWidth - whiteWidth * 0.3}%`, width: `${whiteWidth * 0.6}%` }}
            onPointerDown={(e) => down(e, w + 1)}
            onPointerEnter={(e) => enter(e, w + 1)}
          >
            {label(w + 1)}
          </div>
        ) : null,
      )}
    </div>
  );
}
