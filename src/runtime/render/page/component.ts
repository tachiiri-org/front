import {
  isListComponent,
  isCanvasComponent,
  isTextareaComponent,
  isTableComponent,
  applyDefaults,
  type TableColumn,
  type TableComponent,
  type TableData,
  type TableSchema,
  type TableSelectSource,
  type Component,
} from '../../../schema/component';
import { type Frame, type FrameRef, isFrameRef } from '../../../schema/screen/screen';
import { isEditorComponent } from '../../../editor/component-editor';
import type { FrameState } from '../../../state';
import { putComponent, updateScreen } from '../../bind/editor/save';
import { renderList, renderCanvas, renderEditor, renderTable } from './frame';

const applyPadding = (el: HTMLElement, c: Record<string, unknown>): void => {
  if (typeof c.padding === 'string') el.style.padding = c.padding;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

type TableEditorDraft = TableComponent;
type TableColumnType = TableColumn['type'];
type TableSaveTarget =
  | { kind: 'component'; screenId: string; componentSrc: string }
  | { kind: 'screen-frame'; screenId: string; frameId: string };

type RenderOptions = {
  screenId?: string;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const randomId = (): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `row_${Math.random().toString(36).slice(2, 10)}`;
};

const generateColumnKey = (columns: TableColumn[], base = 'column'): string => {
  const used = new Set(columns.map((column) => column.key));
  let index = 1;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
};

const createInlineSelectSource = (): TableSelectSource => ({
  kind: 'inline',
  options: [],
});

const createColumnByType = (schema: TableSchema, type: TableColumnType): TableColumn => {
  const base = {
    key: generateColumnKey(schema.columns),
    label: 'New column',
    hidden: false,
    required: false,
    nullable: true,
  };

  switch (type) {
    case 'string':
      return { ...base, type: 'string' };
    case 'int':
      return { ...base, type: 'int' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'date':
      return { ...base, type: 'date', dateKind: 'date' };
    case 'select':
      return { ...base, type: 'select', source: createInlineSelectSource() };
  }
};

const formatDateValue = (date: Date, kind: 'date' | 'datetime' = 'date'): string => {
  if (kind === 'datetime') {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      'T',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
    ].join('');
  }
  return date.toISOString().slice(0, 10);
};

const makeDefaultValue = (column: TableColumn, now = new Date()): unknown => {
  if (column.default) {
    if (column.default.kind === 'literal') return column.default.value;
    if (column.type === 'date') {
      return formatDateValue(now, column.dateKind ?? 'date');
    }
  }

  switch (column.type) {
    case 'string':
      return '';
    case 'int':
      return null;
    case 'boolean':
      return false;
    case 'date':
      return null;
    case 'select':
      return '';
  }
};

const makeRowFromSchema = (schema: TableSchema): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const column of schema.columns) {
    values[column.key] = makeDefaultValue(column);
  }
  return values;
};

const addColumnToRows = (rows: TableData['rows'], column: TableColumn): void => {
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(row.values, column.key)) {
      row.values[column.key] = makeDefaultValue(column);
    }
  }
};

const syncRowValuesForColumn = (
  rows: TableData['rows'],
  oldKey: string,
  newKey: string,
  fallback: unknown,
): void => {
  if (oldKey === newKey) return;
  for (const row of rows) {
    const next = { ...row.values };
    if (Object.prototype.hasOwnProperty.call(next, oldKey)) {
      next[newKey] = next[oldKey];
      delete next[oldKey];
    } else if (!Object.prototype.hasOwnProperty.call(next, newKey)) {
      next[newKey] = fallback;
    }
    row.values = next;
  }
};

const buildSaveTarget = (
  frame: Frame,
  resolvedComponent: Component | null,
  screenId?: string,
): TableSaveTarget | null => {
  if (!screenId) return null;
  if (isFrameRef(frame)) {
    if (resolvedComponent && (resolvedComponent as Record<string, unknown>).kind === 'table') {
      return { kind: 'component', screenId, componentSrc: frame.src };
    }
    return null;
  }
  if (isTableComponent(frame)) return { kind: 'screen-frame', screenId, frameId: frame.id };
  return null;
};

const persistTableDraft = async (
  draft: TableEditorDraft,
  saveTarget: TableSaveTarget | null,
): Promise<void> => {
  if (!saveTarget) return;
  const next = clone(draft);
  if (saveTarget.kind === 'component') {
    await putComponent(saveTarget.screenId, saveTarget.componentSrc, next);
    return;
  }
  await updateScreen(saveTarget.screenId, (screen) => ({
    ...screen,
    frames: screen.frames.map((frame) =>
      frame.id === saveTarget.frameId ? { ...(frame as Record<string, unknown>), ...next } : frame,
    ),
  }));
};

