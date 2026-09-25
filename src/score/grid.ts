/**
 * 악보를 "한 줄 4칸, 모든 칸 같은 너비"로 배치하기 위한 계산.
 *
 * OSMD는 마디 폭을 `앞머리(음자리표 등) + 음표 영역 최소폭 × e + 끝부분(끝 세로줄 등)`으로 정하고,
 * 한 줄의 e는 `(줄 폭 - 앞머리·끝부분 합) / 음표 영역 최소폭 합`이다.
 * 모든 마디의 음표 영역 최소폭을 `(칸 너비 - 앞머리 - 끝부분) / e`로 맞춰 두면
 * 어느 줄에서든 e가 같아지고, 줄 첫 칸(음자리표 포함)을 포함한 모든 칸이 정확히 같은 너비가 된다.
 *
 * 단위는 OSMD 단위(배율 1에서 10px).
 */

export interface GridInput {
  /** 마디별 음표 영역의 자연 최소폭 (너비 배수 1일 때) */
  contentWidths: number[];
  /** 줄 첫 마디 앞머리 폭 (음자리표, 조표) */
  beginWidth: number;
  /** 줄 첫 마디가 아닌 마디의 앞머리 폭 (마디선 뒤 여백) */
  otherBeginWidth: number;
  /** 마디별 끝부분 폭 (마디선 앞 여백, 끝 세로줄) */
  endWidths: number[];
  /** 페이지 폭 - 오선 폭 (좌우 여백, 괄호 등) */
  marginUnits: number;
  /** 지금 악보 영역 폭 (px) */
  containerPx: number;
  /** 배율을 정하는 기준 폭 (px): iPad 세로 화면 폭 */
  fitPx: number;
  perLine: number;
  minZoom: number;
  maxZoom: number;
}

export interface GridPlan {
  zoom: number;
  /** 마디별 너비 배수 (SourceMeasure.WidthFactor) */
  widthFactors: number[];
  /** 모든 줄에 공통인 늘림 비율. 덜 찬 마지막 줄도 이 비율로 제한해 칸을 맞춘다 */
  scale: number;
  /** 칸 너비 (OSMD 단위) */
  column: number;
}

/** 줄 경계 계산이 부동소수 오차로 넘치지 않게 조금 여유를 둔다 */
const SAFETY = 0.998;
/**
 * 기준 폭에서 가장 빽빽한 칸이 차지할 비율. 1이면 딱 맞아서 OSMD의 줄 나눔 계산 오차로
 * 4마디가 한 줄에 안 들어갈 수 있다. 칸은 어차피 폭에 맞춰 늘어나므로 화면은 꽉 찬다.
 */
const FILL = 0.95;
const UNIT_PX = 10;

export function planGrid(input: GridInput): GridPlan {
  const { contentWidths, beginWidth, otherBeginWidth, endWidths, marginUnits, perLine } = input;
  const begin = (i: number) => (i % perLine === 0 ? beginWidth : otherBeginWidth);
  const end = (i: number) => endWidths[i] ?? 0;

  // 가장 빽빽한 칸이 자연 간격으로 들어가는 칸 너비 → 기준 폭(세로 화면)에 4칸이 꽉 차는 배율
  const naturalColumn = Math.max(...contentWidths.map((c, i) => begin(i) + c + end(i)));
  const fitWidth = Math.min(input.fitPx, input.containerPx);
  const zoom = clamp(
    fitWidth / (UNIT_PX * ((perLine * naturalColumn) / FILL + marginUnits)),
    input.minZoom,
    input.maxZoom,
  );

  // 지금 화면 폭에서의 칸 너비. 가로 화면이면 세로보다 넓어서 음표 간격이 벌어진다
  const staffWidth = input.containerPx / (UNIT_PX * zoom) - marginUnits;
  const column = staffWidth / perLine;
  const room = (i: number) => column - begin(i) - end(i);

  // 모든 마디가 자기 음표를 겹치지 않게 담을 수 있는 가장 큰 공통 비율
  const scale = Math.min(...contentWidths.map((c, i) => room(i) / c));
  const widthFactors = contentWidths.map((c, i) => ((room(i) / scale) * SAFETY) / c);
  return { zoom, widthFactors, scale, column };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
