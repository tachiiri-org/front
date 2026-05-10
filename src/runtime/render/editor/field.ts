import {
  isFormField,
  normalizeFormFieldKind,
  type FormField,
  type SchemaField,
} from '../../../schema/component';
import { type FieldStyleContext, SUMMARY_STYLE } from './context';
import { getAtPath, setAtPath, blankFromSchema } from '../../bind/field/path';

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

const COMMON_STYLE_KEYS = [
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

function renderTextField(
  label: string,
  path: string,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = label;
  Object.assign(lbl.style, ctx.label);
  const input = mk('input');
  input.type = 'text';
  Object.assign(input.style, ctx.input);
  const current = getAtPath(draft, path);
  input.value = typeof current === 'string' ? current : '';
  input.addEventListener('input', () => { setAtPath(draft, path, input.value); });
  if (onBlurSave) input.addEventListener('blur', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderNumberField(
  label: string,
  path: string,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = label;
  Object.assign(lbl.style, ctx.label);
  const input = mk('input');
  input.type = 'number';
  Object.assign(input.style, ctx.input);
  const current = getAtPath(draft, path);
  input.value = typeof current === 'number' ? String(current) : '';
  input.addEventListener('input', () => {
    const next = input.value.trim();
    setAtPath(draft, path, next === '' ? 0 : Number(next));
  });
  if (onBlurSave) input.addEventListener('blur', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderTextarea(
  label: string,
  path: string,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = label;
  Object.assign(lbl.style, ctx.label);
  const ta = mk('textarea');
  Object.assign(ta.style, ctx.input);
  ta.style.resize = 'vertical';
  ta.rows = 2;
  const current = getAtPath(draft, path);
  ta.value = typeof current === 'string' ? current : '';
  ta.addEventListener('input', () => { setAtPath(draft, path, ta.value); });
  if (onBlurSave) ta.addEventListener('blur', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(ta);
  return wrapper;
}

function renderSelectField(
  label: string,
  path: string,
  field: SchemaField,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  selectEndpointVariables: Record<string, string>,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = label;
  Object.assign(lbl.style, ctx.label);
  const select = mk('select');
  Object.assign(select.style, ctx.input);
  const current = getAtPath(draft, path);
  select.addEventListener('change', () => { setAtPath(draft, path, select.value); });
  if (onBlurSave) select.addEventListener('change', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(select);

  const fieldRecord = field as Record<string, unknown>;
  const staticOptions = Array.isArray(fieldRecord.options)
    ? (fieldRecord.options as Array<{ value: string; label: string }>)
    : [];
  const source = typeof fieldRecord.source === 'object' &&
    fieldRecord.source !== null &&
    !Array.isArray(fieldRecord.source)
    ? (fieldRecord.source as Record<string, unknown>)
    : null;

  const syncOptions = async (): Promise<void> => {
    select.replaceChildren();
    const loading = mk('option');
    loading.value = '';
    loading.textContent = 'Loading...';
    select.appendChild(loading);

    let options = staticOptions;
    if (source) {
      try {
        options = await resolveEndpointOptions(source, selectEndpointVariables);
      } catch (error) {
        select.replaceChildren();
        const opt = mk('option');
        opt.value = typeof current === 'string' ? current : '';
        opt.textContent = typeof current === 'string' ? current : 'Failed to load options';
        select.appendChild(opt);
        select.title = error instanceof Error ? error.message : String(error);
        return;
      }
    }

    select.replaceChildren();
    if (typeof current === 'string' && current !== '' && !options.some((opt) => opt.value === current)) {
      const currentOption = mk('option');
      currentOption.value = current;
      currentOption.textContent = current;
      select.appendChild(currentOption);
    }
    const empty = mk('option');
    empty.value = '';
    empty.textContent = '';
    select.appendChild(empty);
    for (const opt of options) {
      const option = mk('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    select.value = typeof current === 'string' ? current : '';
  };

  void syncOptions();
  return wrapper;
}

function renderBooleanField(
  label: string,
  path: string,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = label;
  Object.assign(lbl.style, ctx.label);
  const input = mk('input');
  input.type = 'checkbox';
  const current = getAtPath(draft, path);
  input.checked = typeof current === 'boolean' ? current : false;
  input.addEventListener('change', () => { setAtPath(draft, path, input.checked); });
  if (onBlurSave) input.addEventListener('blur', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

const resolveTemplate = (value: string, variables: Record<string, string> = {}): string =>
  value.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => variables[key] ?? '');

const resolveEndpointOptions = async (
  source: Record<string, unknown>,
  variables: Record<string, string>,
): Promise<Array<{ value: string; label: string }>> => {
  const url = typeof source.url === 'string' ? resolveTemplate(source.url, variables) : '';
  if (!url) return [];

  const headers = typeof source.headers === 'object' &&
    source.headers !== null &&
    !Array.isArray(source.headers)
    ? (source.headers as Record<string, string>)
    : undefined;

  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    throw new Error(`Failed to fetch options: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  const itemsPath = typeof source.itemsPath === 'string' ? source.itemsPath : '';
  const items = itemsPath
    ? itemsPath.split('.').reduce((acc: unknown, key: string) => {
      if (acc === null || typeof acc !== 'object') return undefined;
      if (Array.isArray(acc)) {
        const idx = parseInt(key, 10);
        return isNaN(idx) ? undefined : (acc as unknown[])[idx];
      }
      return (acc as Record<string, unknown>)[key];
    }, payload)
    : payload;
  if (!Array.isArray(items)) return [];

  const valueKey = typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value';
  const labelKey = typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label';
  return items
    .map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const value = record[valueKey];
      if (typeof value !== 'string') return null;
      return {
        value,
        label: typeof record[labelKey] === 'string' ? (record[labelKey] as string) : value,
      };
    })
    .filter((entry): entry is { value: string; label: string } => entry !== null);
};

function renderUnsupportedField(
  field: SchemaField,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
): HTMLElement {
  const wrapper = mk('div');
  Object.assign(wrapper.style, ctx.wrapper);
  const lbl = mk('label');
  lbl.textContent = field.label ?? field.key ?? field.kind;
  Object.assign(lbl.style, ctx.label);
  const note = mk('div');
  note.textContent = `Unsupported field kind: ${field.kind}`;
  note.style.fontSize = '10px';
  note.style.color = 'rgba(0,0,0,0.45)';
  note.style.fontFamily = 'monospace';
  const preview = mk('textarea');
  preview.readOnly = true;
  preview.style.width = '100%';
  preview.style.boxSizing = 'border-box';
  preview.style.minHeight = '64px';
  preview.style.fontFamily = 'monospace';
  preview.style.fontSize = '11px';
  const previewValue = field.key && Object.prototype.hasOwnProperty.call(draft, field.key)
    ? JSON.stringify(getAtPath(draft, field.key), null, 2)
    : JSON.stringify(field, null, 2);
  preview.value = previewValue ?? 'undefined';
  wrapper.appendChild(lbl);
  wrapper.appendChild(note);
  wrapper.appendChild(preview);
  return wrapper;
}

function renderStyleMap(
  label: string,
  path: string,
  field: SchemaField,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');

  const raw = getAtPath(draft, path);
  const map: Record<string, string> = isStringRecord(raw) ? (raw as Record<string, string>) : {};
  setAtPath(draft, path, map);

  const list = mk('div');
  const keys =
    Array.isArray((field as Record<string, unknown>).keys) &&
    ((field as Record<string, unknown>).keys as unknown[]).every((key) => typeof key === 'string')
      ? ((field as Record<string, unknown>).keys as string[])
      : [...COMMON_STYLE_KEYS];

  const renderRows = (): void => {
    list.innerHTML = '';
    for (const key of Object.keys(map)) {
      const row = mk('div');
      Object.assign(row.style, ctx.wrapper);
      const keySelect = mk('select');
      Object.assign(keySelect.style, ctx.input);
      const customOptionValue = '__custom__';
      const knownKeys = new Set(keys);
      for (const candidate of keys) {
        const option = mk('option');
        option.value = candidate;
        option.textContent = candidate;
        keySelect.appendChild(option);
      }
      const customOption = mk('option');
      customOption.value = customOptionValue;
      customOption.textContent = 'custom...';
      keySelect.appendChild(customOption);
      const customKeyInput = mk('input');
      customKeyInput.placeholder = 'style key';
      Object.assign(customKeyInput.style, ctx.input);
      customKeyInput.style.display = 'none';
      const syncKeyState = (nextKey: string): void => {
        if (nextKey === key) return;
        map[nextKey] = map[key] ?? '';
        delete map[key];
        renderRows();
      };
      if (knownKeys.has(key)) {
        keySelect.value = key;
      } else {
        keySelect.value = customOptionValue;
        customKeyInput.style.display = '';
        customKeyInput.value = key;
      }
      keySelect.addEventListener('change', () => {
        if (keySelect.value === customOptionValue) {
          customKeyInput.style.display = '';
          customKeyInput.focus();
          return;
        }
        syncKeyState(keySelect.value);
      });
      customKeyInput.addEventListener('input', () => {
        if (keySelect.value !== customOptionValue) return;
        const nextKey = customKeyInput.value;
        if (!nextKey || nextKey === key) return;
        syncKeyState(nextKey);
      });
      const valInput = mk('input');
      valInput.placeholder = 'value';
      valInput.value = map[key] ?? '';
      Object.assign(valInput.style, ctx.input);
      const removeBtn = mk('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.style.fontSize = '10px';
      removeBtn.style.cursor = 'pointer';
      removeBtn.style.flexShrink = '0';
      removeBtn.style.border = 'none';
      removeBtn.style.background = 'transparent';
      valInput.addEventListener('input', () => { map[key] = valInput.value; });
      if (onBlurSave) {
        keySelect.addEventListener('blur', onBlurSave);
        customKeyInput.addEventListener('blur', onBlurSave);
        valInput.addEventListener('blur', onBlurSave);
      }
      removeBtn.addEventListener('click', () => { delete map[key]; renderRows(); });
      row.appendChild(keySelect);
      row.appendChild(customKeyInput);
      row.appendChild(valInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
    }
  };

  renderRows();

  const headingRow = mk('div');
  Object.assign(headingRow.style, ctx.wrapper);
  const heading = mk('span');
  heading.textContent = label;
  Object.assign(heading.style, ctx.label);
  const addBtn = mk('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add';
  addBtn.style.fontSize = '10px';
  addBtn.style.cursor = 'pointer';
  addBtn.style.border = 'none';
  addBtn.style.background = 'transparent';
  addBtn.style.color = 'rgba(0,0,0,0.45)';
  addBtn.addEventListener('click', () => { map[''] = ''; renderRows(); });
  headingRow.appendChild(heading);
  headingRow.appendChild(addBtn);

  wrapper.appendChild(headingRow);
  wrapper.appendChild(list);
  return wrapper;
}

export function renderFieldFromSchema(
  field: SchemaField,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  selectEndpointVariables: Record<string, string> = {},
  onBlurSave?: () => void,
): HTMLElement {
  if (!isFormField(field)) return renderUnsupportedField(field, draft, ctx);
  const label: string = ('label' in field && field.label) ? field.label : (('key' in field && field.key) ? field.key : '');
  const kind = normalizeFormFieldKind(String(field.kind));

  switch (kind) {
    case 'text': {
      const textField = field as Extract<FormField, { kind: 'text' }>;
      return renderTextField(label, textField.key, draft, ctx, onBlurSave);
    }
    case 'number': {
      const numberField = field as Extract<FormField, { kind: 'number' }>;
      return renderNumberField(label, numberField.key, draft, ctx, onBlurSave);
    }
    case 'textarea': {
      const textareaField = field as Extract<FormField, { kind: 'textarea' }>;
      return renderTextarea(label, textareaField.key, draft, ctx, onBlurSave);
    }
    case 'boolean': {
      const booleanField = field as Extract<FormField, { kind: 'boolean' }>;
      return renderBooleanField(label, booleanField.key, draft, ctx, onBlurSave);
    }
    case 'select':
      return renderSelectField(
        label,
        (field as Extract<FormField, { kind: 'select' }>).key,
        field,
        draft,
        ctx,
        selectEndpointVariables,
        onBlurSave,
      );
    case 'style': {
      const styleField = field as Extract<FormField, { kind: 'style' }>;
      return renderStyleMap(label, styleField.key, styleField, draft, ctx, onBlurSave);
    }
    case 'object-list': {
      const listField = field as Extract<FormField, { kind: 'object-list' }>;
      const wrapper = mk('div');
      const headingRow = mk('div');
      Object.assign(headingRow.style, ctx.wrapper);
      const headingLbl = mk('span');
      headingLbl.textContent = label;
      Object.assign(headingLbl.style, ctx.label);
      const addBtn = mk('button');
      addBtn.type = 'button';
      addBtn.textContent = '+ Add';
      addBtn.style.fontSize = '10px';
      addBtn.style.cursor = 'pointer';
      addBtn.style.border = 'none';
      addBtn.style.background = 'transparent';
      addBtn.style.color = 'rgba(0,0,0,0.45)';
      headingRow.appendChild(headingLbl);
      headingRow.appendChild(addBtn);
      wrapper.appendChild(headingRow);
      const list = mk('div');
      wrapper.appendChild(list);
      const raw = getAtPath(draft, listField.key);
      const arr: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      setAtPath(draft, listField.key, arr);
      const renderItems = (): void => {
        list.innerHTML = '';
        arr.forEach((item, i) => {
          const section = mk('div');
          section.style.borderLeft = '2px solid rgba(0,0,0,0.08)';
          section.style.marginLeft = '8px';
          const removeBtn = mk('button');
          removeBtn.type = 'button';
          removeBtn.textContent = 'Remove';
          removeBtn.style.fontSize = '10px';
          removeBtn.style.cursor = 'pointer';
          removeBtn.style.border = 'none';
          removeBtn.style.background = 'transparent';
          removeBtn.style.color = 'rgba(0,0,0,0.45)';
          removeBtn.style.padding = '2px 8px';
          removeBtn.addEventListener('click', () => { arr.splice(i, 1); renderItems(); });
          section.appendChild(removeBtn);
          for (const subField of listField.fields) {
            section.appendChild(renderFieldFromSchema(subField, item, ctx, selectEndpointVariables, onBlurSave));
          }
          list.appendChild(section);
        });
      };
      renderItems();
      addBtn.addEventListener('click', () => { arr.push(blankFromSchema(listField.fields)); renderItems(); });
      return wrapper;
    }
    case 'group': {
      const groupField = field as Extract<FormField, { kind: 'group' }>;
      const subDraft = field.key
        ? ((getAtPath(draft, field.key) as Record<string, unknown>) ?? {})
        : draft;
      if (field.key && getAtPath(draft, field.key) === undefined) {
        setAtPath(draft, field.key, subDraft);
      }
      if (groupField.collapsible) {
        const details = mk('details');
        if (!groupField.defaultCollapsed) details.open = true;
        const summary = mk('summary');
        summary.textContent = groupField.label ?? groupField.key ?? '';
        Object.assign(summary.style, SUMMARY_STYLE);
        details.appendChild(summary);
        for (const subField of groupField.fields) {
          details.appendChild(renderFieldFromSchema(subField, subDraft, ctx, selectEndpointVariables, onBlurSave));
        }
        return details;
      }
      const wrapper = mk('div');
      if (groupField.label || groupField.key) {
        const headingRow = mk('div');
        Object.assign(headingRow.style, ctx.wrapper);
        const lbl = mk('span');
        lbl.textContent = groupField.label ?? groupField.key ?? '';
        Object.assign(lbl.style, ctx.label);
        headingRow.appendChild(lbl);
        wrapper.appendChild(headingRow);
      }
      for (const subField of groupField.fields) {
        wrapper.appendChild(renderFieldFromSchema(subField, subDraft, ctx, selectEndpointVariables, onBlurSave));
      }
      return wrapper;
    }
  }
  return renderUnsupportedField(field, draft, ctx);
}
