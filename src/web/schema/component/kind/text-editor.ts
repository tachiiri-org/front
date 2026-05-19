import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type TextEditorComponent = {
  kind: 'text-editor';
  name?: string;
  sourceComponentId?: string;
} & CssStyleProps;

export const textEditorDefaults: TextEditorComponent = {
  kind: 'text-editor',
  name: '',
};

export const textEditorSchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
  { kind: 'text-field', key: 'sourceComponentId', label: 'sourceComponentId' },
];

export const isTextEditorComponent = (value: unknown): value is TextEditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'text-editor') return false;
  if (c.name !== undefined && typeof c.name !== 'string') return false;
  if (c.sourceComponentId !== undefined && typeof c.sourceComponentId !== 'string') return false;
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
