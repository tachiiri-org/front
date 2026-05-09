import {
  COMPONENT_KINDS,
  componentDefaults,
  type TableColumn,
  type TableComponent,
  type TableData,
  type TableSelectSource,
  type TableSchema,
  applyDefaults,
} from '../../../schema/component';
import type { EditorFrame } from '../../../schema/screen/screen';
import { appendSection, createLabeledRow } from '../../render/editor/section';
import { buildFieldStyleContext, type FieldStyleContext } from '../../render/editor/context';
import { renderJsonEditorRow } from './json-editor';
import { validateTableSchemaDraft } from './schema';
import { validateTableDataDraft } from './data';

type TableSelectOption = {
  value: string;
  label: string;
};

type TableEditorDraft = TableComponent;
type TableColumnType = TableColumn['type'];
type TableEndpointSource = Extract<TableSelectSource, { kind: 'endpoint' }>;

type SectionMounts = {
  schema: HTMLElement;
  data: HTMLElement;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const randomId = (): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `row_${Math.random().toString(36).slice(2, 10)}`;
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

const getByPath = (value: unknown, path: string | undefined): unknown => {
  if (!path) return value;
  const segments = path.split('.').filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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

const addColumnToRows = (rows: TableData['rows'], column: TableColumn): void => {
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(row.values, column.key)) {
      row.values[column.key] = makeDefaultValue(column);
    }
  }
};

const renderKindSelector = (
  editorEl: HTMLElement,
  draft: TableEditorDraft,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): void => {
  const row = createLabeledRow('kind');
  const select = document.createElement('select');
  Object.assign(select.style, {
    flex: '1',
    fontSize: '12px',
    border: 'none',
    borderBottom: '1px solid rgba(0,0,0,0.12)',
    background: 'transparent',
    padding: '3px 2px',
    minWidth: '0',
    outline: 'none',
    cursor: 'pointer',
  });

  for (const kind of COMPONENT_KINDS) {
    const option = document.createElement('option');
    option.value = kind;
    option.textContent = kind;
    option.selected = kind === draft.kind;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    const nextKind = select.value;
    const defaults = componentDefaults[nextKind];
    if (!defaults) return;
    void onSave(defaults as Record<string, unknown>);
  });

  row.appendChild(select);
  editorEl.appendChild(row);
};

const renderPropertiesSection = (
  draft: TableEditorDraft,
  ctx: FieldStyleContext,
  onChange: () => void,
): HTMLElement => {
  const wrap = document.createElement('div');
  const fields = [
    { key: 'name', label: 'name', placeholder: 'table name' },
    { key: 'padding', label: 'padding', placeholder: '12px' },
  ] as const;

  for (const field of fields) {
    const row = document.createElement('div');
    Object.assign(row.style, ctx.wrapper);
    const label = document.createElement('label');
    label.textContent = field.label;
    Object.assign(label.style, ctx.label);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = field.placeholder;
    Object.assign(input.style, ctx.input);
    input.value = typeof draft[field.key] === 'string' ? String(draft[field.key]) : '';
    input.addEventListener('input', () => {
      draft[field.key] = input.value;
      onChange();
    });
    row.appendChild(label);
    row.appendChild(input);
    wrap.appendChild(row);
  }

  return wrap;
};

