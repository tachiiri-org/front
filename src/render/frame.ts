import {
  type ScreenListComponent,
  type GridCanvasComponent,
  type EditorComponent,
} from '../component';

export const renderScreenList = (id: string, component: ScreenListComponent): HTMLElement => {
  const ul = document.createElement('ul');
  ul.dataset.frameId = id;
  if (component.style) Object.assign(ul.style, component.style);
  return ul;
};

export const renderGridCanvas = (id: string, component: GridCanvasComponent): HTMLElement => {
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
