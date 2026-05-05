import type { FieldComponent } from '../component/kind/fields';
import { renderFieldFromSchema, buildFieldStyleContext, type FieldStyleContext } from './field';

function inferField(key: string, value: unknown): FieldComponent {
  if (typeof value === 'boolean') return { kind: 'boolean-field', key };
  if (typeof value === 'number') return { kind: 'number-field', key };
  if (typeof value === 'string') {
    return value.includes('\n') || value.length >= 100
      ? { kind: 'textarea', key }
      : { kind: 'text-field', key };
  }
  if (Array.isArray(value)) {
    const allObjects = value.length > 0 && value.every(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
    );
    if (allObjects) {
      return {
        kind: 'object-list-field',
        key,
        fields: inferFieldsFromData(value[0] as Record<string, unknown>),
      };
    }
    return { kind: 'textarea', key };
  }
  if (typeof value === 'object' && value !== null) {
    return { kind: 'field-group', key, fields: inferFieldsFromData(value as Record<string, unknown>) };
  }
  return { kind: 'textarea', key };
}

export function inferFieldsFromData(data: Record<string, unknown>): FieldComponent[] {
  return Object.entries(data).map(([key, value]) => inferField(key, value));
}

export function mergeWithSchema(
  inferred: FieldComponent[],
  schema: FieldComponent[],
): FieldComponent[] {
  const schemaByKey = new Map<string, FieldComponent>();
  for (const f of schema) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (key) schemaByKey.set(key, f);
  }

  const usedKeys = new Set<string>();
  const result: FieldComponent[] = [];

  for (const f of inferred) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (key && schemaByKey.has(key)) {
      result.push(schemaByKey.get(key)!);
      usedKeys.add(key);
    } else {
      result.push(f);
    }
  }

  for (const f of schema) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (!key || !usedKeys.has(key)) result.push(f);
  }

  return result;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

export function renderFormFromSchema(
  data: Record<string, unknown>,
  fields: FieldComponent[],
  onSave: (draft: unknown) => Promise<void>,
  ctx?: FieldStyleContext,
): HTMLElement {
  const resolvedCtx = ctx ?? buildFieldStyleContext();
  const draft = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const form = mk('form');

  for (const field of fields) {
    form.appendChild(renderFieldFromSchema(field, draft, resolvedCtx));
  }

  const footer = mk('div');
  footer.style.display = 'flex';
  footer.style.alignItems = 'center';
  footer.style.padding = '6px 8px 4px';
  footer.style.gap = '8px';
  const saveBtn = mk('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save';
  saveBtn.style.fontSize = '11px';
  saveBtn.style.padding = '2px 10px';
  saveBtn.style.cursor = 'pointer';
  const status = mk('span');
  status.style.fontSize = '10px';
  status.style.color = 'rgba(0,0,0,0.6)';
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
