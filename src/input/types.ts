export type InputSource = 'midi' | 'keyboard' | 'mic';

export interface NoteInput {
  type: 'on' | 'off';
  midi: number;
  /** 0~1 */
  velocity: number;
  source: InputSource;
  /**
   * 음이 실제로 시작된 시각 (performance.now 기준 ms). 마이크는 인식이 늦게 끝나도 친 순간을 알려 준다.
   * 없으면 이벤트를 받은 시각으로 본다.
   */
  time?: number;
}

export type NoteListener = (e: NoteInput) => void;
