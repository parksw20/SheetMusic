import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { Logo } from './components/Logo';
import { PlayScreen, type InputBridge } from './components/PlayScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { TranscribeDialog } from './components/TranscribeDialog';
import { listenComputerKeyboard } from './input/computerKeyboard';
import { isMicSupported, MODEL_URL, startMic, type MicDiagnostics, type MicSession, type MicStatus } from './input/mic';
import { connectMidi, isMidiSupported, type MidiConnection } from './input/midi';
import type { NoteInput } from './input/types';
import type { Score } from './score/model';
import { parseMusicXml } from './score/parseMusicXml';
import { fetchBuiltinSongs, loadSongXml, MY_LEVEL, MY_LEVEL_NAME, mySongEntries, splitTitle, type SongEntry } from './songs';
import {
  loadBestStars,
  loadLevel,
  loadMySongs,
  loadSettings,
  saveBestStars,
  saveLevel,
  saveMySongs,
  saveSettings,
  type MySong,
  type Settings,
} from './storage';
import { YOUTUBE_MODE_HASH } from './transcribe/youtube';
import { CURRENT, fetchDeployed, reloadTo, versionLabel, type VersionInfo } from './version';

type MicState = 'off' | 'starting' | 'error' | MicStatus;

const MIC_TEXT: Record<MicState, string> = {
  off: '마이크 켜기',
  starting: '마이크 켜는 중',
  error: '마이크 다시 켜기',
  loading: 'AI 준비 중',
  warming: '듣는 중',
  ai: '듣는 중',
  basic: '듣는 중 (기본)',
};

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

