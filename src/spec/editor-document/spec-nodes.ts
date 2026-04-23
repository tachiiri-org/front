import type {
  NamedOption,
  ScreenSpec,
  SpecDocument,
  SpecNode,
  SpecNodeDoc,
  SpecNodeDocItem,
  TraceLink,
  ViewportId,
} from '../editor-schema';
import { viewportIds } from '../editor-schema';
import {
  createDefaultSpecNodeDoc,
  createSpecNodeDocFromLegacySections,
  hasRenderableDocItems,
} from '../spec-node-doc';

const localStoreConcernId = 'local-store';
export const globalSpecNodeId = 'global-node:root';

export const getToolSpecNodeId = (toolId: string): string => `tool-node:${toolId}`;

const getConcernSpecNodeId = (toolId: string, concernId: string): string =>
  `concern-node:${toolId}:${concernId}`;

const getScreenSpecNodeId = (toolId: string, screenId: string): string =>
  `screen-node:${toolId}:${screenId}`;

const getComponentSpecNodeId = (
  toolId: string,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
): string => `component-node:${toolId}:${screenId}:${viewportId}:${componentId}`;

const emptyDoc = (): SpecNodeDoc => createDefaultSpecNodeDoc();

const createLink = (
  id: string,
  kind: TraceLink['kind'],
  label: string,
  target: string,
): TraceLink => ({
  id,
  kind,
  label,
  target,
});

const sortNodes = (nodes: readonly SpecNode[]): SpecNode[] =>
  [...nodes].sort(
    (left, right) =>
      left.order - right.order ||
      left.titleJa.localeCompare(right.titleJa, 'ja') ||
      left.id.localeCompare(right.id),
  );

const createGlobalNode = (existing?: SpecNode): SpecNode => ({
  doc: existing?.doc ?? emptyDoc(),
  id: existing?.id ?? globalSpecNodeId,
  kind: 'global',
  links: existing?.links ?? [],
  metadata: {
    managed: 'synced',
  },
  order: 0,
  titleEn: 'Global',
  titleJa: 'Global',
});

const createToolNode = (tool: NamedOption, order: number, existing?: SpecNode): SpecNode => ({
  doc: existing?.doc ?? emptyDoc(),
  id: existing?.id ?? getToolSpecNodeId(tool.id),
  kind: 'tool',
  links: existing?.links ?? [],
  metadata: {
    managed: 'synced',
    toolId: tool.id,
  },
  order,
  titleEn: tool.nameEn,
  titleJa: tool.nameJa,
});

const createConcernNode = (
  toolId: string,
  concern: NamedOption,
  parentId: string,
  existing?: SpecNode,
): SpecNode => ({
  doc: existing?.doc ?? emptyDoc(),
  id: existing?.id ?? getConcernSpecNodeId(toolId, concern.id),
  kind: 'concern',
  links: existing?.links ?? [
    createLink(`concern-link:${toolId}:${concern.id}`, 'contract', concern.nameEn, concern.id),
  ],
  metadata: {
    concernId: concern.id,
    managed: 'synced',
    toolId,
  },
  order: existing?.order ?? 0,
  parentId,
  titleEn: concern.nameEn,
  titleJa: concern.nameJa,
});

const createScreenNode = (
  toolId: string,
  screen: ScreenSpec,
  parentId: string,
  order: number,
  existing?: SpecNode,
): SpecNode => ({
  doc:
    existing?.doc ??
    createSpecNodeDocFromLegacySections({
      constraints: screen.constraints ?? [],
      goals: screen.goals ?? [],
      hints: screen.hints ?? [],
      todos: [],
    }),
  id: existing?.id ?? getScreenSpecNodeId(toolId, screen.id),
  kind: 'screen',
  links: existing?.links ?? [
    createLink(`screen-link:${toolId}:${screen.id}`, 'screen', screen.nameEn, screen.id),
  ],
  metadata: {
    managed: 'synced',
    screenId: screen.id,
    toolId,
  },
  order,
  parentId,
  titleEn: screen.nameEn,
  titleJa: screen.nameJa,
});

const createComponentNode = ({
  component,
  existing,
  order,
  parentId,
  screenId,
  toolId,
  viewportId,
}: {
  readonly component: ScreenSpec['viewports'][ViewportId]['components'][number];
  readonly existing?: SpecNode;
  readonly order: number;
  readonly parentId: string;
  readonly screenId: string;
  readonly toolId: string;
  readonly viewportId: ViewportId;
}): SpecNode => ({
  doc: existing?.doc ?? emptyDoc(),
  id: existing?.id ?? getComponentSpecNodeId(toolId, screenId, viewportId, component.id),
  kind: 'component',
  links: existing?.links ?? [
    createLink(
      `component-link:${toolId}:${screenId}:${viewportId}:${component.id}`,
      'component',
      `${component.nameEn} (${viewportId})`,
      `${screenId}:${viewportId}:${component.id}`,
    ),
  ],
  metadata: {
    componentId: component.id,
    managed: 'synced',
    screenId,
    toolId,
    viewportId,
  },
  order,
  parentId,
  titleEn: component.nameEn,
  titleJa: component.nameJa,
});

