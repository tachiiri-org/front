import { componentCatalogMap } from '../../catalog/components';

import {
  specDocumentSchema,
  type ComponentInstance,
  type NamedOption,
  type SpecNodeDocItem,
  type ScreenSpec,
  type SpecDocument,
  viewportIds,
} from '../editor-schema';

import { defaultSpecDocument } from './default-document';
import { syncStructureNodesFromUiDocument } from './spec-nodes';

const localStoreConcernId = 'local-store';
const localStoreConcernName = 'local-store';
const legacyLocalStoreConcernIds = new Set(['ui', 'visual']);
const legacyLocalStoreConcernNames = new Set(['UI', 'Visual', '見た目']);

const isLegacyLocalStoreConcern = (concern: NamedOption): boolean =>
  concern.id === localStoreConcernId ||
  legacyLocalStoreConcernIds.has(concern.id) ||
  concern.nameEn === localStoreConcernName ||
  legacyLocalStoreConcernNames.has(concern.nameEn) ||
  concern.nameJa === localStoreConcernName ||
  legacyLocalStoreConcernNames.has(concern.nameJa);

const createLocalStoreConcern = (): NamedOption => ({
  id: localStoreConcernId,
  nameEn: localStoreConcernName,
  nameJa: localStoreConcernName,
});

const normalizeLegacyProps = (component: ComponentInstance): ComponentInstance => {
  const definition = componentCatalogMap[component.type];
  const rawProps = component.props;
  const props = { ...(definition?.defaultProps ?? {}), ...rawProps };

  if (component.type === 'Header' && typeof rawProps.subtitle === 'string') {
    props.title =
      typeof rawProps.title === 'string' && rawProps.title.trim().length > 0
        ? `${rawProps.title}\n${rawProps.subtitle}`
        : rawProps.subtitle;
    delete props.subtitle;
  }

  if (
    (component.type === 'Heading' || component.type === 'Text') &&
    typeof rawProps.content === 'string' &&
    typeof rawProps.title !== 'string'
  ) {
    props.title = rawProps.content;
    delete props.content;
  }

  if (
    component.type === 'Button' &&
    typeof rawProps.label === 'string' &&
    typeof rawProps.title !== 'string'
  ) {
    props.title = rawProps.label;
    delete props.label;
  }

  return {
    ...component,
    props,
  };
};

const normalizeConcerns = (concerns: readonly NamedOption[]): NamedOption[] => {
  const normalized: NamedOption[] = [];
  const seenIds = new Set<string>();

  for (const concern of concerns) {
    const nextConcern = isLegacyLocalStoreConcern(concern) ? createLocalStoreConcern() : concern;

    if (seenIds.has(nextConcern.id)) {
      continue;
    }

    seenIds.add(nextConcern.id);
    normalized.push(nextConcern);
  }

  return normalized;
};

const normalizeTools = (tools: readonly NamedOption[]): NamedOption[] =>
  tools.length > 0
    ? tools.map((tool) => ({
        id: tool.id,
        nameEn: tool.nameEn.trim() || tool.id,
        nameJa: tool.nameJa.trim() || tool.nameEn.trim() || tool.id,
      }))
    : [{ id: 'ui-spec-editor', nameJa: 'ui-spec-editor', nameEn: 'ui-spec-editor' }];

const remapConcernId = (concernId: string): string =>
  legacyLocalStoreConcernIds.has(concernId) ? localStoreConcernId : concernId;

const buildLegacySyncedIdMap = (
  tools: readonly NamedOption[],
  concerns: readonly NamedOption[],
  screens: readonly ScreenSpec[],
): ReadonlyMap<string, string> => {
  const defaultToolId = tools[0]?.id;

  if (!defaultToolId) {
    return new Map();
  }

  const mappedIds = new Map<string, string>();

  for (const concern of concerns) {
    mappedIds.set(`concern-node:${concern.id}`, `concern-node:${defaultToolId}:${concern.id}`);
  }

  mappedIds.set(`concern-node:ui`, `concern-node:${defaultToolId}:${localStoreConcernId}`);
  mappedIds.set(`concern-node:visual`, `concern-node:${defaultToolId}:${localStoreConcernId}`);

  for (const screen of screens) {
    mappedIds.set(`screen-node:${screen.id}`, `screen-node:${defaultToolId}:${screen.id}`);

    for (const viewportId of viewportIds) {
      for (const component of screen.viewports[viewportId].components) {
        mappedIds.set(
          `component-node:${screen.id}:${viewportId}:${component.id}`,
          `component-node:${defaultToolId}:${screen.id}:${viewportId}:${component.id}`,
        );
      }
    }
  }

  return mappedIds;
};

