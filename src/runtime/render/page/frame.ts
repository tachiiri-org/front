import {
  type ListComponent,
  type CanvasComponent,
  type TableComponent,
  isStyleRecord,
  STYLE_SPEC_KEYS,
} from '../../../schema/component';
import type { EditorComponent } from '../../../editor/component-editor';

const applySpecStyles = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const specKey of STYLE_SPEC_KEYS) {
    const v = c[specKey];
    if (isStyleRecord(v)) Object.assign(el.style, v);
  }
};

export const renderList = (id: string, component: ListComponent): HTMLElement => {
  const ul = document.createElement('ul');
  ul.dataset.frameId = id;
  applySpecStyles(ul, component as unknown as Record<string, unknown>);
  return ul;
};

export const renderCanvas = (id: string, component: CanvasComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  applySpecStyles(div, component as unknown as Record<string, unknown>);
  return div;
};

export const renderEditor = (id: string, component: EditorComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  applySpecStyles(div, component as unknown as Record<string, unknown>);
  return div;
};

export const renderTable = (id: string, component: TableComponent): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.overflow = 'auto';
  wrapper.style.boxSizing = 'border-box';
  return wrapper;
};
