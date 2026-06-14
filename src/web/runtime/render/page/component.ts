import {
  isListComponent,
  isCanvasComponent,
  isTextareaComponent,
  isTableComponent,
  isTreeEditorComponent,
  isOutlinerComponent,
  isTextEditorComponent,
  isDefinitionEditorComponent,
  isWordGraphComponent,
  isWordGraphTextColComponent,
  isWordGraphWordColComponent,
  isStorageExplorerComponent,
  isDbApplyComponent,
  ALL_CSS_PROP_KEYS,
  applyDefaults,
  type TableComponent,
  type TreeEditorComponent,
  type OutlinerComponent,
  type TextEditorComponent,
  type DefinitionEditorComponent,
  type WordGraphComponent,
  type WordGraphTextColComponent,
  type WordGraphWordColComponent,
  type StorageExplorerComponent,
  type DbApplyComponent,
  type Component,
} from '../../../schema/component';
import { type Frame, type FrameRef, isFrameRef } from '../../../schema/screen/screen';
import { isEditorComponent } from '../../../editor/component-editor';
import type { FrameState } from '../../../state';
import { renderList, renderCanvas, renderEditor, renderTable } from './frame';
import { renderEditableTable } from './table-editor';
import { renderEditableTree } from './tree-editor';
import { renderOutliner } from './outliner';
import { renderTextEditor } from './text-editor';
import { renderDefinitionEditor } from './definition-editor';
import { renderWordGraph } from './word-graph';
import { renderWordGraphTextCol } from './word-graph/text-col';
import { renderWordGraphWordCol } from './word-graph/word-col';
import { renderStorageExplorer } from './storage-explorer';
import { renderDbApply } from './db-apply';

const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = c[propKey];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[propKey] = v;
  }
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

type RenderOptions = {
  screenId?: string;
};

