import type { ReactNode } from 'react';
import { z } from 'zod';

export type PropField =
  | {
      readonly kind: 'color';
      readonly label: string;
      readonly name: string;
    }
  | {
      readonly kind: 'number';
      readonly label: string;
      readonly max?: number;
      readonly min?: number;
      readonly name: string;
    }
  | {
      readonly kind: 'select';
      readonly label: string;
      readonly name: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: 'text' | 'textarea';
      readonly label: string;
      readonly name: string;
    };

export type ComponentDefinition = {
  readonly allowedChildTypes?: readonly string[];
  readonly allowsChildren: boolean;
  readonly category: string;
  readonly defaultProps: Record<string, unknown>;
  readonly displayNameEn: string;
  readonly displayNameJa: string;
  readonly fields: readonly PropField[];
  readonly primaryTextProp?: string;
  readonly propsSchema: z.ZodType<Record<string, unknown>>;
  readonly render: (props: Record<string, unknown>) => ReactNode;
  readonly type: string;
};

export const stringSchema = z.string().trim().min(1);
const colorSchema = z.string().trim().min(1);
export const textAlignOptions = ['left', 'center', 'right'] as const;

export const textStyleSchema = {
  color: colorSchema.optional(),
  fontSize: z.number().int().min(10).max(48).optional(),
  textAlign: z.enum(textAlignOptions).optional(),
} as const;

export const createTextStyleFields = (): readonly PropField[] => [
  { kind: 'select', name: 'textAlign', label: 'Text Align', options: [...textAlignOptions] },
  { kind: 'number', name: 'fontSize', label: 'Font Size', min: 10, max: 48 },
  { kind: 'color', name: 'color', label: 'Color' },
];

export const getTextStyle = (props: Record<string, unknown>) => ({
  color: String(props.color ?? '#cccccc'),
  fontSize: `${Number(props.fontSize ?? 16)}px`,
  textAlign: String(props.textAlign ?? 'left') as 'left' | 'center' | 'right',
  whiteSpace: 'pre-wrap' as const,
});
