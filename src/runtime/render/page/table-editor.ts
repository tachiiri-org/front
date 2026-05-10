import {
  isTableComponent,
  type TableColumn,
  type TableComponent,
  type TableData,
  type TableSchema,
} from '../../../schema/component';
import {
  validateSchemaEditorTableDraft,
  validateSchemaEditorTableDraftDetail,
} from '../../../schema/component/schema-editor';
import { type Frame, isFrameRef } from '../../../schema/screen/screen';
import { putComponent, putComponentSchema, updateScreen } from '../../bind/editor/save';
import { renderTable } from './frame';
import { showToast } from '../toast';

type TableEditorDraft = TableComponent;
type TableSaveTarget =
  | { kind: 'component'; screenId: string; componentSrc: string }
  | { kind: 'component-schema'; screenId: string; componentSrc: string }
  | { kind: 'screen-frame'; screenId: string; frameId: string };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const TEXT_INPUT_MIN_WIDTH = 96;
const TEXT_INPUT_EXTRA_SPACE = 18;

let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

const measureTextWidth = (text: string, font: string): number => {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureContext = measureCanvas.getContext('2d');
  }
  if (!measureContext) return text.length * 8;
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

const applyTextInputSize = (
  input: HTMLInputElement | HTMLSelectElement,
  value: string,
  fallback = '',
): void => {
  const label = value || fallback || '';
  const style = globalThis.getComputedStyle(input);
  const font = style.font || `${style.fontSize} ${style.fontFamily}`;
  const textWidth = Math.ceil(measureTextWidth(label, font));
  const horizontalPadding =
    Number.parseFloat(style.paddingLeft || '0') + Number.parseFloat(style.paddingRight || '0');
  const borderWidth =
    Number.parseFloat(style.borderLeftWidth || '0') + Number.parseFloat(style.borderRightWidth || '0');
  const width = Math.max(
    TEXT_INPUT_MIN_WIDTH,
    textWidth + horizontalPadding + borderWidth + TEXT_INPUT_EXTRA_SPACE,
  );
  if (input instanceof HTMLInputElement) {
    input.style.width = `${width}px`;
  }
  if (input instanceof HTMLSelectElement) {
    input.style.minWidth = `${width}px`;
  }
};

const syncAutoSizedControls = (root: HTMLElement): void => {
  for (const element of root.querySelectorAll('[data-auto-size="true"]')) {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      applyTextInputSize(element, element.value, element instanceof HTMLInputElement ? element.placeholder : '');
    }
  }
};

const scheduleAutoSizedControls = (root: HTMLElement): void => {
  const run = (): void => syncAutoSizedControls(root);
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run);
    return;
  }
  setTimeout(run, 0);
};

const ACTION_COL_MIN_WIDTH = '72px';
const STYLE_MAP_KEY_OPTIONS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'display',
  'gap',
  'flex',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'textAlign',
  'fontSize',
  'fontWeight',
  'color',
  'background',
  'backgroundColor',
  'border',
  'borderRadius',
  'boxShadow',
  'overflow',
  'overflowX',
  'overflowY',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'cursor',
  'whiteSpace',
  'opacity',
  'transform',
  'transformOrigin',
  'userSelect',
  'pointerEvents',
  'lineHeight',
] as const;

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

const createColumn = (schema: TableSchema, label?: string): TableColumn => {
  const base = {
    key: generateColumnKey(schema.columns),
    label: label?.trim() || 'New column',
    hidden: false,
    required: false,
    nullable: true,
    type: 'string' as const,
  };

  return base;
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
  screenId?: string,
): TableSaveTarget | null => {
  if (!screenId) return null;
  const frameRecord = frame as Record<string, unknown>;
  if (typeof frameRecord.schemaEditorKind === 'string' && frameRecord.schemaEditorKind) {
    return { kind: 'component-schema', screenId, componentSrc: frameRecord.schemaEditorKind };
  }
  if (isFrameRef(frame)) return { kind: 'component', screenId, componentSrc: frame.src };
  if (isTableComponent(frame)) return { kind: 'screen-frame', screenId, frameId: frame.id };
  return null;
};