const getLocalStoreConcernId = (concerns: readonly NamedOption[]): string =>
  (concerns.find((concern) => concern.id === localStoreConcernId) ?? concerns[0])?.id ??
  localStoreConcernId;

const syncConcernNodes = (
  toolId: string,
  concerns: readonly NamedOption[],
  existing: readonly SpecNode[],
): SpecNode[] =>
  concerns
    .map((concern) =>
      createConcernNode(
        toolId,
        concern,
        getToolSpecNodeId(toolId),
        existing.find(
          (node) =>
            node.kind === 'concern' &&
            node.metadata?.toolId === toolId &&
            node.metadata?.concernId === concern.id,
        ),
      ),
    )
    .map((node, index) => ({ ...node, order: index }));

const syncScreenAndComponentNodes = (
  toolId: string,
  screens: readonly ScreenSpec[],
  concernParentId: string,
  existing: readonly SpecNode[],
): SpecNode[] => {
  const nodes: SpecNode[] = [];

  for (const [screenIndex, screen] of screens.entries()) {
    const existingScreen = existing.find(
      (node) =>
        node.kind === 'screen' &&
        node.metadata?.toolId === toolId &&
        node.metadata?.screenId === screen.id,
    );
    const screenNode = createScreenNode(
      toolId,
      screen,
      concernParentId,
      screenIndex,
      existingScreen,
    );

    nodes.push(screenNode);

    const componentNodeIds = new Map<string, string>();

    for (const viewportId of viewportIds) {
      const viewport = screen.viewports[viewportId];

      for (const component of viewport.components) {
        componentNodeIds.set(
          `${viewportId}:${component.id}`,
          getComponentSpecNodeId(toolId, screen.id, viewportId, component.id),
        );
      }
    }

    let componentOrder = 0;

    for (const [viewportIndex, viewportId] of viewportIds.entries()) {
      const viewport = screen.viewports[viewportId];

      for (const component of viewport.components) {
        const existingComponent = existing.find(
          (node) =>
            node.kind === 'component' &&
            node.metadata?.toolId === toolId &&
            node.metadata?.screenId === screen.id &&
            node.metadata?.viewportId === viewportId &&
            node.metadata?.componentId === component.id,
        );
        const parentId =
          component.parentId && componentNodeIds.has(`${viewportId}:${component.parentId}`)
            ? (existing.find(
                (node) =>
                  node.kind === 'component' &&
                  node.metadata?.toolId === toolId &&
                  node.metadata?.screenId === screen.id &&
                  node.metadata?.viewportId === viewportId &&
                  node.metadata?.componentId === component.parentId,
              )?.id ?? componentNodeIds.get(`${viewportId}:${component.parentId}`)!)
            : screenNode.id;

        nodes.push(
          createComponentNode({
            component,
            existing: existingComponent,
            order: viewportIndex * 1000 + componentOrder,
            parentId,
            screenId: screen.id,
            toolId,
            viewportId,
          }),
        );
        componentOrder += 1;
      }
    }
  }

  return nodes;
};

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
    mappedIds.set(`concern-node:${concern.id}`, getConcernSpecNodeId(defaultToolId, concern.id));
  }

  for (const screen of screens) {
    mappedIds.set(`screen-node:${screen.id}`, getScreenSpecNodeId(defaultToolId, screen.id));

    for (const viewportId of viewportIds) {
      for (const component of screen.viewports[viewportId].components) {
        mappedIds.set(
          `component-node:${screen.id}:${viewportId}:${component.id}`,
          getComponentSpecNodeId(defaultToolId, screen.id, viewportId, component.id),
        );
      }
    }
  }

  return mappedIds;
};

