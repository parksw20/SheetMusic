import { describe, expect, it } from 'vitest';
import { planGrid, type GridInput } from './grid';

const base: GridInput = {
  contentWidths: [10, 8, 12, 9, 7, 11, 10, 6, 9],
  beginWidth: 4.8,
  otherBeginWidth: 0.7,
  endWidths: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.2],
  marginUnits: 12,
  containerPx: 1194,
  fitPx: 810,
  perLine: 4,
  minZoom: 0.5,
  maxZoom: 3,
};

/** OSMD가 줄마다 하는 계산을 흉내 낸다 (마지막 줄은 늘림 비율 상한 적용) */
function simulate(input: GridInput) {
  const plan = planGrid(input);
  const staffWidth = input.containerPx / (10 * plan.zoom) - input.marginUnits;
  const lines: number[][] = [];
  for (let start = 0; start < input.contentWidths.length; start += input.perLine) {
    const idx = [...Array(input.perLine).keys()].map((j) => start + j).filter((i) => i < input.contentWidths.length);
    const begin = (i: number) => (i % input.perLine === 0 ? input.beginWidth : input.otherBeginWidth);
    const minw = (i: number) => input.contentWidths[i] * plan.widthFactors[i];
    const fix = idx.reduce((s, i) => s + begin(i) + (input.endWidths[i] ?? 0), 0);
    const total = idx.reduce((s, i) => s + minw(i), 0);
    expect(fix + total).toBeLessThanOrEqual(staffWidth); // 줄이 넘치지 않음 (4마디 유지)
    let e = (staffWidth - fix) / total;
    const isLast = start + input.perLine >= input.contentWidths.length;
    if (isLast) e = Math.min(e, plan.scale);
    lines.push(idx.map((i) => begin(i) + minw(i) * e + (input.endWidths[i] ?? 0)));
  }
  return { plan, lines };
}

describe('planGrid', () => {
  it('줄 첫 칸(음자리표 포함)과 마지막 줄까지 모든 칸 너비가 같다', () => {
    const { plan, lines } = simulate(base);
    for (const w of lines.flat()) expect(w).toBeCloseTo(plan.column, 1);
  });

  it('어떤 마디도 자연 최소폭보다 좁아지지 않는다 (음표 겹침 없음)', () => {
    const { plan } = simulate(base);
    base.contentWidths.forEach((c, i) => expect(c * plan.widthFactors[i] * plan.scale).toBeGreaterThanOrEqual(c * 0.99));
  });

  it('배율은 세로 폭 기준이라 가로/세로에서 같고, 세로에서는 4칸이 꽉 찬다', () => {
    const landscape = planGrid(base);
    const portrait = planGrid({ ...base, containerPx: base.fitPx });
    expect(landscape.zoom).toBeCloseTo(portrait.zoom, 6);
    // 세로에서는 가장 빽빽한 칸이 거의 자연 간격 (늘림 비율 1보다 조금 큼)
    expect(portrait.scale).toBeGreaterThanOrEqual(1);
    expect(portrait.scale).toBeLessThan(1.1);
    // 가로에서는 칸이 더 넓다
    expect(landscape.column).toBeGreaterThan(portrait.column);
  });

  it('배율은 상하한을 넘지 않는다', () => {
    expect(planGrid({ ...base, contentWidths: [1, 1, 1, 1], beginWidth: 0, otherBeginWidth: 0, endWidths: [], marginUnits: 0 }).zoom).toBe(3);
    expect(planGrid({ ...base, contentWidths: [80, 80, 80, 80] }).zoom).toBe(0.5);
  });
});
