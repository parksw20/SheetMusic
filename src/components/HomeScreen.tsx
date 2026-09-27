import { useEffect, useRef } from 'react';
import { splitTitle, type SongEntry } from '../songs';
import { SongCover } from './SongCover';

interface Props {
  levels: [number, string][];
  level: number;
  onLevel: (level: number) => void;
  songs: SongEntry[];
  bestStars: Record<string, number>;
  onSelect: (song: SongEntry) => void;
  error: string | null;
}

/** 첫 화면: 난이도를 고르고, 곡 카드를 좌우로 넘겨 고른다 */
export function HomeScreen({ levels, level, onLevel, songs, bestStars, onSelect, error }: Props) {
  const railRef = useRef<HTMLDivElement>(null);

  // 난이도를 바꾸면 처음 곡으로 돌아간다
  useEffect(() => {
    railRef.current?.scrollTo({ left: 0 });
  }, [level]);

  const page = (dir: number) => {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <main className="home">
      <section className="home-head">
        <div>
          <p className="eyebrow">오늘의 연습</p>
          <h1>어떤 곡을 쳐 볼까요?</h1>
        </div>
        <label className="field">
          <span>난이도</span>
          <select value={level} onChange={(e) => onLevel(Number(e.target.value))} aria-label="난이도">
            {levels.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="rail-wrap" aria-label="곡 목록">
        <div className="rail-head">
          <span className="count">{songs.length}곡</span>
          <span className="rail-nav">
            <button className="icon-btn" onClick={() => page(-1)} aria-label="이전 곡들">
              ‹
            </button>
            <button className="icon-btn" onClick={() => page(1)} aria-label="다음 곡들">
              ›
            </button>
          </span>
        </div>
        <div className="rail" ref={railRef}>
          {songs.map((s) => {
            const { main, sub } = splitTitle(s.title);
            const stars = bestStars[`${s.key}#both`];
            return (
              <button key={s.key} className="card" onClick={() => onSelect(s)}>
                <SongCover song={s} />
                <span className="card-body">
                  <span className="card-title">{main}</span>
                  <span className="card-sub">{sub || s.composer}</span>
                  <span className="card-stars" aria-label={stars === undefined ? '아직 안 쳐 봄' : `최고 별 ${stars}개`}>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className={stars !== undefined && i <= stars ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
          {songs.length === 0 && <p className="empty">이 난이도에는 아직 곡이 없어요.</p>}
        </div>
      </section>
    </main>
  );
}
