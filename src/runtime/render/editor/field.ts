import { isFormField, type SchemaField } from '../../../schema/component';
import { type FieldStyleContext, SUMMARY_STYLE } from './context';
import { getAtPath, setAtPath, blankFromSchema } from '../../bind/field/path';

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

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
  options: Array<{ value: string; label: string }>,
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
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
  for (const opt of options) {
    const option = mk('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  select.value = typeof current === 'string' ? current : '';
  select.addEventListener('change', () => { setAtPath(draft, path, select.value); });
  if (onBlurSave) select.addEventListener('change', onBlurSave);
  wrapper.appendChild(lbl);
  wrapper.appendChild(select);
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
  draft: Record<string, unknown>,
  ctx: FieldStyleContext,
  onBlurSave?: () => void,
): HTMLElement {
  const wrapper = mk('div');

  const raw = getAtPath(draft, path);
  const map: Record<string, string> = isStringRecord(raw) ? (raw as Record<string, string>) : {};
  setAtPath(draft, path, map);

  const list = mk('div');

  const renderRows = (): void => {
    list.innerHTML = '';
    for (const key of Object.keys(map)) {
      const row = mk('div');
      Object.assign(row.style, ctx.wrapper);
      const keyInput = mk('input');
      keyInput.placeholder = 'key';
      keyInput.value = key;
      Object.assign(keyInput.style, ctx.input);
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
      keyInput.addEventListener('change', () => {
        const newKey = keyInput.value;
        if (newKey === key) return;
        map[newKey] = map[key] ?? '';
        delete map[key];
        renderRows();
      });
      valInput.addEventListener('input', () => { map[key] = valInput.value; });
      if (onBlurSave) {
        keyInput.addEventListener('blur', onBlurSave);
        valInput.addEventListener('blur', onBlurSave);
      }
      removeBtn.addEventListener('click', () => { delete map[key]; renderRows(); });
      row.appendChild(keyInput);
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
  onBlurSave?: () => void,
): HTMLElement {
  if (!isFormField(field)) return renderUnsupportedField(field, draft, ctx);
  const label: string = ('label' in field && field.label) ? field.label : (('key' in field && field.key) ? field.key : '');

  switch (field.kind) {
    case 'text-field':
      return renderTextField(label, field.key, draft, ctx, onBlurSave);
    case 'number-field':
      return renderNumberField(label, field.key, draft, ctx, onBlurSave);
    case 'textarea-field':
      return renderTextarea(label, field.key, draft, ctx, onBlurSave);
    case 'boolean-field':
      return renderBooleanField(label, field.key, draft, ctx, onBlurSave);
    case 'select-field':
      return renderSelectField(label, field.key, field.options, draft, ctx, onBlurSave);
    case 'style-map-field':
      return renderStyleMap(label, field.key, draft, ctx, onBlurSave);
    case 'object-list-field': {
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
      const raw = getAtPath(draft, field.key);
      const arr: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      setAtPath(draft, field.key, arr);
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
          for (const subField of field.fields) {
            section.appendChild(renderFieldFromSchema(subField, item, ctx, onBlurSave));
          }
          list.appendChild(section);
        });
      };
      renderItems();
      addBtn.addEventListener('click', () => { arr.push(blankFromSchema(field.fields)); renderItems(); });
      return wrapper;
    }
    case 'field-group': {
      const subDraft = field.key
        ? ((getAtPath(draft, field.key) as Record<string, unknown>) ?? {})
        : draft;
      if (field.key && getAtPath(draft, field.key) === undefined) {
        setAtPath(draft, field.key, subDraft);
      }
      if (field.collapsible) {
        const details = mk('details');
        if (!field.defaultCollapsed) details.open = true;
        const summary = mk('summary');
        summary.textContent = field.label ?? field.key ?? '';
        Object.assign(summary.style, SUMMARY_STYLE);
        details.appendChild(summary);
        for (const subField of field.fields) {
          details.appendChild(renderFieldFromSchema(subField, subDraft, ctx, onBlurSave));
        }
        return details;
      }
      const wrapper = mk('div');
      if (field.label || field.key) {
        const headingRow = mk('div');
        Object.assign(headingRow.style, ctx.wrapper);
        const lbl = mk('span');
        lbl.textContent = field.label ?? field.key ?? '';
        Object.assign(lbl.style, ctx.label);
        headingRow.appendChild(lbl);
        wrapper.appendChild(headingRow);
      }
      for (const subField of field.fields) {
        wrapper.appendChild(renderFieldFromSchema(subField, subDraft, ctx, onBlurSave));
      }
      return wrapper;
    }
  }
}
