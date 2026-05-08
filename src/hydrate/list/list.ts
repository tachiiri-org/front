import type { ListFrame } from '../../screen';
import { domMap, getFrameSelection, setFrameSelection, clearFrameSelection, isEditableTarget } from '../../state';
import { fetchItems } from './fetch';
import { RESOURCES } from './resources';

let listInteractionController: AbortController | null = null;

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

  for (const itemId of items) {
    const item = document.createElement('li');
    item.textContent = itemId;
    if (listFrame.itemStyle) Object.assign(item.style, listFrame.itemStyle);
    if (itemId === currentSelection) item.style.fontWeight = 'bold';

    item.addEventListener('click', () => {
      for (const child of listEl.children) {
        (child as HTMLElement).style.fontWeight = '';
      }
      item.style.fontWeight = 'bold';
      setFrameSelection(listFrame.id, itemId);
      void onItemSelect(itemId);
    });

    listEl.appendChild(item);
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
        const res = await fetch(`${resource.itemBaseUrl}/${encodeURIComponent(currentId)}`, {
          method: 'DELETE',
        });
        if (!res.ok) return;
        clearFrameSelection(listFrame.id);
        onReload();
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
