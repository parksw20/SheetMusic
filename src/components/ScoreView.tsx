import { OpenSheetMusicDisplay, type GraphicalNote } from 'opensheetmusicdisplay';
import { useEffect, useRef, useState } from 'react';
import { planGrid } from '../score/grid';
import type { HandFilter } from '../score/model';

interface Props {
  xml: string;
  /** 커서를 둘 위치 (4분음표 단위 박) */
  cursorBeat: number;
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
/** 한 줄에 놓을 마디 수 */
const MEASURES_PER_LINE = 4;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
/** .score 좌우 안쪽 여백 합 (px). styles.css와 맞춘다 */
const SCORE_PADDING_PX = 24;
const HIT_CLASS = 'sm-hit';

function staffNumber(g: GraphicalNote): number {
  const staff = g.sourceNote.ParentStaff;
  return staff.ParentInstrument.Staves.indexOf(staff) + 1;
}

function setBaseRules(osmd: OpenSheetMusicDisplay) {
  const rules = osmd.EngravingRules;
  rules.RenderXMeasuresPerLineAkaSystem = MEASURES_PER_LINE;
  rules.FixedMeasureWidth = false;
  rules.StretchLastSystemLine = false;
  // 박자표는 첫 줄에만 붙어 첫 줄만 앞머리가 길어진다. 빼서 모든 줄의 앞머리를 음자리표로 같게 한다.
  // 박자는 화면 상단에 따로 표시한다.
  rules.RenderTimeSignatures = false;
}

/**
 * 한 줄 4칸, 곡 전체에서 모든 칸이 같은 너비가 되도록 두 번 그린다.
 *  1. 너비 배수 1로 그려서 마디별 음표 영역 최소폭, 음자리표 폭, 여백을 잰다.
 *  2. planGrid로 배율(iPad 세로 폭에 4칸이 꽉 차는 값)과 마디별 너비 배수를 정해 다시 그린다.
 * 가로 화면에서는 같은 배율로 4칸이 화면 폭을 가득 채운다.
 */
function renderGrid(osmd: OpenSheetMusicDisplay, containerPx: number): void {
  const sheet = osmd.Sheet;
  const rules = osmd.EngravingRules;
  setBaseRules(osmd);
  sheet.SourceMeasures.forEach((m) => (m.WidthFactor = 1));
  rules.LastSystemMaxScalingFactor = 100;
  osmd.Zoom = 1;
  osmd.render();

  const measures = osmd.GraphicSheet.MeasureList.map((staves) => staves.find(Boolean)!);
  const staffWidth = osmd.GraphicSheet.MusicPages[0].MusicSystems[0].StaffLines[0].PositionAndShape.Size.width;
  const plan = planGrid({
    contentWidths: measures.map((m) => Math.max(m.minimumStaffEntriesWidth, 0.1)),
    beginWidth: measures[0].beginInstructionsWidth,
    // 1차 배치에서 첫 줄 두 번째 마디는 줄 첫 마디가 아니므로 일반 마디의 앞머리 폭을 알 수 있다
    otherBeginWidth: measures[1]?.beginInstructionsWidth ?? 0,
    endWidths: measures.map((m) => m.endInstructionsWidth),
    marginUnits: containerPx / 10 - staffWidth,
    containerPx,
    fitPx: Math.min(screen.width, screen.height) - SCORE_PADDING_PX,
    perLine: MEASURES_PER_LINE,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  });

  sheet.SourceMeasures.forEach((m, i) => (m.WidthFactor = plan.widthFactors[i] ?? 1));
  // 덜 찬 마지막 줄도 다른 줄과 같은 비율로만 늘려 칸 너비를 맞춘다
  rules.LastSystemMaxScalingFactor = plan.scale;
  osmd.Zoom = plan.zoom;
  osmd.render();
}

/** OpenSheetMusicDisplay로 악보를 그리고, cursorBeat 위치로 커서를 옮긴다. */
export function ScoreView({ xml, cursorBeat, markPassed, hand, resetKey, wrongFlash }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draw = (osmd: OpenSheetMusicDisplay) => {
    const el = containerRef.current;
    if (el) renderGrid(osmd, el.offsetWidth);
  };

  // OSMD 인스턴스는 하나만 만든다. 곡마다 새로 만들면 이전 인스턴스의 빈 SVG와
  // 창 크기 변경 리스너가 남아서 악보 위에 빈 공간이 생긴다.
  useEffect(() => {
    if (!containerRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      // 창 크기가 바뀌면 OSMD가 칸 계산 없이 다시 그리므로 직접 처리한다 (아래 ResizeObserver)
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
        draw(osmd);
        osmd.cursor.show();
        osmd.cursor.reset();
        setReady(true);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [xml]);

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
        draw(osmd);
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