export default function App() {
  const [builtin, setBuiltin] = useState<SongEntry[]>([]);
  const [mySongs, setMySongs] = useState<MySong[]>(loadMySongs);
  const [level, setLevel] = useState<number>(() => loadLevel() ?? 1);
  const [listError, setListError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  /** 유튜브 모드(?nocoi)로 열렸으면 바로 악보 만들기 창을 연다 */
  const youtubeMode = location.hash === YOUTUBE_MODE_HASH;
  const [showTranscribe, setShowTranscribe] = useState(youtubeMode);
  const [bestStars, setBestStars] = useState<Record<string, number>>(loadBestStars);

  const [song, setSong] = useState<SongEntry | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; xml: string; score: Score } | null>(null);
  const [songError, setSongError] = useState<string | null>(null);

  const [micState, setMicState] = useState<MicState>('off');
  const [micError, setMicError] = useState<string | null>(null);
  const [diag, setDiag] = useState<MicDiagnostics | null>(null);
  const [inference, setInference] = useState<{ ms: number; backend: string } | null>(null);
  const [heard, setHeard] = useState<number | null>(null);
  const micRef = useRef<MicSession | null>(null);
  const micLevelRef = useRef<HTMLSpanElement>(null);
  const heardTimer = useRef<number | undefined>(undefined);

  const [midiDevices, setMidiDevices] = useState<string[] | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const midiRef = useRef<MidiConnection | null>(null);
  const keyboardBase = useRef(60);
  const [deployed, setDeployed] = useState<VersionInfo | null>(null);

  /** 연습 화면이 등록하는 입력 통로 (마이크·MIDI·키보드 → 연습) */
  const bridge = useRef<InputBridge | null>(null);
  const sendNote = useCallback((e: NoteInput) => bridge.current?.onNote(e), []);

  // AI 인식기를 앱을 열 때 미리 불러 둔다 (마이크를 켤 때 기다리지 않게)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./input/aiClient').then((m) => m.preloadAi(MODEL_URL)).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  // 새 버전 확인: 앱을 열 때, 5분마다, 다른 앱에 갔다 돌아왔을 때
  useEffect(() => {
    if (CURRENT.commit === 'dev') return;
    const check = () => void fetchDeployed().then((v) => v && v.commit !== CURRENT.commit && setDeployed(v));
    check();
    const timer = window.setInterval(check, 5 * 60 * 1000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    fetchBuiltinSongs()
      .then(setBuiltin)
      .catch(() => setListError('곡 목록을 불러오지 못했습니다.'));
  }, []);

  const allSongs = useMemo(() => [...builtin, ...mySongEntries(mySongs)], [builtin, mySongs]);
  const levels = useMemo(() => {
    const map = new Map(builtin.map((s) => [s.level, s.levelName]));
    if (mySongs.length) map.set(MY_LEVEL, MY_LEVEL_NAME);
    return [...map.entries()].sort(([a], [b]) => (a || 99) - (b || 99));
  }, [builtin, mySongs]);
  const levelSongs = allSongs.filter((s) => s.level === level);

  const changeLevel = (next: number) => {
    setLevel(next);
    saveLevel(next);
  };

  const changeSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
    micRef.current?.setSensitivity(next.sensitivity);
  };

  // ── 마이크: 곡에 들어가면 켜고, 나오면 끈다 ──
  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setMicState('off');
    setDiag(null);
  }, []);

  /** 사용자가 누른 순간(클릭 처리 안)에 불러야 iPad에서 소리를 받을 수 있다 */
  const startMicSession = () => {
    if (!isMicSupported() || micRef.current) return;
    setMicState('starting');
    setMicError(null);
    startMic({
      listener: sendNote,
      getExpected: () => bridge.current?.getExpected() ?? [],
      onLevel: (v) => {
        if (micLevelRef.current) micLevelRef.current.style.transform = `scaleX(${v.toFixed(3)})`;
      },
      onStatus: setMicState,
      onInferenceMs: (ms, backend) => setInference({ ms, backend }),
      onDiagnostics: setDiag,
      onHeard: (midi) => {
        setHeard(midi);
        window.clearTimeout(heardTimer.current);
        heardTimer.current = window.setTimeout(() => setHeard(null), 1500);
      },
      sensitivity: settings.sensitivity,
    })
      .then((session) => {
        micRef.current = session;
      })
      .catch(() => {
        setMicState('error');
        setMicError(
          window.isSecureContext
            ? '마이크 권한이 없어요. iPad 설정에서 이 사이트의 마이크를 허용해 주세요.'
            : '마이크는 HTTPS 주소에서만 쓸 수 있어요.',
        );
      });
  };
  useEffect(() => () => micRef.current?.stop(), []);

  const openSong = (s: SongEntry) => {
    startMicSession();
    setSong(s);
    setSongError(null);
    loadSongXml(s)
      .then((xml) => setLoaded({ key: s.key, xml, score: parseMusicXml(xml) }))
      .catch((e: unknown) => setSongError(e instanceof Error ? e.message : String(e)));
  };

  const goHome = () => {
    stopMic();
    setSong(null);
    setLoaded(null);
  };

  const onFinished = (stars: number) => {
    if (!song) return;
    const key = `${song.key}#${settings.hand}`;
    setBestStars((prev) => {
      if ((prev[key] ?? -1) >= stars) return prev;
      const next = { ...prev, [key]: stars };
      saveBestStars(next);
      return next;
    });
  };

  // 컴퓨터(외장) 키보드
  useEffect(
    () =>
      listenComputerKeyboard(
        sendNote,
        () => keyboardBase.current,
        (d) => (keyboardBase.current = Math.min(96, Math.max(24, keyboardBase.current + d))),
      ),
    [sendNote],
  );
  useEffect(() => () => midiRef.current?.disconnect(), []);
  const connectMidiDevice = async () => {
    try {
      midiRef.current?.disconnect();
      midiRef.current = await connectMidi(sendNote, setMidiDevices);
      setMidiError(null);
    } catch {
      setMidiError('MIDI 권한이 거부되었거나 사용할 수 없습니다.');
    }
  };

  const addMySong = (title: string, xml: string): boolean => {
    const entry: MySong = { id: Date.now().toString(36), title, createdAt: Date.now(), xml };
    const next = [entry, ...mySongs];
    if (!saveMySongs(next)) return false;
    setMySongs(next);
    return true;
  };
  const deleteMySong = (id: string) => {
    const next = mySongs.filter((s) => s.id !== id);
    saveMySongs(next);
    setMySongs(next);
    if (!next.length && level === MY_LEVEL) changeLevel(1);
  };

  const diagnostics =
    settings.showDiagnostics && diag
      ? `오디오 ${diag.audio === 'running' ? '정상' : diag.audio} · ${Math.round(diag.sampleRate / 1000)}kHz · 수집 ${diag.capture} ${Math.round(diag.samplesPerSec / 1000)}k/초 · 입력 ${Math.round(diag.levelDb)}dB · ${inference ? `AI ${inference.backend} ${Math.round(inference.ms)}ms` : 'AI 준비 중'} · 최근 인식 ${diag.lastNotes}음`
      : null;

  const title = song ? splitTitle(song.title) : null;
  const listening = micState === 'ai' || micState === 'warming' || micState === 'basic';

  return (
    <div className="app">
      {deployed && (
        <div className="update" role="status">
          새 버전이 있어요 ({versionLabel(deployed)})
          <button className="btn primary small" onClick={() => reloadTo(deployed)}>
            새로고침
          </button>
        </div>
      )}

      <header className="topbar">
        <div className="tb-left">
          {song && (
            <button className="icon-btn" onClick={goHome} aria-label="곡 목록으로">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button className="logo-btn" onClick={goHome} aria-label="처음 화면">
            <Logo />
          </button>
        </div>
        <div className="tb-center">
          {title && (
            <>
              <h1>{title.main}</h1>
              <small>{[title.sub, song?.composer].filter(Boolean).join(' · ')}</small>
            </>
          )}
        </div>
        <div className="tb-right">
          {song && isMicSupported() && (
            <button
              className={`mic-pill ${listening ? 'on' : micState}`}
              onClick={() => (micState === 'off' || micState === 'error' ? startMicSession() : undefined)}
              title={micError ?? '마이크'}
            >
              <span className="dot" />
              {listening && heard !== null ? `${MIC_TEXT[micState]} · ${heardName(heard)}` : MIC_TEXT[micState]}
              {listening && (
                <span className="level">
                  <span ref={micLevelRef} />
                </span>
              )}
            </button>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="설정">
            <GearIcon />
          </button>
        </div>
      </header>

      {micError && song && <p className="banner error">{micError}</p>}

      {song ? (
        loaded && loaded.key === song.key ? (
          <PlayScreen
            key={song.key}
            xml={loaded.xml}
            score={loaded.score}
            settings={settings}
            bridge={bridge}
            onFinished={onFinished}
            diagnostics={diagnostics}
          />
        ) : (
          <div className="loading">{songError ?? '악보를 불러오는 중…'}</div>
        )
      ) : (
        <HomeScreen
          levels={levels}
          level={level}
          onLevel={changeLevel}
          songs={levelSongs}
          bestStars={bestStars}
          onSelect={openSong}
          error={listError}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setShowSettings(false)}
          onTranscribe={() => {
            // 악보 만들기는 마이크·AI를 따로 쓰므로 연습 화면에서 나온다
            setShowSettings(false);
            if (song) goHome();
            setShowTranscribe(true);
          }}
          onImportXml={async (file) => {
            const xml = await file.text();
            try {
              const parsed = parseMusicXml(xml);
              if (!addMySong(parsed.title === '제목 없음' ? file.name.replace(/\.[^.]+$/, '') : parsed.title, xml)) {
                window.alert('저장 공간이 모자라요.');
                return;
              }
              setShowSettings(false);
              if (song) goHome();
              changeLevel(MY_LEVEL);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : String(e));
            }
          }}
          mySongs={mySongs}
          onDeleteMySong={deleteMySong}
          midi={{ supported: isMidiSupported(), devices: midiDevices, error: midiError, connect: connectMidiDevice }}
          version={versionLabel(CURRENT)}
        />
      )}

      {showTranscribe && (
        <TranscribeDialog
          initialTab={youtubeMode ? 'youtube' : 'file'}
          onClose={() => {
            setShowTranscribe(false);
            // 유튜브 모드에서 나오면 빠른 음 인식 모드로 돌아간다
            if (youtubeMode) location.replace(location.pathname);
          }}
          onSave={(t, xml) => {
            if (!addMySong(t, xml)) return false;
            setShowTranscribe(false);
            changeLevel(MY_LEVEL);
            if (youtubeMode) location.replace(location.pathname);
            return true;
          }}
        />
      )}
    </div>
  );
}

const SOLFEGE = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
function heardName(midi: number): string {
  return `${SOLFEGE[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