const renderColumnSourceEditor = (
  column: TableColumn,
  ctx: FieldStyleContext,
  refreshSchema: () => void,
  onChange: () => void,
  refreshData: () => void,
): HTMLElement | null => {
  if (column.type !== 'select') return null;
  const source = column.source;
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  });

  const sourceTypeRow = document.createElement('div');
  Object.assign(sourceTypeRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  });

  const sourceTypeLabel = document.createElement('span');
  sourceTypeLabel.textContent = 'source';
  Object.assign(sourceTypeLabel.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)', width: '80px' });

  const sourceTypeSelect = document.createElement('select');
  Object.assign(sourceTypeSelect.style, {
    minWidth: '120px',
    fontSize: '11px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: '4px',
    background: 'white',
    padding: '2px 4px',
  });
  for (const option of [
    { value: 'inline', label: 'inline options' },
    { value: 'endpoint', label: 'endpoint' },
  ]) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    el.selected = source.kind === option.value;
    sourceTypeSelect.appendChild(el);
  }
  sourceTypeSelect.addEventListener('change', () => {
    if (sourceTypeSelect.value === 'inline') {
      column.source = createInlineSelectSource();
    } else {
      column.source = {
        kind: 'endpoint',
        url: '',
        itemsPath: '',
        valueKey: 'value',
        labelKey: 'label',
        headers: {},
      };
    }
    refreshSchema();
    refreshData();
    onChange();
  });

  sourceTypeRow.appendChild(sourceTypeLabel);
  sourceTypeRow.appendChild(sourceTypeSelect);
  wrap.appendChild(sourceTypeRow);

  if (source.kind === 'inline') {
    const heading = document.createElement('div');
    Object.assign(heading.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    });
    const title = document.createElement('span');
    title.textContent = 'options';
    Object.assign(title.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)' });
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ add';
    addBtn.style.border = 'none';
    addBtn.style.background = 'transparent';
    addBtn.style.cursor = 'pointer';
    addBtn.style.fontSize = '10px';
    heading.appendChild(title);
    heading.appendChild(addBtn);

    const list = document.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

    const renderRows = (): void => {
      list.replaceChildren();
      for (const [index, option] of source.options.entries()) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
          gap: '4px',
          alignItems: 'center',
        });

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.placeholder = 'value';
        Object.assign(valueInput.style, ctx.input);
        valueInput.value = option.value;
        valueInput.addEventListener('input', () => {
          source.options[index] = { ...source.options[index], value: valueInput.value };
          onChange();
        });

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.placeholder = 'label';
        Object.assign(labelInput.style, ctx.input);
        labelInput.value = option.label;
        labelInput.addEventListener('input', () => {
          source.options[index] = { ...source.options[index], label: labelInput.value };
          onChange();
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.style.border = 'none';
        removeBtn.style.background = 'transparent';
        removeBtn.style.cursor = 'pointer';
        removeBtn.addEventListener('click', () => {
          source.options.splice(index, 1);
          renderRows();
          refreshData();
          onChange();
        });

        row.appendChild(valueInput);
        row.appendChild(labelInput);
        row.appendChild(removeBtn);
        list.appendChild(row);
      }
    };

    addBtn.addEventListener('click', () => {
      source.options.push({ value: '', label: '' });
      renderRows();
      refreshData();
      onChange();
    });

    renderRows();
    wrap.appendChild(heading);
    wrap.appendChild(list);
    return wrap;
  }

  const endpointForm = document.createElement('div');
  Object.assign(endpointForm.style, {
    display: 'grid',
    gridTemplateColumns: '80px 1fr',
    gap: '6px',
    alignItems: 'center',
  });

  const endpointFields: Array<{
    label: string;
    key: 'url' | 'itemsPath' | 'valueKey' | 'labelKey';
    placeholder: string;
  }> = [
    { label: 'url', key: 'url', placeholder: 'https://example.com/options' },
    { label: 'itemsPath', key: 'itemsPath', placeholder: 'data.items' },
    { label: 'valueKey', key: 'valueKey', placeholder: 'value' },
    { label: 'labelKey', key: 'labelKey', placeholder: 'label' },
  ];

  for (const field of endpointFields) {
    const label = document.createElement('span');
    label.textContent = field.label;
    Object.assign(label.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = field.placeholder;
    Object.assign(input.style, ctx.input);
    input.value =
      field.key === 'url'
        ? source.url
        : field.key === 'itemsPath'
          ? source.itemsPath ?? ''
          : field.key === 'valueKey'
            ? source.valueKey ?? ''
            : source.labelKey ?? '';
    input.addEventListener('input', () => {
      if (field.key === 'url') {
        source.url = input.value;
      } else if (field.key === 'itemsPath') {
        source.itemsPath = input.value;
      } else if (field.key === 'valueKey') {
        source.valueKey = input.value;
      } else {
        source.labelKey = input.value;
      }
      onChange();
    });

    endpointForm.appendChild(label);
    endpointForm.appendChild(input);
  }

  const headersLabel = document.createElement('span');
  headersLabel.textContent = 'headers';
  Object.assign(headersLabel.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)' });
  const headersInput = document.createElement('textarea');
  Object.assign(headersInput.style, {
    ...ctx.input,
    minHeight: '72px',
    fontFamily: 'monospace',
    gridColumn: '2',
  });
  headersInput.value = JSON.stringify(source.headers ?? {}, null, 2);
  headersInput.addEventListener('input', () => {
    try {
      const parsed = JSON.parse(headersInput.value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record: Record<string, string> = {};
        let valid = true;
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'string') {
            valid = false;
            break;
          }
          record[key] = value;
        }
        if (valid) {
          source.headers = record;
          onChange();
        }
      }
    } catch {
      // keep draft editable
    }
  });
  endpointForm.appendChild(headersLabel);
  endpointForm.appendChild(headersInput);
  wrap.appendChild(endpointForm);

  const hint = document.createElement('div');
  hint.textContent = 'Endpoint source reads a string array from itemsPath and maps value/label keys.';
  Object.assign(hint.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.55)',
    padding: '0 0 0 80px',
  });
  wrap.appendChild(hint);
  return wrap;
};

