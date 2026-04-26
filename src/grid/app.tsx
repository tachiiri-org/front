import { useEffect, useState } from 'react';

import { GridCanvas } from './grid-canvas';
import { EditorProvider, type EditorContextValue } from './editor-context';
import { gridLayoutSchema, type GridCell, type GridLayout } from './schema';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; layout: GridLayout };

const LAYOUT_ID = 'sample';

const fetchLayout = async (): Promise<GridLayout> => {
  const res = await fetch(`/api/layouts/${LAYOUT_ID}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return gridLayoutSchema.parse(await res.json());
};

const saveLayout = async (layout: GridLayout): Promise<void> => {
  const res = await fetch(`/api/layouts/${LAYOUT_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
};

export const GridApp = () => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [cells, setCells] = useState<GridCell[]>([]);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLayout()
      .then((layout) => {
        setState({ status: 'ready', layout });
        setCells(layout.cells);
        const canvas = layout.cells.find((c) => c.type === 'Canvas');
        if (canvas) setSelectedCellId(canvas.id);
      })
      .catch((e: unknown) =>
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
  }, []);

  if (state.status === 'loading') return <main className="grid-app" />;

  if (state.status === 'error') {
    return (
      <main className="grid-app">
        <p style={{ padding: 16, color: 'var(--editor-text-muted)' }}>{state.message}</p>
      </main>
    );
  }

  const { layout } = state;

  const handleCellChange = (updated: GridCell): void => {
    setCells((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleSave = (): void => {
    setSaving(true);
    saveLayout({ ...layout, cells })
      .catch((e: unknown) => console.error('Save failed:', e))
      .finally(() => setSaving(false));
  };

  const editorContext: EditorContextValue = {
    layout,
    cells,
    selectedCellId,
    saving,
    onCellSelect: setSelectedCellId,
    onCellChange: handleCellChange,
    onCellsChange: setCells,
    onSave: handleSave,
  };

  return (
    <EditorProvider value={editorContext}>
      <main className="grid-app">
        <GridCanvas layout={layout} cells={cells} />
      </main>
    </EditorProvider>
  );
};
