const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type ListComponent = {
  kind: 'list';
  src?: string;
  targetComponentId?: string;
  style?: Record<string, string>;
  itemStyle?: Record<string, string>;
};

export const listDefaults: ListComponent = {
  kind: 'list',
  src: '',
  targetComponentId: '',
  style: {},
  itemStyle: {},
};

export const isListComponent = (value: unknown): value is ListComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'list' &&
    (c.src === undefined || typeof c.src === 'string') &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.itemStyle === undefined || isStyle(c.itemStyle))
  );
};