const renderColumnSpecificFields = (
  column: TableColumn,
  ctx: FieldStyleContext,
  refreshSchema: () => void,
  onChange: () => void,
  refreshData: () => void,
): HTMLElement | null => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '0 8px 8px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
  });

  const addLabeledRow = (labelText: string, control: HTMLElement): void => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    });
    const label = document.createElement('span');
    label.textContent = labelText;
    Object.assign(label.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)', width: '80px' });
    row.appendChild(label);
    row.appendChild(control);
    wrap.appendChild(row);
  };

  if (column.type === 'string') {
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.value = column.minLength === undefined ? '' : String(column.minLength);
    Object.assign(minInput.style, ctx.input);
    minInput.addEventListener('input', () => {
      column.minLength = minInput.value === '' ? undefined : Number(minInput.value);
      onChange();
    });
    addLabeledRow('minLength', minInput);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.value = column.maxLength === undefined ? '' : String(column.maxLength);
    Object.assign(maxInput.style, ctx.input);
    maxInput.addEventListener('input', () => {
      column.maxLength = maxInput.value === '' ? undefined : Number(maxInput.value);
      onChange();
    });
    addLabeledRow('maxLength', maxInput);
    return wrap;
  }

  if (column.type === 'int') {
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.value = column.min === undefined ? '' : String(column.min);
    Object.assign(minInput.style, ctx.input);
    minInput.addEventListener('input', () => {
      column.min = minInput.value === '' ? undefined : Number(minInput.value);
      onChange();
    });
    addLabeledRow('min', minInput);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.value = column.max === undefined ? '' : String(column.max);
    Object.assign(maxInput.style, ctx.input);
    maxInput.addEventListener('input', () => {
      column.max = maxInput.value === '' ? undefined : Number(maxInput.value);
      onChange();
    });
    addLabeledRow('max', maxInput);
    return wrap;
  }

  if (column.type === 'date') {
    const dateKindSelect = document.createElement('select');
    Object.assign(dateKindSelect.style, {
      minWidth: '120px',
      fontSize: '11px',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '4px',
      background: 'white',
      padding: '2px 4px',
    });
    for (const option of [
      { value: '', label: '(default)' },
      { value: 'date', label: 'date' },
      { value: 'datetime', label: 'datetime' },
    ]) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      el.selected = (column.dateKind ?? '') === option.value;
      dateKindSelect.appendChild(el);
    }
    dateKindSelect.addEventListener('change', () => {
      column.dateKind = dateKindSelect.value === '' ? undefined : (dateKindSelect.value as 'date' | 'datetime');
      onChange();
    });
    addLabeledRow('dateKind', dateKindSelect);

    const minInput = document.createElement('input');
    minInput.type = 'date';
    minInput.value = column.min ?? '';
    Object.assign(minInput.style, ctx.input);
    minInput.addEventListener('input', () => {
      column.min = minInput.value || undefined;
      onChange();
    });
    addLabeledRow('min', minInput);

    const maxInput = document.createElement('input');
    maxInput.type = 'date';
    maxInput.value = column.max ?? '';
    Object.assign(maxInput.style, ctx.input);
    maxInput.addEventListener('input', () => {
      column.max = maxInput.value || undefined;
      onChange();
    });
    addLabeledRow('max', maxInput);
    return wrap;
  }

  if (column.type === 'select') {
    const sourceEditor = renderColumnSourceEditor(column, ctx, refreshSchema, onChange, refreshData);
    if (sourceEditor) wrap.appendChild(sourceEditor);
    return wrap;
  }

  return null;
};

