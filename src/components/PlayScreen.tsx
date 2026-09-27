import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ensureAudio, noteOff, noteOn, playNotes } from '../audio/synth';
import { createPractice, currentStep, isFinished, pressKey, summarize, type PracticeState } from '../engine/practice';
import type { NoteInput } from '../input/types';
import { buildSteps, filterByHand, midiToName, midiToSolfege, type Score, type Staff, type Step } from '../score/model';
import type { Settings } from '../storage';
import { ResultPanel } from './ResultPanel';
import { ScoreView, type LoopRange, type PlayedMark } from './ScoreView';

/** 앱이 마이크·MIDI·키보드 입력을 연습 화면으로 넘기는 통로 */
export interface InputBridge {
  onNote: (e: NoteInput) => void;
  /** 지금 쳐야 하는(아직 안 친) 음. 연습 중이 아니면 빈 배열 */
  getExpected: () => number[];
}

interface Props {
  xml: string;
  score: Score;
  settings: Settings;
  bridge: MutableRefObject<InputBridge | null>;
  /** 연습을 마치면 별점을 알린다 */
  onFinished: (stars: number) => void;
  /** 마이크 진단 줄 (설정에서 켰을 때) */
  diagnostics: string | null;
}

type Mode = 'idle' | 'practice' | 'demo';

const TEMPOS = [
  { value: 60, label: '매우 느림' },
  { value: 80, label: '느림' },
  { value: 100, label: '보통' },
  { value: 120, label: '빠름' },
  { value: 140, label: '매우 빠름' },
];

/** 친 음 표시가 악보에 남아 있는 시간 */
const MARK_MS = 1400;
/** 구간 반복: 끝까지 치고 처음으로 돌아가기까지 */
const LOOP_PAUSE_MS = 700;

