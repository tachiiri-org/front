import type { FieldComponent } from '../component/fields';

export type FieldStyleContext = {
  wrapper: Record<string, string>;
  label: Record<string, string>;
  input: Record<string, string>;
};

const DEFAULT_WRAPPER: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  padding: '2px 8px',
  gap: '4px',
  minHeight: '24px',
};

const DEFAULT_LABEL: Record<string, string> = {
  fontSize: '10px',
  color: 'rgba(0,0,0,0.65)',
  width: '80px',
  flexShrink: '0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const DEFAULT_INPUT: Record<string, string> = {
  flex: '1',
  fontSize: '12px',
  border: 'none',
  borderBottom: '1px solid rgba(0,0,0,0.12)',
  background: 'transparent',
  padding: '1px 2px',
  minWidth: '0',
  outline: 'none',
};

const SUMMARY_STYLE: Record<string, string> = {
  fontSize: '10px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.7)',
  padding: '2px 8px',
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
};

export function buildFieldStyleContext(override?: {
  wrapper?: Record<string, string>;
  label?: Record<string, string>;
  input?: Record<string, string>;
}): FieldStyleContext {
  return {
    wrapper: { ...DEFAULT_WRAPPER, ...(override?.wrapper ?? {}) },
    label: { ...DEFAULT_LABEL, ...(override?.label ?? {}) },
    input: { ...DEFAULT_INPUT, ...(override?.input ?? {}) },
  };
}

const getAtPath = (obj: unknown, path: string): unknown => {
  if (!path) return obj;
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    if (Array.isArray(acc)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? undefined : (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
};

const setAtPath = (obj: unknown, path: string, value: unknown): void => {
  if (!path || obj === null || typeof obj !== 'object') return;
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((acc: unknown, key: string): unknown => {
    if (acc === null || typeof acc !== 'object') return null;
    if (Array.isArray(acc)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? null : (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key] ?? null;
  }, obj);
  if (parent === null || typeof parent !== 'object') return;
  if (Array.isArray(parent)) {
    const idx = parseInt(last, 10);
    if (!isNaN(idx)) (parent as unknown[])[idx] = value;
  } else {
    (parent as Record<string, unknown>)[last] = value;
  }
};

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

const blankFromSchema = (fields: FieldComponent[]): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    if (!('key' in field) || !field.key) continue;
    if (field.kind === 'number-field') obj[field.key] = 0;
    else if (field.kind === 'boolean-field') obj[field.key] = false;
    else if (field.kind === 'text-field' || field.kind === 'textarea') obj[field.key] = '';
    else if (field.kind === 'style-map-field') obj[field.key] = {};
    else if (field.kind === 'object-list-field') obj[field.key] = [];
  }
  return obj;
};

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

function renderTextField(label: string, path: string, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
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
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderNumberField(label: string, path: string, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
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
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderTextarea(label: string, path: string, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
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
  wrapper.appendChild(lbl);
  wrapper.appendChild(ta);
  return wrapper;
}

function renderBooleanField(label: string, path: string, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
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
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderStyleMap(label: string, path: string, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
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

export function renderFieldFromSchema(field: FieldComponent, draft: Record<string, unknown>, ctx: FieldStyleContext): HTMLElement {
  const label: string = ('label' in field && field.label) ? field.label : (('key' in field && field.key) ? field.key : '');

  switch (field.kind) {
    case 'text-field':
      return renderTextField(label, field.key, draft, ctx);
    case 'number-field':
      return renderNumberField(label, field.key, draft, ctx);
    case 'textarea':
      return renderTextarea(label, field.key, draft, ctx);
    case 'boolean-field':
      return renderBooleanField(label, field.key, draft, ctx);
    case 'style-map-field':
      return renderStyleMap(label, field.key, draft, ctx);
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
            section.appendChild(renderFieldFromSchema(subField, item, ctx));
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
          details.appendChild(renderFieldFromSchema(subField, subDraft, ctx));
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
        wrapper.appendChild(renderFieldFromSchema(subField, subDraft, ctx));
      }
      return wrapper;
    }
  }
}
