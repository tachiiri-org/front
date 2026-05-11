export type { StyleEntrySpec, StyleValueTarget } from './types';

export const CSS_PROP_KEYS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'display',
  'gap',
  'flex',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'textAlign',
  'fontSize',
  'fontWeight',
  'color',
  'background',
  'backgroundColor',
  'border',
  'borderRadius',
  'boxShadow',
  'overflow',
  'overflowX',
  'overflowY',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'cursor',
  'whiteSpace',
  'opacity',
  'transform',
  'transformOrigin',
  'userSelect',
  'pointerEvents',
  'lineHeight',
] as const;

export type CssStyleProps = Partial<Record<typeof CSS_PROP_KEYS[number], string>>;

export const isStyleRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