const remapConcernNodeId = (id: string, defaultToolId?: string): string => {
  const toolScopedMatch = /^concern-node:([^:]+):([^:]+)$/.exec(id);

  if (toolScopedMatch) {
    const [, toolId, concernId] = toolScopedMatch;
    const nextConcernId = remapConcernId(concernId);

    return nextConcernId === concernId ? id : `concern-node:${toolId}:${nextConcernId}`;
  }

  const legacyConcernMatch = /^concern-node:([^:]+)$/.exec(id);

  if (!legacyConcernMatch || !defaultToolId) {
    return id;
  }

  const [, concernId] = legacyConcernMatch;

  return `concern-node:${defaultToolId}:${remapConcernId(concernId)}`;
};

const migrateLegacyConcernReferences = (
  document: SpecDocument,
  tools: readonly NamedOption[],
  concerns: readonly NamedOption[],
): SpecDocument => {
  const defaultToolId = tools[0]?.id;
  const legacyIdMap = buildLegacySyncedIdMap(tools, concerns, document.screens);

  const specNodes = (document.specNodes ?? []).map((node) => {
    const nextConcernId = node.metadata?.concernId
      ? remapConcernId(node.metadata.concernId)
      : undefined;
    const mappedNodeId = legacyIdMap.get(node.id) ?? remapConcernNodeId(node.id, defaultToolId);
    const nextId =
      node.kind === 'concern' && node.metadata?.toolId && nextConcernId
        ? `concern-node:${node.metadata.toolId}:${nextConcernId}`
        : mappedNodeId;
    const nextParentId = node.parentId
      ? (legacyIdMap.get(node.parentId) ?? remapConcernNodeId(node.parentId, defaultToolId))
      : node.parentId;
    const isLocalStoreConcernNode =
      node.kind === 'concern' && nextConcernId === localStoreConcernId;

    return {
      ...node,
      id: nextId,
      links: isLocalStoreConcernNode
        ? node.links.map((link) =>
            link.kind !== 'contract'
              ? link
              : {
                  ...link,
                  label: localStoreConcernName,
                  target: localStoreConcernId,
                },
          )
        : node.links,
      metadata:
        nextConcernId && node.metadata
          ? {
              ...node.metadata,
              concernId: nextConcernId,
            }
          : node.metadata,
      parentId: nextParentId,
      titleEn: isLocalStoreConcernNode ? localStoreConcernName : node.titleEn,
      titleJa: isLocalStoreConcernNode ? localStoreConcernName : node.titleJa,
    };
  });

  const issues = (document.issues ?? []).map((issue) => ({
    ...issue,
    sourceNodeId:
      legacyIdMap.get(issue.sourceNodeId) ?? remapConcernNodeId(issue.sourceNodeId, defaultToolId),
  }));

  return {
    ...document,
    issues,
    specNodes,
  };
};

const removeMigratedTasks = (
  items: readonly SpecNodeDocItem[],
  migratedIssueIds: ReadonlySet<string>,
): SpecNodeDocItem[] =>
  items
    .filter((item) => !(item.kind === 'task' && item.id && migratedIssueIds.has(item.id)))
    .map((item) => ({
      ...item,
      children: removeMigratedTasks(item.children, migratedIssueIds),
    }));

const defaultDocHeadingTitles = new Set(['Goal', 'Hint', 'Constraint', 'Todo']);

const removeEmptyDefaultHeadings = (items: readonly SpecNodeDocItem[]): SpecNodeDocItem[] =>
  items
    .filter(
      (item) =>
        !(
          item.kind === 'heading' &&
          defaultDocHeadingTitles.has(item.text) &&
          item.children.length === 0
        ),
    )
    .map((item) => ({
      ...item,
      children: removeEmptyDefaultHeadings(item.children),
    }));

