import { describe, expect, it } from 'vitest';
import { versionLabel } from './version';

describe('versionLabel', () => {
  it('버전, 커밋, 빌드 시각을 한 줄로 보여 준다', () => {
    const d = new Date(2026, 8, 27, 9, 5);
    expect(versionLabel({ version: '0.5.0', commit: 'a1b2c3d', builtAt: d.toISOString() })).toBe('v0.5.0 · a1b2c3d · 9/27 09:05');
  });

  it('빌드 시각을 모르면 빼고 보여 준다', () => {
    expect(versionLabel({ version: '0.5.0', commit: 'dev', builtAt: '' })).toBe('v0.5.0 · dev');
  });
});