const renderColumnRow = (
  draft: TableEditorDraft,
  column: TableColumn,
  onChange: () => void,
  refreshSchema: () => void,
  refreshData: () => void,
  ctx: FieldStyleContext,
): HTMLElement => {
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    background: column.hidden ? 'rgba(0,0,0,0.02)' : 'transparent',
  });

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(120px, 1fr) 90px 70px 70px 70px auto',
    gap: '6px',
    alignItems: 'start',
    padding: '6px 8px',
  });

  const makeTextInput = (value: string, placeholder: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    Object.assign(input.style, ctx.input);
    input.value = value;
    return input;
  };

  const keyInput = makeTextInput(column.key, 'key');
  keyInput.addEventListener('blur', () => {
    const nextKey = keyInput.value.trim();
    if (!nextKey || nextKey === column.key) {
      keyInput.value = column.key;
      return;
    }
    const oldKey = column.key;
    column.key = nextKey;
    syncRowValuesForColumn(draft.data.rows, oldKey, nextKey, makeDefaultValue(column));
    refreshSchema();
    refreshData();
    onChange();
  });

  const labelInput = makeTextInput(column.label, 'label');
  labelInput.addEventListener('blur', () => {
    const nextLabel = labelInput.value.trim();
    column.label = nextLabel || column.label;
    labelInput.value = column.label;
    refreshSchema();
    refreshData();
    onChange();
  });

  const typeLabel = document.createElement('div');
  typeLabel.textContent = column.type;
  Object.assign(typeLabel.style, {
    fontSize: '11px',
    color: 'rgba(0,0,0,0.7)',
    padding: '5px 0',
  });

  const requiredInput = document.createElement('input');
  requiredInput.type = 'checkbox';
  requiredInput.checked = Boolean(column.required);
  requiredInput.addEventListener('change', () => {
    column.required = requiredInput.checked;
    onChange();
  });

  const nullableInput = document.createElement('input');
  nullableInput.type = 'checkbox';
  nullableInput.checked = Boolean(column.nullable);
  nullableInput.addEventListener('change', () => {
    column.nullable = nullableInput.checked;
    onChange();
  });

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'checkbox';
  hiddenInput.checked = Boolean(column.hidden);
  hiddenInput.addEventListener('change', () => {
    column.hidden = hiddenInput.checked;
    refreshSchema();
    refreshData();
    onChange();
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '4px', flexWrap: 'wrap' });

  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.textContent = column.hidden ? 'show' : 'hide';
  hideBtn.style.border = 'none';
  hideBtn.style.background = 'transparent';
  hideBtn.style.cursor = 'pointer';
  hideBtn.style.fontSize = '11px';
  hideBtn.addEventListener('click', () => {
    column.hidden = !column.hidden;
    refreshSchema();
    refreshData();
    onChange();
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'delete';
  removeBtn.style.border = 'none';
  removeBtn.style.background = 'transparent';
  removeBtn.style.cursor = 'pointer';
  removeBtn.style.fontSize = '11px';
  removeBtn.addEventListener('click', () => {
    const index = draft.schema.columns.indexOf(column);
    if (index >= 0) {
      draft.schema.columns.splice(index, 1);
      for (const rowData of draft.data.rows) {
        delete rowData.values[column.key];
      }
      refreshSchema();
      refreshData();
      onChange();
    }
  });

  actions.appendChild(hideBtn);
  actions.appendChild(removeBtn);

  row.appendChild(keyInput);
  row.appendChild(labelInput);
  row.appendChild(typeLabel);
  row.appendChild(requiredInput);
  row.appendChild(nullableInput);
  row.appendChild(hiddenInput);
  row.appendChild(actions);
  wrapper.appendChild(row);

  const specific = renderColumnSpecificFields(column, ctx, refreshSchema, onChange, refreshData);
  if (specific) wrapper.appendChild(specific);

  const defaultRow = document.createElement('div');
  Object.assign(defaultRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px 8px',
    gap: '6px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    flexWrap: 'wrap',
  });
  const defaultLabel = document.createElement('span');
  defaultLabel.textContent = 'default';
  Object.assign(defaultLabel.style, { fontSize: '10px', color: 'rgba(0,0,0,0.65)', width: '80px' });
  const defaultWrap = document.createElement('div');
  Object.assign(defaultWrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '220px',
    flex: '1',
  });

  const defaultInput = document.createElement('input');
  defaultInput.type = 'text';
  Object.assign(defaultInput.style, ctx.input);
  defaultInput.placeholder = 'default';
  const defaultValue = column.default && column.default.kind === 'literal'
    ? column.default.value
    : column.default?.kind ?? '';
  defaultInput.value = defaultValue === null ? '' : String(defaultValue);

  const defaultKindSelect = document.createElement('select');
  Object.assign(defaultKindSelect.style, {
    minWidth: '88px',
    fontSize: '11px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: '4px',
    background: 'white',
    padding: '2px 4px',
  });
  for (const option of [
    { value: '', label: '(none)' },
    { value: 'literal', label: 'literal' },
    { value: 'now', label: 'now' },
    { value: 'createdAt', label: 'createdAt' },
    { value: 'updatedAt', label: 'updatedAt' },
  ]) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    el.selected = column.default ? column.default.kind === option.value : option.value === '';
    defaultKindSelect.appendChild(el);
  }

  const syncDefaultInputState = (): void => {
    defaultInput.disabled = defaultKindSelect.value !== 'literal';
    if (defaultKindSelect.value !== 'literal') {
      defaultInput.value = '';
    }
  };

  defaultKindSelect.addEventListener('change', () => {
    if (defaultKindSelect.value === '') {
      delete column.default;
    } else if (defaultKindSelect.value === 'literal') {
      column.default = { kind: 'literal', value: defaultInput.value === '' ? null : defaultInput.value };
    } else {
      column.default = { kind: defaultKindSelect.value as 'now' | 'createdAt' | 'updatedAt' };
    }
    syncDefaultInputState();
    onChange();
  });

  defaultInput.addEventListener('input', () => {
    if (!column.default || column.default.kind !== 'literal') return;
    const raw = defaultInput.value;
    column.default = {
      kind: 'literal',
      value: raw === '' ? null : Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : raw,
    };
    onChange();
  });

  syncDefaultInputState();
  defaultWrap.appendChild(defaultKindSelect);
  defaultWrap.appendChild(defaultInput);
  defaultRow.appendChild(defaultLabel);
  defaultRow.appendChild(defaultWrap);
  wrapper.appendChild(defaultRow);

  return wrapper;
};

