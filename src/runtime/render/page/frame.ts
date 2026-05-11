import {
  type ListComponent,
  type CanvasComponent,
  type TableComponent,
  CSS_PROP_KEYS,
} from '../../../schema/component';
import type { EditorComponent } from '../../../editor/component-editor';

const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const propKey of CSS_PROP_KEYS) {
    const v = c[propKey];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[propKey] = v;
  }
};

export const renderList = (id: string, component: ListComponent): HTMLElement => {
  const ul = document.createElement('ul');
  ul.dataset.frameId = id;
  applyCssProps(ul, component as unknown as Record<string, unknown>);
  return ul;
};

export const renderCanvas = (id: string, component: CanvasComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  applyCssProps(div, component as unknown as Record<string, unknown>);
  return div;
};

export const renderEditor = (id: string, component: EditorComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  applyCssProps(div, component as unknown as Record<string, unknown>);
  return div;
};

export const renderTable = (id: string, component: TableComponent): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.overflow = 'auto';
  wrapper.style.boxSizing = 'border-box';
  return wrapper;
};
