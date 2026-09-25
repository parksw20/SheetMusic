export type InputSource = 'midi' | 'keyboard' | 'mic';

export interface NoteInput {
  type: 'on' | 'off';
  midi: number;
  /** 0~1 */
  velocity: number;
  source: InputSource;
}

export type NoteListener = (e: NoteInput) => void;
