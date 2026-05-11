import type { ListFrame } from '../../../schema/screen/screen';
import { ALL_CSS_PROP_KEYS, isStyleRecord } from '../../../schema/component/style';
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
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = (frame as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (ul.style as unknown as Record<string, string>)[propKey] = v;
  }
  for (const id of items) {
    const li = document.createElement('li');
    li.textContent = id;
    if (isStyleRecord(frame.itemStyle)) Object.assign(li.style, frame.itemStyle);
    ul.appendChild(li);
  }
  wrapper.replaceChildren(ul);
};
