import type { FieldComponent } from '../component/fields';
import { renderFieldFromSchema } from './field';

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

export function renderFormFromSchema(
  data: Record<string, unknown>,
  fields: FieldComponent[],
  onSave: (draft: unknown) => Promise<void>,
): HTMLElement {
  const draft = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const form = mk('form');

  for (const field of fields) {
    form.appendChild(renderFieldFromSchema(field, draft));
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
