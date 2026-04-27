import type { Component, ComponentDocument, InlineComponent } from './layout';
import type { ComponentState } from './store';

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

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
    return button;
  }

  if (documentValue.kind === 'form') {
    const form = document.createElement('form');
    form.dataset.componentId = component.id;
    const heading = document.createElement('p');
    heading.textContent = typeof documentValue.title === 'string' ? documentValue.title : 'Form';
    form.appendChild(heading);
    return form;
  }

  if (documentValue.kind === 'select') {
    const select = document.createElement('select');
    select.dataset.componentId = component.id;
    const options = Array.isArray(documentValue.options) ? documentValue.options : [];
    for (const optionValue of options) {
      if (typeof optionValue !== 'object' || optionValue === null || Array.isArray(optionValue)) continue;
      const optionRecord = optionValue as Record<string, unknown>;
      const option = document.createElement('option');
      if (typeof optionRecord.value === 'string') option.value = optionRecord.value;
      if (typeof optionRecord.label === 'string') option.textContent = optionRecord.label;
      select.appendChild(option);
    }
    if (typeof documentValue.selected === 'string') {
      select.value = documentValue.selected;
    }
    return select;
  }

  const pre = document.createElement('pre');
  pre.dataset.componentId = component.id;
  pre.textContent = JSON.stringify(documentValue, null, 2);
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
