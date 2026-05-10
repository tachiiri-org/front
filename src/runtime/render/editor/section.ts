import type { EditorSection } from '../../../editor/component-editor';
import type { SchemaField } from '../../../schema/component';
import { renderFormFromSchema } from './form';
import type { FieldStyleContext } from './context';
import { inferFieldsFromData } from '../../bind/form/infer';

export const SECTION_SUMMARY_STYLE: Record<string, string> = {
  fontSize: '11px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.75)',
  padding: '6px 8px 4px',
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
  letterSpacing: '0.02em',
};

export const SECTION_HEADING_STYLE: Record<string, string> = {
  fontSize: '11px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.75)',
  padding: '6px 8px 4px',
  margin: '0',
  letterSpacing: '0.02em',
};

export const appendSection = (
  parent: HTMLElement,
  section: EditorSection,
  contentEl: HTMLElement,
): void => {
  if (section.collapsible) {
    const details = document.createElement('details');
    if (!section.defaultCollapsed) details.open = true;
    if (section.label) {
      const summary = document.createElement('summary');
      summary.textContent = section.label;
      Object.assign(summary.style, SECTION_SUMMARY_STYLE);
      details.appendChild(summary);
    }
    details.appendChild(contentEl);
    parent.appendChild(details);
  } else {
    const sectionEl = document.createElement('div');
    if (section.label) {
      const heading = document.createElement('p');
      Object.assign(heading.style, SECTION_HEADING_STYLE);
      heading.textContent = section.label;
      sectionEl.appendChild(heading);
    }
    sectionEl.appendChild(contentEl);
    parent.appendChild(sectionEl);
  }
};

export const createLabeledRow = (label: string): HTMLDivElement => {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px',
    gap: '4px',
    minHeight: '32px',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '8px',
    background: 'rgba(243,244,246,0.95)',
    marginBottom: '8px',
  });
  const rowLabel = document.createElement('span');
  rowLabel.textContent = label;
  Object.assign(rowLabel.style, {
    fontSize: '10px',
    fontWeight: '600',
    color: 'rgba(0,0,0,0.56)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    width: '88px',
    flexShrink: '0',
  });
  row.appendChild(rowLabel);
  return row;
};

export const renderSectionContent = (
  data: Record<string, unknown>,
  schema: SchemaField[] | null,
  onSave: (draft: unknown) => Promise<void>,
  ctx: FieldStyleContext,
  saveOnBlur = false,
  selectEndpointVariables: Record<string, string> = {},
): HTMLElement => {
  const fields = schema ?? inferFieldsFromData(data);
  return renderFormFromSchema(data, fields, onSave, ctx, {
    saveOnBlur,
    selectEndpointVariables,
  });
};