const renderSchemaSection = (
  draft: TableEditorDraft,
  mount: HTMLElement,
  refreshSchema: () => void,
  refreshData: () => void,
  onChange: () => void,
  ctx: FieldStyleContext,
): HTMLElement => {
  const container = document.createElement('div');
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px 6px',
    flexWrap: 'wrap',
  });

  const label = document.createElement('span');
  label.textContent = 'columns';
  Object.assign(label.style, { fontSize: '11px', color: 'rgba(0,0,0,0.7)', fontWeight: '500' });

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
  const addColumn = (): void => {
    const column = createColumnByType(draft.schema, typeSelect.value as TableColumnType);
    draft.schema.columns.push(column);
    addColumnToRows(draft.data.rows, column);
    refreshSchema();
    refreshData();
    onChange();
  };
  addBtn.addEventListener('click', addColumn);

  controls.appendChild(typeSelect);
  controls.appendChild(addBtn);
  header.appendChild(label);
  header.appendChild(controls);

  const list = document.createElement('div');
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
    const emptyBtn = document.createElement('button');
    emptyBtn.type = 'button';
    emptyBtn.textContent = '+ add first column';
    emptyBtn.style.border = 'none';
    emptyBtn.style.background = 'transparent';
    emptyBtn.style.cursor = 'pointer';
    emptyBtn.style.padding = '0';
    emptyBtn.style.fontSize = '11px';
    emptyBtn.addEventListener('click', addColumn);
    empty.appendChild(message);
    empty.appendChild(emptyBtn);
    list.appendChild(empty);
  } else {
    for (const column of draft.schema.columns) {
      list.appendChild(renderColumnRow(draft, column, onChange, refreshSchema, refreshData, ctx));
    }
  }

  container.appendChild(header);
  container.appendChild(list);
  mount.replaceChildren(container);
  return container;
};

