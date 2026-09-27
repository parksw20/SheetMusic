import { OpenSheetMusicDisplay, type GraphicalNote } from 'opensheetmusicdisplay';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planGrid } from '../score/grid';
import type { HandFilter, Staff } from '../score/model';

/** 방금 친 음 (악보 위에 잠깐 표시) */
export interface PlayedMark {
  id: number;
  midi: number;
  /** 맞음이면 초록, 틀림이면 빨강 */
  ok: boolean;
  /** 친 순간 연습하던 위치 (박) */
  beat: number;
  staff: Staff;
}

/** 반복 연습 구간 (마디 번호, 1부터) */
export interface LoopRange {
  from: number;
  to: number;
}

interface Props {
  xml: string;
  /** 커서를 둘 위치 (4분음표 단위 박) */
  cursorBeat: number;
  /** true면 커서가 지나간 음을 초록색으로 칠한다 (연습 중) */
  markPassed: boolean;
  /** 이 박보다 앞의 음은 칠하지 않는다 (구간 반복) */
  colorFromBeat: number;
  /** 칠할 음을 고를 때 쓰는 손 선택 */
  hand: HandFilter;
  /** 값이 바뀌면 칠해 둔 색을 지운다 */
  resetKey: number;
  /** 손가락 번호 보기 */
  fingering: boolean;
  marks: PlayedMark[];
  loop: LoopRange | null;
  /** true면 악보를 드래그해서 반복 구간을 고른다 */
  selecting: boolean;
  onSelectLoop: (range: LoopRange) => void;
  /** 박자 맞추기·듣기: 이 박 위치에 세로 막대를 그린다 (박 사이는 부드럽게 이어진다) */
  playhead?: number | null;
  /** 듣기 중: 커서가 지나가는 음을 잠깐 빛나게 하고 지금 마디를 칠한다 */
  playing?: boolean;
}

const EPS = 1e-6;
/** 한 줄에 놓을 마디 수 */
const MEASURES_PER_LINE = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
/** .score 좌우 안쪽 여백 합 (px). styles.css와 맞춘다 */
const SCORE_PADDING_PX = 24;
const HIT_CLASS = 'sm-hit';
const PLAY_CLASS = 'sm-play';
/** 드래그하다 위아래 가장자리 이 거리 안에 오면 악보를 스크롤한다 (px) */
const EDGE_PX = 80;

function staffNumber(g: GraphicalNote): number {
  const staff = g.sourceNote.ParentStaff;
  return staff.ParentInstrument.Staves.indexOf(staff) + 1;
}

function setBaseRules(osmd: OpenSheetMusicDisplay, fingering: boolean) {
  const rules = osmd.EngravingRules;
  rules.RenderXMeasuresPerLineAkaSystem = MEASURES_PER_LINE;
  // 빈 마디가 이어져도 여러 마디 쉼표("2")로 합치지 않는다. 합치면 칸이 빠져 4칸 배치와 박 위치가 깨진다
  rules.AutoGenerateMultipleRestMeasuresFromRestMeasures = false;
  rules.RenderMultipleRestMeasures = false;
  rules.FixedMeasureWidth = false;
  rules.StretchLastSystemLine = false;
  // 박자표는 첫 줄에만 붙어 첫 줄만 앞머리가 길어진다. 빼서 모든 줄의 앞머리를 음자리표로 같게 한다
  rules.RenderTimeSignatures = false;
  // 마디 번호는 줄 첫머리에만 (손가락 번호와 겹치지 않게)
  rules.RenderMeasureNumbersOnlyAtSystemStart = true;
  rules.RenderFingerings = fingering;
  // 오른손 번호는 위, 왼손 번호는 아래 (MusicXML의 placement를 따른다)
  rules.FingeringPositionFromXML = true;
}

/**
 * 한 줄 4칸, 곡 전체에서 모든 칸이 같은 너비가 되도록 두 번 그린다.
 *  1. 너비 배수 1로 그려서 마디별 음표 영역 최소폭, 음자리표 폭, 여백을 잰다.
 *  2. planGrid로 배율(iPad 세로 폭에 4칸이 꽉 차는 값)과 마디별 너비 배수를 정해 다시 그린다.
 * 가로 화면에서는 같은 배율로 4칸이 화면 폭을 가득 채운다.
 */
