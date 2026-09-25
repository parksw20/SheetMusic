import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useEffect, useRef, useState } from 'react';

interface Props {
  xml: string;
  /** 커서를 둘 위치 (4분음표 단위 박) */
  cursorBeat: number;
}

const EPS = 1e-6;

/** OpenSheetMusicDisplay로 악보를 그리고, cursorBeat 위치로 커서를 옮긴다. */
export function ScoreView({ xml, cursorBeat }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawComposer: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#3b82f6', alpha: 0.35, follow: true }],
    });
    osmdRef.current = osmd;
    let cancelled = false;
    setReady(false);
    setError(null);

    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        osmd.cursor.show();
        setReady(true);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
      osmd.clear();
      osmdRef.current = null;
    };
  }, [xml]);

  useEffect(() => {
    const cursor = osmdRef.current?.cursor;
    if (!ready || !cursor) return;
    const position = () => cursor.Iterator.currentTimeStamp.RealValue * 4; // 온음표 → 4분음표
    if (position() > cursorBeat + EPS) cursor.reset();
    while (!cursor.Iterator.EndReached && position() < cursorBeat - EPS) cursor.next();
  }, [cursorBeat, ready]);

  return (
    <div className="score">
      {error && <p className="error">악보를 표시할 수 없습니다: {error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
