const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

function getAtPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    if (Array.isArray(acc)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? undefined : (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function setAtPath(obj: unknown, path: string, value: unknown): void {
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
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  );
}

function blankOf(v: unknown): unknown {
  if (typeof v === 'string') return '';
  if (Array.isArray(v)) return [];
  if (typeof v === 'object' && v !== null) {
    const t: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      t[k] = blankOf(val);
    }
    return t;
  }
  return v;
}

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

function renderObjectList(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const heading = mk('p');
  heading.textContent = label;
  wrapper.appendChild(heading);

  const list = mk('div');
  wrapper.appendChild(list);

  const raw = getAtPath(draft, path);
  const arr: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  setAtPath(draft, path, arr);

  function renderItems(): void {
    list.innerHTML = '';
    arr.forEach((item, i) => {
      const section = mk('div');
      const removeBtn = mk('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        arr.splice(i, 1);
        renderItems();
      });
      section.appendChild(removeBtn);
      for (const key of Object.keys(item)) {
        section.appendChild(renderField(key, `${path}.${i}.${key}`, draft));
      }
      list.appendChild(section);
    });
  }

  renderItems();

  const addBtn = mk('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', () => {
    const template = arr[0] !== undefined
      ? blankOf(arr[0]) as Record<string, unknown>
      : {};
    arr.push(JSON.parse(JSON.stringify(template)) as Record<string, unknown>);
    renderItems();
  });
  wrapper.appendChild(addBtn);

  return wrapper;
}

function renderObject(label: string, path: string, value: Record<string, unknown>, draft: Record<string, unknown>): HTMLElement {
  const wrapper = mk('div');
  const heading = mk('p');
  heading.textContent = label;
  wrapper.appendChild(heading);
  for (const key of Object.keys(value)) {
    wrapper.appendChild(renderField(key, `${path}.${key}`, draft));
  }
  return wrapper;
}

function renderField(label: string, path: string, draft: Record<string, unknown>): HTMLElement {
  const value = getAtPath(draft, path);
  if (typeof value === 'string') return renderTextField(label, path, draft);
  if (typeof value === 'number') return renderNumberField(label, path, draft);
  if (isStringRecord(value)) return renderStyleMap(label, path, draft);
  if (Array.isArray(value)) return renderObjectList(label, path, draft);
  if (typeof value === 'object' && value !== null) {
    return renderObject(label, path, value as Record<string, unknown>, draft);
  }
  return mk('div');
}

export function renderForm(
  data: Record<string, unknown>,
  onSave: (draft: unknown) => Promise<void>,
  options?: { excludeKeys?: string[] },
): HTMLElement {
  const draft = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const form = mk('form');
  const excludeKeys = new Set(options?.excludeKeys ?? []);

  for (const key of Object.keys(draft)) {
    if (excludeKeys.has(key)) continue;
    form.appendChild(renderField(key, key, draft));
  }

  const footer = mk('div');
  const saveBtn = mk('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save';
  const status = mk('span');
  footer.appendChild(saveBtn);
  footer.appendChild(status);
  form.appendChild(footer);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    status.textContent = 'Saving...';
    onSave(draft)
      .then(() => { status.textContent = 'Saved!'; })
      .catch((err: unknown) => {
        status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  return form;
}
