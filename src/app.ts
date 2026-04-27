import {
  isComponentDocument,
  isFormDocument,
  isLayout,
  isSelectDocument,
  isSelectOption,
  type Component,
  type ComponentDocument,
  type FormDocument,
  type Layout,
  type PlacedComponent,
  type SelectDocument,
  type SelectOption,
  type SelectSource,
} from './layout';
import { createStore, type ComponentState } from './store';
import { renderComponent } from './render';
import { renderForm } from './renderForm';

const store = createStore();
const domMap = new Map<string, HTMLElement>();

const root = document.createElement('div');
document.body.appendChild(root);

type ResolvedComponent = {
  component: PlacedComponent;
  document: ComponentDocument | null;
};

const isComponentRef = (component: Component): component is Extract<Component, { src: string }> =>
  'src' in component;

const applyPlacement = (el: HTMLElement, component: PlacedComponent): void => {
  el.style.gridColumn = `${component.placement.x} / span ${component.placement.width}`;
  el.style.gridRow = `${component.placement.y} / span ${component.placement.height}`;
  el.style.minWidth = '0';
  el.style.minHeight = '0';
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

const getComponentSelection = (componentId: string): string | null => {
  const state = store.components.get(componentId);
  if (!state) return null;
  return typeof state.selectedValue === 'string' ? state.selectedValue : null;
};

const setComponentSelection = (componentId: string, value: string): void => {
  const current = store.components.get(componentId) ?? {};
  store.components.set(componentId, { ...current, selectedValue: value });
};

const resolveTemplate = (value: string): string | null => {
  let missing = false;
  const resolved = value.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const selected = getComponentSelection(key);
    if (selected === null) {
      missing = true;
      return '';
    }
    return selected;
  });

  return missing ? null : resolved;
};

const getAtPath = (value: unknown, path?: string): unknown => {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    if (Array.isArray(acc)) {
      const index = Number.parseInt(key, 10);
      return Number.isNaN(index) ? undefined : acc[index];
    }
    return (acc as Record<string, unknown>)[key];
  }, value);
};

