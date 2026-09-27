import { useEffect, useMemo, useRef, useState } from 'react';
import { MODEL_URL } from '../input/mic';
import { songXml } from '../score/buildMusicXml';
import { decodeFile, MAX_SECONDS, SAMPLE_RATE, startRecording, type Recorder } from '../transcribe/audio';
import { notesToSong, type DetectedNote } from '../transcribe/quantize';
import {
  canEmbedYouTube,
  formatTime,
  loadYouTubeApi,
  parseTime,
  parseYouTubeId,
  youtubeModeUrl,
  type YTPlayer,
} from '../transcribe/youtube';

type Tab = 'file' | 'youtube';
type Stage = 'source' | 'recording' | 'working' | 'done';

interface Props {
  initialTab?: Tab;
  onClose: () => void;
  /** 저장에 성공하면 true (저장 공간이 모자라면 false) */
  onSave: (title: string, xml: string) => boolean;
}

async function transcribe(audio: Float32Array, onProgress: (p: number) => void): Promise<DetectedNote[]> {
  const { preloadAi } = await import('../input/aiClient');
  const ai = await preloadAi(MODEL_URL);
  return ai.transcribe(audio, onProgress);
}

/** 음원(파일 또는 유튜브 구간)을 AI로 악보로 옮겨 이 기기에 저장한다 */
export function TranscribeDialog({ initialTab = 'file', onClose, onSave }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stage, setStage] = useState<Stage>('source');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState<DetectedNote[] | null>(null);
  const [title, setTitle] = useState('');
  const [bpm, setBpm] = useState(90);
  const [beats, setBeats] = useState<3 | 4>(4);
  /** 잡음 거르기에 쓰는 원래 소리 (AI에 넘기면 옮겨져서 따로 복사해 둔다) */
  const source = useRef<Float32Array | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 유튜브
  const [url, setUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [start, setStart] = useState('0:00');
  const [end, setEnd] = useState('0:30');
  const [elapsed, setElapsed] = useState(0);
  const playerEl = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const poll = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearInterval(poll.current);
      recorder.current?.cancel();
      player.current?.destroy();
    },
    [],
  );

  const run = async (audio: Float32Array, name: string) => {
    setStage('working');
    setProgress(0);
    setError(null);
    try {
      source.current = audio.slice();
      const found = await transcribe(audio, setProgress);
      if (!found.length) throw new Error('음을 찾지 못했어요. 피아노 소리가 크게 들어가게 다시 해 보세요.');
      setNotes(found);
      setBpm(notesToSong(found, name, undefined, { samples: source.current, sampleRate: SAMPLE_RATE }).bpm);
      setTitle(name);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('source');
    }
  };

  const onFile = async (file: File) => {
    setError(null);
    setStage('working');
    try {
      const { audio, trimmed } = await decodeFile(file);
      if (trimmed) setError(`앞 ${MAX_SECONDS / 60}분만 옮겨요.`);
      await run(audio, file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('source');
    }
  };

  const loadVideo = async () => {
    const id = parseYouTubeId(url);
    if (!id) {
      setError('유튜브 주소를 확인해 주세요.');
      return;
    }
    setError(null);
    try {
      const YT = await loadYouTubeApi();
      player.current?.destroy();
      const host = document.createElement('div');
      playerEl.current!.replaceChildren(host);
      player.current = new YT.Player(host, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            const d = player.current?.getDuration() ?? 0;
            if (d) setEnd(formatTime(Math.min(d, 30)));
          },
          onError: () => setError('이 영상은 퍼가기가 막혀 있어 쓸 수 없어요.'),
        },
      });
      setVideoId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const recordSegment = async () => {
    const s = parseTime(start);
    const e = parseTime(end);
    const p = player.current;
    if (s === null || e === null || e <= s) {
      setError('시작과 끝 시간을 확인해 주세요 (예: 1:05).');
      return;
    }
    if (e - s > MAX_SECONDS) {
      setError(`한 번에 ${MAX_SECONDS / 60}분까지 옮길 수 있어요.`);
      return;
    }
    if (!p) return;
    setError(null);
    try {
      // 클릭 처리 안에서 마이크를 켠다
      const rec = startRecording((v) => {
        if (levelRef.current) levelRef.current.style.transform = `scaleX(${v.toFixed(3)})`;
      });
      p.seekTo(s, true);
      p.playVideo();
      recorder.current = await rec;
    } catch {
      setError('마이크를 켜지 못했어요. 마이크 권한을 허용해 주세요.');
      p.pauseVideo();
      return;
    }
    setStage('recording');
    setElapsed(0);
    window.clearInterval(poll.current);
    poll.current = window.setInterval(() => {
      const t = p.getCurrentTime();
      setElapsed(Math.max(0, t - s));
      if (t >= e) void finishRecording();
    }, 200);
  };

  const finishRecording = async () => {
    window.clearInterval(poll.current);
    player.current?.pauseVideo();
    const rec = recorder.current;
    recorder.current = null;
    if (!rec) return;
    const audio = await rec.stop();
    const name = player.current?.getVideoData()?.title ?? '유튜브 악보';
    await run(audio, name);
  };

  const result = useMemo(() => {
    if (!notes) return null;
    try {
      const audio = source.current ? { samples: source.current, sampleRate: SAMPLE_RATE } : undefined;
      return notesToSong(notes, title || '내 악보', bpm, audio, beats);
    } catch {
      return null;
    }
  }, [notes, title, bpm, beats]);

  const save = () => {
    if (!result) return;
    const xml = songXml(result.song);
    if (!onSave(title.trim() || '내 악보', xml)) setSaveError('저장 공간이 모자라요. 설정에서 안 쓰는 내 악보를 지워 주세요.');
  };

  const busy = stage === 'recording' || stage === 'working';

  return (
    <div className="sheet-backdrop center" onClick={busy ? undefined : onClose}>
      <div className="dialog transcribe" role="dialog" aria-label="음원으로 악보 만들기" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>음원으로 악보 만들기</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기" disabled={busy}>
            ✕
          </button>
        </header>

        {stage !== 'done' && (
          <div className="seg wide" role="tablist">
            <button role="tab" className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')} disabled={busy}>
              음원 파일
            </button>
            <button role="tab" className={tab === 'youtube' ? 'on' : ''} onClick={() => setTab('youtube')} disabled={busy}>
              유튜브
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {stage === 'source' && tab === 'file' && (
          <div className="pane">
            <p className="muted">
              피아노 연주 음원(mp3, m4a, wav)을 고르세요. 피아노만 나오는 음원일수록 정확해요. 최대 {MAX_SECONDS / 60}분.
            </p>
            <label className="drop">
              <input type="file" accept="audio/*,video/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <span className="drop-icon">♫</span>
              <b>음원 파일 고르기</b>
            </label>
          </div>
        )}

        {tab === 'youtube' && (stage === 'source' || stage === 'recording') && (
          <div className="pane">
            {!canEmbedYouTube() ? (
              <>
                <p className="muted">
                  유튜브 영상은 빠른 음 인식 모드에서는 넣을 수 없어서, 유튜브 전용 화면으로 다시 열어요. 저장하면 원래
                  화면으로 돌아와요.
                </p>
                <a className="btn primary block" href={youtubeModeUrl()}>
                  유튜브 화면으로 열기
                </a>
              </>
            ) : (
              <>
                <div className="field-row">
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="유튜브 주소 (https://youtu.be/…)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={busy}
                  />
                  <button className="btn" onClick={loadVideo} disabled={busy || !url}>
                    불러오기
                  </button>
                </div>
                <div className={`video${videoId ? '' : ' empty'}`} ref={playerEl}>
                  {!videoId && <span className="muted">영상을 불러오면 여기에 나와요</span>}
                </div>
                {videoId && (
                  <>
                    <div className="field-row times">
                      <label>
                        시작
                        <input value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
                        <button
                          className="btn ghost small"
                          onClick={() => setStart(formatTime(player.current?.getCurrentTime() ?? 0))}
                          disabled={busy}
                        >
                          지금 위치
                        </button>
                      </label>
                      <label>
                        끝
                        <input value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
                        <button
                          className="btn ghost small"
                          onClick={() => setEnd(formatTime(player.current?.getCurrentTime() ?? 0))}
                          disabled={busy}
                        >
                          지금 위치
                        </button>
                      </label>
                    </div>
                    <p className="muted small">
                      영상 소리를 스피커로 틀고 마이크로 받아 옮겨요. 조용한 곳에서 음량을 크게 해 주세요. 옮긴 결과는 이
                      기기에만 저장돼요.
                    </p>
                    {stage === 'recording' ? (
                      <div className="recording">
                        <span className="rec-dot" /> 녹음 중 {formatTime(elapsed)} / {formatTime((parseTime(end) ?? 0) - (parseTime(start) ?? 0))}
                        <span className="level">
                          <span ref={levelRef} />
                        </span>
                        <button className="btn small" onClick={() => void finishRecording()}>
                          여기까지
                        </button>
                      </div>
                    ) : (
                      <button className="btn primary block" onClick={recordSegment}>
                        구간 재생하며 악보 만들기
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {stage === 'working' && (
          <div className="pane working">
            <p>AI가 음을 찾고 있어요… {Math.round(progress * 100)}%</p>
            <div className="progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="pane">
            <label className="field block">
              <span>제목</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field block">
              <span>빠르기 (BPM) · 박이 어긋나 보이면 바꿔 보세요</span>
              <input
                type="number"
                min={40}
                max={220}
                value={bpm}
                onChange={(e) => setBpm(Math.min(220, Math.max(40, Number(e.target.value) || 90)))}
              />
            </label>
            <div className="row-inline">
              <span className="muted">박자</span>
              <div className="seg" role="radiogroup" aria-label="박자">
                {([4, 3] as const).map((b) => (
                  <button key={b} role="radio" aria-checked={beats === b} className={beats === b ? 'on' : ''} onClick={() => setBeats(b)}>
                    {b}/4박자
                  </button>
                ))}
              </div>
            </div>
            <p className="muted">
              음 {result.noteCount}개 · {result.song.measures.length}마디 · 첫 음을 첫 박으로 맞췄어요
            </p>
            {saveError && <p className="error">{saveError}</p>}
            <div className="actions">
              <button className="btn" onClick={() => setStage('source')}>
                다시 하기
              </button>
              <button className="btn primary" onClick={save}>
                저장하고 내 악보에 넣기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