const resolveSelectOptions = async (source: TableSelectSource): Promise<TableSelectOption[]> => {
  if (source.kind === 'inline') return source.options;

  const response = await fetch(source.url, {
    headers: source.headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch options: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  const items = getByPath(payload, source.itemsPath);
  if (!Array.isArray(items)) return [];

  const valueKey = source.valueKey ?? 'value';
  const labelKey = source.labelKey ?? 'label';
  return items
    .map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const value = record[valueKey];
      const label = record[labelKey];
      if (typeof value !== 'string') return null;
      return {
        value,
        label: typeof label === 'string' ? label : value,
      };
    })
    .filter((entry): entry is TableSelectOption => entry !== null);
};

const renderCellEditor = (
  draft: TableEditorDraft,
  column: TableColumn,
  rowIndex: number,
  onChange: () => void,
): HTMLElement => {
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
      onChange();
    });
    cell.appendChild(input);
    return cell;
  }

  if (column.type === 'select') {
    const select = document.createElement('select');
    Object.assign(select.style, {
      width: '100%',
      fontSize: '12px',
    });

    const syncOptions = async (): Promise<void> => {
      select.replaceChildren();
      const loading = document.createElement('option');
      loading.value = '';
      loading.textContent = 'Loading...';
      select.appendChild(loading);
      try {
        const options = await resolveSelectOptions(column.source);
        select.replaceChildren();
        if (current !== undefined && current !== null && current !== '') {
          const currentOption = document.createElement('option');
          currentOption.value = String(current);
          currentOption.textContent = String(current);
          select.appendChild(currentOption);
        }
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '';
        select.appendChild(empty);
        for (const option of options) {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          select.appendChild(el);
        }
        select.value = typeof current === 'string' ? current : '';
      } catch (error) {
        select.replaceChildren();
        const opt = document.createElement('option');
        opt.value = typeof current === 'string' ? current : '';
        opt.textContent = typeof current === 'string' ? current : 'Failed to load options';
        select.appendChild(opt);
        select.title = error instanceof Error ? error.message : String(error);
      }
    };

    select.addEventListener('change', () => {
      row.values[column.key] = select.value;
      onChange();
    });

    void syncOptions();
    cell.appendChild(select);
    return cell;
  }

  const input = document.createElement('input');
  input.type = column.type === 'int' ? 'text' : column.type === 'date' ? (column.dateKind === 'datetime' ? 'datetime-local' : 'date') : 'text';
  Object.assign(input.style, {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: '12px',
  });
  input.value = current === undefined || current === null ? '' : String(current);

  input.addEventListener('input', () => {
    if (column.type === 'int') {
      const raw = input.value.trim();
      row.values[column.key] = raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : raw;
      onChange();
      return;
    }
    row.values[column.key] = input.value;
    onChange();
  });

  cell.appendChild(input);
  return cell;
};

