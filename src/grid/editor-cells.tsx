import { useRef, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { z } from 'zod';

import type { ComponentDefinition } from '../catalog/components/shared';
import { componentCatalogMap } from '../catalog/components';
import { CellSidebar } from './cell-sidebar';
import { useEditorContext } from './editor-context';
import type { GridCell } from './schema';

// ─── EditorShell ─────────────────────────────────────────────────────────────

const editorShellDef: ComponentDefinition = {
  type: 'EditorShell',
  displayNameJa: 'エディタシェル',
  displayNameEn: 'Editor Shell',
  category: 'Editor',
  allowsChildren: false,
  propsSchema: z.object({ background: z.string() }),
  defaultProps: { background: '#2b2b2d' },
  fields: [{ kind: 'color', name: 'background', label: 'Background' }],
  render: (props) => (
    <div style={{ position: 'absolute', inset: 0, background: String(props.background ?? '#2b2b2d') }} />
  ),
};

// ─── EditorStage ─────────────────────────────────────────────────────────────

const editorStageDef: ComponentDefinition = {
  type: 'EditorStage',
  displayNameJa: 'ステージ',
  displayNameEn: 'Editor Stage',
  category: 'Editor',
  allowsChildren: false,
  propsSchema: z.object({ background: z.string() }),
  defaultProps: { background: '#2b2b2d' },
  fields: [{ kind: 'color', name: 'background', label: 'Background' }],
  render: (props) => (
    <div style={{ position: 'absolute', inset: 0, background: String(props.background ?? '#2b2b2d') }} />
  ),
};

// ─── EditorSidebar ───────────────────────────────────────────────────────────

const EditorSidebarInner = () => {
  const { layout, cells, selectedCellId, saving, onCellChange, onSave } = useEditorContext();
  const selectedCell = selectedCellId ? (cells.find((c) => c.id === selectedCellId) ?? null) : null;

  return (
    <CellSidebar
      cell={selectedCell}
      form={selectedCell ? (layout.editorForms?.[selectedCell.type] ?? null) : null}
      totalColumns={layout.grid.columns}
      totalRows={layout.grid.rows}
      saving={saving}
      onCellChange={onCellChange}
      onSave={onSave}
    />
  );
};

const editorSidebarDef: ComponentDefinition = {
  type: 'EditorSidebar',
  displayNameJa: 'エディタサイドバー',
  displayNameEn: 'Editor Sidebar',
  category: 'Editor',
  allowsChildren: false,
  propsSchema: z.object({
    background: z.string(),
    borderLeft: z.string(),
    footerBackground: z.string().optional(),
  }),
  defaultProps: { background: '#252526', borderLeft: '1px solid #3c3c3c', footerBackground: '#252526' },
  fields: [
    { kind: 'color', name: 'background', label: 'Background' },
    { kind: 'text', name: 'borderLeft', label: 'Border Left' },
  ],
  render: (props) => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: String(props.background ?? '#252526'),
        borderLeft: String(props.borderLeft ?? '1px solid #3c3c3c'),
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <EditorSidebarInner />
    </div>
  ),
};

// ─── Canvas (minimap) ─────────────────────────────────────────────────────────

type DragState = {
  readonly cellId: string;
  readonly mode: 'move' | 'resize';
  readonly originX: number;
  readonly originY: number;
};

const CHROME_TYPES = new Set(['EditorShell', 'EditorStage', 'EditorSidebar', 'Canvas']);

// Canvas cell id is found by looking for the Canvas type cell in cells list.
// Document cells are children of Canvas (parentId === canvasCell.id).
// They are positioned using absolute grid coords; we render them offset by
// the Canvas cell's own frame origin so they appear within the canvas area.

