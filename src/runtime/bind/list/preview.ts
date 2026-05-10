import type { ListFrame } from '../../../schema/screen/screen';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../../../schema/component/style';
import { fetchItems } from './fetch';
import { RESOURCES } from './resources';

export const renderListPreview = async (
  wrapper: HTMLElement,
  frame: ListFrame,
): Promise<void> => {
  const resource = RESOURCES[frame.resource ?? ''];
  if (!resource) { wrapper.replaceChildren(); return; }
  const items = await fetchItems(resource.listUrl);
  const ul = document.createElement('ul');
  for (const specKey of STYLE_SPEC_KEYS) {
    const v = (frame as Record<string, unknown>)[specKey];
    if (isStyleRecord(v)) Object.assign(ul.style, v);
  }
  for (const id of items) {
    const li = document.createElement('li');
    li.textContent = id;
    if (isStyleRecord(frame.itemStyle)) Object.assign(li.style, frame.itemStyle);
    ul.appendChild(li);
  }
  wrapper.replaceChildren(ul);
};