const renderDataSection = (
  draft: TableEditorDraft,
  mount: HTMLElement,
  refreshData: () => void,
  onChange: () => void,
): HTMLElement => {
  const container = document.createElement('div');
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px 6px',
  });

  const label = document.createElement('span');
  label.textContent = 'rows';
  Object.assign(label.style, { fontSize: '11px', color: 'rgba(0,0,0,0.7)', fontWeight: '500' });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ add row';
  addBtn.style.border = 'none';
  addBtn.style.background = 'transparent';
  addBtn.style.cursor = 'pointer';
  addBtn.style.fontSize = '11px';
  addBtn.addEventListener('click', () => {
    const row = {
      id: randomId(),
      values: makeRowFromSchema(draft.schema),
    };
    draft.data.rows.push(row);
    refreshData();
    onChange();
  });

  header.appendChild(label);
  header.appendChild(addBtn);

  const visibleColumns = draft.schema.columns.filter((column) => !column.hidden);
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
    message.textContent = 'No columns yet. Define the schema first, then add rows here.';
    empty.appendChild(message);
    container.appendChild(header);
    container.appendChild(empty);
    mount.replaceChildren(container);
    return container;
  }

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '12px';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of visibleColumns) {
    const th = document.createElement('th');
    th.textContent = column.label || column.key;
    th.style.textAlign = 'left';
    th.style.borderBottom = '1px solid rgba(0,0,0,0.12)';
    th.style.padding = '4px 6px';
    th.style.whiteSpace = 'nowrap';
    headRow.appendChild(th);
  }
  const actionHead = document.createElement('th');
  actionHead.textContent = '';
  actionHead.style.borderBottom = '1px solid rgba(0,0,0,0.12)';
  actionHead.style.padding = '4px 6px';
  headRow.appendChild(actionHead);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (draft.data.rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = Math.max(visibleColumns.length + 1, 1);
    td.style.padding = '8px 6px';
    td.style.color = 'rgba(0,0,0,0.55)';
    const emptyWrap = document.createElement('div');
    Object.assign(emptyWrap.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    });
    const message = document.createElement('div');
    message.textContent = 'No rows yet. Add the first row to start editing data.';
    const emptyBtn = document.createElement('button');
    emptyBtn.type = 'button';
    emptyBtn.textContent = '+ add first row';
    emptyBtn.style.border = 'none';
    emptyBtn.style.background = 'transparent';
    emptyBtn.style.cursor = 'pointer';
    emptyBtn.style.padding = '0';
    emptyBtn.style.fontSize = '11px';
    emptyBtn.addEventListener('click', () => {
      const row = {
        id: randomId(),
        values: makeRowFromSchema(draft.schema),
      };
      draft.data.rows.push(row);
      refreshData();
      onChange();
    });
    emptyWrap.appendChild(message);
    emptyWrap.appendChild(emptyBtn);
    td.appendChild(emptyWrap);
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const [rowIndex, row] of draft.data.rows.entries()) {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      for (const column of visibleColumns) {
        tr.appendChild(renderCellEditor(draft, column, rowIndex, onChange));
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
        refreshData();
        onChange();
      });
      actionCell.appendChild(deleteBtn);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  container.appendChild(header);
  container.appendChild(table);
  mount.replaceChildren(container);
  return container;
};

const renderStatus = (status: HTMLElement, message: string): void => {
  status.textContent = message;
  status.style.color = message ? '#c0392b' : 'rgba(0,0,0,0.6)';
};

const validateDraft = (draft: TableEditorDraft): string | null => {
  const schemaMessage = validateTableSchemaDraft(draft.schema);
  if (schemaMessage) return schemaMessage;
  const dataMessage = validateTableDataDraft(draft.data, draft.schema);
  if (dataMessage) return dataMessage;
  return null;
};

const validateDraftForSave = async (draft: TableEditorDraft): Promise<string | null> => {
  const message = validateDraft(draft);
  if (message) return message;

  const endpointOptionsCache = new Map<string, TableSelectOption[]>();
  for (const column of draft.schema.columns) {
    if (column.type !== 'select' || column.source.kind !== 'endpoint') continue;

    const cacheKey = JSON.stringify(column.source);
    let options = endpointOptionsCache.get(cacheKey);
    if (!options) {
      try {
        options = await resolveSelectOptions(column.source);
      } catch (error) {
        return error instanceof Error
          ? `Failed to load select options for ${column.label}: ${error.message}`
          : `Failed to load select options for ${column.label}: ${String(error)}`;
      }
      endpointOptionsCache.set(cacheKey, options);
    }

    const allowedValues = new Set(options.map((option) => option.value));
    for (const row of draft.data.rows) {
      const value = row.values[column.key];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !allowedValues.has(value)) {
        return `Invalid select value: ${column.label}`;
      }
    }
  }

  return null;
};

