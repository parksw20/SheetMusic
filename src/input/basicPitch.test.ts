import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASIC_PITCH_WINDOW, shortModelArtifacts, windowFrames } from './basicPitch';

const json = JSON.parse(readFileSync('public/models/basic-pitch/model.json', 'utf8'));
const buf = readFileSync('public/models/basic-pitch/group1-shard1of1.bin');
const bin = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe('shortModelArtifacts', () => {
  it('공식 모델의 입력 길이와 출력 프레임 수만 바꾼다', () => {
    const a = shortModelArtifacts(json, bin);
    const ph = (a.modelTopology as { node: { op: string; attr: { shape: { shape: { dim: { size: string }[] } } } }[] }).node.find(
      (n) => n.op === 'Placeholder',
    )!;
    expect(ph.attr.shape.shape.dim[1].size).toBe(String(BASIC_PITCH_WINDOW));
    const before = new Uint8Array(bin);
    const after = new Uint8Array(a.weightData as ArrayBuffer);
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(4 * 4); // int32 값 4개만
    // 원본은 그대로
    expect(json.modelTopology.node.find((n: { op: string }) => n.op === 'Placeholder').attr.shape.shape.dim[1].size).toBe('43844');
  });

  it('프레임 수: 공식 2초 창 172, 1.5초 창 130', () => {
    expect(windowFrames(43844)).toBe(172);
    expect(windowFrames(BASIC_PITCH_WINDOW)).toBe(130);
  });

  it('모델이 예상과 다르면 오류를 낸다', () => {
    const other = structuredClone(json);
    other.modelTopology.node.find((n: { op: string }) => n.op === 'Placeholder').attr.shape.shape.dim[1].size = '22050';
    expect(() => shortModelArtifacts(other, bin)).toThrow();
  });
});
