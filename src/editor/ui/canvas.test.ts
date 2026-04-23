import { describe, expect, it } from 'vitest';

import { calculateCanvasSize, isCanvasPrimaryTextEditShortcut } from './canvas';

describe('canvas sizing', () => {
  it('fits the frame inside the available stage area', () => {
    expect(calculateCanvasSize(640, 280, 16 / 9)).toEqual({
      width: 497,
      height: 279,
    });
  });

  it('shrinks below the previous fixed minimum when the stage is narrow', () => {
    expect(calculateCanvasSize(180, 300, 16 / 9)).toEqual({
      width: 180,
      height: 101,
    });
  });

  it('starts inline text editing with plain F2 only', () => {
    expect(
      isCanvasPrimaryTextEditShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'F2',
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      isCanvasPrimaryTextEditShortcut({
        altKey: false,
        ctrlKey: true,
        key: 'F2',
        metaKey: false,
      }),
    ).toBe(false);
  });
});
