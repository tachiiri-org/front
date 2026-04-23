import { z } from 'zod';

import type {
  ComponentInstance,
  Frame,
  NamedOption,
  ScreenSpec,
  SpecNode,
  SpecNodeDoc,
  SpecNodeDocHeadingLevel,
  SpecNodeDocItem,
  SpecNodeDocItemKind,
  SpecIssue,
  SpecNodeTaskStatus,
  SpecNodeKind,
  SpecDocument,
  TraceLink,
  TraceLinkKind,
  ViewportId,
  ViewportSpec,
} from '@shared/spec-document';

export type {
  ComponentInstance,
  Frame,
  NamedOption,
  ScreenSpec,
  SpecNode,
  SpecNodeDoc,
  SpecNodeDocHeadingLevel,
  SpecNodeDocItem,
  SpecNodeDocItemKind,
  SpecIssue,
  SpecNodeTaskStatus,
  SpecNodeKind,
  SpecDocument,
  TraceLink,
  TraceLinkKind,
  ViewportId,
  ViewportSpec,
} from '@shared/spec-document';

export const viewportIds = ['desktop', 'tablet', 'mobile'] as const satisfies readonly ViewportId[];

export const viewportDisplayPresets = {
  desktop: { label: 'Desktop', aspectRatio: 16 / 9, frame: '16:9' },
  tablet: { label: 'Tablet', aspectRatio: 4 / 3, frame: '4:3' },
  mobile: { label: 'Mobile', aspectRatio: 9 / 16, frame: '9:16' },
} as const satisfies Record<
  ViewportId,
  {
    readonly label: string;
    readonly aspectRatio: number;
    readonly frame: string;
  }
>;

const frameSchema: z.ZodType<Frame> = z.object({
  x: z.number().int().min(0).max(119),
  y: z.number().int().min(0).max(119),
  w: z.number().int().min(1).max(120),
  h: z.number().int().min(1).max(120),
});

const editorMetadataSchema = z.object({
  note: z.string(),
});

const specNodeKinds = [
  'global',
  'tool',
  'concern',
  'issue',
  'screen',
  'component',
  'contract',
  'state',
  'interaction',
  'todo',
] as const satisfies readonly SpecNodeKind[];

const traceLinkKinds = [
  'file',
  'symbol',
  'screen',
  'component',
  'contract',
] as const satisfies readonly TraceLinkKind[];

const specNodeDocItemKinds = [
  'heading',
  'item',
  'task',
] as const satisfies readonly SpecNodeDocItemKind[];

const specNodeTaskStatuses = [
  'open',
  'proposed',
  'accepted',
  'done',
] as const satisfies readonly SpecNodeTaskStatus[];

const specNodeHeadingLevelSchema: z.ZodType<SpecNodeDocHeadingLevel> = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const namedOptionSchema: z.ZodType<NamedOption> = z.object({
  id: z.string().min(1),
  nameJa: z.string().min(1),
  nameEn: z.string().min(1),
});

const specNodeDocItemSchema: z.ZodType<SpecNodeDocItem> = z.lazy(() =>
  z
    .object({
      children: z.array(specNodeDocItemSchema).default([]),
      headingLevel: specNodeHeadingLevelSchema.optional(),
      id: z.string().min(1).optional().catch(undefined),
      kind: z.enum(specNodeDocItemKinds).default('item'),
      status: z.enum(specNodeTaskStatuses).optional(),
      text: z.string(),
    })
    .transform((item) => ({
      ...item,
      id: item.id ?? globalThis.crypto.randomUUID(),
      status: item.kind === 'task' ? (item.status ?? 'open') : undefined,
    })),
);

const specNodeDocItemsSchema = z
  .array(z.union([z.string(), specNodeDocItemSchema]))
  .transform((items) =>
    items.map((item) =>
      typeof item === 'string'
        ? {
            text: item,
            children: [],
            id: globalThis.crypto.randomUUID(),
            kind: 'item' as const,
          }
        : item,
    ),
  );

