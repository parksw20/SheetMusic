/**
 * input의 끝에서 outLength개 샘플을 outRate로 다시 뽑는다 (선형 보간).
 * 낮은 레이트로 줄일 때 생기는 앨리어싱을 줄이려고 [1, 2, 1]/4 삼각 필터를 먼저 건다.
 * input이 짧으면 앞쪽은 0으로 채운다.
 */
export function resampleTail(input: Float32Array, inRate: number, outRate: number, outLength: number): Float32Array {
  const out = new Float32Array(outLength);
  const ratio = inRate / outRate;
  const last = input.length - 1;
  const smooth = (j: number) => {
    if (j < 0 || j > last) return 0;
    const a = input[j - 1] ?? input[j];
    const c = input[j + 1] ?? input[j];
    return ratio > 1 ? (a + 2 * input[j] + c) / 4 : input[j];
  };
  for (let i = 0; i < outLength; i++) {
    const pos = last - (outLength - 1 - i) * ratio;
    if (pos < 0) continue;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = smooth(j) * (1 - frac) + smooth(j + 1) * frac;
  }
  return out;
}
