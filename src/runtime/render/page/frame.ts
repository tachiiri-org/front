import {
  type ListComponent,
  type CanvasComponent,
  type TableComponent,
} from '../../../schema/component';
import type { EditorComponent } from '../../../editor/component-editor';

export const renderList = (id: string, component: ListComponent): HTMLElement => {
  const ul = document.createElement('ul');
  ul.dataset.frameId = id;
  if (component.style) Object.assign(ul.style, component.style);
  return ul;
};

export const renderCanvas = (id: string, component: CanvasComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  if (component.style) Object.assign(div.style, component.style);
  return div;
};

export const renderEditor = (id: string, component: EditorComponent): HTMLElement => {
  const div = document.createElement('div');
  div.dataset.frameId = id;
  if (component.style) Object.assign(div.style, component.style);
  return div;
};

export const renderTable = (id: string, component: TableComponent): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.overflow = 'auto';
  wrapper.style.boxSizing = 'border-box';
  if (component.padding) wrapper.style.padding = component.padding;
  return wrapper;
};
