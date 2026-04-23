import { describe, expect, it } from 'vitest';

import { resolveRendererMode } from './renderer-mode';

describe('resolveRendererMode', () => {
  it('defaults to editor mode', () => {
    expect(resolveRendererMode('')).toBe('editor');
    expect(resolveRendererMode('?foo=bar')).toBe('editor');
  });

  it('switches to diagnostics mode when explicitly requested', () => {
    expect(resolveRendererMode('?mode=diagnostics')).toBe('diagnostics');
  });
});
