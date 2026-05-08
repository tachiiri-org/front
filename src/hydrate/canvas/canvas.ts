import { isScreen, isFrameRef } from '../../screen';
import type { Frame, CanvasFrame, Screen, ListFrame, EditorFrame } from '../../screen';
import type { Component } from '../../component';
import { elementDefaults } from '../../component';
import { domMap, getCanvasSelection, setCanvasSelection, isEditableTarget } from '../../state';
import { fetchFrameComponent } from '../../api/layouts';
import { renderListPreview } from '../list/preview';
import { renderEditorPreview } from '../editor/preview';
import { allocateDefaultEntityName } from '../../component/name';
import { renderComponent } from '../../render/page/component';
import { previewScaleRafs, schedulePreviewScale } from './scale';
import { EDITOR_ONLY_KINDS, renderCanvasPreview, renderFramePreview } from '../../render/canvas/preview';

let previewResizeObserver: ResizeObserver | null = null;

const directionMap: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

let canvasInteractionController: AbortController | null = null;

export const hydrateCanvas = async (
  selectedScreenId: string | null,
  canvasFrame: CanvasFrame,
  onFrameSelect: (screenId: string, frameId: string | null) => Promise<void>,
  onCanvasSelect: (screenId: string) => Promise<void>,
  onReload: () => void,
): Promise<void> => {
  const canvasEl = domMap.get(canvasFrame.id);
  if (!canvasEl) return;

  previewResizeObserver?.disconnect();
  previewResizeObserver = null;
  for (const rafId of previewScaleRafs.values()) cancelAnimationFrame(rafId);
  previewScaleRafs.clear();

  if (!selectedScreenId) {
    canvasEl.replaceChildren();
    return;
  }

  const response = await fetch(`/api/layouts/${selectedScreenId}`);
  if (!response.ok) { canvasEl.replaceChildren(); return; }
  const value = (await response.json()) as unknown;
  if (!isScreen(value)) { canvasEl.replaceChildren(); return; }

  let screen = value;
  const cols = screen.grid.columns;
  let rows = screen.grid.rows ?? screen.frames.reduce(
    (m, f) => Math.max(m, f.placement.y + f.placement.height - 1),
    1,
  );

  canvasEl.style.display = 'grid';
  canvasEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  canvasEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  canvasEl.style.border = '1px solid rgba(0, 0, 0, 0.12)';
  canvasEl.style.boxSizing = 'border-box';
  canvasEl.style.backgroundImage = [
    'linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px)',
    'linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)',
  ].join(', ');
  canvasEl.style.backgroundSize = `calc(100% / ${cols}) calc(100% / ${rows})`;
  canvasEl.style.cursor = 'default';
  canvasEl.style.position = 'relative';
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

  const currentSel = getCanvasSelection(canvasFrame.id);
  const currentFrameId = currentSel?.kind === 'frame' ? currentSel.id : null;
  const screenId = selectedScreenId;
  const frameCells = new Map<string, HTMLElement>();
  const previewWrappers = new Map<string, HTMLElement>();

  const selectionOverlay = document.createElement('div');
  selectionOverlay.style.position = 'absolute';
  selectionOverlay.style.inset = '0';
  selectionOverlay.style.pointerEvents = 'none';
  selectionOverlay.style.zIndex = '9999';

  const updateSelectionOverlay = (selectedCell: HTMLElement | null): void => {
    selectionOverlay.replaceChildren();
    if (!selectedCell) return;
    const indicator = document.createElement('div');
    indicator.style.position = 'absolute';
    indicator.style.left = `${selectedCell.offsetLeft}px`;
    indicator.style.top = `${selectedCell.offsetTop}px`;
    indicator.style.width = `${selectedCell.offsetWidth}px`;
    indicator.style.height = `${selectedCell.offsetHeight}px`;
    indicator.style.outline = '2px solid rgba(0, 100, 220, 0.8)';
    indicator.style.boxSizing = 'border-box';
    selectionOverlay.appendChild(indicator);
  };

  const applyCanvasSelectedStyle = (selected: boolean): void => {
    canvasEl.style.outline = selected ? '2px solid rgba(0, 100, 220, 0.4)' : '';
  };

  const syncCanvasBounds = (): void => {
    rows = screen.grid.rows ?? screen.frames.reduce(
      (m, f) => Math.max(m, f.placement.y + f.placement.height - 1),
      1,
    );
    canvasEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    canvasEl.style.backgroundSize = `calc(100% / ${cols}) calc(100% / ${rows})`;
  };

  const getEffectiveKind = (frame: Frame): string => {
    const resolved = resolvedComponents.get(frame.id);
    return resolved
      ? String((resolved as Record<string, unknown>).kind ?? '')
      : String((frame as Record<string, unknown>).kind ?? '');
  };

  const refreshPreview = async (frame: Frame): Promise<void> => {
    const wrapper = previewWrappers.get(frame.id);
    if (!wrapper) return;

    const resolved = resolvedComponents.get(frame.id) ?? null;
    const effectiveKind = getEffectiveKind(frame);

    if (effectiveKind === 'list') {
      await renderListPreview(wrapper, frame as ListFrame);
      schedulePreviewScale(frame.id, previewWrappers, canvasEl, canvasFrame, effectiveKind);
      return;
    }

    if (effectiveKind === 'canvas') {
      renderCanvasPreview(wrapper, frame as CanvasFrame);
      schedulePreviewScale(frame.id, previewWrappers, canvasEl, canvasFrame, effectiveKind);
      return;
    }

    if (effectiveKind === 'component-editor') {
      await renderEditorPreview(wrapper, frame as EditorFrame, screen, screenId);
      schedulePreviewScale(frame.id, previewWrappers, canvasEl, canvasFrame, effectiveKind);
      return;
    }

    wrapper.replaceChildren();
    if (!EDITOR_ONLY_KINDS.has(effectiveKind)) {
      wrapper.appendChild(renderComponent(frame, {}, resolved));
    }
    schedulePreviewScale(frame.id, previewWrappers, canvasEl, canvasFrame, effectiveKind);
  };

  const refreshDependentPreviews = async (): Promise<void> => {
    await Promise.all(
      screen.frames
        .filter((frame) => {
          const kind = getEffectiveKind(frame);
          return kind === 'list' || kind === 'canvas' || kind === 'component-editor';
        })
        .map((frame) => refreshPreview(frame)),
    );
    const depSel = getCanvasSelection(canvasFrame.id);
    const depFrameId = depSel?.kind === 'frame' ? depSel.id : null;
    updateSelectionOverlay(depFrameId ? frameCells.get(depFrameId) ?? null : null);
  };

  const appendFrameCell = (cell: HTMLElement): void => {
    if (selectionOverlay.parentNode === canvasEl) {
      canvasEl.insertBefore(cell, selectionOverlay);
      return;
    }
    canvasEl.appendChild(cell);
  };

  const buildFrameCell = (frame: Frame): HTMLElement => {
    const resolved = resolvedComponents.get(frame.id) ?? null;
    const effectiveKind = getEffectiveKind(frame);

    const cell = document.createElement('div');
    cell.style.gridColumn = `${frame.placement.x} / span ${frame.placement.width}`;
    cell.style.gridRow = `${frame.placement.y} / span ${frame.placement.height}`;
    cell.style.position = 'relative';
    cell.style.backgroundColor = 'white';
    if (canvasFrame.cellStyle) Object.assign(cell.style, canvasFrame.cellStyle);
    const resolvedStyle = resolved
      ? (resolved as Record<string, unknown>).style as Record<string, string> | undefined
      : undefined;
    const frameStyle = (frame as Record<string, unknown>).style as Record<string, string> | undefined;
    const bgColor = resolvedStyle?.backgroundColor ?? frameStyle?.backgroundColor;
    if (bgColor !== undefined) cell.style.backgroundColor = bgColor;

    const previewWrapper = renderFramePreview(frame, resolved, effectiveKind);
    previewWrappers.set(frame.id, previewWrapper);
    cell.appendChild(previewWrapper);
    if (effectiveKind === 'list' || effectiveKind === 'canvas' || effectiveKind === 'component-editor') {
      void refreshPreview(frame);
    }
    schedulePreviewScale(frame.id, previewWrappers, canvasEl, canvasFrame, effectiveKind);

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
      const sel = getCanvasSelection(canvasFrame.id);
      const isSelected = sel?.kind === 'frame' && sel.id === frame.id;
      const d = isSelected ? getDir(ev, cell) : null;
      cell.style.cursor = d ? dirCursor(d) : '';
    });

    cell.addEventListener('mouseleave', () => { cell.style.cursor = ''; });

    cell.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const sel = getCanvasSelection(canvasFrame.id);
      const isSelected = sel?.kind === 'frame' && sel.id === frame.id;
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
          selectionOverlay.style.display = 'none';
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
          if (p.x === startPlacement.x && p.y === startPlacement.y && p.width === startPlacement.width && p.height === startPlacement.height) {
            isDragging = false;
            selectionOverlay.style.display = '';
            updateSelectionOverlay(cell);
            return;
          }
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
          selectionOverlay.style.display = 'none';
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
          if (newX === startPlacement.x && newY === startPlacement.y) {
            isDragging = false;
            selectionOverlay.style.display = '';
            updateSelectionOverlay(cell);
            return;
          }
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
      updateSelectionOverlay(cell);
      setCanvasSelection(canvasFrame.id, { kind: 'frame', id: frame.id });
      void onFrameSelect(screenId, frame.id);
    });

    return cell;
  };

  const insertFrameCell = (frame: Frame): void => {
    const cell = buildFrameCell(frame);
    frameCells.set(frame.id, cell);
    appendFrameCell(cell);
  };

  canvasInteractionController?.abort();
  canvasInteractionController = new AbortController();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const keySel = getCanvasSelection(canvasFrame.id);
    if (keySel?.kind !== 'frame') return;
    const selectedId = keySel.id;

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
        frameCells.get(selectedId)?.remove();
        frameCells.delete(selectedId);
        previewWrappers.delete(selectedId);
        resolvedComponents.delete(selectedId);
        screen = {
          ...freshScreen,
          frames: freshScreen.frames.filter((f) => f.id !== selectedId),
        };
        syncCanvasBounds();
        setCanvasSelection(canvasFrame.id, null);
        updateSelectionOverlay(null);
        await refreshDependentPreviews();
        await onFrameSelect(screenId, null);
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

  let suppressCanvasClick = false;
  canvasEl.addEventListener('click', () => {
    if (suppressCanvasClick) { suppressCanvasClick = false; return; }
    updateSelectionOverlay(null);
    applyCanvasSelectedStyle(true);
    setCanvasSelection(canvasFrame.id, { kind: 'canvas' });
    void onCanvasSelect(screenId);
  });

  canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== canvasEl) return;

    const rect = canvasEl.getBoundingClientRect();
    const startCol = Math.max(1, Math.min(cols, Math.ceil((e.clientX - rect.left) / (rect.width / cols))));
    const startRow = Math.max(1, Math.min(rows, Math.ceil((e.clientY - rect.top) / (rect.height / rows))));

    let isCreating = false;

    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9998';
    ghost.style.backgroundColor = 'rgba(0, 100, 220, 0.12)';
    ghost.style.border = '2px dashed rgba(0, 100, 220, 0.5)';
    ghost.style.boxSizing = 'border-box';
    ghost.style.display = 'none';
    canvasEl.appendChild(ghost);

    canvasEl.setPointerCapture(e.pointerId);

    const getCell = (cx: number, cy: number): { col: number; row: number } => {
      const r = canvasEl.getBoundingClientRect();
      return {
        col: Math.max(1, Math.min(cols, Math.ceil((cx - r.left) / (r.width / cols)))),
        row: Math.max(1, Math.min(rows, Math.ceil((cy - r.top) / (r.height / rows)))),
      };
    };

    const refreshGhost = (col: number, row: number): void => {
      const r = canvasEl.getBoundingClientRect();
      const cw = r.width / cols;
      const ch = r.height / rows;
      const x = Math.min(startCol, col);
      const y = Math.min(startRow, row);
      ghost.style.left = `${(x - 1) * cw}px`;
      ghost.style.top = `${(y - 1) * ch}px`;
      ghost.style.width = `${(Math.abs(col - startCol) + 1) * cw}px`;
      ghost.style.height = `${(Math.abs(row - startRow) + 1) * ch}px`;
      ghost.style.display = '';
    };

    const onMove = (me: PointerEvent): void => {
      if (!isCreating && Math.abs(me.clientX - e.clientX) < 4 && Math.abs(me.clientY - e.clientY) < 4) return;
      isCreating = true;
      const { col, row } = getCell(me.clientX, me.clientY);
      refreshGhost(col, row);
    };

    const onUp = (ue: PointerEvent): void => {
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      ghost.remove();
      if (!isCreating) return;
      suppressCanvasClick = true;

      const { col: endCol, row: endRow } = getCell(ue.clientX, ue.clientY);
      const x = Math.min(startCol, endCol);
      const y = Math.min(startRow, endRow);
      const width = Math.abs(endCol - startCol) + 1;
      const height = Math.abs(endRow - startRow) + 1;
      const newId = crypto.randomUUID();

      void (async () => {
        const freshRes = await fetch(`/api/layouts/${screenId}`);
        if (!freshRes.ok) return;
        const freshScreen = (await freshRes.json()) as unknown;
        if (!isScreen(freshScreen)) return;
        setCanvasSelection(canvasFrame.id, { kind: 'frame', id: newId });
        const newFrameData = {
          ...elementDefaults,
          id: newId,
          kind: 'element',
          placement: { x, y, width, height },
          name: allocateDefaultEntityName(
            freshScreen.frames as Array<{ id: string; kind: string; name?: unknown }>,
            elementDefaults.kind,
          ),
        } as Frame;
        await fetch(`/api/layouts/${screenId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...freshScreen,
            frames: [...freshScreen.frames, newFrameData],
          }),
        });
        const newFrame = newFrameData as Frame;
        screen = {
          ...freshScreen,
          frames: [
            ...freshScreen.frames,
            newFrame,
          ],
        };
        syncCanvasBounds();
        insertFrameCell(newFrame);
        setCanvasSelection(canvasFrame.id, { kind: 'frame', id: newId });
        updateSelectionOverlay(frameCells.get(newId) ?? null);
        await refreshDependentPreviews();
        void onFrameSelect(screenId, newId);
      })();
    };

    canvasEl.addEventListener('pointermove', onMove);
    canvasEl.addEventListener('pointerup', onUp);
  });

  for (const frame of screen.frames) {
    const cell = buildFrameCell(frame);
    frameCells.set(frame.id, cell);
    appendFrameCell(cell);
  }

  canvasEl.appendChild(selectionOverlay);
  updateSelectionOverlay(currentFrameId ? frameCells.get(currentFrameId) ?? null : null);

  if (typeof ResizeObserver !== 'undefined') {
    previewResizeObserver = new ResizeObserver(() => {
      for (const frameId of previewWrappers.keys()) {
        const frame = screen.frames.find((f) => f.id === frameId);
        if (!frame) continue;
        schedulePreviewScale(frameId, previewWrappers, canvasEl, canvasFrame, getEffectiveKind(frame));
      }
    });
    previewResizeObserver.observe(canvasEl);
  }
};