const renderEditableTable = (
  id: string,
  component: TableEditorDraft,
  saveTarget: TableSaveTarget | null,
): HTMLElement => {
  const wrapper = renderTable(id, component);
  const draft = clone(component) as TableEditorDraft;

  const status = document.createElement('div');
  status.style.fontSize = '10px';
  status.style.fontFamily = 'monospace';
  status.style.minHeight = '14px';
  status.style.color = '#c0392b';

  const visibleColumns = (): TableColumn[] => draft.schema.columns.filter((column) => !column.hidden);

  const saveAndRender = async (): Promise<void> => {
    try {
      await persistTableDraft(draft, saveTarget);
      status.textContent = '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
    render();
  };

  const addColumn = (type: TableColumnType): void => {
    const column = createColumnByType(draft.schema, type);
    draft.schema.columns.push(column);
    addColumnToRows(draft.data.rows, column);
    void saveAndRender();
  };

  const addRow = (): void => {
    draft.data.rows.push({ id: randomId(), values: makeRowFromSchema(draft.schema) });
    void saveAndRender();
  };

  const renderColumnEditor = (column: TableColumn): HTMLElement => {
    const rowWrap = document.createElement('div');
    Object.assign(rowWrap.style, {
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(120px, 1fr) 90px 70px 70px auto',
      gap: '6px',
      alignItems: 'start',
      padding: '6px 8px',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      background: column.hidden ? 'rgba(0,0,0,0.02)' : 'transparent',
    });

    const makeInput = (value: string, placeholder: string): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.value = value;
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      input.style.fontSize = '12px';
      return input;
    };

    const keyInput = makeInput(column.key, 'key');
    keyInput.addEventListener('blur', () => {
      const nextKey = keyInput.value.trim();
      if (!nextKey || nextKey === column.key) {
        keyInput.value = column.key;
        return;
      }
      const oldKey = column.key;
      column.key = nextKey;
      syncRowValuesForColumn(draft.data.rows, oldKey, nextKey, makeDefaultValue(column));
      void saveAndRender();
    });

    const labelInput = makeInput(column.label, 'label');
    labelInput.addEventListener('blur', () => {
      const next = labelInput.value.trim();
      if (next) column.label = next;
      labelInput.value = column.label;
      void saveAndRender();
    });

    const typeLabel = document.createElement('div');
    typeLabel.textContent = column.type;
    typeLabel.style.fontSize = '11px';
    typeLabel.style.color = 'rgba(0,0,0,0.7)';
    typeLabel.style.padding = '5px 0';

    const requiredInput = document.createElement('input');
    requiredInput.type = 'checkbox';
    requiredInput.checked = Boolean(column.required);
    requiredInput.addEventListener('change', () => {
      column.required = requiredInput.checked;
      void saveAndRender();
    });

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'checkbox';
    hiddenInput.checked = Boolean(column.hidden);
    hiddenInput.addEventListener('change', () => {
      column.hidden = hiddenInput.checked;
      void saveAndRender();
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', gap: '4px', flexWrap: 'wrap' });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'delete';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.fontSize = '11px';
    removeBtn.addEventListener('click', () => {
      const index = draft.schema.columns.indexOf(column);
      if (index < 0) return;
      draft.schema.columns.splice(index, 1);
      for (const row of draft.data.rows) delete row.values[column.key];
      void saveAndRender();
    });

    actions.appendChild(removeBtn);
    rowWrap.appendChild(keyInput);
    rowWrap.appendChild(labelInput);
    rowWrap.appendChild(typeLabel);
    rowWrap.appendChild(requiredInput);
    rowWrap.appendChild(hiddenInput);
    rowWrap.appendChild(actions);
    return rowWrap;
  };

  const renderCellEditor = (rowIndex: number, column: TableColumn): HTMLElement => {
    const row = draft.data.rows[rowIndex];
    const cell = document.createElement('td');
    cell.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
    cell.style.padding = '4px 6px';
    cell.style.verticalAlign = 'top';

    const current = row.values[column.key];

    if (column.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(current);
      input.addEventListener('change', () => {
        row.values[column.key] = input.checked;
        void saveAndRender();
      });
      cell.appendChild(input);
      return cell;
    }

    if (column.type === 'select') {
      const select = document.createElement('select');
      select.style.width = '100%';
      select.style.fontSize = '12px';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '';
      select.appendChild(empty);
      if (column.source.kind === 'inline') {
        for (const option of column.source.options) {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          select.appendChild(el);
        }
      }
      select.value = typeof current === 'string' ? current : '';
      select.addEventListener('change', () => {
        row.values[column.key] = select.value;
        void saveAndRender();
      });
      cell.appendChild(select);
      return cell;
    }

    const input = document.createElement('input');
    input.type = column.type === 'date'
      ? (column.dateKind === 'datetime' ? 'datetime-local' : 'date')
      : 'text';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '12px';
    input.value = current === undefined || current === null ? '' : String(current);
    input.addEventListener('blur', () => {
      if (column.type === 'int') {
        const raw = input.value.trim();
        row.values[column.key] = raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : raw;
      } else {
        row.values[column.key] = input.value;
      }
      void saveAndRender();
    });
    cell.appendChild(input);
    return cell;
  };

  const render = (): void => {
    wrapper.replaceChildren();

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '0 8px 6px',
      flexWrap: 'wrap',
    });
    const title = document.createElement('span');
    title.textContent = 'columns';
    title.style.fontSize = '11px';
    title.style.color = 'rgba(0,0,0,0.7)';
    title.style.fontWeight = '500';

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
    });
    const typeSelect = document.createElement('select');
    Object.assign(typeSelect.style, {
      minWidth: '108px',
      fontSize: '11px',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '4px',
      background: 'white',
      padding: '2px 4px',
    });
    for (const option of [
      { value: 'string', label: 'string' },
      { value: 'int', label: 'int' },
      { value: 'boolean', label: 'boolean' },
      { value: 'date', label: 'date' },
      { value: 'select', label: 'select' },
    ]) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      typeSelect.appendChild(el);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ add';
    addBtn.style.border = 'none';
    addBtn.style.background = 'transparent';
    addBtn.style.cursor = 'pointer';
    addBtn.style.fontSize = '11px';
    addBtn.addEventListener('click', () => addColumn(typeSelect.value as TableColumnType));
    controls.appendChild(typeSelect);
    controls.appendChild(addBtn);
    header.appendChild(title);
    header.appendChild(controls);
    wrapper.appendChild(header);

    const columnList = document.createElement('div');
    if (draft.schema.columns.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        fontSize: '11px',
        color: 'rgba(0,0,0,0.55)',
      });
      const message = document.createElement('div');
      message.textContent = 'No columns yet. Add one to start defining the table schema.';
      const firstColumnBtn = document.createElement('button');
      firstColumnBtn.type = 'button';
      firstColumnBtn.textContent = '+ add first column';
      firstColumnBtn.style.border = 'none';
      firstColumnBtn.style.background = 'transparent';
      firstColumnBtn.style.cursor = 'pointer';
      firstColumnBtn.style.padding = '0';
      firstColumnBtn.style.fontSize = '11px';
      firstColumnBtn.addEventListener('click', () => addColumn('string'));
      empty.appendChild(message);
      empty.appendChild(firstColumnBtn);
      columnList.appendChild(empty);
    } else {
      for (const column of draft.schema.columns) {
        columnList.appendChild(renderColumnEditor(column));
      }
    }
    wrapper.appendChild(columnList);

    const rowsHeader = document.createElement('div');
    Object.assign(rowsHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '8px 8px 6px',
    });
    const rowsTitle = document.createElement('span');
    rowsTitle.textContent = 'rows';
    rowsTitle.style.fontSize = '11px';
    rowsTitle.style.color = 'rgba(0,0,0,0.7)';
    rowsTitle.style.fontWeight = '500';
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.textContent = '+ add row';
    addRowBtn.style.border = 'none';
    addRowBtn.style.background = 'transparent';
    addRowBtn.style.cursor = 'pointer';
    addRowBtn.style.fontSize = '11px';
    addRowBtn.addEventListener('click', addRow);
    rowsHeader.appendChild(rowsTitle);
    rowsHeader.appendChild(addRowBtn);
    wrapper.appendChild(rowsHeader);

    const rowsBody = document.createElement('div');
    const columns = visibleColumns();
    if (draft.schema.columns.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        fontSize: '11px',
        color: 'rgba(0,0,0,0.55)',
      });
      const message = document.createElement('div');
      message.textContent = 'No rows yet. Start by adding a column, then add rows.';
      const actions = document.createElement('div');
      Object.assign(actions.style, {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
      });
      const addFirstRowBtn = document.createElement('button');
      addFirstRowBtn.type = 'button';
      addFirstRowBtn.textContent = '+ add first row';
      addFirstRowBtn.style.border = 'none';
      addFirstRowBtn.style.background = 'transparent';
      addFirstRowBtn.style.cursor = 'pointer';
      addFirstRowBtn.style.padding = '0';
      addFirstRowBtn.style.fontSize = '11px';
      addFirstRowBtn.addEventListener('click', addRow);
      actions.appendChild(addFirstRowBtn);
      empty.appendChild(message);
      empty.appendChild(actions);
      rowsBody.appendChild(empty);
    } else if (draft.data.rows.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        fontSize: '11px',
        color: 'rgba(0,0,0,0.55)',
      });
      const message = document.createElement('div');
      message.textContent = 'No rows yet. Add the first row to start editing data.';
      const addFirstRowBtn = document.createElement('button');
      addFirstRowBtn.type = 'button';
      addFirstRowBtn.textContent = '+ add first row';
      addFirstRowBtn.style.border = 'none';
      addFirstRowBtn.style.background = 'transparent';
      addFirstRowBtn.style.cursor = 'pointer';
      addFirstRowBtn.style.padding = '0';
      addFirstRowBtn.style.fontSize = '11px';
      addFirstRowBtn.addEventListener('click', addRow);
      empty.appendChild(message);
      empty.appendChild(addFirstRowBtn);
      rowsBody.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.fontSize = '12px';

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const column of columns) {
        const th = document.createElement('th');
        th.textContent = column.label || column.key;
        th.style.textAlign = 'left';
        th.style.borderBottom = '1px solid rgba(0,0,0,0.12)';
        th.style.padding = '4px 6px';
        th.style.whiteSpace = 'nowrap';
        headRow.appendChild(th);
      }
      const actionHead = document.createElement('th');
      actionHead.style.borderBottom = '1px solid rgba(0,0,0,0.12)';
      actionHead.style.padding = '4px 6px';
      headRow.appendChild(actionHead);
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const [rowIndex, row] of draft.data.rows.entries()) {
        const tr = document.createElement('tr');
        tr.dataset.rowId = row.id;
        for (const column of columns) {
          tr.appendChild(renderCellEditor(rowIndex, column));
        }

        const actionCell = document.createElement('td');
        actionCell.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
        actionCell.style.padding = '4px 6px';
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'delete';
        deleteBtn.style.border = 'none';
        deleteBtn.style.background = 'transparent';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '11px';
        deleteBtn.addEventListener('click', () => {
          draft.data.rows.splice(rowIndex, 1);
          void saveAndRender();
        });
        actionCell.appendChild(deleteBtn);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      rowsBody.appendChild(table);
    }
    wrapper.appendChild(rowsBody);
    wrapper.appendChild(status);
  };

  render();
  return wrapper;
};

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
  options?: RenderOptions,
): HTMLElement => {
  const { id } = frame;

  if (isFrameRef(frame)) {
    if (resolvedComponent) {
      const kind = (resolvedComponent as Record<string, unknown>).kind as string;
      const resolved = applyDefaults(kind, resolvedComponent as Record<string, unknown>);
      if (kind === 'table' && isTableComponent(resolved) && options?.screenId) {
        return renderEditableTable(id, resolved, buildSaveTarget(frame, resolvedComponent, options.screenId));
      }
      if (kind === 'textarea') return renderTextareaComponent(id, resolved);
      return renderResolved(id, resolved);
    }
    return renderResolved(id, { kind: (frame as FrameRef).kind });
  }

  if (isListComponent(frame)) return renderList(id, frame);
  if (isCanvasComponent(frame)) return renderCanvas(id, frame);
  if (isEditorComponent(frame)) return renderEditor(id, frame);
  if (isTableComponent(frame) && options?.screenId) {
    return renderEditableTable(id, applyDefaults('table', frame as Record<string, unknown>) as TableComponent,
      buildSaveTarget(frame, null, options.screenId));
  }
  if (isTextareaComponent(frame)) {
    const kind = (frame as Record<string, unknown>).kind as string;
    return renderTextareaComponent(id, applyDefaults(kind, frame as Record<string, unknown>));
  }

  const kind = (frame as Record<string, unknown>).kind as string;
  return renderResolved(id, applyDefaults(kind, frame as Record<string, unknown>));
};
