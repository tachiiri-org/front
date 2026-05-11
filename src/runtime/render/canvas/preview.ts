import type { Frame, CanvasFrame } from '../../../schema/screen/screen';
import type { Component } from '../../../schema/component';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component/style';
import { renderComponent } from '../page/component';

export const EDITOR_ONLY_KINDS = new Set(['canvas', 'list', 'component-editor']);

const CANVAS_PREVIEW_COLS = 50;
const CANVAS_PREVIEW_ROWS = 50;

export const renderCanvasPreview = (
  wrapper: HTMLElement,
  frame: CanvasFrame,
): void => {
  const cols = CANVAS_PREVIEW_COLS;
  const rows = CANVAS_PREVIEW_ROWS;
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  grid.style.border = '1px solid rgba(0, 0, 0, 0.12)';
  grid.style.boxSizing = 'border-box';
  grid.style.width = '100%';
  grid.style.height = '100%';
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = (frame as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (grid.style as unknown as Record<string, string>)[propKey] = v;
  }
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const cell = document.createElement('div');
      cell.style.borderRight = col < cols ? '1px solid rgba(0,0,0,0.06)' : 'none';
      cell.style.borderBottom = row < rows ? '1px solid rgba(0,0,0,0.06)' : 'none';
      grid.appendChild(cell);
    }
  }
  wrapper.replaceChildren(grid);
};

export const renderFramePreview = (frame: Frame, resolved: Component | null, effectiveKind: string): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  wrapper.style.overflow = 'hidden';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.userSelect = 'none';

  if (!EDITOR_ONLY_KINDS.has(effectiveKind)) {
    wrapper.appendChild(renderComponent(frame, {}, resolved));
  }

  return wrapper;
};