const legacySpecNodeDocSchema = z
  .object({
    constraints: specNodeDocItemsSchema.default([]),
    goals: specNodeDocItemsSchema.default([]),
    hints: specNodeDocItemsSchema.default([]),
    todos: specNodeDocItemsSchema.default([]),
  })
  .strict();

const specNodeDocSchema: z.ZodType<SpecNodeDoc> = z
  .union([
    legacySpecNodeDocSchema.transform((doc) => ({
      items: [
        {
          text: 'Goal',
          id: globalThis.crypto.randomUUID(),
          kind: 'heading' as const,
          headingLevel: 1 as const,
          children: doc.goals,
        },
        {
          text: 'Hint',
          id: globalThis.crypto.randomUUID(),
          kind: 'heading' as const,
          headingLevel: 1 as const,
          children: doc.hints,
        },
        {
          text: 'Constraint',
          id: globalThis.crypto.randomUUID(),
          kind: 'heading' as const,
          headingLevel: 1 as const,
          children: doc.constraints,
        },
        {
          text: 'Todo',
          id: globalThis.crypto.randomUUID(),
          kind: 'heading' as const,
          headingLevel: 1 as const,
          children: doc.todos,
        },
      ],
    })),
    z
      .object({
        items: specNodeDocItemsSchema.default([]),
      })
      .strict(),
  ])
  .default({
    items: [],
  });

const traceLinkSchema: z.ZodType<TraceLink> = z.object({
  id: z.string().min(1),
  kind: z.enum(traceLinkKinds),
  label: z.string(),
  target: z.string(),
});

const specIssueSchema: z.ZodType<SpecIssue> = z.object({
  componentId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  id: z.string().min(1),
  screenId: z.string().min(1).optional(),
  sourceItemId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  status: z.enum(specNodeTaskStatuses),
  text: z.string(),
  toolId: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
});

const specNodeSchema: z.ZodType<SpecNode> = z.object({
  doc: specNodeDocSchema.default({
    items: [],
  }),
  id: z.string().min(1),
  kind: z.enum(specNodeKinds),
  links: z.array(traceLinkSchema).default([]),
  metadata: z
    .object({
      componentId: z.string().min(1).optional(),
      concernId: z.string().min(1).optional(),
      managed: z.enum(['manual', 'synced']).optional(),
      screenId: z.string().min(1).optional(),
      toolId: z.string().min(1).optional(),
      viewportId: z.enum(viewportIds).optional(),
    })
    .optional(),
  order: z.number().int().min(0),
  parentId: z.string().min(1).optional(),
  titleEn: z.string().min(1),
  titleJa: z.string().min(1),
});

export const componentInstanceSchema: z.ZodType<ComponentInstance> = z.object({
  editorMetadata: editorMetadataSchema,
  frame: frameSchema,
  id: z.string().min(1),
  nameEn: z.string().min(1),
  nameJa: z.string().min(1),
  parentId: z.string().min(1).optional(),
  props: z.record(z.string(), z.unknown()),
  type: z.string().min(1),
  zIndex: z.number().int().min(0).default(0),
});

export const viewportSchema: z.ZodType<ViewportSpec> = z.object({
  components: z.array(componentInstanceSchema),
  id: z.enum(viewportIds),
});

export const screenSchema: z.ZodType<ScreenSpec> = z.object({
  id: z.string().min(1),
  nameEn: z.string().min(1),
  nameJa: z.string().min(1),
  viewports: z.object({
    desktop: viewportSchema,
    tablet: viewportSchema,
    mobile: viewportSchema,
  }),
  goals: z.array(z.string()).optional(),
  hints: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
});

export const specDocumentSchema: z.ZodType<SpecDocument> = z.object({
  concerns: z.array(namedOptionSchema),
  issues: z.array(specIssueSchema).default([]).optional(),
  screens: z.array(screenSchema).min(1),
  specNodes: z.array(specNodeSchema).default([]).optional(),
  tools: z.array(namedOptionSchema),
});
