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
  /** 실제로 적용된 배율. 한 줄 4마디가 들어가지 않으면 zoom보다 작다 */
  onFitZoom?: (zoom: number) => void;
}

const EPS = 1e-6;
/** 한 줄에 놓을 마디 수 */
const MEASURES_PER_LINE = 4;
/** 4마디를 맞추려고 배율을 줄일 때의 하한과 단계 */
const MIN_FIT_ZOOM = 0.5;
const FIT_STEP = 0.1;
const HIT_CLASS = 'sm-hit';

function staffNumber(g: GraphicalNote): number {
  const staff = g.sourceNote.ParentStaff;
  return staff.ParentInstrument.Staves.indexOf(staff) + 1;
}

/** 배율과 "한 줄 4마디, 마디 너비 같게" 설정 */
function applyLayout(osmd: OpenSheetMusicDisplay, zoom: number) {
  osmd.Zoom = zoom;
  const rules = osmd.EngravingRules;
  rules.RenderXMeasuresPerLineAkaSystem = MEASURES_PER_LINE;
  rules.FixedMeasureWidth = true;
  rules.StretchLastSystemLine = false;
}

/** 마지막 줄을 뺀 모든 줄에 4마디씩 들어갔는지 */
function fitsMeasuresPerLine(osmd: OpenSheetMusicDisplay): boolean {
  const systems = osmd.GraphicSheet.MusicPages.flatMap((p) => p.MusicSystems);
  return systems.slice(0, -1).every((sys) => sys.GraphicalMeasures.length >= MEASURES_PER_LINE);
}

/**
 * 원하는 배율로 그려 보고, 한 줄 4마디가 들어가지 않으면(OSMD가 줄을 일찍 바꿈)
 * 들어갈 때까지 배율을 줄여 다시 그린다. 실제로 적용한 배율을 돌려준다.
 */
function renderFit(osmd: OpenSheetMusicDisplay, want: number): number {
  let zoom = want;
  for (;;) {
    applyLayout(osmd, zoom);
    osmd.render();
    if (zoom <= MIN_FIT_ZOOM || fitsMeasuresPerLine(osmd)) return zoom;
    zoom = Math.max(MIN_FIT_ZOOM, Math.round((zoom - FIT_STEP) * 10) / 10);
  }
}

/** OpenSheetMusicDisplay로 악보를 그리고, cursorBeat 위치로 커서를 옮긴다. */
export function ScoreView({ xml, cursorBeat, zoom, markPassed, hand, resetKey, wrongFlash, onFitZoom }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** 마지막으로 요청받아 그린 배율. 같은 배율로 다시 그리지 않기 위해 둔다 */
  const renderedZoom = useRef<number | null>(null);
  const onFitZoomRef = useRef(onFitZoom);
  onFitZoomRef.current = onFitZoom;

  const draw = (osmd: OpenSheetMusicDisplay, want: number) => {
    const fit = renderFit(osmd, want);
    renderedZoom.current = want;
    onFitZoomRef.current?.(fit);
  };

  // OSMD 인스턴스는 하나만 만든다. 곡마다 새로 만들면 이전 인스턴스의 빈 SVG와
  // 창 크기 변경 리스너가 남아서 악보 위에 빈 공간이 생긴다.
  useEffect(() => {
    if (!containerRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      // 창 크기가 바뀌면 OSMD가 원래 배율로 다시 그려 4마디가 깨지므로 직접 처리한다 (아래 ResizeObserver)
      autoResize: false,
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

    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return;
        // load()가 배율과 조판 설정을 초기화하므로 그리기 직전에 다시 적용한다
        draw(osmd, zoomRef.current);
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
    if (!ready || !osmd || renderedZoom.current === zoom) return;
    draw(osmd, zoom);
    osmd.cursor.update();
  }, [zoom, ready]);

  // 화면 회전 등으로 폭이 바뀌면 다시 맞춰 그린다
  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el) return;
    let width = el.clientWidth;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const osmd = osmdRef.current;
        if (!osmd) return;
        draw(osmd, zoomRef.current);
        osmd.cursor.update();
      }, 150);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [ready]);

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
