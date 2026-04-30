import type { ScreenListFrame } from '../screen';
import { domMap, getFrameSelection, setFrameSelection, isEditableTarget } from '../state';
import { fetchScreenIds } from '../api';

export const renderScreenListPreview = async (
  wrapper: HTMLElement,
  frame: ScreenListFrame,
): Promise<void> => {
  const screenIds = await fetchScreenIds();
  const ul = document.createElement('ul');
  if (frame.style) Object.assign(ul.style, frame.style);
  for (const id of screenIds) {
    const li = document.createElement('li');
    li.textContent = id;
    if (frame.itemStyle) Object.assign(li.style, frame.itemStyle);
    ul.appendChild(li);
  }
  wrapper.replaceChildren(ul);
};

let screenListInteractionController: AbortController | null = null;

export const hydrateScreenList = async (
  screenListFrame: ScreenListFrame,
  onScreenSelect: (screenId: string) => Promise<void>,
  onReload: () => void,
  isBlocked?: () => boolean,
): Promise<void> => {
  const listEl = domMap.get(screenListFrame.id);
  if (!listEl) return;

  const screenIds = await fetchScreenIds();
  listEl.replaceChildren();

  const currentSelection = getFrameSelection(screenListFrame.id);

  for (const screenId of screenIds) {
    const item = document.createElement('li');
    item.textContent = screenId;
    if (screenListFrame.itemStyle) Object.assign(item.style, screenListFrame.itemStyle);
    if (screenId === currentSelection) item.style.fontWeight = 'bold';

    item.addEventListener('click', () => {
      for (const child of listEl.children) {
        (child as HTMLElement).style.fontWeight = '';
      }
      item.style.fontWeight = 'bold';
      setFrameSelection(screenListFrame.id, screenId);
      void onScreenSelect(screenId);
    });

    listEl.appendChild(item);
  }

  screenListInteractionController?.abort();
  screenListInteractionController = new AbortController();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (isBlocked?.()) return;

    const currentId = getFrameSelection(screenListFrame.id);

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
        setFrameSelection(screenListFrame.id, newName);
        await hydrateScreenList(screenListFrame, onScreenSelect, onReload, isBlocked);
        void onScreenSelect(newName);
      })();
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    const idx = screenIds.indexOf(currentId ?? '');
    const newIdx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(screenIds.length - 1, idx + 1);
    const newId = screenIds[newIdx];
    if (!newId || newId === currentId) return;

    e.preventDefault();

    for (const child of listEl.children) {
      (child as HTMLElement).style.fontWeight = '';
    }
    const newItem = listEl.children[newIdx] as HTMLElement | undefined;
    if (newItem) newItem.style.fontWeight = 'bold';

    setFrameSelection(screenListFrame.id, newId);
    void onScreenSelect(newId);
  }, { signal: screenListInteractionController.signal });
};
