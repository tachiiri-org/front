import type { FieldComponent } from '../component/fields';

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
    else if (field.kind === 'text-field' || field.kind === 'textarea') obj[field.key] = '';
    else if (field.kind === 'style-map-field') obj[field.key] = {};
    else if (field.kind === 'object-list-field') obj[field.key] = [];
  }
  return obj;
};

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

function renderTextField(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const lbl = mk('label');
  lbl.textContent = label;
  const input = mk('input');
  input.type = 'text';
  const current = getAtPath(draft, path);
  input.value = typeof current === 'string' ? current : '';
  input.addEventListener('input', () => { setAtPath(draft, path, input.value); });
  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

function renderNumberField(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const lbl = mk('label');
  lbl.textContent = label;
  const input = mk('input');
  input.type = 'number';
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

function renderTextarea(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const lbl = mk('label');
  lbl.textContent = label;
  const ta = mk('textarea');
  const current = getAtPath(draft, path);
  ta.value = typeof current === 'string' ? current : '';
  ta.addEventListener('input', () => { setAtPath(draft, path, ta.value); });
  wrapper.appendChild(lbl);
  wrapper.appendChild(ta);
  return wrapper;
}

function renderStyleMap(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const heading = mk('p');
  heading.textContent = label;
  wrapper.appendChild(heading);

  const list = mk('div');
  wrapper.appendChild(list);

  const raw = getAtPath(draft, path);
  const map: Record<string, string> = isStringRecord(raw) ? (raw as Record<string, string>) : {};
  setAtPath(draft, path, map);

  function renderRows(): void {
    list.innerHTML = '';
    for (const key of Object.keys(map)) {
      const row = mk('div');
      const keyInput = mk('input');
      keyInput.placeholder = 'key';
      keyInput.value = key;
      const valInput = mk('input');
      valInput.placeholder = 'value';
      valInput.value = map[key] ?? '';
      const removeBtn = mk('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';

      keyInput.addEventListener('change', () => {
        const newKey = keyInput.value;
        if (newKey === key) return;
        map[newKey] = map[key] ?? '';
        delete map[key];
        renderRows();
      });
      valInput.addEventListener('input', () => { map[key] = valInput.value; });
      removeBtn.addEventListener('click', () => {
        delete map[key];
        renderRows();
      });

      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
    }
  }

  renderRows();

  const addBtn = mk('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', () => {
    map[''] = '';
    renderRows();
  });
  wrapper.appendChild(addBtn);

  return wrapper;
}

export function renderFieldFromSchema(field: FieldComponent, draft: Record<string, unknown>): HTMLElement {
  const label: string = ('label' in field && field.label) ? field.label : (('key' in field && field.key) ? field.key : '');

  switch (field.kind) {
    case 'text-field':
      return renderTextField(label, field.key, draft);
    case 'number-field':
      return renderNumberField(label, field.key, draft);
    case 'textarea':
      return renderTextarea(label, field.key, draft);
    case 'style-map-field':
      return renderStyleMap(label, field.key, draft);
    case 'object-list-field': {
      const wrapper = mk('div');
      const heading = mk('p');
      heading.textContent = label;
      wrapper.appendChild(heading);
      const list = mk('div');
      wrapper.appendChild(list);
      const raw = getAtPath(draft, field.key);
      const arr: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      setAtPath(draft, field.key, arr);
      const renderItems = (): void => {
        list.innerHTML = '';
        arr.forEach((item, i) => {
          const section = mk('div');
          const removeBtn = mk('button');
          removeBtn.type = 'button';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => { arr.splice(i, 1); renderItems(); });
          section.appendChild(removeBtn);
          for (const subField of field.fields) {
            section.appendChild(renderFieldFromSchema(subField, item));
          }
          list.appendChild(section);
        });
      };
      renderItems();
      const addBtn = mk('button');
      addBtn.type = 'button';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => {
        arr.push(blankFromSchema(field.fields));
        renderItems();
      });
      wrapper.appendChild(addBtn);
      return wrapper;
    }
    case 'field-group': {
      const wrapper = mk('div');
      if (field.label) {
        const heading = mk('p');
        heading.textContent = field.label;
        wrapper.appendChild(heading);
      }
      const subDraft = field.key
        ? ((getAtPath(draft, field.key) as Record<string, unknown>) ?? {})
        : draft;
      if (field.key && getAtPath(draft, field.key) === undefined) {
        setAtPath(draft, field.key, subDraft);
      }
      for (const subField of field.fields) {
        wrapper.appendChild(renderFieldFromSchema(subField, subDraft));
      }
      return wrapper;
    }
  }
}
