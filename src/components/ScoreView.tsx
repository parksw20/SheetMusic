import { OpenSheetMusicDisplay, type GraphicalNote } from 'opensheetmusicdisplay';
import { useEffect, useRef, useState } from 'react';
import type { HandFilter } from '../score/model';

interface Props {
  xml: string;
  /** 커서를 둘 위치 (4분음표 단위 박) */
  cursorBeat: number;
  /** 악보 확대 배율 */
  zoom: number;
  /** true면 커서가 지나간 음을 초록색으로 칠한다 (연습 중) */
  markPassed: boolean;
  /** 칠할 음을 고를 때 쓰는 손 선택 */
  hand: HandFilter;
  /** 값이 바뀌면 칠해 둔 색을 지운다 */
  resetKey: number;
  /** 틀린 음을 쳤을 때 잠깐 true */
  wrongFlash: boolean;
}

const EPS = 1e-6;
const HIT_CLASS = 'sm-hit';

function staffNumber(g: GraphicalNote): number {
  const staff = g.sourceNote.ParentStaff;
  return staff.ParentInstrument.Staves.indexOf(staff) + 1;
}

/** OpenSheetMusicDisplay로 악보를 그리고, cursorBeat 위치로 커서를 옮긴다. */
export function ScoreView({ xml, cursorBeat, zoom, markPassed, hand, resetKey, wrongFlash }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OSMD 인스턴스는 하나만 만든다. 곡마다 새로 만들면 이전 인스턴스의 빈 SVG와
  // 창 크기 변경 리스너가 남아서 악보 위에 빈 공간이 생긴다.
  useEffect(() => {
    if (!containerRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawComposer: false,
      drawPartNames: false,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#3b82f6', alpha: 0.35, follow: true }],
    });
    return () => {
      osmdRef.current?.clear();
      osmdRef.current = null;
    };
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    osmd.zoom = zoom;

    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        osmd.cursor.show();
        osmd.cursor.reset();
        setReady(true);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
    // zoom은 아래 effect에서 따로 반영한다
  }, [xml]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!ready || !osmd || osmd.zoom === zoom) return;
    osmd.zoom = zoom;
    osmd.render();
    osmd.cursor.update();
  }, [zoom, ready]);

  useEffect(() => {
    containerRef.current?.querySelectorAll(`.${HIT_CLASS}`).forEach((el) => el.classList.remove(HIT_CLASS));
  }, [resetKey, xml]);

  useEffect(() => {
    const cursor = osmdRef.current?.cursor;
    if (!ready || !cursor) return;
    const position = () => cursor.Iterator.currentTimeStamp.RealValue * 4; // 온음표 → 4분음표
    if (position() > cursorBeat + EPS) cursor.reset();
    while (!cursor.Iterator.EndReached && position() < cursorBeat - EPS) {
      if (markPassed) {
        for (const g of cursor.GNotesUnderCursor()) {
          if (g.sourceNote.isRest()) continue;
          const staff = staffNumber(g);
          if ((hand === 'right' && staff !== 1) || (hand === 'left' && staff !== 2)) continue;
          (g as GraphicalNote & { getSVGGElement?: () => SVGGElement }).getSVGGElement?.()?.classList.add(HIT_CLASS);
        }
      }
      cursor.next();
    }
  }, [cursorBeat, ready, markPassed, hand]);

  return (
    <div className={`score${wrongFlash ? ' flash-wrong' : ''}`}>
      {error && <p className="error">악보를 표시할 수 없습니다: {error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