const savePatchIfValid = async (
  draft: TableEditorDraft,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
  patch: Record<string, unknown>,
): Promise<void> => {
  const nextDraft = clone(draft) as TableEditorDraft;
  Object.assign(nextDraft, patch);
  const message = await validateDraftForSave(nextDraft);
  if (message) throw new Error(message);
  await onSave(patch);
};

const renderAdvancedJsonSection = (
  draft: TableEditorDraft,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): HTMLElement => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  });

  const schemaRow = renderJsonEditorRow(
    'schema',
    draft.schema,
    validateTableSchemaDraft,
    async (schemaDraft) => {
      const nextSchema = schemaDraft as TableSchema;
      await savePatchIfValid(draft, onSave, { schema: nextSchema });
    },
  );

  const dataRow = renderJsonEditorRow(
    'data',
    draft.data,
    (dataDraft) => validateTableDataDraft(dataDraft, draft.schema),
    async (dataDraft) => {
      const nextData = dataDraft as TableData;
      await savePatchIfValid(draft, onSave, { data: nextData });
    },
  );

  const note = document.createElement('div');
  note.textContent = 'Advanced JSON editors for direct editing and recovery.';
  Object.assign(note.style, {
    padding: '0 8px',
    fontSize: '10px',
    color: 'rgba(0,0,0,0.55)',
  });

  wrap.appendChild(note);
  wrap.appendChild(schemaRow);
  wrap.appendChild(dataRow);
  return wrap;
};

export const hydrateTableEditor = async (
  editorEl: HTMLElement,
  editorFrame: EditorFrame,
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): Promise<void> => {
  const ctx = buildFieldStyleContext(editorFrame.fieldStyle);
  const draft = clone(applyDefaults('table', componentData)) as TableEditorDraft;
  const status = document.createElement('div');
  Object.assign(status.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.6)',
    minHeight: '14px',
    fontFamily: 'monospace',
    padding: '4px 8px 0',
  });

  const schemaMount = document.createElement('div');
  const dataMount = document.createElement('div');
  const kindMount = document.createElement('div');
  const propertiesMount = document.createElement('div');
  const schemaSectionMount = document.createElement('div');
  const dataSectionMount = document.createElement('div');

  const refreshSchema = (): void => {
    renderSchemaSection(draft, schemaMount, refreshSchema, refreshData, updateStatus, ctx);
  };

  const refreshData = (): void => {
    renderDataSection(draft, dataMount, refreshData, updateStatus);
  };

  const updateStatus = (): void => {
    renderStatus(status, validateDraft(draft) ?? '');
  };

  const saveDraft = async (): Promise<void> => {
    const message = await validateDraftForSave(draft);
    if (message) {
      renderStatus(status, message);
      return;
    }
    renderStatus(status, 'Saving...');
    await onSave(clone(draft) as Record<string, unknown>);
    renderStatus(status, 'Saved');
  };

  editorEl.replaceChildren();
  renderKindSelector(kindMount, draft, onSave);
  appendSection(editorEl, { source: 'properties', label: 'kind' }, kindMount);
  propertiesMount.replaceChildren(renderPropertiesSection(draft, ctx, updateStatus));
  appendSection(editorEl, { source: 'properties', label: 'properties' }, propertiesMount);
  refreshSchema();
  appendSection(editorEl, { source: 'properties', label: 'schema' }, schemaMount);
  refreshData();
  appendSection(editorEl, { source: 'properties', label: 'data' }, dataMount);
  appendSection(
    editorEl,
    { source: 'properties', label: 'advanced JSON', collapsible: true, defaultCollapsed: true },
    renderAdvancedJsonSection(draft, onSave),
  );

  const footer = document.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
  });
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save all';
  saveBtn.style.fontSize = '11px';
  saveBtn.style.padding = '2px 10px';
  saveBtn.style.cursor = 'pointer';
  saveBtn.addEventListener('click', () => {
    void saveDraft().catch((error: unknown) => {
      renderStatus(status, error instanceof Error ? error.message : String(error));
    });
  });
  footer.appendChild(saveBtn);
  footer.appendChild(status);
  editorEl.appendChild(footer);
  updateStatus();
};
