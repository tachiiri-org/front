export { isStyle } from './validator';
export { type ElementComponent, isElementComponent, elementDefaults } from './element';
export { type HeadingComponent, isHeadingComponent, headingDefaults } from './heading';
export { type ButtonComponent, isButtonComponent, buttonDefaults } from './button';
export { type ScreenListComponent, isScreenListComponent } from './screen-list';
export { type GridCanvasComponent, isGridCanvasComponent } from './grid-canvas';
export { type EditorComponent, isEditorComponent } from './editor';
export {
  type SelectComponent,
  type SelectOption,
  type SelectSource,
  type SelectEndpointSource,
  isSelectComponent,
  isSelectOption,
  isSelectSource,
  selectDefaults,
} from './select';
export { type FormComponent, isFormComponent, formDefaults } from './form';
export { type GridComponent, isGridComponent, gridDefaults } from './grid';
export {
  type FieldComponent,
  type TextFieldComponent,
  type NumberFieldComponent,
  type TextareaComponent,
  type StyleMapFieldComponent,
  type ObjectListFieldComponent,
  type FieldGroupComponent,
  isFieldComponent,
  isTextFieldComponent,
  isNumberFieldComponent,
  isTextareaComponent,
  isStyleMapFieldComponent,
  isObjectListFieldComponent,
  isFieldGroupComponent,
} from './fields';

import type { ElementComponent } from './element';
import type { HeadingComponent } from './heading';
import type { ButtonComponent } from './button';
import type { ScreenListComponent } from './screen-list';
import type { GridCanvasComponent } from './grid-canvas';
import type { EditorComponent } from './editor';
import type { SelectComponent } from './select';
import type { FormComponent } from './form';
import type { GridComponent } from './grid';
import type {
  TextFieldComponent,
  NumberFieldComponent,
  TextareaComponent,
  StyleMapFieldComponent,
  ObjectListFieldComponent,
  FieldGroupComponent,
} from './fields';
import { isElementComponent, elementDefaults } from './element';
import { isHeadingComponent, headingDefaults } from './heading';
import { isButtonComponent, buttonDefaults } from './button';
import { isScreenListComponent } from './screen-list';
import { isGridCanvasComponent } from './grid-canvas';
import { isEditorComponent } from './editor';
import { isSelectComponent, selectDefaults } from './select';
import { isFormComponent, formDefaults } from './form';
import { isGridComponent, gridDefaults } from './grid';
import {
  isTextFieldComponent,
  isNumberFieldComponent,
  isTextareaComponent,
  isStyleMapFieldComponent,
  isObjectListFieldComponent,
  isFieldGroupComponent,
} from './fields';

export type Component =
  | ElementComponent
  | HeadingComponent
  | ButtonComponent
  | ScreenListComponent
  | GridCanvasComponent
  | EditorComponent
  | SelectComponent
  | FormComponent
  | GridComponent
  | TextFieldComponent
  | NumberFieldComponent
  | TextareaComponent
  | StyleMapFieldComponent
  | ObjectListFieldComponent
  | FieldGroupComponent;

export const isComponent = (value: unknown): value is Component =>
  isElementComponent(value) ||
  isHeadingComponent(value) ||
  isButtonComponent(value) ||
  isScreenListComponent(value) ||
  isGridCanvasComponent(value) ||
  isEditorComponent(value) ||
  isSelectComponent(value) ||
  isFormComponent(value) ||
  isGridComponent(value) ||
  isTextFieldComponent(value) ||
  isNumberFieldComponent(value) ||
  isTextareaComponent(value) ||
  isStyleMapFieldComponent(value) ||
  isObjectListFieldComponent(value) ||
  isFieldGroupComponent(value);

export const componentDefaults: Record<string, Record<string, unknown>> = {
  element: elementDefaults as Record<string, unknown>,
  heading: headingDefaults as Record<string, unknown>,
  button: buttonDefaults as Record<string, unknown>,
  form: formDefaults as Record<string, unknown>,
  select: selectDefaults as Record<string, unknown>,
  grid: gridDefaults as Record<string, unknown>,
};

export const COMPONENT_KINDS = Object.keys(componentDefaults);
