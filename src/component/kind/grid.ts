export type GridComponent = {
  kind: 'grid';
  rows: number;
  columns: number;
  padding?: string;
};

export const gridDefaults: GridComponent = { kind: 'grid', rows: 1, columns: 1 };

export const isGridComponent = (value: unknown): value is GridComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'grid' &&
    typeof c.rows === 'number' &&
    Number.isInteger(c.rows) &&
    c.rows > 0 &&
    typeof c.columns === 'number' &&
    Number.isInteger(c.columns) &&
    c.columns > 0 &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