export function PlayScreen({ xml, score, settings, bridge, onFinished, diagnostics }: Props) {
  const { hand } = settings;
  const [mode, setMode] = useState<Mode>('idle');
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [tempo, setTempo] = useState(100);
  const [resetKey, setResetKey] = useState(0);
  const [demoBeat, setDemoBeat] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [marks, setMarks] = useState<PlayedMark[]>([]);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [loopCount, setLoopCount] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);

  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const stopDemoRef = useRef<(() => void) | null>(null);
  const markId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const notes = useMemo(() => filterByHand(score.notes, hand), [score, hand]);
  const rangeNotes = useMemo(
    () => (loop ? notes.filter((n) => n.measure >= loop.from && n.measure <= loop.to) : notes),
    [notes, loop],
  );
  const steps = useMemo(() => buildSteps(rangeNotes), [rangeNotes]);
  const rangeStart = loop ? (steps[0]?.startBeat ?? 0) : 0;

  const stopAll = useCallback(() => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    setMode('idle');
    setPractice(null);
    setDemoBeat(null);
    setResetKey((k) => k + 1);
  }, []);

  // 곡, 손, 구간이 바뀌면 진행 중인 연습/재생을 멈춘다
  useEffect(stopAll, [steps, stopAll]);
  useEffect(() => () => stopDemoRef.current?.(), []);

  const begin = useCallback((list: Step[]) => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    setShowResult(false);
    setPractice(createPractice(list));
    setResetKey((k) => k + 1);
    setMode('practice');
  }, []);

  const startPractice = () => {
    void ensureAudio();
    setLoopCount(0);
    begin(steps);
  };

  const startDemo = async () => {
    await ensureAudio();
    stopAll();
    setMode('demo');
    const shifted = rangeNotes.map((n) => ({ ...n, startBeat: n.startBeat - rangeStart }));
    stopDemoRef.current = playNotes(
      shifted,
      (score.bpm * tempo) / 100,
      (b) => setDemoBeat(b + rangeStart),
      () => {
        stopDemoRef.current = null;
        setMode('idle');
        setDemoBeat(null);
      },
    );
  };

  const addMark = (midi: number, ok: boolean, step: Step) => {
    const same = step.notes.find((n) => n.midi === midi);
    const staff: Staff = same?.staff ?? (hand === 'left' ? 2 : hand === 'right' ? 1 : midi >= 60 ? 1 : 2);
    const id = ++markId.current;
    setMarks((m) => [...m.slice(-11), { id, midi, ok, beat: step.startBeat, staff }]);
    later(() => setMarks((m) => m.filter((x) => x.id !== id)), MARK_MS);
  };

  const handleNote = (e: NoteInput) => {
    // 마이크 입력은 이미 피아노 소리가 나고, 다시 재생하면 마이크로 되돌아 들어간다
    if (e.source === 'keyboard' || (e.source === 'midi' && settings.soundForMidi)) {
      if (e.type === 'on') void ensureAudio().then(() => noteOn(e.midi, e.velocity));
      else noteOff(e.midi);
    }
    if (e.type !== 'on') return;
    const current = practiceRef.current;
    const step = current && currentStep(current);
    if (!current || !step) return;
    const { state, result } = pressKey(current, e.midi, performance.now());
    practiceRef.current = state;
    setPractice(state);
    if (result === 'hit' || result === 'wrong') addMark(e.midi, result === 'hit', step);
    if (result === 'wrong') {
      setWrong(e.midi);
      later(() => setWrong(null), 600);
    }
    if (isFinished(state) && !isFinished(current)) {
      if (loop) {
        // 구간 반복: 잠깐 쉬고 구간 처음으로
        setLoopCount((c) => c + 1);
        later(() => {
          if (practiceRef.current === state) begin(state.steps);
        }, LOOP_PAUSE_MS);
      } else {
        onFinished(summarize(state).stars);
        setShowResult(true);
      }
    }
  };

  // 입력 통로 연결
  const handleRef = useRef(handleNote);
  handleRef.current = handleNote;
  useEffect(() => {
    bridge.current = {
      onNote: (e) => handleRef.current(e),
      getExpected: () => {
        const p = practiceRef.current;
        const s = p && !isFinished(p) ? currentStep(p) : undefined;
        return s ? s.notes.map((n) => n.midi).filter((m) => !p!.hit.includes(m)) : [];
      },
    };
    return () => {
      bridge.current = null;
    };
  }, [bridge]);

  const step = practice ? currentStep(practice) : undefined;
  const practicing = mode === 'practice';
  const cursorBeat = practicing
    ? (step?.startBeat ?? steps[steps.length - 1]?.startBeat ?? 0)
    : mode === 'demo' && demoBeat !== null
      ? demoBeat
      : rangeStart;
  const progress = practice && steps.length ? Math.round((practice.index / steps.length) * 100) : 0;

  const chooseLoop = (range: LoopRange) => {
    setLoop(range);
    setSelecting(false);
  };

  return (
    <div className="play">
      <div className="play-bar">
        <div className="group">
          {practicing ? (
            <button className="btn danger-soft" onClick={stopAll}>
              ■ 그만하기
            </button>
          ) : (
            <button className="btn primary" onClick={startPractice} disabled={!steps.length}>
              ▶ 연습 시작
            </button>
          )}
          {mode === 'demo' ? (
            <button className="btn" onClick={stopAll}>
              ■ 멈추기
            </button>
          ) : (
            <button className="btn" onClick={startDemo} disabled={!steps.length}>
              ♪ 듣기
            </button>
          )}
          <button
            className={`btn${selecting || loop ? ' toggled' : ''}`}
            onClick={() => {
              if (loop && !selecting) setLoop(null);
              else setSelecting((v) => !v);
            }}
            aria-pressed={selecting || !!loop}
          >
            ⟲ {loop && !selecting ? '구간 해제' : '집중 연습'}
          </button>
        </div>
        <div className="seg tempo" role="radiogroup" aria-label="템포">
          {TEMPOS.map((t) => (
            <button
              key={t.value}
              role="radio"
              aria-checked={tempo === t.value}
              className={tempo === t.value ? 'on' : ''}
              onClick={() => setTempo(t.value)}
            >
              {t.label}
              <small>{t.value}%</small>
            </button>
          ))}
        </div>
      </div>

      {(selecting || loop || practicing) && (
        <div className="play-status">
          {selecting ? (
            <span className="hint">
              반복할 마디를 악보에서 드래그하세요. 화면 끝으로 끌면 악보가 스크롤돼요.
              <button className="btn ghost small" onClick={() => setSelecting(false)}>
                취소
              </button>
            </span>
          ) : (
            loop && (
              <span className="chip accent">
                {loop.from === loop.to ? `${loop.from}마디` : `${loop.from}–${loop.to}마디`} 반복
                {loopCount > 0 && <b> · {loopCount}회</b>}
              </span>
            )
          )}
          {practicing && practice && (
            <>
              <div className="progress" aria-label={`진행률 ${progress}%`}>
                <div style={{ width: `${progress}%` }} />
              </div>
              <span className="stat">
                <span className="ok">✔ {practice.correct}</span>
                <span className="ng">✘ {practice.wrong}</span>
              </span>
              {settings.showHint && step && (
                <span className={`next${wrong !== null ? ' wrong' : ''}`} aria-live="polite">
                  {wrong !== null
                    ? `✘ ${midiToSolfege(wrong)}`
                    : step.notes.map((n) => (
                        <span key={n.id} className={practice.hit.includes(n.midi) ? 'done' : ''}>
                          {midiToSolfege(n.midi)}
                          <small>{midiToName(n.midi)}</small>
                        </span>
                      ))}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {diagnostics && <p className="diag">{diagnostics}</p>}

      <ScoreView
        xml={xml}
        cursorBeat={cursorBeat}
        markPassed={practicing}
        colorFromBeat={rangeStart}
        hand={hand}
        resetKey={resetKey}
        fingering={settings.fingering}
        marks={marks}
        loop={loop}
        selecting={selecting}
        onSelectLoop={chooseLoop}
      />

      {showResult && practice && (
        <ResultPanel
          result={summarize(practice)}
          onRetry={startPractice}
          onClose={() => {
            setShowResult(false);
            stopAll();
          }}
        />
      )}
    </div>
  );
}
