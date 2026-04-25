import { useEffect, useState } from 'react';

import { GridCanvas } from './grid-canvas';
import { type GridLayout, gridLayoutSchema } from './schema';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; layout: GridLayout };

const fetchLayout = async (url: string): Promise<GridLayout> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return gridLayoutSchema.parse(await res.json());
};

export const GridApp = () => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    fetchLayout('./layouts/sample.json')
      .then((layout) => setState({ status: 'ready', layout }))
      .catch((e: unknown) =>
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
  }, []);

  if (state.status === 'loading') {
    return <main className="grid-app" />;
  }

  if (state.status === 'error') {
    return (
      <main className="grid-app">
        <p style={{ padding: 16, color: 'var(--editor-text-muted)' }}>{state.message}</p>
      </main>
    );
  }

  return (
    <main className="grid-app">
      <GridCanvas layout={state.layout} />
    </main>
  );
};