const preserveManualNodes = (
  nodes: readonly SpecNode[],
  tools: readonly NamedOption[],
  concerns: readonly NamedOption[],
  screens: readonly ScreenSpec[],
  syncedNodes: readonly SpecNode[],
): SpecNode[] => {
  const defaultToolId = tools[0]?.id;
  const toolIds = new Set(tools.map((tool) => tool.id));
  const legacyIdMap = buildLegacySyncedIdMap(tools, concerns, screens);
  const byId = new Map<string, SpecNode>(syncedNodes.map((node) => [node.id, node]));

  let manualNodes = nodes
    .filter((node) => node.metadata?.managed !== 'synced')
    .map((node) => {
      const nextParentId =
        node.parentId && legacyIdMap.has(node.parentId)
          ? legacyIdMap.get(node.parentId)
          : node.parentId;
      const inferredToolId =
        node.metadata?.toolId ?? (nextParentId !== node.parentId ? defaultToolId : undefined);

      const nextNode =
        nextParentId !== node.parentId || inferredToolId
          ? {
              ...node,
              parentId: nextParentId,
              metadata: {
                ...node.metadata,
                ...(inferredToolId ? { toolId: inferredToolId } : {}),
              },
            }
          : node;

      byId.set(nextNode.id, nextNode);
      return nextNode;
    });

  if (tools.length === 1 && defaultToolId) {
    manualNodes = manualNodes.map((node) => {
      if (node.metadata?.toolId) {
        return node;
      }

      const nextNode = {
        ...node,
        metadata: {
          ...node.metadata,
          toolId: defaultToolId,
        },
      };
      byId.set(nextNode.id, nextNode);
      return nextNode;
    });
  }

  let changed = true;

  while (changed) {
    changed = false;
    manualNodes = manualNodes.map((node) => {
      if (node.metadata?.toolId || !node.parentId) {
        return node;
      }

      const parent = byId.get(node.parentId);
      const toolId = parent?.metadata?.toolId;

      if (!toolId) {
        return node;
      }

      changed = true;
      const nextNode = {
        ...node,
        metadata: {
          ...node.metadata,
          toolId,
        },
      };
      byId.set(nextNode.id, nextNode);
      return nextNode;
    });
  }

  return manualNodes.filter((node) => !node.metadata?.toolId || toolIds.has(node.metadata.toolId));
};

export const syncStructureNodesFromUiDocument = (document: SpecDocument): SpecDocument => {
  const existingNodes = document.specNodes ?? [];
  const globalNode = createGlobalNode(existingNodes.find((node) => node.kind === 'global'));
  const toolNodes = document.tools.map((tool, index) =>
    createToolNode(
      tool,
      index,
      existingNodes.find((node) => node.kind === 'tool' && node.metadata?.toolId === tool.id),
    ),
  );
  const concernNodes = document.tools.flatMap((tool) =>
    syncConcernNodes(tool.id, document.concerns, existingNodes),
  );
  const syncedNodes = document.tools.flatMap((tool) =>
    syncScreenAndComponentNodes(
      tool.id,
      document.screens,
      getConcernSpecNodeId(tool.id, getLocalStoreConcernId(document.concerns)),
      existingNodes,
    ),
  );
  const nextSyncedNodes = [
    globalNode,
    ...sortNodes(toolNodes),
    ...sortNodes(concernNodes),
    ...sortNodes(syncedNodes),
  ];
  const manualNodes = preserveManualNodes(
    existingNodes,
    document.tools,
    document.concerns,
    document.screens,
    nextSyncedNodes,
  );

  return {
    ...document,
    specNodes: [...nextSyncedNodes, ...sortNodes(manualNodes)],
  };
};

export const getSpecNodes = (document: SpecDocument, toolId?: string): SpecNode[] =>
  sortNodes(
    (document.specNodes ?? []).filter((node) => (toolId ? node.metadata?.toolId === toolId : true)),
  );

export const getSpecNode = (document: SpecDocument, specNodeId: string | null): SpecNode | null =>
  getSpecNodes(document).find((node) => node.id === specNodeId) ?? null;

export const getSpecNodeChildren = (
  document: SpecDocument,
  specNodeId: string | undefined,
): SpecNode[] => getSpecNodes(document).filter((node) => node.parentId === specNodeId);

