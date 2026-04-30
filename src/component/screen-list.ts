import { isStyle } from './validator';

export type ScreenListComponent = {
  kind: 'screen-list';
  targetComponentId?: string;
  style?: Record<string, string>;
  itemStyle?: Record<string, string>;
};

export const isScreenListComponent = (value: unknown): value is ScreenListComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'screen-list' &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.itemStyle === undefined || isStyle(c.itemStyle))
  );
};
