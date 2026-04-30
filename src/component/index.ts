export { isStyle } from './validator';
export { type ElementComponent, isElementComponent } from './element';
export { type HeadingComponent, isHeadingComponent } from './heading';
export { type ButtonComponent, isButtonComponent } from './button';
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
} from './select';
export { type FormComponent, isFormComponent } from './form';
export { type GridComponent, isGridComponent } from './grid';
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
import { isElementComponent } from './element';
import { isHeadingComponent } from './heading';
import { isButtonComponent } from './button';
import { isScreenListComponent } from './screen-list';
import { isGridCanvasComponent } from './grid-canvas';
import { isEditorComponent } from './editor';
import { isSelectComponent } from './select';
import { isFormComponent } from './form';
import { isGridComponent } from './grid';
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