function renderGrid(osmd: OpenSheetMusicDisplay, containerPx: number, fingering: boolean): void {
  const sheet = osmd.Sheet;
  const rules = osmd.EngravingRules;
  setBaseRules(osmd, fingering);
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
  // 덜 찬 마지막 줄도 다른 줄과 같은 비율로만 늘려 칸 너비를 맞춘다. 꽉 찬 마지막 줄은 다른 줄처럼 폭에 맞춘다
  rules.LastSystemMaxScalingFactor = measures.length % MEASURES_PER_LINE === 0 ? 100 : plan.scale;
  osmd.Zoom = plan.zoom;
  osmd.render();
}

/** 마디 하나의 화면 위치 (악보 영역 기준 px) */
interface MeasureBox {
  x: number;
  width: number;
  top: number;
  bottom: number;
  /** 보표별 맨 윗줄 y */
  staffTop: number[];
}

/** 박 위치별 x (막대를 부드럽게 움직이는 데 쓴다) */
interface TimePoint {
  beat: number;
  x: number;
  measure: number;
}

/** 음표가 놓인 박마다의 x와 마디 끝 x. OSMD 단위는 배율 1에서 10px */
function timeline(osmd: OpenSheetMusicDisplay, sheetEl: HTMLElement, boxes: MeasureBox[]): TimePoint[] {
  const svg = sheetEl.querySelector('svg');
  if (!svg) return [];
  const ox = svg.getBoundingClientRect().left - sheetEl.getBoundingClientRect().left;
  const u = 10 * osmd.Zoom;
  const points = new Map<number, TimePoint>();
  osmd.GraphicSheet.MeasureList.forEach((staves, i) => {
    const first = staves.find(Boolean);
    if (!first) return;
    const src = first.parentSourceMeasure;
    const start = src.AbsoluteTimestamp.RealValue * 4;
    for (const m of staves) {
      for (const se of m?.staffEntries ?? []) {
        const beat = Math.round((start + se.relInMeasureTimestamp.RealValue * 4) * 1000) / 1000;
        const x = ox + se.PositionAndShape.AbsolutePosition.x * u;
        const old = points.get(beat);
        if (!old || x < old.x) points.set(beat, { beat, x, measure: i });
      }
    }
    const end = Math.round((start + src.Duration.RealValue * 4) * 1000) / 1000 - 0.0005;
    points.set(end, { beat: end, x: boxes[i].x + boxes[i].width - 4, measure: i });
  });
  return [...points.values()].sort((a, b) => a.beat - b.beat);
}

/** 마디 위치를 잰다. OSMD 단위는 배율 1에서 10px */
function measureBoxes(osmd: OpenSheetMusicDisplay, sheetEl: HTMLElement): MeasureBox[] {
  const svg = sheetEl.querySelector('svg');
  if (!svg) return [];
  const s = svg.getBoundingClientRect();
  const w = sheetEl.getBoundingClientRect();
  const ox = s.left - w.left;
  const oy = s.top - w.top;
  const u = 10 * osmd.Zoom;
  return osmd.GraphicSheet.MeasureList.map((staves) => {
    const list = staves.filter(Boolean);
    const first = list[0].PositionAndShape;
    const last = list[list.length - 1].PositionAndShape;
    return {
      x: ox + first.AbsolutePosition.x * u,
      width: first.Size.width * u,
      top: oy + (first.AbsolutePosition.y - 3) * u,
      bottom: oy + (last.AbsolutePosition.y + 7) * u,
      staffTop: list.map((m) => oy + m.PositionAndShape.AbsolutePosition.y * u),
    };
  });
}

const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C# D D# E F F# G G# A A# B
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
/** 흰 건반 기준 위치 (C4 = 28) */
const diatonic = (midi: number) => (Math.floor(midi / 12) - 1) * 7 + LETTER[midi % 12];
/** 보표 맨 윗줄 음: 높은음자리 F5, 낮은음자리 A3 */
const TOP_LINE = { 1: diatonic(77), 2: diatonic(57) };

interface MarkPos {
  id: number;
  ok: boolean;
  x: number;
  y: number;
  sharp: boolean;
  /** 덧줄 y 목록 */
  ledgers: number[];
  half: number;
}

