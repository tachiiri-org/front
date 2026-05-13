import type { ListFrame } from '../../../schema/screen/screen';
import { domMap, getFrameSelection, setFrameSelection, clearFrameSelection, isEditableTarget } from '../../../state';
import { fetchItems } from './fetch';
import { RESOURCES } from './resources';
import { createScreen, deleteScreen } from '../editor/save';
import { screenDefaults } from '../../../schema/screen/screen';

let listInteractionController: AbortController | null = null;

const actionStyle: Record<string, string> = {
  fontSize: '10px',
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: 'rgba(0,0,0,0.45)',
  padding: '0',
};

const showMutationError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  window.alert(message);
};

const allocateScreenId = (items: string[]): string => {
  let index = 1;
  while (items.includes(`screen-${index}`)) index += 1;
  return `screen-${index}`;
};

const buildItemRow = (
  listEl: HTMLElement,
  listFrame: ListFrame,
  itemId: string,
  currentSelection: string | null,
  onItemSelect: (itemId: string) => Promise<void>,
  onReload: () => void,
): HTMLLIElement => {
  const item = document.createElement('li');
  item.style.display = 'flex';
  item.style.alignItems = 'center';
  item.style.justifyContent = 'space-between';
  item.style.gap = '8px';
  item.style.listStyle = 'none';
  if (listFrame.itemStyle) Object.assign(item.style, listFrame.itemStyle);
  if (itemId === currentSelection) item.style.fontWeight = 'bold';
  item.style.cursor = 'pointer';
  item.addEventListener('click', () => {
    for (const child of listEl.children) {
      (child as HTMLElement).style.fontWeight = '';
    }
    item.style.fontWeight = 'bold';
    setFrameSelection(listFrame.id, itemId);
    void onItemSelect(itemId);
  });

  const label = document.createElement('span');
  label.textContent = itemId;
  label.style.flex = '1';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = '削除';
  Object.assign(deleteBtn.style, actionStyle);
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${itemId}"?`)) return;
    void (async () => {
      try {
        await deleteScreen(itemId);
        if (getFrameSelection(listFrame.id) === itemId) {
          clearFrameSelection(listFrame.id);
        }
        onReload();
      } catch (error) {
        showMutationError(error);
      }
    })();
  });

  const openLink = document.createElement('a');
  openLink.textContent = '開く';
  openLink.href = `/${encodeURIComponent(itemId)}`;
  openLink.target = '_blank';
  openLink.rel = 'noreferrer noopener';
  Object.assign(openLink.style, actionStyle, {
    textDecoration: 'none',
  });
  openLink.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  const actions = document.createElement('span');
  Object.assign(actions.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: '0',
  });
  actions.appendChild(deleteBtn);
  actions.appendChild(openLink);

  item.appendChild(label);
  item.appendChild(actions);
  return item;
};

export const hydrateList = async (
  listFrame: ListFrame,
  onItemSelect: (itemId: string) => Promise<void>,
  onReload: () => void,
  isBlocked?: () => boolean,
): Promise<void> => {
  const listEl = domMap.get(listFrame.id);
  if (!listEl) return;

  const resource = RESOURCES[listFrame.resource ?? ''];
  if (!resource) { listEl.replaceChildren(); return; }

  const items = await fetchItems(resource.listUrl);
  listEl.replaceChildren();

  const currentSelection = getFrameSelection(listFrame.id);

  const header = document.createElement('li');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';
  header.style.padding = '0 0 6px';
  header.style.listStyle = 'none';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '追加';
  Object.assign(addBtn.style, actionStyle);
  addBtn.addEventListener('click', () => {
    const defaultId = allocateScreenId(items);
    const nextId = window.prompt('New screen id', defaultId)?.trim();
    if (!nextId) return;
    if (items.includes(nextId)) {
      window.alert(`"${nextId}" already exists.`);
      return;
    }
    void (async () => {
      try {
        await createScreen(nextId, screenDefaults);
        setFrameSelection(listFrame.id, nextId);
        await hydrateList(listFrame, onItemSelect, onReload, isBlocked);
        void onItemSelect(nextId);
      } catch (error) {
        showMutationError(error);
      }
    })();
  });

  header.appendChild(addBtn);
  listEl.appendChild(header);

  for (const itemId of items) {
    listEl.appendChild(buildItemRow(listEl, listFrame, itemId, currentSelection, onItemSelect, onReload));
  }

  listInteractionController?.abort();
  listInteractionController = new AbortController();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (isBlocked?.()) return;

    const currentId = getFrameSelection(listFrame.id);

    if (e.key === 'F2') {
      if (!currentId) return;
      e.preventDefault();
      const newName = window.prompt('Rename', currentId);
      if (!newName || newName === currentId) return;
      void (async () => {
        const res = await fetch(`${resource.itemBaseUrl}/${encodeURIComponent(currentId)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: newName }),
        });
        if (!res.ok) return;
        setFrameSelection(listFrame.id, newName);
        await hydrateList(listFrame, onItemSelect, onReload, isBlocked);
        void onItemSelect(newName);
      })();
      return;
    }

    if (e.key === 'Delete') {
      if (!currentId) return;
      e.preventDefault();
      if (!window.confirm(`Delete "${currentId}"?`)) return;
      void (async () => {
        try {
          await deleteScreen(currentId);
          clearFrameSelection(listFrame.id);
          onReload();
        } catch (error) {
          showMutationError(error);
        }
      })();
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    const idx = items.indexOf(currentId ?? '');
    const newIdx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(items.length - 1, idx + 1);
    const newId = items[newIdx];
    if (!newId || newId === currentId) return;

    e.preventDefault();

    for (const child of listEl.children) {
      (child as HTMLElement).style.fontWeight = '';
    }
    const newItem = listEl.children[newIdx] as HTMLElement | undefined;
    if (newItem) newItem.style.fontWeight = 'bold';

    setFrameSelection(listFrame.id, newId);
    void onItemSelect(newId);
  }, { signal: listInteractionController.signal });
};
