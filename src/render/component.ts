import {
  isElementComponent,
  isScreenListComponent,
  isGridCanvasComponent,
  isEditorComponent,
  type Component,
} from '../component';
import { type Frame, type FrameRef, isFrameRef } from '../screen';
import type { FrameState } from '../store';
import { renderScreenList, renderGridCanvas, renderEditor } from './frame';

const applyPadding = (el: HTMLElement, c: Record<string, unknown>): void => {
  if (typeof c.padding === 'string') el.style.padding = c.padding;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

const renderResolved = (
  id: string,
  component: Component | { kind: string; [key: string]: unknown },
): HTMLElement => {
  const c = component as Record<string, unknown>;

  if (c.kind === 'heading') {
    const level = isPositiveInteger(c.level) && (c.level as number) <= 6 ? (c.level as number) : 1;
    const el = document.createElement(`h${level}` as keyof HTMLElementTagNameMap);
    el.dataset.frameId = id;
    if (typeof c.text === 'string') el.textContent = c.text;
    applyPadding(el, c);
    return el;
  }

  if (c.kind === 'element' && typeof c.tag === 'string' && isStringRecord(c.style)) {
    const el = document.createElement(c.tag as keyof HTMLElementTagNameMap);
    Object.assign(el.style, c.style);
    el.dataset.frameId = id;
    if (typeof c.text === 'string') el.textContent = c.text;
    applyPadding(el, c);
    return el;
  }

  if (c.kind === 'button') {
    const button = document.createElement('button');
    button.dataset.frameId = id;
    button.textContent = typeof c.text === 'string' ? c.text : String(c.kind);
    applyPadding(button, c);
    return button;
  }

  if (c.kind === 'grid') {
    const rows = isPositiveInteger(c.rows) ? (c.rows as number) : 1;
    const columns = isPositiveInteger(c.columns) ? (c.columns as number) : 1;
    const grid = document.createElement('div');
    grid.dataset.frameId = id;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(48px, auto))`;
    grid.style.boxSizing = 'border-box';
    grid.style.border = '1px solid rgba(0, 0, 0, 0.12)';
    grid.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= columns; col += 1) {
        const cell = document.createElement('div');
        cell.dataset.gridCellRow = String(row);
        cell.dataset.gridCellColumn = String(col);
        cell.style.minHeight = '48px';
        cell.style.borderRight = col < columns ? '1px solid rgba(0, 0, 0, 0.08)' : 'none';
        cell.style.borderBottom = row < rows ? '1px solid rgba(0, 0, 0, 0.08)' : 'none';
        grid.appendChild(cell);
      }
    }
    applyPadding(grid, c);
    return grid;
  }

  if (c.kind === 'select') {
    const select = document.createElement('select');
    select.dataset.frameId = id;
    if (typeof c.targetComponentId === 'string') {
      select.dataset.targetComponentId = c.targetComponentId;
    }
    applyPadding(select, c);
    return select;
  }

  if (c.kind === 'text-field') {
    const wrapper = document.createElement('div');
    wrapper.dataset.frameId = id;
    if (typeof c.label === 'string' || typeof c.key === 'string') {
      const lbl = document.createElement('label');
      lbl.textContent = typeof c.label === 'string' ? c.label : String(c.key);
      wrapper.appendChild(lbl);
    }
    const input = document.createElement('input');
    input.type = 'text';
    wrapper.appendChild(input);
    return wrapper;
  }

  if (c.kind === 'number-field') {
    const wrapper = document.createElement('div');
    wrapper.dataset.frameId = id;
    if (typeof c.label === 'string' || typeof c.key === 'string') {
      const lbl = document.createElement('label');
      lbl.textContent = typeof c.label === 'string' ? c.label : String(c.key);
      wrapper.appendChild(lbl);
    }
    const input = document.createElement('input');
    input.type = 'number';
    wrapper.appendChild(input);
    return wrapper;
  }

  if (c.kind === 'textarea') {
    const wrapper = document.createElement('div');
    wrapper.dataset.frameId = id;
    if (typeof c.label === 'string' || typeof c.key === 'string') {
      const lbl = document.createElement('label');
      lbl.textContent = typeof c.label === 'string' ? c.label : String(c.key);
      wrapper.appendChild(lbl);
    }
    const ta = document.createElement('textarea');
    wrapper.appendChild(ta);
    return wrapper;
  }

  if (c.kind === 'style-map-field' || c.kind === 'object-list-field' || c.kind === 'field-group') {
    const div = document.createElement('div');
    div.dataset.frameId = id;
    const lbl = document.createElement('span');
    lbl.textContent = typeof c.label === 'string' ? c.label : String(c.kind);
    lbl.style.fontSize = '11px';
    lbl.style.color = 'rgba(0,0,0,0.4)';
    lbl.style.fontFamily = 'monospace';
    div.appendChild(lbl);
    return div;
  }

  if (c.kind === 'form') {
    const form = document.createElement('form');
    form.dataset.frameId = id;
    if (typeof c.sourceComponentId === 'string') {
      form.dataset.sourceComponentId = c.sourceComponentId;
    }
    if (typeof c.title === 'string' && c.title !== '') {
      const p = document.createElement('p');
      p.textContent = c.title;
      form.appendChild(p);
    }
    applyPadding(form, c);
    return form;
  }

  const pre = document.createElement('pre');
  pre.dataset.frameId = id;
  pre.textContent = JSON.stringify(component, null, 2);
  applyPadding(pre, c);
  return pre;
};

export const renderComponent = (
  frame: Frame,
  _state: FrameState,
  resolvedComponent?: Component | null,
): HTMLElement => {
  const { id } = frame;

  if (isFrameRef(frame)) {
    const fallback: { kind: string; [key: string]: unknown } = { kind: (frame as FrameRef).kind };
    return resolvedComponent ? renderResolved(id, resolvedComponent) : renderResolved(id, fallback);
  }

  if (isScreenListComponent(frame)) return renderScreenList(id, frame);
  if (isGridCanvasComponent(frame)) return renderGridCanvas(id, frame);
  if (isEditorComponent(frame)) return renderEditor(id, frame);
  if (isElementComponent(frame)) {
    const el = document.createElement(frame.tag as keyof HTMLElementTagNameMap);
    Object.assign(el.style, frame.style);
    el.dataset.frameId = id;
    if (frame.text !== undefined) el.textContent = frame.text;
    return el;
  }

  return renderResolved(id, frame as Component);
};