/** OpenSheetMusicDisplay로 악보를 그리고, cursorBeat 위치로 커서를 옮긴다. */
export function ScoreView(props: Props) {
  const { xml, cursorBeat, markPassed, colorFromBeat, hand, resetKey, fingering, marks, loop, selecting, onSelectLoop, playhead, playing = false } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<MeasureBox[]>([]);
  const [points, setPoints] = useState<TimePoint[]>([]);
  /** 커서가 지나간 위치별 x와 마디 (친 음 표시 위치) */
  const beatPos = useRef(new Map<number, { x: number; measure: number }>());
  const [markPos, setMarkPos] = useState<MarkPos[]>([]);
  const [drag, setDrag] = useState<LoopRange | null>(null);
  /** 다시 그린 뒤 커서를 처음부터 다시 옮기게 하는 값 */
  const [cursorKey, setCursorKey] = useState(0);
  const fingeringRef = useRef(fingering);
  fingeringRef.current = fingering;

  const draw = (osmd: OpenSheetMusicDisplay) => {
    const el = containerRef.current;
    if (!el) return;
    renderGrid(osmd, el.offsetWidth, fingeringRef.current);
    beatPos.current.clear();
    if (sheetRef.current) {
      const b = measureBoxes(osmd, sheetRef.current);
      setBoxes(b);
      setPoints(timeline(osmd, sheetRef.current, b));
    }
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
      autoGenerateMultipleRestMeasuresFromRestMeasures: false,
      cursorsOptions: [{ type: 0, color: '#6d63ff', alpha: 0.28, follow: true }],
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

  // 손가락 번호를 켜고 끄면 다시 그린다
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!ready || !osmd) return;
    draw(osmd);
    osmd.cursor.reset();
    setCursorKey((k) => k + 1);
  }, [fingering]);

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
        osmd.cursor.reset();
        setCursorKey((k) => k + 1);
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
  }, [resetKey, xml, cursorKey]);

  useEffect(() => {
    if (playing) containerRef.current?.querySelectorAll(`.${PLAY_CLASS}`).forEach((el) => el.classList.remove(PLAY_CLASS));
  }, [playing, xml, cursorKey]);

  const cursorX = (): number | null => {
    const img = osmdRef.current?.cursor.cursorElement;
    const sheet = sheetRef.current;
    if (!img || !sheet) return null;
    const r = img.getBoundingClientRect();
    return r.left - sheet.getBoundingClientRect().left + r.width / 2;
  };

  useLayoutEffect(() => {
    const cursor = osmdRef.current?.cursor;
    if (!ready || !cursor) return;
    const position = () => cursor.Iterator.currentTimeStamp.RealValue * 4; // 온음표 → 4분음표
    const remember = () => {
      const x = cursorX();
      if (x !== null) beatPos.current.set(Math.round(position() * 1000), { x, measure: cursor.Iterator.CurrentMeasureIndex });
    };
    if (position() > cursorBeat + EPS) cursor.reset();
    remember();
    while (!cursor.Iterator.EndReached && position() < cursorBeat - EPS) {
      if ((markPassed || playing) && position() >= colorFromBeat - EPS) {
        for (const g of cursor.GNotesUnderCursor()) {
          if (g.sourceNote.isRest()) continue;
          const staff = staffNumber(g);
          if ((hand === 'right' && staff !== 1) || (hand === 'left' && staff !== 2)) continue;
          (g as GraphicalNote & { getSVGGElement?: () => SVGGElement }).getSVGGElement?.()?.classList.add(playing ? PLAY_CLASS : HIT_CLASS);
        }
      }
      cursor.next();
      remember();
    }
  }, [cursorBeat, ready, markPassed, playing, colorFromBeat, hand, cursorKey]);

  // 친 음 위치: 친 순간의 연습 위치(박)의 x, 음높이에 맞는 오선 위 y
  useLayoutEffect(() => {
    const osmd = osmdRef.current;
    if (!ready || !osmd) return;
    const half = 5 * osmd.Zoom; // 오선 한 칸의 절반 (px)
    setMarkPos((prev) => {
      const known = new Map(prev.map((p) => [p.id, p]));
      return marks.flatMap((m) => {
        const old = known.get(m.id);
        if (old) return [{ ...old, ok: m.ok }];
        const at = beatPos.current.get(Math.round(m.beat * 1000));
        const x = at?.x ?? cursorX();
        const box = boxes[at?.measure ?? osmd.cursor.Iterator.CurrentMeasureIndex];
        if (x === null || !box) return [];
        const top = box.staffTop[m.staff - 1] ?? box.staffTop[0];
        const d = diatonic(m.midi);
        const topLine = TOP_LINE[m.staff];
        const y = top + (topLine - d) * half;
        // 덧줄: 오선(맨 윗줄 ~ 4칸 아래) 밖이면 두 칸마다
        const ledgers: number[] = [];
        for (let k = topLine + 2; k <= d; k += 2) ledgers.push(top + (topLine - k) * half);
        for (let k = topLine - 10; k >= d; k -= 2) ledgers.push(top + (topLine - k) * half);
        return [{ id: m.id, ok: m.ok, x, y, sharp: SHARP[m.midi % 12], ledgers, half }];
      });
    });
  }, [marks, ready, boxes]);

  // ── 반복 구간 고르기: 드래그한 마디들, 가장자리에서는 자동 스크롤 ──
  const pointer = useRef<{ x: number; y: number; start: number } | null>(null);
  const measureAt = (clientX: number, clientY: number): number | null => {
    const sheet = sheetRef.current;
    if (!sheet || !boxes.length) return null;
    const r = sheet.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best: number | null = null;
    let bestDist = Infinity;
    boxes.forEach((b, i) => {
      const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - (b.x + b.width) : 0;
      const dist = dy * 4 + dx;
      if (dist < bestDist) {
        bestDist = dist;
        best = i + 1;
      }
    });
    return best;
  };

  useEffect(() => {
    if (!selecting) return;
    let raf = 0;
    const tick = () => {
      const p = pointer.current;
      const scroller = scrollRef.current;
      if (p && scroller) {
        const r = scroller.getBoundingClientRect();
        const speed =
          p.y < r.top + EDGE_PX ? -(r.top + EDGE_PX - p.y) / 4 : p.y > r.bottom - EDGE_PX ? (p.y - (r.bottom - EDGE_PX)) / 4 : 0;
        if (speed) {
          scroller.scrollTop += speed;
          const m = measureAt(p.x, p.y);
          if (m) setDrag({ from: p.start, to: m });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selecting, boxes]);

  const onPointerDown = (e: React.PointerEvent) => {
    const m = measureAt(e.clientX, e.clientY);
    if (!m) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, start: m };
    setDrag({ from: m, to: m });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const m = measureAt(e.clientX, e.clientY);
    if (m) setDrag({ from: p.start, to: m });
  };
  const onPointerUp = () => {
    const d = drag;
    pointer.current = null;
    setDrag(null);
    if (d) onSelectLoop({ from: Math.min(d.from, d.to), to: Math.max(d.from, d.to) });
  };

 // 박 위치 → 막대 위치 (같은 마디 안에서 앞뒤 음 사이를 비례로)
  let bar: { x: number; top: number; height: number } | null = null;
  let current: MeasureBox | null = null;
  if (playhead !== null && playhead !== undefined && points.length) {
    let k = 0;
    while (k + 1 < points.length && points[k + 1].beat <= playhead) k++;
    const a = points[k];
    const b = points[k + 1];
    const x = b && b.measure === a.measure && b.beat > a.beat ? a.x + ((b.x - a.x) * Math.max(0, playhead - a.beat)) / (b.beat - a.beat) : a.x;
    const box = boxes[a.measure];
    if (box) bar = { x, top: box.top, height: box.bottom - box.top };
    current = box ?? null;
  }

  const shown = drag ? { from: Math.min(drag.from, drag.to), to: Math.max(drag.from, drag.to) } : loop;

  return (
    <div ref={scrollRef} className={`score${selecting ? ' selecting' : ''}`}>
      {error && <p className="error">악보를 표시할 수 없습니다: {error}</p>}
      <div ref={sheetRef} className="sheet">
        <div ref={containerRef} />
        <div className="sheet-overlay" aria-hidden>
          {shown &&
            boxes.slice(shown.from - 1, shown.to).map((b, i) => (
              <div
                key={i}
                className={`loop-box${drag ? ' dragging' : ''}`}
                style={{ left: b.x, top: b.top, width: b.width, height: b.bottom - b.top }}
              />
            ))}
          {playing && current && (
            <div className="play-measure" style={{ left: current.x, top: current.top, width: current.width, height: current.bottom - current.top }} />
          )}
          {bar && <div className={`playhead${playing ? ' big' : ''}`} style={{ left: bar.x, top: bar.top, height: bar.height }} />}
          {markPos.map((m) => (
            <div key={m.id} className={`mark ${m.ok ? 'ok' : 'ng'}`} style={{ left: m.x, top: m.y }}>
              {m.ledgers.map((y, i) => (
                <span key={i} className="ledger" style={{ top: y - m.y, width: m.half * 5, left: -m.half * 2.5 }} />
              ))}
              <span className="head" style={{ width: m.half * 2.6, height: m.half * 2, left: -m.half * 1.3, top: -m.half }} />
              {m.sharp && (
                <span className="acc" style={{ fontSize: m.half * 3.4, left: -m.half * 3.8, top: -m.half * 2.2 }}>
                  ♯
                </span>
              )}
            </div>
          ))}
        </div>
        {selecting && (
          <div
            className="select-layer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
      </div>
    </div>
  );
}
