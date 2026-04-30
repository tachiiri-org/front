import { isStyle } from './validator';

export type EditorSection = {
  label?: string;
  source: 'placement' | 'properties';
};

export type EditorComponent = {
  kind: 'component-editor';
  sections?: EditorSection[];
  excludeKeys?: string[];
  style?: Record<string, string>;
};

const isEditorSection = (v: unknown): v is EditorSection => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.label === undefined || typeof c.label === 'string') &&
    (c.source === 'placement' || c.source === 'properties')
  );
};

export const isEditorComponent = (value: unknown): value is EditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'component-editor' &&
    (c.sections === undefined ||
      (Array.isArray(c.sections) && c.sections.every(isEditorSection))) &&
    (c.excludeKeys === undefined ||
      (Array.isArray(c.excludeKeys) && c.excludeKeys.every((e) => typeof e === 'string'))) &&
    (c.style === undefined || isStyle(c.style))
  );
};
