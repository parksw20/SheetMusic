import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ensureAudio, noteOff, noteOn, playClicks, playNotes } from '../audio/synth';
import { createPractice, currentStep, isFinished, pressKey, summarize, type PracticeState } from '../engine/practice';
import { RhythmSession, type RhythmResult } from '../engine/rhythm';
import type { NoteInput } from '../input/types';
import { mirrorLeftFingering } from '../score/fingering';
import { buildSteps, filterByHand, midiToName, midiToSolfege, type NoteEvent, type Score, type Staff, type Step } from '../score/model';
import type { PracticeStyle, Settings } from '../storage';
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
  onSettings: (next: Settings) => void;
  bridge: MutableRefObject<InputBridge | null>;
  /** 연습을 마치면 별점을 알린다 */
  onFinished: (stars: number) => void;
  /** 마이크 진단 줄 (설정에서 켰을 때) */
  diagnostics: string | null;
}

/** idle 대기, practice 기다리기 연습, rhythm 박자 맞추기 연습, demo 듣기 */
type Mode = 'idle' | 'practice' | 'rhythm' | 'demo';

const TEMPOS = [
  { value: 60, label: '매우 느림' },
  { value: 80, label: '느림' },
  { value: 100, label: '보통' },
  { value: 120, label: '빠름' },
  { value: 140, label: '매우 빠름' },
];

const STYLES: { value: PracticeStyle; label: string }[] = [
  { value: 'wait', label: '기다리기' },
  { value: 'rhythm', label: '박자 맞추기' },
];

/** 친 음 표시가 악보에 남아 있는 시간 */
const MARK_MS = 1400;
/** 구간 반복: 끝까지 치고 처음으로 돌아가기까지 */
const LOOP_PAUSE_MS = 700;
/** 박자 맞추기 화면 갱신 간격 (ms) */
const FRAME_MS = 33;

