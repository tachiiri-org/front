export { isStyle } from './validator';
export { type ElementComponent, isElementComponent, elementDefaults } from './kind/element';
export { type HeadingComponent, isHeadingComponent, headingDefaults } from './kind/heading';
export { type ButtonComponent, isButtonComponent, buttonDefaults } from './kind/button';
export { type ScreenListComponent, isScreenListComponent, screenListDefaults } from './kind/screen-list';
export { type GridCanvasComponent, isGridCanvasComponent, gridCanvasDefaults } from './kind/grid-canvas';
export { type EditorComponent, isEditorComponent, editorDefaults } from './kind/editor';
export {
  type SelectComponent,
  type SelectOption,
  type SelectSource,
  type SelectEndpointSource,
  isSelectComponent,
  isSelectOption,
  isSelectSource,
  selectDefaults,
} from './kind/select';
export { type FormComponent, isFormComponent, formDefaults } from './kind/form';
export { type GridComponent, isGridComponent, gridDefaults } from './kind/grid';
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
  textFieldDefaults,
} from './kind/fields';

import type { ElementComponent } from './kind/element';
import type { HeadingComponent } from './kind/heading';
import type { ButtonComponent } from './kind/button';
import type { ScreenListComponent } from './kind/screen-list';
import type { GridCanvasComponent } from './kind/grid-canvas';
import type { EditorComponent } from './kind/editor';
import type { SelectComponent } from './kind/select';
import type { FormComponent } from './kind/form';
import type { GridComponent } from './kind/grid';
import type {
  TextFieldComponent,
  NumberFieldComponent,
  TextareaComponent,
  StyleMapFieldComponent,
  ObjectListFieldComponent,
  FieldGroupComponent,
} from './kind/fields';
import { isElementComponent, elementDefaults } from './kind/element';
import { isHeadingComponent, headingDefaults } from './kind/heading';
import { isButtonComponent, buttonDefaults } from './kind/button';
import { isScreenListComponent, screenListDefaults } from './kind/screen-list';
import { isGridCanvasComponent, gridCanvasDefaults } from './kind/grid-canvas';
import { isEditorComponent, editorDefaults } from './kind/editor';
import { isSelectComponent, selectDefaults } from './kind/select';
import { isFormComponent, formDefaults } from './kind/form';
import { isGridComponent, gridDefaults } from './kind/grid';
import {
  isTextFieldComponent,
  isNumberFieldComponent,
  isTextareaComponent,
  isStyleMapFieldComponent,
  isObjectListFieldComponent,
  isFieldGroupComponent,
  textFieldDefaults,
} from './kind/fields';

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
  'component-editor': editorDefaults as Record<string, unknown>,
  'grid-canvas': gridCanvasDefaults as Record<string, unknown>,
  'screen-list': screenListDefaults as Record<string, unknown>,
  'text-field': textFieldDefaults as Record<string, unknown>,
};

export const COMPONENT_KINDS = Object.keys(componentDefaults);
