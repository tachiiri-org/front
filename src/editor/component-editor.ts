import type { FormField } from '../schema/component';
import componentEditorSchemaJson from './component-editor.schema.json';

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
};

export const editorSchema = componentEditorSchemaJson as FormField[];

export const isEditorComponent = (value: unknown): value is EditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'component-editor' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.sourceCanvasId === undefined || typeof c.sourceCanvasId === 'string') &&
    (c.sections === undefined ||
      (Array.isArray(c.sections) && c.sections.every(isEditorSection)))
  );
};
