import type { FormField } from './form/field';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

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
  name?: string;
  sourceCanvasId?: string;
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

export const editorDefaults: EditorComponent = {
  kind: 'component-editor',
  name: '',
  sourceCanvasId: '',
  sections: [
    { source: 'properties', label: 'properties' },
    { source: 'placement' },
  ],
  style: {},
  fieldStyle: { wrapper: {}, label: {}, input: {} },
};

export const editorSchema: FormField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
  { kind: 'style-map-field', key: 'style', label: 'style' },
];

export const isEditorComponent = (value: unknown): value is EditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'component-editor' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.sourceCanvasId === undefined || typeof c.sourceCanvasId === 'string') &&
    (c.sections === undefined ||
      (Array.isArray(c.sections) && c.sections.every(isEditorSection))) &&
    (c.excludeKeys === undefined ||
      (Array.isArray(c.excludeKeys) && c.excludeKeys.every((e) => typeof e === 'string'))) &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.fieldStyle === undefined || isFieldStyleConfig(c.fieldStyle))
  );
};
