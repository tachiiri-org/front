import type {
  Component,
  ComponentDocument,
  InlineComponent,
} from './layout';
import type { ComponentState } from './store';

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

const applyPadding = (el: HTMLElement, documentValue: ComponentDocument): void => {
  if (typeof documentValue.padding === 'string') {
    el.style.padding = documentValue.padding;
  }
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const renderInlineComponent = (component: InlineComponent): HTMLElement => {
  const el = document.createElement(component.tag);
  Object.assign(el.style, component.style);
  el.dataset.componentId = component.id;
  if (component.text !== undefined) el.textContent = component.text;
  return el;
};

const renderResolvedDocument = (component: Component, documentValue: ComponentDocument): HTMLElement => {
  if (documentValue.kind === 'heading') {
    const level = typeof documentValue.level === 'number' && documentValue.level >= 1 && documentValue.level <= 6
      ? documentValue.level
      : 1;
    const heading = document.createElement(`h${level}`);
    heading.dataset.componentId = component.id;
    if (typeof documentValue.text === 'string') heading.textContent = documentValue.text;
    applyPadding(heading, documentValue);
    return heading;
  }

  if (
    documentValue.kind === 'element' &&
    typeof documentValue.tag === 'string' &&
    isStringRecord(documentValue.style)
  ) {
    const el = document.createElement(documentValue.tag);
    Object.assign(el.style, documentValue.style);
    el.dataset.componentId = component.id;
    if (typeof documentValue.text === 'string') el.textContent = documentValue.text;
    applyPadding(el, documentValue);
    return el;
  }

  if (documentValue.kind === 'button') {
    const button = document.createElement('button');
    button.dataset.componentId = component.id;
    if (typeof documentValue.text === 'string') {
      button.textContent = documentValue.text;
    } else {
      button.textContent = component.kind;
    }
    applyPadding(button, documentValue);
    return button;
  }

  if (documentValue.kind === 'grid') {
    const rows = isPositiveInteger(documentValue.rows) ? documentValue.rows : 1;
    const columns = isPositiveInteger(documentValue.columns) ? documentValue.columns : 1;
    const grid = document.createElement('div');
    grid.dataset.componentId = component.id;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(48px, auto))`;
    grid.style.boxSizing = 'border-box';
    grid.style.border = '1px solid rgba(0, 0, 0, 0.12)';
    grid.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';

    for (let row = 1; row <= rows; row += 1) {
      for (let column = 1; column <= columns; column += 1) {
        const cell = document.createElement('div');
        cell.dataset.gridCellRow = String(row);
        cell.dataset.gridCellColumn = String(column);
        cell.style.minHeight = '48px';
        cell.style.borderRight = column < columns ? '1px solid rgba(0, 0, 0, 0.08)' : 'none';
        cell.style.borderBottom = row < rows ? '1px solid rgba(0, 0, 0, 0.08)' : 'none';
        grid.appendChild(cell);
      }
    }

    applyPadding(grid, documentValue);
    return grid;
  }

  if (documentValue.kind === 'select') {
    const select = document.createElement('select');
    select.dataset.componentId = component.id;
    if (typeof documentValue.targetComponentId === 'string') {
      select.dataset.targetComponentId = documentValue.targetComponentId;
    }
    applyPadding(select, documentValue);
    return select;
  }

  if (documentValue.kind === 'form') {
    const form = document.createElement('form');
    form.dataset.componentId = component.id;
    if (typeof documentValue.sourceComponentId === 'string') {
      form.dataset.sourceComponentId = documentValue.sourceComponentId;
    }
    if (typeof documentValue.title === 'string' && documentValue.title !== '') {
      const heading = document.createElement('p');
      heading.textContent = documentValue.title;
      form.appendChild(heading);
    }
    applyPadding(form, documentValue);
    return form;
  }

  const pre = document.createElement('pre');
  pre.dataset.componentId = component.id;
  pre.textContent = JSON.stringify(documentValue, null, 2);
  applyPadding(pre, documentValue);
  return pre;
};

export const renderComponent = (
  component: Component,
  _state: ComponentState,
  resolvedDocument?: ComponentDocument | null,
): HTMLElement => {
  if ('src' in component) {
    return resolvedDocument ? renderResolvedDocument(component, resolvedDocument) : renderResolvedDocument(component, { kind: component.kind });
  }

  return renderInlineComponent(component);
};
