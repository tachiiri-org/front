import type { FormField } from './form/field';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type ListComponent = {
  kind: 'list';
  name?: string;
  src?: string;
  targetComponentId?: string;
  style?: Record<string, string>;
  itemStyle?: Record<string, string>;
};

export const listDefaults: ListComponent = {
  kind: 'list',
  name: '',
  src: '',
  targetComponentId: '',
  style: {},
  itemStyle: {},
};

export const listSchema: FormField[] = [
  { kind: 'text-field', key: 'src', label: 'src' },
  { kind: 'text-field', key: 'targetComponentId', label: 'targetComponentId' },
  { kind: 'style-map-field', key: 'style', label: 'style' },
  { kind: 'style-map-field', key: 'itemStyle', label: 'itemStyle' },
];

export const isListComponent = (value: unknown): value is ListComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'list' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.src === undefined || typeof c.src === 'string') &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.itemStyle === undefined || isStyle(c.itemStyle))
  );
};