const migrateEmptyDefaultDocSections = (document: SpecDocument): SpecDocument => ({
  ...document,
  specNodes: (document.specNodes ?? []).map((node) => ({
    ...node,
    doc: {
      ...node.doc,
      items: removeEmptyDefaultHeadings(node.doc.items),
    },
  })),
});

const migrateLegacyTasksToIssues = (document: SpecDocument): SpecDocument => {
  const migratedIds = new Set<string>();
  const migratedIssues = (document.specNodes ?? []).flatMap((node) =>
    node.doc.items.flatMap(function collect(item): import('../editor-schema').SpecIssue[] {
      const nested = item.children.flatMap(collect);

      if (item.kind !== 'task') {
        return nested;
      }

      const itemId = item.id ?? globalThis.crypto.randomUUID();
      migratedIds.add(itemId);

      return [
        {
          componentId: node.metadata?.componentId,
          createdAt: new Date().toISOString(),
          id: globalThis.crypto.randomUUID(),
          screenId: node.metadata?.screenId,
          sourceItemId: itemId,
          sourceNodeId: node.id,
          status: item.status ?? 'open',
          text: item.text,
          toolId: node.metadata?.toolId,
          updatedAt: new Date().toISOString(),
        },
        ...nested,
      ];
    }),
  );

  if (migratedIssues.length === 0) {
    return document;
  }

  return {
    ...document,
    issues: [...(document.issues ?? []), ...migratedIssues],
    specNodes: (document.specNodes ?? []).map((node) => ({
      ...node,
      doc: {
        ...node.doc,
        items: removeMigratedTasks(node.doc.items, migratedIds),
      },
    })),
  };
};

const backfillIssueMetadata = (document: SpecDocument): SpecDocument => {
  const issues = document.issues ?? [];
  let changed = false;

  const nextIssues = issues.map((issue) => {
    const sourceNode = document.specNodes?.find((node) => node.id === issue.sourceNodeId);

    if (!sourceNode?.metadata) {
      return issue;
    }

    const nextIssue = {
      ...issue,
      toolId: issue.toolId ?? sourceNode.metadata.toolId,
      screenId: issue.screenId ?? sourceNode.metadata.screenId,
      componentId: issue.componentId ?? sourceNode.metadata.componentId,
    };

    if (
      nextIssue.toolId !== issue.toolId ||
      nextIssue.screenId !== issue.screenId ||
      nextIssue.componentId !== issue.componentId
    ) {
      changed = true;
    }

    return nextIssue;
  });

  return changed ? { ...document, issues: nextIssues } : document;
};

export const normalizeSpecDocument = (document: SpecDocument): SpecDocument =>
  (() => {
    const concerns = normalizeConcerns(document.concerns);
    const tools = normalizeTools(document.tools);
    const normalizedDocument = migrateLegacyConcernReferences(
      {
        ...document,
        concerns,
        screens: document.screens.map((screen) => ({
          ...screen,
          viewports: Object.fromEntries(
            viewportIds.map((viewportId) => [
              viewportId,
              {
                ...screen.viewports[viewportId],
                components: screen.viewports[viewportId].components.map(normalizeLegacyProps),
              },
            ]),
          ) as ScreenSpec['viewports'],
        })),
        tools,
      },
      tools,
      concerns,
    );

    return backfillIssueMetadata(syncStructureNodesFromUiDocument(normalizedDocument));
  })();

const defaultSeedNodes = (defaultSpecDocument.specNodes ?? []).filter(
  (node) => node.metadata?.managed !== 'synced',
);

export const loadSpecDocument = (document: unknown): SpecDocument => {
  const parsed = specDocumentSchema.parse(document ?? defaultSpecDocument);

  if (document !== null) {
    const existingIds = new Set((parsed.specNodes ?? []).map((node) => node.id));
    const missingNodes = defaultSeedNodes.filter((node) => !existingIds.has(node.id));

    if (missingNodes.length > 0) {
      return normalizeSpecDocument(
        migrateEmptyDefaultDocSections(
          migrateLegacyTasksToIssues({
            ...parsed,
            specNodes: [...(parsed.specNodes ?? []), ...missingNodes],
          }),
        ),
      );
    }
  }

  return normalizeSpecDocument(migrateEmptyDefaultDocSections(migrateLegacyTasksToIssues(parsed)));
};
