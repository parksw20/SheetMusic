import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureAudio, noteOff, noteOn, playNotes } from './audio/synth';
import { PianoKeyboard } from './components/PianoKeyboard';
import { ResultPanel } from './components/ResultPanel';
import { ScoreView } from './components/ScoreView';
import {
  createPractice,
  currentStep,
  isFinished,
  pressKey,
  summarize,
  type PracticeState,
} from './engine/practice';
import { listenComputerKeyboard } from './input/computerKeyboard';
import { connectMidi, isMidiSupported, type MidiConnection } from './input/midi';
import type { NoteInput } from './input/types';
import { buildSteps, filterByHand, type HandFilter, type Score } from './score/model';
import { parseMusicXml } from './score/parseMusicXml';
import { loadBestStars, saveBestStars } from './storage';

interface SongInfo {
  file: string;
  title: string;
  composer: string;
}

type Mode = 'idle' | 'practice' | 'demo';

const HANDS: { value: HandFilter; label: string }[] = [
  { value: 'both', label: '양손' },
  { value: 'right', label: '오른손' },
  { value: 'left', label: '왼손' },
];

export default function App() {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [songKey, setSongKey] = useState<string>('');
  const [xml, setXml] = useState<string | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [hand, setHand] = useState<HandFilter>('both');
  const [tempo, setTempo] = useState(100); // %
  const [mode, setMode] = useState<Mode>('idle');
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [demoBeat, setDemoBeat] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [bestStars, setBestStars] = useState<Record<string, number>>(loadBestStars);

  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null);
  const [showNames, setShowNames] = useState(true);
  const [keyboardBase, setKeyboardBase] = useState(60);
  const [midiDevices, setMidiDevices] = useState<string[] | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [soundForMidi, setSoundForMidi] = useState(false);

  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const stopDemoRef = useRef<(() => void) | null>(null);
  const midiRef = useRef<MidiConnection | null>(null);
  const wrongTimer = useRef<number | undefined>(undefined);

  // 곡 목록
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}songs/index.json`)
      .then((r) => r.json())
      .then((list: SongInfo[]) => {
        setSongs(list);
        if (list[0]) setSongKey(list[0].file);
      })
      .catch(() => setLoadError('곡 목록을 불러오지 못했습니다.'));
  }, []);

  // 곡 불러오기 (내장 곡)
  useEffect(() => {
    if (!songKey || songKey.startsWith('upload:')) return;
    fetch(`${import.meta.env.BASE_URL}songs/${songKey}`)
      .then((r) => r.text())
      .then(loadXml)
      .catch(() => setLoadError('악보를 불러오지 못했습니다.'));
  }, [songKey]);

  function loadXml(text: string) {
    try {
      setScore(parseMusicXml(text));
      setXml(text);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  const notes = useMemo(() => (score ? filterByHand(score.notes, hand) : []), [score, hand]);
  const steps = useMemo(() => buildSteps(notes), [notes]);

  const stopAll = useCallback(() => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    setMode('idle');
    setPractice(null);
    setDemoBeat(0);
  }, []);

  // 곡이나 손을 바꾸면 진행 중인 연습/재생을 멈춘다
  useEffect(stopAll, [steps, stopAll]);

  const startPractice = async () => {
    await ensureAudio();
    stopDemoRef.current?.();
    setShowResult(false);
    setPractice(createPractice(steps));
    setMode('practice');
  };

  const startDemo = async () => {
    if (!score) return;
    await ensureAudio();
    stopAll();
    setMode('demo');
    stopDemoRef.current = playNotes(notes, (score.bpm * tempo) / 100, setDemoBeat, () => {
      stopDemoRef.current = null;
      setMode('idle');
      setDemoBeat(0);
    });
  };

  const handleNote = useCallback(
    (e: NoteInput) => {
      if (e.source !== 'midi' || soundForMidi) {
        if (e.type === 'on') void ensureAudio().then(() => noteOn(e.midi, e.velocity));
        else noteOff(e.midi);
      }
      setPressed((prev) => {
        const next = new Set(prev);
        if (e.type === 'on') next.add(e.midi);
        else next.delete(e.midi);
        return next;
      });
      if (e.type !== 'on') return;

      const current = practiceRef.current;
      if (!current) return;
      const { state, result } = pressKey(current, e.midi, performance.now());
      practiceRef.current = state;
      setPractice(state);
      if (result === 'wrong') {
        setWrong(e.midi);
        window.clearTimeout(wrongTimer.current);
        wrongTimer.current = window.setTimeout(() => setWrong(null), 400);
      }
      if (isFinished(state) && !isFinished(current)) setShowResult(true);
    },
    [soundForMidi],
  );

  // 결과 저장
  useEffect(() => {
    if (!practice || !isFinished(practice) || !songKey) return;
    const key = `${songKey}#${hand}`;
    const stars = summarize(practice).stars;
    setBestStars((prev) => {
      if ((prev[key] ?? -1) >= stars) return prev;
      const next = { ...prev, [key]: stars };
      saveBestStars(next);
      return next;
    });
  }, [practice, songKey, hand]);

  // 컴퓨터 키보드
  const baseRef = useRef(keyboardBase);
  baseRef.current = keyboardBase;
  useEffect(
    () =>
      listenComputerKeyboard(
        handleNote,
        () => baseRef.current,
        (d) => setKeyboardBase((b) => Math.min(96, Math.max(24, b + d))),
      ),
    [handleNote],
  );

  // MIDI 연결 해제
  useEffect(() => () => midiRef.current?.disconnect(), []);
  const handleNoteRef = useRef(handleNote);
  handleNoteRef.current = handleNote;

  const connectMidiDevice = async () => {
    try {
      midiRef.current?.disconnect();
      midiRef.current = await connectMidi((e) => handleNoteRef.current(e), setMidiDevices);
      setMidiError(null);
    } catch {
      setMidiError('MIDI 권한이 거부되었거나 사용할 수 없습니다.');
    }
  };

  const onUpload = async (file: File) => {
    stopAll();
    setSongKey(`upload:${file.name}`);
    loadXml(await file.text());
  };

  // 건반 범위: 곡의 음역을 옥타브 단위로 넓혀서 최소 2옥타브
  const [rangeFrom, rangeTo] = useMemo(() => {
    const midis = score?.notes.map((n) => n.midi) ?? [];
    let lo = Math.floor(Math.min(60, ...midis) / 12) * 12;
    let hi = Math.ceil((Math.max(71, ...midis) + 1) / 12) * 12 - 1;
    if (hi - lo < 23) hi = lo + 23;
    lo = Math.max(21, lo);
    return [lo, Math.min(108, hi)];
  }, [score]);

  const step = practice ? currentStep(practice) : undefined;
  const expected =
    mode === 'practice' && step
      ? step.notes.map((n) => n.midi)
      : mode === 'demo'
        ? (steps.find((s) => s.startBeat === demoBeat)?.notes.map((n) => n.midi) ?? [])
        : [];
  const cursorBeat = mode === 'practice' ? (step?.startBeat ?? score?.totalBeats ?? 0) : mode === 'demo' ? demoBeat : 0;
  const progress = practice && steps.length ? Math.round((practice.index / steps.length) * 100) : 0;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>🎹 SheetMusic</h1>

        <label>
          곡
          <select value={songKey} onChange={(e) => setSongKey(e.target.value)}>
            {songs.map((s) => {
              const stars = bestStars[`${s.file}#both`];
              return (
                <option key={s.file} value={s.file}>
                  {s.title}
                  {stars !== undefined ? ` ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : ''}
                </option>
              );
            })}
            {songKey.startsWith('upload:') && <option value={songKey}>{songKey.slice(7)}</option>}
          </select>
        </label>

        <label className="upload">
          MusicXML 열기
          <input
            type="file"
            accept=".musicxml,.xml"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>

        <div className="segmented" role="group" aria-label="연습할 손">
          {HANDS.map((h) => (
            <button key={h.value} className={hand === h.value ? 'active' : ''} onClick={() => setHand(h.value)}>
              {h.label}
            </button>
          ))}
        </div>

        <label>
          템포 {tempo}%
          <input type="range" min={40} max={150} step={10} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </label>

        <label className="check">
          <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
          계이름
        </label>
      </header>

      <section className="controls">
        {mode === 'idle' && (
          <>
            <button className="primary" onClick={startPractice} disabled={!steps.length}>
              ▶ 연습 시작 (대기 모드)
            </button>
            <button onClick={startDemo} disabled={!steps.length}>
              ♪ 들어보기
            </button>
          </>
        )}
        {mode !== 'idle' && <button onClick={stopAll}>■ 멈추기</button>}
        {mode === 'practice' && practice && (
          <>
            <button onClick={startPractice}>↺ 처음부터</button>
            <div className="progress" aria-label="진행률">
              <div style={{ width: `${progress}%` }} />
            </div>
            <span className="stat">
              ✔ {practice.correct} ✘ {practice.wrong}
            </span>
          </>
        )}

        <span className="midi">
          {midiDevices ? (
            midiDevices.length ? `🎛 ${midiDevices.join(', ')}` : '🎛 연결된 MIDI 장치 없음'
          ) : isMidiSupported() ? (
            <button onClick={connectMidiDevice}>MIDI 키보드 연결</button>
          ) : (
            '이 브라우저는 MIDI를 지원하지 않아요 (Chrome/Edge 권장)'
          )}
          {midiDevices && (
            <label className="check">
              <input type="checkbox" checked={soundForMidi} onChange={(e) => setSoundForMidi(e.target.checked)} />
              MIDI 입력음 재생
            </label>
          )}
          {midiError && <span className="error">{midiError}</span>}
        </span>
      </section>

      {loadError && <p className="error">{loadError}</p>}
      {xml && <ScoreView xml={xml} cursorBeat={cursorBeat} />}

      <footer className="keyboard-area">
        <PianoKeyboard
          from={rangeFrom}
          to={rangeTo}
          expected={expected}
          hit={practice?.hit ?? []}
          pressed={pressed}
          wrong={wrong}
          showNames={showNames}
          keyboardBase={keyboardBase}
          onNoteOn={(midi) => handleNote({ type: 'on', midi, velocity: 0.8, source: 'screen' })}
          onNoteOff={(midi) => handleNote({ type: 'off', midi, velocity: 0, source: 'screen' })}
        />
        <p className="help">
          컴퓨터 키보드: A~; 흰 건반, W E T Y U O P 검은 건반, Z/X 옥타브 이동
        </p>
      </footer>

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
