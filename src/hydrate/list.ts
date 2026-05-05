import type { ListFrame } from '../screen';
import { domMap, getFrameSelection, setFrameSelection, isEditableTarget } from '../state';

const fetchItems = async (src: string): Promise<string[]> => {
  const response = await fetch(src);
  if (!response.ok) return [];
  const value = (await response.json()) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      const v = (entry as Record<string, unknown>).value;
      return typeof v === 'string' ? v : null;
    })
    .filter((entry): entry is string => entry !== null);
};

export const renderListPreview = async (
  wrapper: HTMLElement,
  frame: ListFrame,
): Promise<void> => {
  if (!frame.src) { wrapper.replaceChildren(); return; }
  const items = await fetchItems(frame.src);
  const ul = document.createElement('ul');
  if (frame.style) Object.assign(ul.style, frame.style);
  for (const id of items) {
    const li = document.createElement('li');
    li.textContent = id;
    if (frame.itemStyle) Object.assign(li.style, frame.itemStyle);
    ul.appendChild(li);
  }
  wrapper.replaceChildren(ul);
};

let listInteractionController: AbortController | null = null;

export const hydrateList = async (
  listFrame: ListFrame,
  onItemSelect: (itemId: string) => Promise<void>,
  onReload: () => void,
  isBlocked?: () => boolean,
): Promise<void> => {
  const listEl = domMap.get(listFrame.id);
  if (!listEl) return;

  if (!listFrame.src) { listEl.replaceChildren(); return; }

  const items = await fetchItems(listFrame.src);
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
        const res = await fetch(`/api/layouts/${encodeURIComponent(currentId)}/rename`, {
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
