export const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');
export { type ElementComponent, isElementComponent, elementDefaults, elementSchema } from './kind/element';
export { type HeadingComponent, isHeadingComponent, headingDefaults, headingSchema } from './kind/heading';
export { type ButtonComponent, isButtonComponent, buttonDefaults, buttonSchema } from './kind/button';
export { type ListComponent, isListComponent, listDefaults, listSchema } from './kind/list';
export { type CanvasComponent, isCanvasComponent, canvasDefaults, canvasSchema } from './kind/canvas';
export {
  type SelectComponent,
  type SelectOption,
  type SelectSource,
  type SelectEndpointSource,
  isSelectComponent,
  isSelectOption,
  isSelectSource,
  selectDefaults,
  selectSchema,
} from './kind/select';
export { type FormComponent, isFormComponent, formDefaults, formSchema } from './kind/form';
export { type TextareaComponent, isTextareaComponent, textareaDefaults, textareaSchema } from './kind/textarea';
export { type FormField, isFormField } from './kind/form/field';
export type { EditorComponent, EditorSection, FieldStyleConfig } from '../../editor/component-editor';
export { isEditorComponent, editorDefaults, editorSchema } from '../../editor/component-editor';

import type { ElementComponent } from './kind/element';
import type { HeadingComponent } from './kind/heading';
import type { ButtonComponent } from './kind/button';
import type { ListComponent } from './kind/list';
import type { CanvasComponent } from './kind/canvas';
import type { SelectComponent } from './kind/select';
import type { FormComponent } from './kind/form';
import type { TextareaComponent } from './kind/textarea';
import { isElementComponent, elementDefaults, elementSchema } from './kind/element';
import { isHeadingComponent, headingDefaults, headingSchema } from './kind/heading';
import { isButtonComponent, buttonDefaults, buttonSchema } from './kind/button';
import { isListComponent, listDefaults, listSchema } from './kind/list';
import { isCanvasComponent, canvasDefaults, canvasSchema } from './kind/canvas';
import { isSelectComponent, selectDefaults, selectSchema } from './kind/select';
import { isFormComponent, formDefaults, formSchema } from './kind/form';
import { isTextareaComponent, textareaDefaults, textareaSchema } from './kind/textarea';
import type { FormField } from './kind/form/field';

export type Component =
  | ElementComponent
  | HeadingComponent
  | ButtonComponent
  | ListComponent
  | CanvasComponent
  | SelectComponent
  | FormComponent
  | TextareaComponent;

export const isComponent = (value: unknown): value is Component =>
  isElementComponent(value) ||
  isHeadingComponent(value) ||
  isButtonComponent(value) ||
  isListComponent(value) ||
  isCanvasComponent(value) ||
  isSelectComponent(value) ||
  isFormComponent(value) ||
  isTextareaComponent(value);

export const componentDefaults: Record<string, Record<string, unknown>> = {
  element: elementDefaults as Record<string, unknown>,
  heading: headingDefaults as Record<string, unknown>,
  button: buttonDefaults as Record<string, unknown>,
  form: formDefaults as Record<string, unknown>,
  select: selectDefaults as Record<string, unknown>,
  canvas: canvasDefaults as Record<string, unknown>,
  list: listDefaults as Record<string, unknown>,
  textarea: textareaDefaults as Record<string, unknown>,
};

export const componentSchemas: Record<string, FormField[]> = {
  element: elementSchema,
  heading: headingSchema,
  button: buttonSchema,
  form: formSchema,
  select: selectSchema,
  canvas: canvasSchema,
  list: listSchema,
  textarea: textareaSchema,
};

export const COMPONENT_KINDS = Object.keys(componentDefaults);

const mergeObjects = (
  def: Record<string, unknown>,
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...def };
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && v !== undefined) result[k] = v;
  }
  return result;
};

export const applyDefaults = (
  kind: string,
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const defaults = componentDefaults[kind] ?? {};
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) continue;
    const defVal = defaults[key];
    if (
      typeof val === 'object' && !Array.isArray(val) &&
      typeof defVal === 'object' && defVal !== null && !Array.isArray(defVal)
    ) {
      result[key] = mergeObjects(
        defVal as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
};
