import {
  isListComponent,
  isCanvasComponent,
  isTextareaComponent,
  isTableComponent,
  applyDefaults,
  type Component,
} from '../../../schema/component';
import { type Frame, type FrameRef, isFrameRef } from '../../../schema/screen/screen';
import { isEditorComponent } from '../../../editor/component-editor';
import type { FrameState } from '../../../state';
import { renderList, renderCanvas, renderEditor, renderTable } from './frame';

const applyPadding = (el: HTMLElement, c: Record<string, unknown>): void => {
  if (typeof c.padding === 'string') el.style.padding = c.padding;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

const renderResolved = (
  id: string,
  component: Record<string, unknown>,
): HTMLElement => {
  const c = component as Record<string, unknown>;

  if (c.kind === 'heading') {
    const level = isPositiveInteger(c.level) && (c.level as number) <= 6 ? (c.level as number) : 1;
    const el = document.createElement(`h${level}` as keyof HTMLElementTagNameMap);
    el.dataset.frameId = id;
    if (typeof c.text === 'string') el.textContent = c.text;
    applyPadding(el, c);
    return el;
  }

  if (c.kind === 'element' && typeof c.tag === 'string' && isStringRecord(c.style)) {
    const el = document.createElement(c.tag as keyof HTMLElementTagNameMap);
    Object.assign(el.style, c.style);
    el.dataset.frameId = id;
    if (typeof c.text === 'string') el.textContent = c.text;
    applyPadding(el, c);
    return el;
  }

  if (c.kind === 'button') {
    const button = document.createElement('button');
    button.dataset.frameId = id;
    button.textContent = typeof c.text === 'string' ? c.text : String(c.kind);
    applyPadding(button, c);
    return button;
  }

  if (c.kind === 'select') {
    const select = document.createElement('select');
    select.dataset.frameId = id;
    if (typeof c.targetComponentId === 'string') {
      select.dataset.targetComponentId = c.targetComponentId;
    }
    applyPadding(select, c);
    return select;
  }

  if (c.kind === 'form') {
    const form = document.createElement('form');
    form.dataset.frameId = id;
    if (typeof c.sourceComponentId === 'string') {
      form.dataset.sourceComponentId = c.sourceComponentId;
    }
    if (typeof c.title === 'string' && c.title !== '') {
      const p = document.createElement('p');
      p.textContent = c.title;
      form.appendChild(p);
    }
    applyPadding(form, c);
    return form;
  }

  if (c.kind === 'table' && isTableComponent(c)) {
    const wrapper = renderTable(id, c);
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '12px';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const column of c.schema.columns.filter((column) => !column.hidden)) {
      const th = document.createElement('th');
      th.textContent = column.label;
      th.style.textAlign = 'left';
      th.style.borderBottom = '1px solid rgba(0,0,0,0.12)';
      th.style.padding = '4px 6px';
      th.style.whiteSpace = 'nowrap';
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of c.data.rows) {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      for (const column of c.schema.columns.filter((column) => !column.hidden)) {
        const td = document.createElement('td');
        td.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
        td.style.padding = '4px 6px';
        const value = row.values[column.key];
        td.textContent = value === undefined || value === null ? '' : String(value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  const pre = document.createElement('pre');
  pre.dataset.frameId = id;
  pre.textContent = JSON.stringify(component, null, 2);
  applyPadding(pre, c);
  return pre;
};

const renderTextareaComponent = (id: string, c: Record<string, unknown>): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '4px';
  if (isStringRecord(c.style)) Object.assign(wrapper.style, c.style);

  const ta = document.createElement('textarea');
  ta.style.flex = '1';
  ta.style.fontFamily = 'monospace';
  ta.style.fontSize = '13px';
  ta.style.resize = 'vertical';
  ta.style.boxSizing = 'border-box';
  ta.style.width = '100%';
  if (isPositiveInteger(c.rows)) ta.rows = c.rows as number;
  if (typeof c.value === 'string') ta.value = c.value;
  wrapper.appendChild(ta);

  if (c.language !== 'json') return wrapper;

  const status = document.createElement('div');
  status.style.fontSize = '11px';
  status.style.fontFamily = 'monospace';
  status.style.minHeight = '16px';
  status.style.color = '#c0392b';

  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.alignItems = 'center';
  toolbar.style.gap = '6px';

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.textContent = 'Format';
  formatBtn.style.fontSize = '11px';
  formatBtn.style.padding = '1px 8px';
  formatBtn.style.cursor = 'pointer';

  toolbar.appendChild(formatBtn);
  toolbar.appendChild(status);
  wrapper.appendChild(toolbar);

  const validate = (): void => {
    if (ta.value.trim() === '') { status.textContent = ''; return; }
    try {
      JSON.parse(ta.value);
      status.textContent = '';
    } catch (e) {
      status.textContent = e instanceof SyntaxError ? e.message : 'Invalid JSON';
    }
  };

  ta.addEventListener('input', validate);

  formatBtn.addEventListener('click', () => {
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      status.textContent = '';
    } catch (e) {
      status.textContent = e instanceof SyntaxError ? e.message : 'Invalid JSON';
    }
  });

  return wrapper;
};

export const renderComponent = (
  frame: Frame,
  _state: FrameState,
  resolvedComponent?: Component | null,
): HTMLElement => {
  const { id } = frame;

  if (isFrameRef(frame)) {
    if (resolvedComponent) {
      const kind = (resolvedComponent as Record<string, unknown>).kind as string;
      const resolved = applyDefaults(kind, resolvedComponent as Record<string, unknown>);
      if (kind === 'textarea') return renderTextareaComponent(id, resolved);
      return renderResolved(id, resolved);
    }
    return renderResolved(id, { kind: (frame as FrameRef).kind });
  }

  if (isListComponent(frame)) return renderList(id, frame);
  if (isCanvasComponent(frame)) return renderCanvas(id, frame);
  if (isEditorComponent(frame)) return renderEditor(id, frame);
  if (isTextareaComponent(frame)) {
    const kind = (frame as Record<string, unknown>).kind as string;
    return renderTextareaComponent(id, applyDefaults(kind, frame as Record<string, unknown>));
  }

  const kind = (frame as Record<string, unknown>).kind as string;
  return renderResolved(id, applyDefaults(kind, frame as Record<string, unknown>));
};
