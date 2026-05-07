import type { FormField } from '../../component/kind/form/field';
import { renderFieldFromSchema, buildFieldStyleContext, type FieldStyleContext } from '../field';

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);

export type RenderFormOptions = {
  saveOnBlur?: boolean;
};

export function renderFormFromSchema(
  data: Record<string, unknown>,
  fields: FormField[],
  onSave: (draft: unknown) => Promise<void>,
  ctx?: FieldStyleContext,
  options: RenderFormOptions = {},
): HTMLElement {
  const resolvedCtx = ctx ?? buildFieldStyleContext();
  const draft = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const form = mk('form');
  const saveOnBlur = options.saveOnBlur ?? false;

  for (const field of fields) {
    form.appendChild(renderFieldFromSchema(field, draft, resolvedCtx, saveOnBlur ? () => {
      void onSave(draft);
    } : undefined));
  }

  if (!saveOnBlur) {
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
  }

  return form;
}
