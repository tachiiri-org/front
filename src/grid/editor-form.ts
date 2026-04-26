import { z } from 'zod';

const editorFieldBaseSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(['frame', 'props']),
});

const editorTextFieldSchema = editorFieldBaseSchema.extend({
  kind: z.literal('text'),
});

const editorTextareaFieldSchema = editorFieldBaseSchema.extend({
  kind: z.literal('textarea'),
});

const editorNumberFieldSchema = editorFieldBaseSchema.extend({
  kind: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
});

const editorSelectFieldSchema = editorFieldBaseSchema.extend({
  kind: z.literal('select'),
  options: z.array(z.string().min(1)).min(1),
});

const editorColorFieldSchema = editorFieldBaseSchema.extend({
  kind: z.literal('color'),
});

export const editorFieldSchema = z.discriminatedUnion('kind', [
  editorTextFieldSchema,
  editorTextareaFieldSchema,
  editorNumberFieldSchema,
  editorSelectFieldSchema,
  editorColorFieldSchema,
]);

const editorFieldsSectionSchema = z.object({
  kind: z.literal('fields'),
  title: z.string().min(1),
  helpText: z.string().optional(),
  fields: z.array(editorFieldSchema).min(1),
});

export const editorFormSchema = z.object({
  sections: z.array(editorFieldsSectionSchema).min(1),
});

export const editorFormsSchema = z.record(z.string().min(1), editorFormSchema);

export type EditorField = z.infer<typeof editorFieldSchema>;
export type EditorForm = z.infer<typeof editorFormSchema>;
export type EditorFormSection = z.infer<typeof editorFieldsSectionSchema>;
export type EditorForms = z.infer<typeof editorFormsSchema>;