export function PlayScreen({ xml, score, settings, onSettings, bridge, onFinished, diagnostics }: Props) {
  const { hand, practiceStyle } = settings;
  const [mode, setMode] = useState<Mode>('idle');
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [tempo, setTempo] = useState(100);
  const [resetKey, setResetKey] = useState(0);
  const [demoBeat, setDemoBeat] = useState<number | null>(null);
  const [result, setResult] = useState<{ result: RhythmResult | ReturnType<typeof summarize>; rhythm: boolean } | null>(null);
  const [marks, setMarks] = useState<PlayedMark[]>([]);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [loopCount, setLoopCount] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);
  const [loadingSound, setLoadingSound] = useState(false);
  // 박자 맞추기
  const rhythmRef = useRef<RhythmSession | null>(null);
  const [rhythmBeat, setRhythmBeat] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [rhythmStats, setRhythmStats] = useState({ hit: 0, wrong: 0, miss: 0 });

  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const stopDemoRef = useRef<(() => void) | null>(null);
  const stopClicksRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
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
  const bpm = (score.bpm * tempo) / 100;
  const shownXml = useMemo(() => (settings.mirrorLeftHand ? mirrorLeftFingering(xml) : xml), [xml, settings.mirrorLeftHand]);

  const stopRhythm = () => {
    window.clearTimeout(rafRef.current);
    stopClicksRef.current?.();
    stopClicksRef.current = null;
    rhythmRef.current = null;
    setRhythmBeat(null);
    setCountdown(null);
  };

  const stopAll = useCallback(() => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    stopRhythm();
    setMode('idle');
    setPractice(null);
    setDemoBeat(null);
    setResetKey((k) => k + 1);
  }, []);

  // 곡, 손, 구간, 연습 방식, 템포가 바뀌면 진행 중인 연습/재생을 멈춘다
  useEffect(stopAll, [steps, practiceStyle, tempo, stopAll]);
  useEffect(
    () => () => {
      stopDemoRef.current?.();
      window.clearTimeout(rafRef.current);
      stopClicksRef.current?.();
    },
    [],
  );

  const addMark = (midi: number, ok: boolean, beat: number, staffHint?: Staff) => {
    const staff: Staff = staffHint ?? (hand === 'left' ? 2 : hand === 'right' ? 1 : midi >= 60 ? 1 : 2);
    const id = ++markId.current;
    setMarks((m) => [...m.slice(-15), { id, midi, ok, beat, staff }]);
    later(() => setMarks((m) => m.filter((x) => x.id !== id)), MARK_MS);
  };

  // ── 기다리기: 맞는 음을 칠 때까지 기다린다 ──
  const begin = useCallback((list: Step[]) => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    setResult(null);
    setPractice(createPractice(list));
    setResetKey((k) => k + 1);
    setMode('practice');
  }, []);

  // ── 박자 맞추기: 한 마디 세고 나서 커서가 템포대로 흐른다 ──
  const beginRhythm = async () => {
    stopAll();
    setResult(null);
    await ensureAudio();
    const msPerBeat = 60000 / bpm;
    const [beats = '4', unit = '4'] = score.timeSignature.split('/');
    const count = unit === '4' ? Number(beats) || 4 : 4;
    const startAt = performance.now() + (count + 0.5) * msPerBeat;
    const session = new RhythmSession(rangeNotes, startAt, msPerBeat, rangeStart);
    rhythmRef.current = session;
    stopClicksRef.current = playClicks(count, msPerBeat, (startAt - performance.now()) / 1000 - count * (msPerBeat / 1000));
    setRhythmStats({ hit: 0, wrong: 0, miss: 0 });
    setResetKey((k) => k + 1);
    setMode('rhythm');
    const tick = () => {
      if (rhythmRef.current !== session) return;
      const now = performance.now();
      if (now < startAt) {
        setCountdown(Math.ceil((startAt - now) / msPerBeat));
        setRhythmBeat(rangeStart);
      } else {
        setCountdown(null);
        setRhythmBeat(session.beatAt(now));
      }
      for (const n of session.advance(now)) addMark(n.midi, false, n.startBeat, n.staff);
      const s = session.summary();
      setRhythmStats({ hit: s.correct, wrong: s.wrong, miss: s.missed });
      if (session.finished(now)) {
        if (loop) {
          setLoopCount((c) => c + 1);
          void beginRhythm();
        } else {
          rhythmRef.current = null;
          setMode('idle');
          setRhythmBeat(null);
          onFinished(s.stars);
          setResult({ result: s, rhythm: true });
        }
        return;
      }
      rafRef.current = window.setTimeout(tick, FRAME_MS);
    };
    tick();
  };

  const startPractice = () => {
    setLoopCount(0);
    if (practiceStyle === 'rhythm') {
      void beginRhythm();
      return;
    }
    void ensureAudio();
    begin(steps);
  };

  const startDemo = async () => {
    setLoadingSound(true);
    await ensureAudio();
    setLoadingSound(false);
    stopAll();
    setMode('demo');
    const shifted = rangeNotes.map((n) => ({ ...n, startBeat: n.startBeat - rangeStart }));
    // 재생은 0.1초 뒤 시작. 막대는 시간으로 부드럽게 움직인다
    const t0 = performance.now() + 100;
    const msPerBeat = 60000 / bpm;
    const timer = window.setInterval(() => setDemoBeat(rangeStart + Math.max(0, performance.now() - t0) / msPerBeat), FRAME_MS);
    const stopPlay = playNotes(
      shifted,
      bpm,
      () => undefined,
      () => {
        window.clearInterval(timer);
        stopDemoRef.current = null;
        setMode('idle');
        setDemoBeat(null);
      },
    );
    stopDemoRef.current = () => {
      window.clearInterval(timer);
      stopPlay();
    };
  };

  const handleNote = (e: NoteInput) => {
    // 마이크 입력은 이미 피아노 소리가 나고, 다시 재생하면 마이크로 되돌아 들어간다
    if (e.source === 'keyboard' || (e.source === 'midi' && settings.soundForMidi)) {
      if (e.type === 'on') void ensureAudio().then(() => noteOn(e.midi, e.velocity));
      else noteOff(e.midi);
    }
    if (e.type !== 'on') return;
    const time = e.time ?? performance.now();

    const session = rhythmRef.current;
    if (session) {
      if (time < session.startAt - 400) return; // 세는 동안 친 음은 판정하지 않는다
      const r = session.play(e.midi, time);
      if (r) addMark(e.midi, true, r.note.startBeat, r.note.staff);
      else {
        addMark(e.midi, false, session.beatAt(time));
        setWrong(e.midi);
        later(() => setWrong(null), 600);
      }
      return;
    }

    const current = practiceRef.current;
    const step = current && currentStep(current);
    if (!current || !step) return;
    const { state, result: pressed } = pressKey(current, e.midi, performance.now());
    practiceRef.current = state;
    setPractice(state);
    if (pressed === 'hit' || pressed === 'wrong') {
      addMark(e.midi, pressed === 'hit', step.startBeat, step.notes.find((n) => n.midi === e.midi)?.staff);
    }
    if (pressed === 'wrong') {
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
        setResult({ result: summarize(state), rhythm: false });
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
        const r = rhythmRef.current;
        if (r) return r.expected(performance.now());
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
  const running = practicing || mode === 'rhythm';
  const cursorBeat =
    mode === 'rhythm' && rhythmBeat !== null
      ? rhythmBeat
      : practicing
        ? (step?.startBeat ?? steps[steps.length - 1]?.startBeat ?? 0)
        : mode === 'demo' && demoBeat !== null
          ? demoBeat
          : rangeStart;
  const progress =
    mode === 'rhythm' && rhythmRef.current && rangeNotes.length
      ? Math.min(100, Math.round(((rhythmStats.hit + rhythmStats.miss) / rangeNotes.length) * 100))
      : practice && steps.length
        ? Math.round((practice.index / steps.length) * 100)
        : 0;
  /** 박자 맞추기: 곧 칠 음 (다음 음 이름 보기) */
  const upcoming: NoteEvent[] =
    mode === 'rhythm' && rhythmBeat !== null
      ? (() => {
          const next = rangeNotes.find((n) => n.startBeat >= rhythmBeat - 0.05);
          return next ? rangeNotes.filter((n) => n.startBeat === next.startBeat) : [];
        })()
      : (step?.notes ?? []);

  const chooseLoop = (range: LoopRange) => {
    setLoop(range);
    setSelecting(false);
  };

  return (
    <div className="play">
      <div className="play-bar">
        <div className="group">
          {running ? (
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
            <button className="btn" onClick={startDemo} disabled={!steps.length || loadingSound || running}>
              {loadingSound ? '피아노 소리 준비 중…' : '♪ 듣기'}
            </button>
          )}
          <button
            className={`btn${selecting || loop ? ' toggled' : ''}`}
            onClick={() => {
              if (loop && !selecting) setLoop(null);
              else setSelecting((v) => !v);
            }}
            aria-pressed={selecting || !!loop}
            disabled={running}
          >
            ⟲ {loop && !selecting ? '구간 해제' : '집중 연습'}
          </button>
          <div className="seg" role="radiogroup" aria-label="연습 방식">
            {STYLES.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={practiceStyle === s.value}
                className={practiceStyle === s.value ? 'on' : ''}
                onClick={() => onSettings({ ...settings, practiceStyle: s.value })}
                disabled={running}
              >
                {s.label}
              </button>
            ))}
          </div>
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

      {(selecting || loop || running) && (
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
          {running && (
            <>
              <div className="progress" aria-label={`진행률 ${progress}%`}>
                <div style={{ width: `${progress}%` }} />
              </div>
              <span className="stat">
                <span className="ok">✔ {mode === 'rhythm' ? rhythmStats.hit : practice?.correct}</span>
                <span className="ng">✘ {mode === 'rhythm' ? rhythmStats.wrong : practice?.wrong}</span>
                {mode === 'rhythm' && <span className="miss">놓침 {rhythmStats.miss}</span>}
              </span>
              {countdown !== null ? (
                <span className="next count" aria-live="polite">
                  {countdown}
                </span>
              ) : (
                settings.showHint &&
                upcoming.length > 0 && (
                  <span className={`next${wrong !== null ? ' wrong' : ''}`} aria-live="polite">
                    {wrong !== null
                      ? `✘ ${midiToSolfege(wrong)}`
                      : upcoming.map((n) => (
                          <span key={n.id} className={practice?.hit.includes(n.midi) ? 'done' : ''}>
                            {midiToSolfege(n.midi)}
                            <small>{midiToName(n.midi)}</small>
                          </span>
                        ))}
                  </span>
                )
              )}
            </>
          )}
        </div>
      )}

      {diagnostics && <p className="diag">{diagnostics}</p>}

      <ScoreView
        xml={shownXml}
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
        playhead={mode === 'rhythm' || mode === 'demo' ? cursorBeat : null}
      />

      {result && (
        <ResultPanel
          result={result.result}
          rhythm={result.rhythm ? (result.result as RhythmResult) : undefined}
          onRetry={startPractice}
          onClose={() => {
            setResult(null);
            stopAll();
          }}
        />
      )}
    </div>
  );
}