const CanvasSurface = ({ canvasProps }: { canvasProps: Record<string, unknown> }) => {
  const { layout, cells, selectedCellId, onCellSelect, onCellsChange } = useEditorContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftCells, setDraftCells] = useState<GridCell[] | null>(null);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const onCellsChangeRef = useRef(onCellsChange);
  onCellsChangeRef.current = onCellsChange;

  const { columns, rows } = layout.grid;

  // Find this Canvas cell to get its frame (used for origin offset)
  const canvasCell = cells.find((c) => c.type === 'Canvas');
  const canvasOriginX = canvasCell?.frame.x ?? 0;
  const canvasOriginY = canvasCell?.frame.y ?? 0;
  const canvasGridW = canvasCell?.frame.w ?? columns;
  const canvasGridH = canvasCell?.frame.h ?? rows;

  // Document cells = children of this Canvas cell
  const documentCells = cells.filter((c) => c.parentId === canvasCell?.id);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      setPixelSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Scale: map canvasGridW×canvasGridH to the Canvas pixel bounds
  const scaleX = pixelSize ? pixelSize.w / canvasGridW : 1;
  const scaleY = pixelSize ? pixelSize.h / canvasGridH : 1;
  const scale = Math.min(scaleX, scaleY);

  useEffect(() => {
    if (!drag || !pixelSize) return;

    const handleMove = (e: PointerEvent): void => {
      const deltaX = Math.round((e.clientX - drag.originX) / scale);
      const deltaY = Math.round((e.clientY - drag.originY) / scale);
      if (deltaX === 0 && deltaY === 0) return;

      setDraftCells((prev) => {
        const base = prev ?? cellsRef.current;
        return base.map((cell) => {
          if (cell.id !== drag.cellId) return cell;
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
        });
      });
      setDrag((prev) => (prev ? { ...prev, originX: e.clientX, originY: e.clientY } : null));
    };

    const handleUp = (): void => {
      setDraftCells((prev) => {
        if (prev) onCellsChangeRef.current(prev);
        return null;
      });
      setDrag(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [drag, pixelSize, scale, columns, rows]);

  const displayCells = draftCells ?? cells;
  const displayDocCells = displayCells.filter((c) => c.parentId === canvasCell?.id);

  const renderDocCell = (cell: GridCell): ReactNode => {
    const isSelected = selectedCellId === cell.id;
    const definition = componentCatalogMap[cell.type];

    // Offset absolute coords by canvas origin to get canvas-relative position
    const relX = cell.frame.x - canvasOriginX;
    const relY = cell.frame.y - canvasOriginY;

    const pixelLeft = relX * scale;
    const pixelTop = relY * scale;
    const pixelW = cell.frame.w * scale;
    const pixelH = cell.frame.h * scale;

    return (
      <div
        key={cell.id}
        style={{
          position: 'absolute',
          left: pixelLeft,
          top: pixelTop,
          width: pixelW,
          height: pixelH,
          overflow: 'hidden',
          outline: isSelected ? '2px solid #007acc' : undefined,
          outlineOffset: isSelected ? -2 : undefined,
          boxSizing: 'border-box',
          cursor: 'pointer',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onCellSelect(cell.id);
          setDrag({ cellId: cell.id, mode: 'move', originX: e.clientX, originY: e.clientY });
        }}
      >
        {definition ? definition.render(cell.props) : (
          <span style={{ fontSize: 11, color: '#888', padding: 4 }}>{cell.type}</span>
        )}
        {isSelected && (
          <button
            type="button"
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 10,
              height: 10,
              background: '#007acc',
              border: 'none',
              cursor: 'nwse-resize',
              padding: 0,
              zIndex: 10,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag({ cellId: cell.id, mode: 'resize', originX: e.clientX, originY: e.clientY });
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        background: String(canvasProps.background ?? '#252526'),
        overflow: 'hidden',
      }}
      onClick={() => onCellSelect(null)}
    >
      {displayDocCells.map(renderDocCell)}
    </div>
  );
};

const canvasDef: ComponentDefinition = {
  type: 'Canvas',
  displayNameJa: 'キャンバス',
  displayNameEn: 'Canvas',
  category: 'Editor',
  allowsChildren: true,
  allowedChildTypes: [
    'Heading', 'Text', 'Button', 'Image', 'Panel',
    'Header', 'Footer', 'Input', 'Textarea', 'List',
  ],
  propsSchema: z.object({
    background: z.string(),
    gridLine: z.string(),
    border: z.string(),
    shadow: z.string().optional(),
  }),
  defaultProps: {
    background: '#252526',
    gridLine: 'rgba(255, 255, 255, 0.04)',
    border: '#4f4f4f',
    shadow: '0 0 0 1px rgba(0, 0, 0, 0.25), 0 16px 40px rgba(0, 0, 0, 0.22)',
  },
  fields: [
    { kind: 'color', name: 'background', label: 'Background' },
    { kind: 'text', name: 'gridLine', label: 'Grid Line' },
    { kind: 'color', name: 'border', label: 'Border' },
    { kind: 'text', name: 'shadow', label: 'Shadow' },
  ],
  render: (props) => <CanvasSurface canvasProps={props} />,
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const editorCells: readonly ComponentDefinition[] = [
  editorShellDef,
  editorStageDef,
  editorSidebarDef,
  canvasDef,
];

export const editorCatalogMap: Record<string, ComponentDefinition> = Object.fromEntries(
  editorCells.map((d) => [d.type, d]),
);
