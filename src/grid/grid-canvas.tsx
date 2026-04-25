import { useEffect, useRef, useState } from 'react';

import { componentCatalogMap } from '../catalog/components';
import type { GridCell, GridLayout } from './schema';

const calculateCanvasSize = (
  availableWidth: number,
  availableHeight: number,
  aspectRatio: number,
): { readonly width: number; readonly height: number } => {
  const nextWidth = Math.max(
    0,
    Math.floor(Math.min(availableWidth, availableHeight * aspectRatio)),
  );
  const nextHeight = Math.max(0, Math.floor(nextWidth / aspectRatio));
  return { width: nextWidth, height: nextHeight };
};

type DragState = {
  readonly cellId: string;
  readonly mode: 'move' | 'resize';
  readonly originX: number;
  readonly originY: number;
};

type GridCanvasProps = {
  readonly layout: GridLayout;
  readonly onLayoutChange?: (layout: GridLayout) => void;
};

export const GridCanvas = ({ layout, onLayoutChange }: GridCanvasProps) => {
  const [cells, setCells] = useState<GridCell[]>(layout.cells);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);

  const { columns, rows } = layout.grid;
  const aspectRatio = layout.viewport.width / layout.viewport.height;

  useEffect(() => {
    const shell = shellRef.current;
    const stage = stageRef.current;

    if (!shell || !stage || typeof ResizeObserver === 'undefined') {
      return;
    }

    const update = (): void => {
      const stageStyle = window.getComputedStyle(stage);
      const hp =
        Number.parseFloat(stageStyle.paddingLeft) + Number.parseFloat(stageStyle.paddingRight);
      const vp =
        Number.parseFloat(stageStyle.paddingTop) + Number.parseFloat(stageStyle.paddingBottom);

      setCanvasSize(
        calculateCanvasSize(
          Math.max(0, stage.clientWidth - hp),
          Math.max(0, stage.clientHeight - vp),
          aspectRatio,
        ),
      );
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(shell);
    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [aspectRatio]);

  useEffect(() => {
    if (!drag) {
      return;
    }

    const unitPx = canvasSize ? canvasSize.width / columns : 6;

    const handleMove = (event: PointerEvent): void => {
      const deltaX = Math.round((event.clientX - drag.originX) / unitPx);
      const deltaY = Math.round((event.clientY - drag.originY) / unitPx);

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      setCells((prev) =>
        prev.map((cell) => {
          if (cell.id !== drag.cellId) {
            return cell;
          }

          if (drag.mode === 'move') {
            return {
              ...cell,
              frame: {
                ...cell.frame,
                x: Math.max(0, Math.min(columns - cell.frame.w, cell.frame.x + deltaX)),
                y: Math.max(0, Math.min(rows - cell.frame.h, cell.frame.y + deltaY)),
              },
            };
          }

          return {
            ...cell,
            frame: {
              ...cell.frame,
              w: Math.max(1, Math.min(columns - cell.frame.x, cell.frame.w + deltaX)),
              h: Math.max(1, Math.min(rows - cell.frame.y, cell.frame.h + deltaY)),
            },
          };
        }),
      );

      setDrag({ ...drag, originX: event.clientX, originY: event.clientY });
    };

    const handleUp = (): void => {
      setDrag(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [drag, canvasSize, columns, rows]);

  const commitText = (cellId: string, value: string): void => {
    const cell = cells.find((c) => c.id === cellId);
    const definition = cell ? componentCatalogMap[cell.type] : undefined;
    const prop = definition?.primaryTextProp;

    if (!prop) {
      return;
    }

    const nextCells = cells.map((c) =>
      c.id === cellId ? { ...c, props: { ...c.props, [prop]: value } } : c,
    );

    setCells(nextCells);
    onLayoutChange?.({ ...layout, cells: nextCells });
  };

  const { background, gridLine, border, shadow } = layout.canvas;

  return (
    <section className="grid-canvas-shell" ref={shellRef}>
      <div className="grid-canvas-toolbar">
        <span>
          {layout.viewport.label} · {layout.viewport.width}:{layout.viewport.height}
        </span>
        <span>{layout.id}</span>
      </div>
      <div className="grid-canvas-stage" ref={stageRef}>
        <div
          className="grid-canvas"
          style={
            {
              '--grid-columns': columns,
              '--grid-rows': rows,
              '--canvas-background': background,
              '--canvas-grid-line': gridLine,
              '--canvas-border': border,
              ...(shadow ? { '--canvas-shadow': shadow } : {}),
              ...(canvasSize
                ? {
                    width: `${canvasSize.width}px`,
                    height: `${canvasSize.height}px`,
                    aspectRatio: `${aspectRatio}`,
                  }
                : { aspectRatio: `${aspectRatio}` }),
            } as React.CSSProperties & Record<`--${string}`, string | number>
          }
        >
          {cells.map((cell) => {
            const definition = componentCatalogMap[cell.type];
            const isEditing = editingCellId === cell.id;
            const primaryTextProp = definition?.primaryTextProp;

            return (
              <div
                key={cell.id}
                className="grid-canvas__cell"
                style={{
                  left: `${(cell.frame.x / columns) * 100}%`,
                  top: `${(cell.frame.y / rows) * 100}%`,
                  width: `${(cell.frame.w / columns) * 100}%`,
                  height: `${(cell.frame.h / rows) * 100}%`,
                }}
              >
                {isEditing && primaryTextProp ? (
                  <textarea
                    autoFocus
                    className="grid-canvas__inline-editor"
                    value={draftText}
                    onBlur={() => {
                      commitText(cell.id, draftText);
                      setEditingCellId(null);
                    }}
                    onChange={(e) => setDraftText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingCellId(null);
                        return;
                      }
                      if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        commitText(cell.id, draftText);
                        setEditingCellId(null);
                      }
                    }}
                  />
                ) : null}
                <div
                  className="grid-canvas__drag-surface"
                  onPointerDown={(e) => {
                    if (isEditing) {
                      return;
                    }
                    e.stopPropagation();
                    setDrag({
                      cellId: cell.id,
                      mode: 'move',
                      originX: e.clientX,
                      originY: e.clientY,
                    });
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (primaryTextProp) {
                      setEditingCellId(cell.id);
                      setDraftText(String(cell.props[primaryTextProp] ?? ''));
                    }
                  }}
                >
                  {definition ? (
                    definition.render(cell.props)
                  ) : (
                    <span className="grid-canvas__unknown-type">{cell.type}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="grid-canvas__resize-handle"
                  aria-label={`Resize ${cell.id}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDrag({
                      cellId: cell.id,
                      mode: 'resize',
                      originX: e.clientX,
                      originY: e.clientY,
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
