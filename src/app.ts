import { isComponentDocument, isLayout, type Component, type ComponentDocument, type Layout } from './layout';
import { createStore, type ComponentState } from './store';
import { renderComponent } from './render';
import { renderForm } from './renderForm';

const store = createStore();
const domMap = new Map<string, HTMLElement>();

const root = document.createElement('div');
document.body.appendChild(root);

const EDITOR_SHELL_COMPONENTS = [
  { id: 'editor-picker', kind: 'select', src: 'editor/picker' },
] as const;

type SelectOption = {
  value: string;
  label: string;
};

type EditorDocument = ComponentDocument & {
  selected: string;
  options: SelectOption[];
  variants: Record<string, ComponentDocument>;
};

const isComponentRef = (component: Component): component is Extract<Component, { src: string }> =>
  'src' in component;

const isSelectOption = (value: unknown): value is SelectOption => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SelectOption>;
  return typeof candidate.value === 'string' && typeof candidate.label === 'string';
};

const isEditorDocument = (value: unknown): value is EditorDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'select' &&
    typeof candidate.selected === 'string' &&
    Array.isArray(candidate.options) &&
    candidate.options.every(isSelectOption) &&
    typeof candidate.variants === 'object' &&
    candidate.variants !== null &&
    !Array.isArray(candidate.variants)
  );
};

const getSelectedVariantKey = (editorDocument: EditorDocument): string => {
  if (editorDocument.selected in editorDocument.variants) {
    return editorDocument.selected;
  }

  const [firstKey] = Object.keys(editorDocument.variants);
  return firstKey ?? editorDocument.selected;
};

const getSelectedVariant = (editorDocument: EditorDocument): ComponentDocument | null => {
  const key = getSelectedVariantKey(editorDocument);
  const variant = editorDocument.variants[key];
  return variant && isComponentDocument(variant) ? variant : null;
};

const persistEditorDocument = async (layoutId: string, editorDocument: EditorDocument): Promise<void> => {
  const res = await fetch(`/api/layouts/${layoutId}/components/editor/picker`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(editorDocument),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

const loadEditorDocument = async (layoutId: string): Promise<EditorDocument> => {
  const response = await fetch(`/api/layouts/${layoutId}/components/editor/picker`);
  const value = response.ok ? (await response.json()) as unknown : null;
  if (isEditorDocument(value)) {
    return value;
  }

  return {
    kind: 'select',
    selected: 'editor-form',
    options: [
      { value: 'editor-heading', label: 'Components' },
      { value: 'editor-form', label: 'Sample Form' },
    ],
    variants: {
      'editor-heading': {
        kind: 'heading',
        level: 1,
        text: 'Components',
      },
      'editor-form': {
        kind: 'form',
        title: 'Sample Form',
      },
    },
  };
};

const fetchComponentDocument = async (
  layoutId: string,
  componentSrc: string,
): Promise<ComponentDocument | null> => {
  const response = await fetch(`/api/layouts/${layoutId}/components/${componentSrc}`);
  if (!response.ok) return null;

  const value = (await response.json()) as unknown;
  return isComponentDocument(value) ? value : null;
};

export const rerender = (id: string): void => {
  const component = store.layout?.components.find((c) => c.id === id);
  if (!component) return;
  const oldEl = domMap.get(id);
  if (!oldEl) return;
  const state: ComponentState = store.components.get(id) ?? {};
  const newEl = renderComponent(component, state, store.componentDocuments.get(id) ?? null);
  oldEl.replaceWith(newEl);
  domMap.set(id, newEl);
};

const loadViewer = async (layoutId: string): Promise<void> => {
  const response = await fetch(`/api/layouts/${layoutId}`);
  if (!response.ok) return;
  const value = (await response.json()) as unknown;
  if (!isLayout(value)) return;
  store.layout = value;
  store.componentDocuments.clear();

  root.innerHTML = '';
  document.title = store.layout.head.title;
  for (const { name, content } of store.layout.head.meta) {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  }

  Object.assign(root.style, store.layout.shell);
  const currentLayout = store.layout;
  const resolvedComponents = await Promise.all(
    currentLayout.components.map(async (component) => {
      if (!isComponentRef(component)) {
        return { component, document: null };
      }

      const documentValue = await fetchComponentDocument(layoutId, component.src);
      if (documentValue) {
        store.componentDocuments.set(component.id, documentValue);
      }

      return { component, document: documentValue };
    }),
  );

  for (const component of store.layout.components) {
    const state: ComponentState = store.components.get(component.id) ?? {};
    const resolved = resolvedComponents.find((entry) => entry.component.id === component.id)?.document ?? null;
    const el = renderComponent(component, state, resolved);
    root.appendChild(el);
    domMap.set(component.id, el);
  }
};

const loadEditor = async (layoutId: string): Promise<void> => {
  root.innerHTML = '';
  const editorDocument = await loadEditorDocument(layoutId);
  const shellHost = document.createElement('section');
  const selector = renderComponent(EDITOR_SHELL_COMPONENTS[0], {}, editorDocument);
  shellHost.appendChild(selector);

  const previewHost = document.createElement('section');
  const formHost = document.createElement('section');
  root.appendChild(shellHost);
  root.appendChild(previewHost);
  root.appendChild(formHost);

  let currentEditorDocument = editorDocument;

  const renderSelectedComponent = async (): Promise<void> => {
    const selectedKey = getSelectedVariantKey(currentEditorDocument);
    currentEditorDocument.selected = selectedKey;
    previewHost.innerHTML = '';
    formHost.innerHTML = '';
    const selectedVariant = getSelectedVariant(currentEditorDocument);
    if (!selectedVariant) return;

    const syntheticComponent = { id: selectedKey, kind: selectedVariant.kind, src: 'editor/picker' };
    previewHost.appendChild(renderComponent(syntheticComponent, {}, selectedVariant));

    formHost.appendChild(
      renderForm(selectedVariant as Record<string, unknown>, async (draft) => {
        currentEditorDocument = {
          ...currentEditorDocument,
          variants: {
            ...currentEditorDocument.variants,
            [selectedKey]: draft as ComponentDocument,
          },
        };
        await persistEditorDocument(layoutId, currentEditorDocument);
        previewHost.innerHTML = '';
        previewHost.appendChild(renderComponent(syntheticComponent, {}, draft as ComponentDocument));
      }, { excludeKeys: ['kind'] }),
    );
  };

  selector.addEventListener('change', () => {
    void (async () => {
      currentEditorDocument = {
        ...currentEditorDocument,
        selected: (selector as HTMLSelectElement).value,
      };
      await persistEditorDocument(layoutId, currentEditorDocument);
      await renderSelectedComponent();
    })();
  });

  await renderSelectedComponent();
};

const pathname = window.location.pathname;
const editMatch = pathname.match(/^\/edit\/([^/]+)$/);
const viewMatch = pathname.match(/^\/view\/([^/]+)$/);

if (editMatch) {
  void loadEditor(editMatch[1]);
} else if (viewMatch) {
  void loadViewer(viewMatch[1]);
} else {
  void loadEditor('sample');
}