function renderElementNode(c: Record<string, unknown>): HTMLElement {
  const tag = typeof c.tag === 'string' && c.tag ? c.tag : 'div';
  const el = document.createElement(tag as keyof HTMLElementTagNameMap);
  if (typeof c.href === 'string') el.setAttribute('href', c.href);
  if (typeof c.src === 'string') el.setAttribute('src', c.src);
  if (typeof c.alt === 'string') el.setAttribute('alt', c.alt);
  if (typeof c.placeholder === 'string') el.setAttribute('placeholder', c.placeholder);
  if (typeof c.type === 'string') el.setAttribute('type', c.type);
  if (typeof c.target === 'string') el.setAttribute('target', c.target);
  if (typeof c.value === 'string') el.setAttribute('value', c.value);
  applyCssProps(el, c);
  const children = Array.isArray(c.children) ? c.children as Record<string, unknown>[] : null;
  if (children && children.length > 0) {
    for (const child of children) {
      el.appendChild(renderElementNode(child));
    }
  } else if (typeof c.text === 'string') {
    el.textContent = c.text;
  }
  return el;
}

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
    applyCssProps(el, c);
    return el;
  }

  if (c.kind === 'element' && typeof c.tag === 'string') {
    const el = renderElementNode(c);
    el.dataset.frameId = id;
    return el;
  }

  if (c.kind === 'button') {
    const button = document.createElement('button');
    button.dataset.frameId = id;
    button.textContent = typeof c.text === 'string' ? c.text : String(c.kind);
    applyCssProps(button, c);
    return button;
  }

  if (c.kind === 'select') {
    const select = document.createElement('select');
    select.dataset.frameId = id;
    if (typeof c.targetComponentId === 'string') {
      select.dataset.targetComponentId = c.targetComponentId;
    }
    applyCssProps(select, c);
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
    applyCssProps(form, c);
    return form;
  }

  if (c.kind === 'table' && isTableComponent(c)) {
    const wrapper = renderTable(id, c);
    const table = document.createElement('table');
    applyCssProps(wrapper, c);
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

    const renderRows = (rows: typeof c.data.rows): void => {
      tbody.replaceChildren();
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.dataset.rowId = row.id;
        for (const column of c.schema.columns.filter((col) => !col.hidden)) {
          const td = document.createElement('td');
          td.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
          td.style.padding = '4px 6px';
          const value = row.values[column.key];
          td.textContent = value === undefined || value === null ? '' : String(value);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    };

    renderRows(c.data.rows);

    if (c.source) {
      void (async () => {
        try {
          const res = await fetch(c.source!.url);
          if (!res.ok) return;
          const payload = (await res.json()) as unknown;
          const items: unknown[] = c.source!.itemsPath
            ? ((payload as Record<string, unknown>)[c.source!.itemsPath] as unknown[]) ?? []
            : Array.isArray(payload) ? payload : [];
          const rows = items.map((item, i) => {
            const obj = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
            const rowId = c.source!.idKey ? String(obj[c.source!.idKey] ?? i) : String(i);
            return { id: rowId, values: { ...obj } };
          });
          renderRows(rows);
        } catch { /* non-fatal */ }
      })();
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  const pre = document.createElement('pre');
  pre.dataset.frameId = id;
  pre.textContent = JSON.stringify(component, null, 2);
  applyCssProps(pre, c);
  return pre;
};

const renderTextareaComponent = (id: string, c: Record<string, unknown>): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '4px';
  applyCssProps(wrapper, c);

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
  options?: RenderOptions,
): HTMLElement => {
  const { id } = frame;

  if (isFrameRef(frame)) {
    if (resolvedComponent) {
      const kind = (resolvedComponent as Record<string, unknown>).kind as string;
      const resolved = applyDefaults(kind, resolvedComponent as Record<string, unknown>);
      if (kind === 'table' && isTableComponent(resolved) && options?.screenId) {
        return renderEditableTable(id, frame, resolved, options.screenId);
      }
      if (kind === 'textarea') return renderTextareaComponent(id, resolved);
      return renderResolved(id, resolved);
    }
    return renderResolved(id, { kind: (frame as FrameRef).kind });
  }

  if (isListComponent(frame)) return renderList(id, frame);
  if (isCanvasComponent(frame)) return renderCanvas(id, frame);
  if (isEditorComponent(frame)) return renderEditor(id, frame);
  if (isTreeEditorComponent(frame)) {
    const treeId = typeof (frame as Record<string, unknown>).treeId === 'string'
      ? (frame as Record<string, unknown>).treeId as string
      : undefined;
    return renderEditableTree(id, frame as TreeEditorComponent, treeId);
  }
  if (isOutlinerComponent(frame)) {
    const treeId = typeof (frame as Record<string, unknown>).treeId === 'string'
      ? (frame as Record<string, unknown>).treeId as string
      : undefined;
    return renderOutliner(id, frame as OutlinerComponent, treeId);
  }
  if (isTextEditorComponent(frame)) {
    return renderTextEditor(id, frame as TextEditorComponent);
  }
  if (isDefinitionEditorComponent(frame)) {
    const treeId = typeof (frame as Record<string, unknown>).treeId === 'string'
      ? (frame as Record<string, unknown>).treeId as string
      : undefined;
    return renderDefinitionEditor(id, frame as DefinitionEditorComponent, treeId);
  }
  if (isWordGraphTextColComponent(frame)) {
    return renderWordGraphTextCol(id, frame as WordGraphTextColComponent);
  }
  if (isWordGraphWordColComponent(frame)) {
    return renderWordGraphWordCol(id, frame as WordGraphWordColComponent);
  }
  if (isWordGraphComponent(frame)) {
    const graphId = typeof (frame as Record<string, unknown>).graphId === 'string'
      ? (frame as Record<string, unknown>).graphId as string
      : undefined;
    return renderWordGraph(id, frame as WordGraphComponent, graphId);
  }
  if (isStorageExplorerComponent(frame)) {
    return renderStorageExplorer(id, frame as StorageExplorerComponent);
  }
  if (isDbApplyComponent(frame)) {
    return renderDbApply(id, frame as DbApplyComponent);
  }
  if (isTableComponent(frame) && options?.screenId) {
    return renderEditableTable(
      id,
      frame,
      applyDefaults('table', frame as Record<string, unknown>) as TableComponent,
      options.screenId,
    );
  }
  if (isTextareaComponent(frame)) {
    const kind = (frame as Record<string, unknown>).kind as string;
    return renderTextareaComponent(id, applyDefaults(kind, frame as Record<string, unknown>));
  }

  const kind = (frame as Record<string, unknown>).kind as string;
  return renderResolved(id, applyDefaults(kind, frame as Record<string, unknown>));
};