export const getSpecNodeAncestors = (
  document: SpecDocument,
  specNodeId: string | null,
): SpecNode[] => {
  if (!specNodeId) {
    return [];
  }

  const nodes = getSpecNodes(document);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors: SpecNode[] = [];
  let current = byId.get(specNodeId) ?? null;

  while (current?.parentId) {
    const parent = byId.get(current.parentId);

    if (!parent) {
      break;
    }

    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
};

const getNodePath = (document: SpecDocument, specNodeId: string | null): string[] => {
  const node = getSpecNode(document, specNodeId);

  if (!node) {
    return [];
  }

  return [
    ...getSpecNodeAncestors(document, specNodeId).map((entry) => entry.titleJa),
    node.titleJa,
  ];
};

const getToolNode = (document: SpecDocument, specNodeId: string | null): SpecNode | null => {
  const selectedNode = getSpecNode(document, specNodeId);

  if (!selectedNode?.metadata?.toolId) {
    return null;
  }

  return getSpecNode(document, getToolSpecNodeId(selectedNode.metadata.toolId));
};

export const getGlobalSpecNode = (document: SpecDocument): SpecNode | null =>
  getSpecNode(document, globalSpecNodeId);

export type SpecNodeContext = {
  readonly childSummary: string[];
  readonly doc: SpecNodeDoc;
  readonly links: TraceLink[];
  readonly path: string[];
  readonly relatedComponents: string[];
  readonly relatedScreens: string[];
  readonly selectedNode: SpecNode;
  readonly globalNode: SpecNode | null;
  readonly toolNode: SpecNode | null;
};

export const buildSpecNodeContext = (
  document: SpecDocument,
  specNodeId: string | null,
): SpecNodeContext | null => {
  const selectedNode = getSpecNode(document, specNodeId);

  if (!selectedNode) {
    return null;
  }

  const children = getSpecNodeChildren(document, selectedNode.id);
  const relatedScreens = selectedNode.metadata?.screenId ? [selectedNode.metadata.screenId] : [];
  const relatedComponents =
    selectedNode.metadata?.componentId &&
    selectedNode.metadata?.viewportId &&
    selectedNode.metadata?.screenId
      ? [
          `${selectedNode.metadata.screenId}:${selectedNode.metadata.viewportId}:${selectedNode.metadata.componentId}`,
        ]
      : [];

  return {
    childSummary: children.map((child) => `${child.kind}:${child.titleJa}`),
    doc: selectedNode.doc,
    links: selectedNode.links,
    path: getNodePath(document, selectedNode.id),
    relatedComponents,
    relatedScreens,
    selectedNode,
    globalNode: getGlobalSpecNode(document),
    toolNode: getToolNode(document, selectedNode.id),
  };
};

export const exportSpecNodeContextPrompt = (
  document: SpecDocument,
  specNodeId: string | null,
): string => {
  const context = buildSpecNodeContext(document, specNodeId);

  if (!context) {
    return '# Spec Node Context\n\nNo node is selected.';
  }

  const renderDocOutline = (items: readonly SpecNodeDocItem[], depth = 0): string[] =>
    items.flatMap((item) => {
      if (item.text.trim().length === 0 && !hasRenderableDocItems(item.children)) {
        return [];
      }

      const indent = '  '.repeat(depth);
      const marker =
        item.kind === 'heading'
          ? '#'.repeat(item.headingLevel ?? 1)
          : item.kind === 'task'
            ? `- [${item.status ?? 'open'}]`
            : '-';

      return [
        `${indent}${marker} ${item.text || '(empty)'}`,
        ...renderDocOutline(item.children, depth + 1),
      ];
    });

  const lines = [
    '# Spec Node Context',
    '',
    `Node: ${context.selectedNode.kind} / ${context.selectedNode.titleEn} / ${context.selectedNode.titleJa}`,
    `Path: ${context.path.join(' > ')}`,
    '',
  ];

  if (context.globalNode && context.globalNode.id !== context.selectedNode.id) {
    lines.push(
      '## Global Context',
      ...(renderDocOutline(context.globalNode.doc.items).length > 0
        ? renderDocOutline(context.globalNode.doc.items)
        : ['- none']),
      '',
    );
  }

  if (context.toolNode && context.toolNode.id !== context.selectedNode.id) {
    lines.push(
      '## Tool Shared Context',
      ...(renderDocOutline(context.toolNode.doc.items).length > 0
        ? renderDocOutline(context.toolNode.doc.items)
        : ['- none']),
      '',
    );
  }

  lines.push(
    '## Outline',
    ...(renderDocOutline(context.doc.items).length > 0
      ? renderDocOutline(context.doc.items)
      : ['- none']),
    '',
    '## Children',
    ...(context.childSummary.length > 0
      ? context.childSummary.map((entry) => `- ${entry}`)
      : ['- none']),
    '',
    '## Trace Links',
    ...(context.links.length > 0
      ? context.links.map((link) => `- ${link.kind}: ${link.label} -> ${link.target}`)
      : ['- none']),
  );

  return lines.join('\n');
};

export const getDefaultSelectedSpecNodeId = (document: SpecDocument, toolId?: string): string => {
  const nodes = getSpecNodes(document, toolId);
  return (nodes.find((node) => !node.parentId) ?? nodes[0])?.id ?? '';
};

export const isSpecNodeDescendant = (
  document: SpecDocument,
  parentNodeId: string,
  candidateChildId: string,
): boolean => {
  const nodes = getSpecNodes(document);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(candidateChildId) ?? null;

  while (current?.parentId) {
    if (current.parentId === parentNodeId) {
      return true;
    }

    current = byId.get(current.parentId) ?? null;
  }

  return false;
};
