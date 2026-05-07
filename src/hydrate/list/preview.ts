import type { ListFrame } from '../../screen';
import { fetchItems } from './fetch';

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