const persistTableDraft = async (
  draft: TableEditorDraft,
  saveTarget: TableSaveTarget | null,
): Promise<void> => {
  if (!saveTarget) return;
  const next = clone(draft);
  if (saveTarget.kind === 'component-schema') {
    await putComponentSchema(saveTarget.componentSrc, next);
    return;
  }
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
  frame: Frame,
  component: TableEditorDraft,
  screenId?: string,
): HTMLElement => {
  const wrapper = renderTable(id, component);
  const draft = clone(component) as TableEditorDraft;
  const saveTarget = buildSaveTarget(frame, screenId);
  let pendingRowValues = makeRowFromSchema(draft.schema);
  let showHiddenColumns = false;

  let isDirty = false;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  Object.assign(saveBtn.style, {
    fontSize: '11px',
    padding: '2px 10px',
    cursor: 'pointer',
    border: '1px solid rgba(0,0,0,0.14)',
    borderRadius: '4px',
    background: 'white',
  });
  saveBtn.disabled = true;

  const updateStatus = (): void => {
    if (!saveTarget) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.65';
      saveBtn.style.cursor = 'not-allowed';
      return;
    }
    saveBtn.disabled = !isDirty;
    saveBtn.style.opacity = isDirty ? '1' : '0.65';
    saveBtn.style.cursor = isDirty ? 'pointer' : 'not-allowed';
  };

  const markDirty = (): void => {
    isDirty = true;
    updateStatus();
  };

  const markDirtyAndRender = (): void => {
    markDirty();
    render();
  };

  const saveDraft = async (): Promise<void> => {
    if (!saveTarget) return;
    if (saveTarget.kind === 'component-schema') {
      const message = validateSchemaEditorTableDraftDetail(draft.data).message;
      if (message) {
        showToast(message, 'error');
        return;
      }
    }
    try {
      await persistTableDraft(draft, saveTarget);
      isDirty = false;
      updateStatus();
      showToast('Saved', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const addColumn = (label?: string): void => {
    const column = createColumn(draft.schema, label);
    draft.schema.columns.push(column);
    addColumnToRows(draft.data.rows, column);
    pendingRowValues[column.key] = makeDefaultValue(column);
    markDirtyAndRender();
  };

  const removeColumn = (column: TableColumn): void => {
    const index = draft.schema.columns.indexOf(column);
    if (index < 0) return;
    draft.schema.columns.splice(index, 1);
    for (const row of draft.data.rows) {
      delete row.values[column.key];
    }
    pendingRowValues = makeRowFromSchema(draft.schema);
    markDirtyAndRender();
  };

  const addRow = (values: Record<string, unknown>): void => {
    draft.data.rows.push({ id: randomId(), values });
    markDirtyAndRender();
  };

  const renderColumnHeaderLabel = (column: TableColumn): HTMLElement => {
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'column name';
    labelInput.value = column.label;
    labelInput.style.width = 'auto';
    labelInput.style.display = 'inline-block';
    labelInput.style.boxSizing = 'border-box';
    labelInput.style.fontSize = '12px';
    labelInput.style.fontWeight = '700';
    labelInput.style.border = 'none';
    labelInput.style.borderRadius = '0';
    labelInput.style.padding = '10px 8px';
    labelInput.style.background = 'transparent';
    labelInput.style.outline = 'none';
    labelInput.dataset.autoSize = 'true';
    applyTextInputSize(labelInput, labelInput.value, labelInput.placeholder);
    labelInput.addEventListener('input', () => {
      applyTextInputSize(labelInput, labelInput.value, labelInput.placeholder);
    });
    labelInput.addEventListener('blur', () => {
      const next = labelInput.value.trim();
      if (next) column.label = next;
      labelInput.value = column.label;
      applyTextInputSize(labelInput, labelInput.value, labelInput.placeholder);
      markDirtyAndRender();
    });
    return labelInput;
  };

  const renderColumnHeaderAction = (column: TableColumn): HTMLElement => {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '列削除';
    removeBtn.setAttribute('aria-label', 'remove column');
    removeBtn.style.display = 'block';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.fontSize = '11px';
    removeBtn.style.padding = '0';
    removeBtn.style.width = '100%';
    removeBtn.style.textAlign = 'center';
    removeBtn.style.whiteSpace = 'nowrap';
    removeBtn.addEventListener('click', () => removeColumn(column));
    return removeBtn;
  };

  const renderCellEditor = (
    rowValues: Record<string, unknown>,
    current: unknown,
    column: TableColumn,
    setValue: (value: unknown) => void,
    commit: () => void,
    isDraftRow = false,
    issue?: string,
  ): HTMLElement => {
    const cell = document.createElement('td');
    cell.style.border = '1px solid rgba(0,0,0,0.14)';
    cell.style.padding = '0';
    cell.style.verticalAlign = 'top';
    if (isDraftRow) {
      cell.style.background = 'white';
      cell.style.color = 'rgba(0,0,0,0.46)';
      cell.style.fontWeight = '600';
    }
    if (issue) {
      cell.style.background = 'rgba(239, 68, 68, 0.10)';
      cell.style.boxShadow = 'inset 0 0 0 1px rgba(239, 68, 68, 0.25)';
      cell.title = issue;
    }
    if (column.hidden) {
      cell.style.opacity = '0.35';
    }

    if (
      column.key === 'key' &&
      typeof rowValues.type === 'string' &&
      rowValues.type === 'style'
    ) {
      const select = document.createElement('select');
      Object.assign(select.style, {
        width: 'auto',
        minWidth: '0',
        boxSizing: 'border-box',
        fontSize: '12px',
        border: 'none',
        background: 'transparent',
        padding: '10px 8px',
        color: 'inherit',
        fontWeight: 'inherit',
      });
      select.dataset.autoSize = 'true';
      const currentValue = typeof current === 'string' ? current : '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '';
      select.appendChild(empty);
      for (const optionValue of STYLE_MAP_KEY_OPTIONS) {
        const el = document.createElement('option');
        el.value = optionValue;
        el.textContent = optionValue;
        select.appendChild(el);
      }
      if (currentValue && !Array.from(select.options).some((option) => option.value === currentValue)) {
        const invalid = document.createElement('option');
        invalid.value = currentValue;
        invalid.textContent = `invalid: ${currentValue}`;
        invalid.style.color = '#c0392b';
        select.appendChild(invalid);
      }
      select.value = currentValue;
      applyTextInputSize(select, select.value, '');
      select.addEventListener('change', () => {
        setValue(select.value);
        commit();
      });
      cell.appendChild(select);
      return cell;
    }

    if (column.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.style.display = 'block';
      input.style.margin = '10px 8px';
      input.checked = Boolean(current);
      input.addEventListener('change', () => {
        setValue(input.checked);
        commit();
      });
      cell.appendChild(input);
      return cell;
    }

    if (column.type === 'select') {
      const select = document.createElement('select');
      Object.assign(select.style, {
        width: 'auto',
        minWidth: '0',
        boxSizing: 'border-box',
        fontSize: '12px',
        border: 'none',
        background: 'transparent',
        padding: '10px 8px',
        color: 'inherit',
        fontWeight: 'inherit',
      });
      select.dataset.autoSize = 'true';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '';
      select.appendChild(empty);
      const currentValue = typeof current === 'string' ? current : '';
      if (column.source.kind === 'inline') {
        for (const option of column.source.options) {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          select.appendChild(el);
        }
      }
      if (currentValue && !Array.from(select.options).some((option) => option.value === currentValue)) {
        const invalid = document.createElement('option');
        invalid.value = currentValue;
        invalid.textContent = `invalid: ${currentValue}`;
        invalid.style.color = '#c0392b';
        select.appendChild(invalid);
      }
      select.value = currentValue;
      applyTextInputSize(select, select.value, '');
      if (issue) {
        select.style.background = 'rgba(239, 68, 68, 0.10)';
      }
      select.addEventListener('change', () => {
        setValue(select.value);
        commit();
      });
      cell.appendChild(select);
      return cell;
    }

    const input = document.createElement('input');
    input.type = column.type === 'date'
      ? (column.dateKind === 'datetime' ? 'datetime-local' : 'date')
      : 'text';
    Object.assign(input.style, {
      width: 'auto',
      minWidth: '0',
      boxSizing: 'border-box',
      fontSize: '12px',
      border: 'none',
      background: 'transparent',
      padding: '10px 8px',
      outline: 'none',
      color: 'inherit',
      fontWeight: 'inherit',
    });
    input.dataset.autoSize = 'true';
    input.value = current === undefined || current === null ? '' : String(current);
    applyTextInputSize(input, input.value, input.placeholder);
    const handleTextChange = (): void => {
      if (column.type === 'int') {
        const raw = input.value.trim();
        setValue(raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : raw);
      } else {
        setValue(input.value);
      }
      applyTextInputSize(input, input.value, input.placeholder);
      commit();
    };
    if (isDraftRow) {
      input.addEventListener('input', handleTextChange);
    } else {
      input.addEventListener('blur', handleTextChange);
    }
    cell.appendChild(input);
    return cell;
  };

  const render = (): void => {
    wrapper.replaceChildren();
    const validationDetail =
      saveTarget?.kind === 'component-schema'
        ? validateSchemaEditorTableDraftDetail(draft.data)
        : null;
    const rowIssues = validationDetail?.rowIssues ?? new Map<string, Record<string, string>>();

    const toolbar = document.createElement('div');
    Object.assign(toolbar.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 8px 6px',
      flexWrap: 'wrap',
      position: 'sticky',
      top: '0',
      zIndex: '1',
      background: 'rgba(255,255,255,0.96)',
      backdropFilter: 'blur(6px)',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
    });

    toolbar.appendChild(saveBtn);

    const hiddenLabel = document.createElement('label');
    Object.assign(hiddenLabel.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '11px',
      color: 'rgba(0,0,0,0.7)',
      cursor: 'pointer',
      userSelect: 'none',
    });
    const hiddenToggle = document.createElement('input');
    hiddenToggle.type = 'checkbox';
    hiddenToggle.checked = showHiddenColumns;
    hiddenToggle.addEventListener('change', () => {
      showHiddenColumns = hiddenToggle.checked;
      render();
    });
    hiddenLabel.appendChild(hiddenToggle);
    hiddenLabel.appendChild(document.createTextNode('show hidden columns'));
    toolbar.appendChild(hiddenLabel);
    wrapper.appendChild(toolbar);

    const visibleColumns = draft.schema.columns.filter(
      (column) => showHiddenColumns || !column.hidden,
    );

    const table = document.createElement('table');
    Object.assign(table.style, {
      width: 'max-content',
      borderCollapse: 'collapse',
      borderSpacing: '0',
      tableLayout: 'auto',
      fontSize: '12px',
    });

    const colgroup = document.createElement('colgroup');
    for (const column of visibleColumns) {
      const col = document.createElement('col');
      colgroup.appendChild(col);
    }
    const actionCol = document.createElement('col');
    actionCol.style.width = ACTION_COL_MIN_WIDTH;
    actionCol.style.minWidth = ACTION_COL_MIN_WIDTH;
    colgroup.appendChild(actionCol);
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    const headActionRow = document.createElement('tr');
    for (const column of visibleColumns) {
      const th = document.createElement('th');
      Object.assign(th.style, {
        verticalAlign: 'bottom',
        textAlign: 'left',
        padding: '0 8px 6px',
        border: 'none',
        background: 'transparent',
        fontSize: '11px',
        fontWeight: '700',
        color: 'rgba(0,0,0,0.58)',
        letterSpacing: '0.02em',
      });
      th.appendChild(renderColumnHeaderAction(column));
      headActionRow.appendChild(th);
    }
    thead.appendChild(headActionRow);

    const headLabelRow = document.createElement('tr');
    for (const column of visibleColumns) {
      const th = document.createElement('th');
      Object.assign(th.style, {
        verticalAlign: 'top',
        textAlign: 'left',
        padding: '0',
        border: '1px solid rgba(0,0,0,0.14)',
        background: 'transparent',
      });
      th.appendChild(renderColumnHeaderLabel(column));
      headLabelRow.appendChild(th);
    }
    const addColumnHead = document.createElement('th');
    Object.assign(addColumnHead.style, {
      verticalAlign: 'middle',
      textAlign: 'left',
      padding: '0 8px',
      border: 'none',
      background: 'transparent',
      whiteSpace: 'nowrap',
    });
    const addColumnBtn = document.createElement('button');
    addColumnBtn.type = 'button';
    addColumnBtn.textContent = '列追加';
    addColumnBtn.setAttribute('aria-label', 'add column');
    addColumnBtn.style.border = 'none';
    addColumnBtn.style.background = 'transparent';
    addColumnBtn.style.cursor = 'pointer';
    addColumnBtn.style.fontSize = '11px';
    addColumnBtn.style.padding = '0';
    addColumnBtn.style.width = 'auto';
    addColumnBtn.style.textAlign = 'left';
    addColumnBtn.style.display = 'block';
    addColumnBtn.style.whiteSpace = 'nowrap';
    addColumnBtn.addEventListener('click', () => addColumn());
    addColumnHead.appendChild(addColumnBtn);
    headLabelRow.appendChild(addColumnHead);
    thead.appendChild(headLabelRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const [rowIndex, row] of draft.data.rows.entries()) {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      tr.style.background = 'rgba(255,255,255,0.96)';
      const issueMap = rowIssues.get(row.id);
      const rowHasIssue = Boolean(issueMap && Object.keys(issueMap).length > 0);
      if (rowHasIssue) {
        tr.style.background = 'rgba(239, 68, 68, 0.05)';
      }
      for (const column of visibleColumns) {
        tr.appendChild(
          renderCellEditor(
            row.values,
            row.values[column.key],
            column,
            (value) => {
              row.values[column.key] = value;
            },
            column.type === 'select' ? markDirtyAndRender : markDirty,
            false,
            issueMap?.[column.key],
          ),
        );
      }

      const actionCell = document.createElement('td');
      actionCell.style.border = 'none';
      actionCell.style.padding = '0 8px';
      actionCell.style.verticalAlign = 'middle';
      actionCell.style.textAlign = 'left';
      actionCell.style.whiteSpace = 'nowrap';
      if (rowHasIssue) {
        actionCell.style.background = 'rgba(239, 68, 68, 0.05)';
      }
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '行削除';
      deleteBtn.style.border = 'none';
      deleteBtn.style.background = 'transparent';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.fontSize = '11px';
      deleteBtn.style.padding = '0';
      deleteBtn.style.width = 'auto';
      deleteBtn.style.textAlign = 'left';
      deleteBtn.style.whiteSpace = 'nowrap';
      deleteBtn.addEventListener('click', () => {
        draft.data.rows.splice(rowIndex, 1);
        markDirtyAndRender();
      });
      actionCell.appendChild(deleteBtn);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    }

    const draftRow = document.createElement('tr');
    draftRow.dataset.rowId = 'pending';
    draftRow.style.background = 'white';
    draftRow.style.color = 'rgba(0,0,0,0.46)';
    for (const column of visibleColumns) {
      draftRow.appendChild(
        renderCellEditor(
          pendingRowValues,
          pendingRowValues[column.key],
          column,
          (value) => {
            pendingRowValues[column.key] = value;
          },
          column.type === 'select'
            ? () => {
                pendingRowValues = { ...pendingRowValues };
                render();
              }
            : () => {},
          true,
        ),
      );
    }
    const draftActionCell = document.createElement('td');
    draftActionCell.style.border = 'none';
    draftActionCell.style.padding = '0 8px';
    draftActionCell.style.verticalAlign = 'middle';
    draftActionCell.style.textAlign = 'left';
    draftActionCell.style.whiteSpace = 'nowrap';
    draftActionCell.style.background = 'white';
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.textContent = '行追加';
    addRowBtn.setAttribute('aria-label', 'add row');
    addRowBtn.style.border = 'none';
    addRowBtn.style.background = 'transparent';
    addRowBtn.style.cursor = 'pointer';
    addRowBtn.style.fontSize = '11px';
    addRowBtn.style.padding = '0';
    addRowBtn.style.width = 'auto';
    addRowBtn.style.textAlign = 'left';
    addRowBtn.style.whiteSpace = 'nowrap';
    addRowBtn.disabled = draft.schema.columns.length === 0;
    addRowBtn.addEventListener('click', () => {
      addRow({ ...pendingRowValues });
      pendingRowValues = makeRowFromSchema(draft.schema);
      render();
    });
    draftActionCell.appendChild(addRowBtn);
    draftRow.appendChild(draftActionCell);
    tbody.appendChild(draftRow);
    table.appendChild(tbody);

    wrapper.appendChild(table);
    scheduleAutoSizedControls(wrapper);
  };

  saveBtn.addEventListener('click', () => {
    void saveDraft().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    });
  });

  render();
  updateStatus();
  return wrapper;
};

export { renderEditableTable };
