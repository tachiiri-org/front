import { isScreen, isFrameRef } from '../screen';
import type { Frame, GridCanvasFrame, Screen, ScreenListFrame, EditorFrame } from '../screen';
import type { Component } from '../component';
import { renderComponent } from '../render/component';
import { domMap, getFrameSelection, setFrameSelection, isEditableTarget } from '../state';
import { fetchFrameComponent } from '../api';
import { renderScreenListPreview } from './screen-list';
import { renderEditorPreview } from './editor';

const EDITOR_ONLY_KINDS = new Set(['grid-canvas', 'screen-list', 'component-editor']);

const renderGridCanvasPreview = (
  wrapper: HTMLElement,
  frame: GridCanvasFrame,
  screen: Screen,
): void => {
  const cols = screen.grid.columns;
  const rows = screen.grid.rows ?? screen.frames.reduce(
    (m, f) => Math.max(m, f.placement.y + f.placement.height - 1), 1,
  );
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  grid.style.border = '1px solid rgba(0, 0, 0, 0.12)';
  grid.style.boxSizing = 'border-box';
  grid.style.width = '100%';
  grid.style.height = '100%';
  if (frame.style) Object.assign(grid.style, frame.style);
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

const renderFramePreview = (frame: Frame, resolved: Component | null, effectiveKind: string): HTMLElement => {
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

let canvasInteractionController: AbortController | null = null;

const directionMap: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export const hydrateGridCanvas = async (
  selectedScreenId: string | null,
  canvasFrame: GridCanvasFrame,
  onFrameSelect: (screenId: string, frameId: string) => Promise<void>,
  onCanvasSelect: (screenId: string) => Promise<void>,
  onReload: () => void,
): Promise<void> => {
  const canvasEl = domMap.get(canvasFrame.id);
  if (!canvasEl) return;

  if (!selectedScreenId) {
    canvasEl.replaceChildren();
    return;
  }

  const response = await fetch(`/api/layouts/${selectedScreenId}`);
  if (!response.ok) { canvasEl.replaceChildren(); return; }
  const value = (await response.json()) as unknown;
  if (!isScreen(value)) { canvasEl.replaceChildren(); return; }

  const screen = value;
  const cols = screen.grid.columns;
  const rows = screen.grid.rows ?? screen.frames.reduce(
    (m, f) => Math.max(m, f.placement.y + f.placement.height - 1),
    1,
  );

  canvasEl.style.display = 'grid';
  canvasEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  canvasEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  canvasEl.style.border = '1px solid rgba(0, 0, 0, 0.12)';
  canvasEl.style.boxSizing = 'border-box';
  canvasEl.style.cursor = 'default';
  canvasEl.replaceChildren();

  const resolvedComponents = new Map<string, Component>();
  await Promise.all(
    screen.frames
      .filter(isFrameRef)
      .map(async (frame) => {
        const component = await fetchFrameComponent(selectedScreenId, frame.src);
        if (component) resolvedComponents.set(frame.id, component);
      }),
  );

  const currentSelection = getFrameSelection(canvasFrame.id);
  const screenId = selectedScreenId;

  const applySelectedStyle = (el: HTMLElement, selected: boolean): void => {
    el.style.outline = selected ? '2px solid rgba(0, 100, 220, 0.6)' : '';
  };

  const applyCanvasSelectedStyle = (selected: boolean): void => {
    canvasEl.style.outline = selected ? '2px solid rgba(0, 100, 220, 0.4)' : '';
  };

  canvasInteractionController?.abort();
  canvasInteractionController = new AbortController();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const selectedId = getFrameSelection(canvasFrame.id);
    if (!selectedId) return;

    if (e.key === 'Delete') {
      e.preventDefault();
      void (async () => {
        const freshRes = await fetch(`/api/layouts/${screenId}`);
        if (!freshRes.ok) return;
        const freshScreen = (await freshRes.json()) as unknown;
        if (!isScreen(freshScreen)) return;
        await fetch(`/api/layouts/${screenId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...freshScreen,
            frames: freshScreen.frames.filter((f) => f.id !== selectedId),
          }),
        });
        setFrameSelection(canvasFrame.id, '');
        onReload();
      })();
      return;
    }

    const dir = directionMap[e.key];
    if (!dir) return;
    e.preventDefault();
    const [dx, dy] = dir;
    void (async () => {
      const freshRes = await fetch(`/api/layouts/${screenId}`);
      if (!freshRes.ok) return;
      const freshScreen = (await freshRes.json()) as unknown;
      if (!isScreen(freshScreen)) return;
      const frame = freshScreen.frames.find((f) => f.id === selectedId);
      if (!frame) return;
      const p = { ...frame.placement };
      if (e.shiftKey) {
        p.width = Math.max(1, p.width + dx);
        p.height = Math.max(1, p.height + dy);
      } else if (e.ctrlKey) {
        if (dx < 0) p.x = 1;
        if (dx > 0) p.x = Math.max(1, cols - p.width + 1);
        if (dy < 0) p.y = 1;
        if (dy > 0) p.y = Math.max(1, rows - p.height + 1);
      } else {
        p.x = Math.max(1, Math.min(cols - p.width + 1, p.x + dx));
        p.y = Math.max(1, p.y + dy);
      }
      await fetch(`/api/layouts/${screenId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...freshScreen,
          frames: freshScreen.frames.map((f) => f.id === selectedId ? { ...f, placement: p } : f),
        }),
      });
      onReload();
    })();
  }, { signal: canvasInteractionController.signal });

  canvasEl.onclick = () => {
    for (const child of canvasEl.children) {
      applySelectedStyle(child as HTMLElement, false);
    }
    applyCanvasSelectedStyle(true);
    setFrameSelection(canvasFrame.id, '');
    void onCanvasSelect(screenId);
  };

  for (const frame of screen.frames) {
    const resolved = resolvedComponents.get(frame.id) ?? null;
    const effectiveKind = resolved
      ? String((resolved as Record<string, unknown>).kind ?? '')
      : String((frame as Record<string, unknown>).kind ?? '');

    const cell = document.createElement('div');
    cell.style.gridColumn = `${frame.placement.x} / span ${frame.placement.width}`;
    cell.style.gridRow = `${frame.placement.y} / span ${frame.placement.height}`;
    cell.style.position = 'relative';
    if (canvasFrame.cellStyle) Object.assign(cell.style, canvasFrame.cellStyle);
    applySelectedStyle(cell, frame.id === currentSelection);

    const previewWrapper = renderFramePreview(frame, resolved, effectiveKind);
    cell.appendChild(previewWrapper);

    let isDragging = false;

    const EDGE = 6;
    type Dir = { n: boolean; s: boolean; e: boolean; w: boolean };

    const getDir = (ev: PointerEvent, el: HTMLElement): Dir | null => {
      const r = el.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const d = { n: y <= EDGE, s: y >= r.height - EDGE, w: x <= EDGE, e: x >= r.width - EDGE };
      return (d.n || d.s || d.e || d.w) ? d : null;
    };

    const dirCursor = (d: Dir): string => {
      if (d.n && d.w) return 'nw-resize';
      if (d.n && d.e) return 'ne-resize';
      if (d.s && d.w) return 'sw-resize';
      if (d.s && d.e) return 'se-resize';
      if (d.n || d.s) return 'ns-resize';
      return 'ew-resize';
    };

    cell.addEventListener('pointermove', (ev: PointerEvent) => {
      if (ev.buttons !== 0) return;
      const isSelected = getFrameSelection(canvasFrame.id) === frame.id;
      const d = isSelected ? getDir(ev, cell) : null;
      cell.style.cursor = d ? dirCursor(d) : '';
    });

    cell.addEventListener('mouseleave', () => { cell.style.cursor = ''; });

    cell.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const isSelected = getFrameSelection(canvasFrame.id) === frame.id;
      const dir = isSelected ? getDir(e, cell) : null;
      isDragging = false;
      const startX = e.clientX;
      const startY = e.clientY;
      const startPlacement = { ...frame.placement };
      cell.setPointerCapture(e.pointerId);

      if (dir) {
        const calcPlacement = (cx: number, cy: number): { x: number; y: number; width: number; height: number } => {
          const rect = canvasEl.getBoundingClientRect();
          const cw = rect.width / cols;
          const ch = rect.height / rows;
          const dx = cx - startX;
          const dy = cy - startY;
          let { x, y, width, height } = startPlacement;
          if (dir.e) width = Math.max(1, width + Math.round(dx / cw));
          if (dir.s) height = Math.max(1, height + Math.round(dy / ch));
          if (dir.w) { const dc = Math.round(dx / cw); x = Math.max(1, x + dc); width = Math.max(1, startPlacement.width - dc); }
          if (dir.n) { const dr = Math.round(dy / ch); y = Math.max(1, y + dr); height = Math.max(1, startPlacement.height - dr); }
          return { x, y, width, height };
        };

        const onMove = (moveEvent: PointerEvent): void => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (!isDragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          isDragging = true;
          const p = calcPlacement(moveEvent.clientX, moveEvent.clientY);
          cell.style.gridColumn = `${p.x} / span ${p.width}`;
          cell.style.gridRow = `${p.y} / span ${p.height}`;
          cell.style.opacity = '0.7';
        };

        const onUp = (upEvent: PointerEvent): void => {
          cell.removeEventListener('pointermove', onMove);
          cell.removeEventListener('pointerup', onUp);
          if (!isDragging) return;
          cell.style.opacity = '';
          const p = calcPlacement(upEvent.clientX, upEvent.clientY);
          if (p.x === startPlacement.x && p.y === startPlacement.y && p.width === startPlacement.width && p.height === startPlacement.height) { isDragging = false; return; }
          void (async () => {
            const freshRes = await fetch(`/api/layouts/${screenId}`);
            if (!freshRes.ok) return;
            const freshScreen = (await freshRes.json()) as unknown;
            if (!isScreen(freshScreen)) return;
            await fetch(`/api/layouts/${screenId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...freshScreen,
                frames: freshScreen.frames.map((f) =>
                  f.id === frame.id ? { ...f, placement: p } : f,
                ),
              }),
            });
            onReload();
          })();
        };

        cell.addEventListener('pointermove', onMove);
        cell.addEventListener('pointerup', onUp);
      } else {
        const onMove = (moveEvent: PointerEvent): void => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (!isDragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          isDragging = true;
          const rect = canvasEl.getBoundingClientRect();
          const newX = Math.max(1, Math.min(cols - startPlacement.width + 1, startPlacement.x + Math.round(dx / (rect.width / cols))));
          const newY = Math.max(1, startPlacement.y + Math.round(dy / (rect.height / rows)));
          cell.style.gridColumn = `${newX} / span ${startPlacement.width}`;
          cell.style.gridRow = `${newY} / span ${startPlacement.height}`;
          cell.style.opacity = '0.7';
          cell.style.zIndex = '10';
        };

        const onUp = (upEvent: PointerEvent): void => {
          cell.removeEventListener('pointermove', onMove);
          cell.removeEventListener('pointerup', onUp);
          if (!isDragging) return;
          cell.style.opacity = '';
          cell.style.zIndex = '';
          const rect = canvasEl.getBoundingClientRect();
          const newX = Math.max(1, Math.min(cols - startPlacement.width + 1, startPlacement.x + Math.round((upEvent.clientX - startX) / (rect.width / cols))));
          const newY = Math.max(1, startPlacement.y + Math.round((upEvent.clientY - startY) / (rect.height / rows)));
          if (newX === startPlacement.x && newY === startPlacement.y) { isDragging = false; return; }
          void (async () => {
            const freshRes = await fetch(`/api/layouts/${screenId}`);
            if (!freshRes.ok) return;
            const freshScreen = (await freshRes.json()) as unknown;
            if (!isScreen(freshScreen)) return;
            await fetch(`/api/layouts/${screenId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...freshScreen,
                frames: freshScreen.frames.map((f) =>
                  f.id === frame.id ? { ...f, placement: { ...startPlacement, x: newX, y: newY } } : f,
                ),
              }),
            });
            onReload();
          })();
        };

        cell.addEventListener('pointermove', onMove);
        cell.addEventListener('pointerup', onUp);
      }
    });

    cell.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (isDragging) { isDragging = false; return; }
      applyCanvasSelectedStyle(false);
      for (const child of canvasEl.children) {
        applySelectedStyle(child as HTMLElement, false);
      }
      applySelectedStyle(cell, true);
      setFrameSelection(canvasFrame.id, frame.id);
      void onFrameSelect(screenId, frame.id);
    });

    canvasEl.appendChild(cell);

    if (effectiveKind === 'screen-list') {
      void renderScreenListPreview(previewWrapper, frame as ScreenListFrame);
    } else if (effectiveKind === 'grid-canvas') {
      renderGridCanvasPreview(previewWrapper, frame as GridCanvasFrame, screen);
    } else if (effectiveKind === 'component-editor') {
      void renderEditorPreview(previewWrapper, frame as EditorFrame, screen, screenId);
    }
  }
};
