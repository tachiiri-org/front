import { isStyle } from '../validator';

export type FieldStyleConfig = {
  wrapper?: Record<string, string>;
  label?: Record<string, string>;
  input?: Record<string, string>;
};

export type EditorSection = {
  label?: string;
  source: 'placement' | 'properties';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

export type EditorComponent = {
  kind: 'component-editor';
  sections?: EditorSection[];
  excludeKeys?: string[];
  style?: Record<string, string>;
  fieldStyle?: FieldStyleConfig;
};

const isFieldStyleConfig = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.wrapper === undefined || isStyle(c.wrapper)) &&
    (c.label === undefined || isStyle(c.label)) &&
    (c.input === undefined || isStyle(c.input))
  );
};

const isEditorSection = (v: unknown): v is EditorSection => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.label === undefined || typeof c.label === 'string') &&
    (c.source === 'placement' || c.source === 'properties') &&
    (c.collapsible === undefined || typeof c.collapsible === 'boolean') &&
    (c.defaultCollapsed === undefined || typeof c.defaultCollapsed === 'boolean')
  );
};

export const editorDefaults: EditorComponent = { kind: 'component-editor' };

export const isEditorComponent = (value: unknown): value is EditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'component-editor' &&
    (c.sections === undefined ||
      (Array.isArray(c.sections) && c.sections.every(isEditorSection))) &&
    (c.excludeKeys === undefined ||
      (Array.isArray(c.excludeKeys) && c.excludeKeys.every((e) => typeof e === 'string'))) &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.fieldStyle === undefined || isFieldStyleConfig(c.fieldStyle))
  );
};
