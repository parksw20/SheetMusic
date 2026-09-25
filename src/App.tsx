import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureAudio, noteOff, noteOn, playNotes } from './audio/synth';
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
import { isMicSupported, startMic, type MicSession } from './input/mic';
import { connectMidi, isMidiSupported, type MidiConnection } from './input/midi';
import type { Sensitivity } from './input/pitch';
import type { NoteInput } from './input/types';
import {
  buildSteps,
  filterByHand,
  midiToName,
  midiToSolfege,
  type HandFilter,
  type Score,
} from './score/model';
import { parseMusicXml } from './score/parseMusicXml';
import { loadBestStars, loadSensitivity, loadZoom, saveBestStars, saveSensitivity, saveZoom } from './storage';

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

const SENSITIVITIES: { value: Sensitivity; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'normal', label: '보통' },
  { value: 'high', label: '높음' },
];

const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.4;

export default function App() {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [songKey, setSongKey] = useState<string>('');
  const [xml, setXml] = useState<string | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [hand, setHand] = useState<HandFilter>('both');
  const [tempo, setTempo] = useState(100); // %
  const [zoom, setZoom] = useState(loadZoom);
  const [mode, setMode] = useState<Mode>('idle');
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [demoBeat, setDemoBeat] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [bestStars, setBestStars] = useState<Record<string, number>>(loadBestStars);

  const [wrong, setWrong] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [midiDevices, setMidiDevices] = useState<string[] | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [soundForMidi, setSoundForMidi] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(loadSensitivity);

  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const stopDemoRef = useRef<(() => void) | null>(null);
  const midiRef = useRef<MidiConnection | null>(null);
  const wrongTimer = useRef<number | undefined>(undefined);
  const keyboardBase = useRef(60);
  const micRef = useRef<MicSession | null>(null);
  const micLevelRef = useRef<HTMLDivElement>(null);

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
    setResetKey((k) => k + 1);
  }, []);

  // 곡이나 손을 바꾸면 진행 중인 연습/재생을 멈춘다
  useEffect(stopAll, [steps, stopAll]);

  const startPractice = async () => {
    await ensureAudio();
    stopDemoRef.current?.();
    stopDemoRef.current = null;
    setShowResult(false);
    setPractice(createPractice(steps));
    setResetKey((k) => k + 1);
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

  const changeZoom = (delta: number) => {
    setZoom((z) => {
      const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)) * 10) / 10;
      saveZoom(next);
      return next;
    });
  };

  const handleNote = useCallback(
    (e: NoteInput) => {
      // 마이크 입력은 이미 피아노 소리가 나고, 다시 재생하면 마이크로 되돌아 들어간다
      if (e.source === 'keyboard' || (e.source === 'midi' && soundForMidi)) {
        if (e.type === 'on') void ensureAudio().then(() => noteOn(e.midi, e.velocity));
        else noteOff(e.midi);
      }
      if (e.type !== 'on') return;

      const current = practiceRef.current;
      if (!current) return;
      const { state, result } = pressKey(current, e.midi, performance.now());
      practiceRef.current = state;
      setPractice(state);
      if (result === 'wrong') {
        setWrong(e.midi);
        window.clearTimeout(wrongTimer.current);
        wrongTimer.current = window.setTimeout(() => setWrong(null), 500);
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

  // 컴퓨터(외장) 키보드
  useEffect(
    () =>
      listenComputerKeyboard(
        handleNote,
        () => keyboardBase.current,
        (d) => (keyboardBase.current = Math.min(96, Math.max(24, keyboardBase.current + d))),
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

  // 마이크: 연습 중일 때만 아직 안 친 기대 음을 넘긴다
  const toggleMic = async () => {
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
      setMicOn(false);
      return;
    }
    try {
      micRef.current = await startMic(
        (e) => handleNoteRef.current(e),
        () => {
          const p = practiceRef.current;
          const s = p && !isFinished(p) ? currentStep(p) : undefined;
          return s ? s.notes.map((n) => n.midi).filter((m) => !p!.hit.includes(m)) : [];
        },
        (level) => {
          if (micLevelRef.current) micLevelRef.current.style.width = `${Math.round(level * 100)}%`;
        },
        sensitivity,
      );
      setMicOn(true);
      setMicError(null);
    } catch {
      setMicError(
        window.isSecureContext
          ? '마이크 권한이 거부되었습니다. 설정에서 마이크를 허용해 주세요.'
          : '마이크는 HTTPS 주소에서만 쓸 수 있어요. (npm run dev:ipad 참고)',
      );
    }
  };
  useEffect(() => () => micRef.current?.stop(), []);

  const changeSensitivity = (s: Sensitivity) => {
    setSensitivity(s);
    saveSensitivity(s);
    micRef.current?.setSensitivity(s);
  };

  const onUpload = async (file: File) => {
    stopAll();
    setSongKey(`upload:${file.name}`);
    loadXml(await file.text());
  };

  const step = practice ? currentStep(practice) : undefined;
  const cursorBeat =
    mode === 'practice' ? (step?.startBeat ?? score?.totalBeats ?? 0) : mode === 'demo' ? demoBeat : 0;
  const progress = practice && steps.length ? Math.round((practice.index / steps.length) * 100) : 0;
  const practicing = mode === 'practice';

  return (
    <div className="app">
      {!practicing && (
        <header className="toolbar">
          <select className="song" value={songKey} onChange={(e) => setSongKey(e.target.value)} aria-label="곡">
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

          <label className="button">
            악보 열기
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

          <label className="tempo">
            템포 {tempo}%
            <input
              type="range"
              min={40}
              max={150}
              step={10}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
          </label>

          <label className="check">
            <input type="checkbox" checked={showHint} onChange={(e) => setShowHint(e.target.checked)} />
            다음 음 표시
          </label>

          <span className="midi">
            {midiDevices ? (
              <>
                {midiDevices.length ? `🎛 ${midiDevices.join(', ')}` : '🎛 연결된 MIDI 장치 없음'}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={soundForMidi}
                    onChange={(e) => setSoundForMidi(e.target.checked)}
                  />
                  입력음 재생
                </label>
              </>
            ) : (
              isMidiSupported() && <button onClick={connectMidiDevice}>MIDI 연결</button>
            )}
            {midiError && <span className="error">{midiError}</span>}
          </span>
        </header>
      )}

      <section className="controls">
        {mode === 'idle' && (
          <>
            <button className="primary" onClick={startPractice} disabled={!steps.length}>
              ▶ 연습 시작
            </button>
            <button onClick={startDemo} disabled={!steps.length}>
              ♪ 들어보기
            </button>
            <span className="title">
              {score?.title}
              {score?.composer && <small> · {score.composer}</small>}
            </span>
          </>
        )}
        {mode === 'demo' && <button onClick={stopAll}>■ 멈추기</button>}
        {practicing && practice && (
          <>
            <button onClick={stopAll}>■ 그만하기</button>
            <button onClick={startPractice}>↺ 처음부터</button>
            <div className="progress" aria-label={`진행률 ${progress}%`}>
              <div style={{ width: `${progress}%` }} />
            </div>
            <span className="stat">
              <span className="ok">✔ {practice.correct}</span> <span className="ng">✘ {practice.wrong}</span>
            </span>
            {showHint && step && (
              <span className={`next${wrong !== null ? ' wrong' : ''}`} aria-live="polite">
                {wrong !== null
                  ? `✘ ${midiToSolfege(wrong)} (${midiToName(wrong)})`
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

        {isMicSupported() && (
          <span className="mic">
            <button className={micOn ? 'active' : ''} onClick={toggleMic} aria-pressed={micOn}>
              {micOn ? '🎤 듣는 중' : '🎤 마이크 켜기'}
            </button>
            {micOn && (
              <span className="meter" aria-hidden>
                <span ref={micLevelRef} />
              </span>
            )}
            <select
              value={sensitivity}
              onChange={(e) => changeSensitivity(e.target.value as Sensitivity)}
              aria-label="마이크 감도"
            >
              {SENSITIVITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  감도 {s.label}
                </option>
              ))}
            </select>
          </span>
        )}

        <span className="zoom" role="group" aria-label="악보 크기">
          <button onClick={() => changeZoom(-0.1)} disabled={zoom <= ZOOM_MIN} aria-label="작게">
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.1)} disabled={zoom >= ZOOM_MAX} aria-label="크게">
            +
          </button>
        </span>
      </section>

      {loadError && <p className="error">{loadError}</p>}
      {micError && <p className="error">{micError}</p>}
      {xml && (
        <ScoreView
          xml={xml}
          cursorBeat={cursorBeat}
          zoom={zoom}
          markPassed={practicing}
          hand={hand}
          resetKey={resetKey}
          wrongFlash={wrong !== null}
        />
      )}

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