const normalizeOption = (value: unknown, source: SelectSource): SelectOption | null => {
  if (typeof value === 'string') {
    return { value, label: value };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const rawValue = candidate[typeof source.valueKey === 'string' ? source.valueKey : 'value'];
  if (typeof rawValue !== 'string') {
    return null;
  }

  const rawLabel = candidate[typeof source.labelKey === 'string' ? source.labelKey : 'label'];
  return {
    value: rawValue,
    label: typeof rawLabel === 'string' ? rawLabel : rawValue,
  };
};

const fetchSelectOptions = async (source: SelectSource): Promise<SelectOption[]> => {
  const url = resolveTemplate(source.url);
  if (!url) return [];

  const response = await fetch(url, {
    headers: isStringRecord(source.headers) ? source.headers : undefined,
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as unknown;
  const items = getAtPath(payload, source.itemsPath);
  const values = Array.isArray(items) ? items : Array.isArray(payload) ? payload : [];
  return values
    .map((entry) => normalizeOption(entry, source))
    .filter((entry): entry is SelectOption => entry !== null && isSelectOption(entry));
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

const fetchLayoutIds = async (): Promise<string[]> => {
  const response = await fetch('/api/layouts/json-files');
  if (!response.ok) return [];

  const value = (await response.json()) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];

  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  return items
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      const value = (entry as Record<string, unknown>).value;
      return typeof value === 'string' ? value : null;
    })
    .filter((entry): entry is string => entry !== null);
};

const isEditorShellLayout = (layout: Layout): boolean =>
  layout.components.some((component) => 'src' in component && component.id === 'layout-select');

const findEditorLayoutId = async (): Promise<string | null> => {
  const layoutIds = await fetchLayoutIds();
  for (const layoutId of layoutIds) {
    const response = await fetch(`/api/layouts/${layoutId}`);
    if (!response.ok) continue;

    const value = (await response.json()) as unknown;
    if (isLayout(value) && isEditorShellLayout(value)) {
      return layoutId;
    }
  }

  return layoutIds[0] ?? null;
};

const renderLayout = async (layoutId: string): Promise<ResolvedComponent[] | null> => {
  const response = await fetch(`/api/layouts/${layoutId}`);
  if (!response.ok) return null;

  const value = (await response.json()) as unknown;
  if (!isLayout(value)) return null;

  store.layout = value;
  store.componentDocuments.clear();
  domMap.clear();

  root.innerHTML = '';
  document.title = store.layout.head.title;
  for (const { name, content } of store.layout.head.meta) {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  }

  Object.assign(root.style, store.layout.shell);
  const canvas = document.createElement('div');
  canvas.style.display = 'grid';
  canvas.style.width = '100%';
  canvas.style.boxSizing = 'border-box';
  canvas.style.gridTemplateColumns = `repeat(${store.layout.grid.columns}, minmax(0, 1fr))`;
  canvas.style.gridAutoRows = 'auto';
  canvas.style.alignItems = 'stretch';
  root.appendChild(canvas);

  const resolvedComponents = await Promise.all(
    store.layout.components.map(async (component) => {
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
    applyPlacement(el, component);
    canvas.appendChild(el);
    domMap.set(component.id, el);
  }

  return resolvedComponents;
};

const updateEditorForm = async (
  layoutId: string,
  formComponent: Component,
  formDocument: FormDocument,
  selectedKey: string,
): Promise<void> => {
  const host = domMap.get(formComponent.id);
  if (!host) return;

  if (!selectedKey) {
    host.replaceChildren();
    return;
  }

  const selectedVariant = await fetchComponentDocument(layoutId, selectedKey);
  if (!selectedVariant) {
    host.replaceChildren();
    return;
  }

  const form = renderForm(
    selectedVariant as Record<string, unknown>,
    async (draft) => {
      await fetch(`/api/layouts/${layoutId}/components/${selectedKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    },
    { excludeKeys: formDocument.excludeKeys ?? ['kind'] },
  );

  host.replaceWith(form);
  domMap.set(formComponent.id, form);
};

const hydrateEditorSelect = async (
  layoutId: string,
  selectComponent: Component,
  selectDocument: SelectDocument,
): Promise<string> => {
  const selectEl = domMap.get(selectComponent.id);
  if (!(selectEl instanceof HTMLSelectElement)) {
    return '';
  }

  selectEl.disabled = true;
  const options = await fetchSelectOptions(selectDocument.source);
  selectEl.innerHTML = '';

  if (options.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No options';
    selectEl.appendChild(empty);
  } else {
    for (const optionValue of options) {
      const option = document.createElement('option');
      option.value = optionValue.value;
      option.textContent = optionValue.label;
      selectEl.appendChild(option);
    }
  }

  const storedSelection = getComponentSelection(selectComponent.id);
  const selectedKey =
    options.find((option) => option.value === storedSelection)?.value ??
    options[0]?.value ??
    '';

  selectEl.value = selectedKey;
  if (selectedKey !== storedSelection) {
    setComponentSelection(selectComponent.id, selectedKey);
  }
  selectEl.disabled = false;

  return selectedKey;
};

const hydrateEditor = async (layoutId: string, resolvedComponents: ResolvedComponent[]): Promise<void> => {
  if (!store.layout) {
    return;
  }

  const componentById = new Map(store.layout.components.map((component) => [component.id, component]));
  const documentsById = new Map(
    resolvedComponents.map((entry) => [entry.component.id, entry.document] as const),
  );
  const formComponents = resolvedComponents
    .filter((entry): entry is ResolvedComponent & { document: FormDocument } =>
      entry.document !== null && isFormDocument(entry.document),
    )
    .map((entry) => ({
      component: entry.component,
      document: entry.document,
    }));

  const formBySource = new Map<string, { component: Component; document: FormDocument }>();
  for (const entry of formComponents) {
    if (entry.document.sourceComponentId) {
      formBySource.set(entry.document.sourceComponentId, entry);
    }
  }

  const selectComponents = resolvedComponents
    .filter((entry): entry is ResolvedComponent & { document: SelectDocument } =>
      entry.document !== null && isSelectDocument(entry.document),
    )
    .map((entry) => ({
      component: entry.component,
      document: entry.document,
    }));

  for (const entry of selectComponents) {
    const selectComponent = entry.component;
    const selectDocument = entry.document;

    const selectedKey = await hydrateEditorSelect(layoutId, selectComponent, selectDocument);
    const targetComponentId = selectDocument.targetComponentId ?? formBySource.get(selectComponent.id)?.component.id;
    if (targetComponentId) {
      const targetComponent = componentById.get(targetComponentId);
      const targetDocument = documentsById.get(targetComponentId);
      if (targetComponent && targetDocument && isFormDocument(targetDocument)) {
        if (!targetDocument.sourceComponentId || targetDocument.sourceComponentId === selectComponent.id) {
          await updateEditorForm(layoutId, targetComponent, targetDocument, selectedKey);
        }
      }
    }

    const selectEl = domMap.get(selectComponent.id);
    if (selectEl instanceof HTMLSelectElement) {
      selectEl.onchange = () => {
        void (async () => {
          const nextSelectedKey = selectEl.value;
          setComponentSelection(selectComponent.id, nextSelectedKey);
          await hydrateEditor(layoutId, resolvedComponents);
        })();
      };
    }
  }
};

export const rerender = (id: string): void => {
  const component = store.layout?.components.find((c) => c.id === id);
  if (!component) return;
  const oldEl = domMap.get(id);
  if (!oldEl) return;
  const state: ComponentState = store.components.get(id) ?? {};
  const newEl = renderComponent(component, state, store.componentDocuments.get(id) ?? null);
  applyPlacement(newEl, component);
  oldEl.replaceWith(newEl);
  domMap.set(id, newEl);
};

const loadViewer = async (layoutId: string): Promise<void> => {
  await renderLayout(layoutId);
};

const loadEditor = async (layoutId: string): Promise<void> => {
  const resolvedComponents = await renderLayout(layoutId);
  if (!resolvedComponents) return;

  await hydrateEditor(layoutId, resolvedComponents);
};

const loadEditorBootstrap = async (): Promise<void> => {
  const layoutId = await findEditorLayoutId();
  if (!layoutId) {
    root.replaceChildren();
    return;
  }

  await loadEditor(layoutId);
};

const pathname = window.location.pathname;
const editMatch = pathname.match(/^\/edit\/([^/]+)$/);
const viewMatch = pathname.match(/^\/view\/([^/]+)$/);

if (editMatch) {
  void loadEditor(editMatch[1]);
} else if (viewMatch) {
  void loadViewer(viewMatch[1]);
} else {
  void loadEditorBootstrap();
}
