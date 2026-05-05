import {
  type ListComponent,
  type CanvasComponent,
  type EditorComponent,
} from '../component';

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
