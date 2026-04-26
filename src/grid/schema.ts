import { z } from 'zod';
import { editorFormsSchema } from './editor-form';

const viewportSchema = z.object({
  label: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const gridSchema = z.object({
  columns: z.number().int().min(1),
  rows: z.number().int().min(1),
});

const gridFrameSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

export const gridCellSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  frame: gridFrameSchema,
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const gridLayoutSchema = z.object({
  id: z.string().min(1),
  viewport: viewportSchema,
  grid: gridSchema,
  editorForms: editorFormsSchema.default({}),
  cells: z.array(gridCellSchema),
});

export type GridFrame = z.infer<typeof gridFrameSchema>;
export type GridCell = z.infer<typeof gridCellSchema>;
export type GridLayout = z.infer<typeof gridLayoutSchema>;
