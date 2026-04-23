import type {
  SpecDocument,
  SpecNode,
  SpecNodeDoc,
  SpecNodeKind,
  TraceLink,
  TraceLinkKind,
  ViewportId,
} from '../../spec/editor-schema';
import { getSpecNode } from '../../spec/editor-document';
import { createDefaultSpecNodeDoc } from '../../spec/spec-node-doc';
import { addScreen, removeConcern, removeScreen, removeTool } from './document-options';
import { removeComponent } from './component-state';

let nextSpecNodeCounter = 1;
let nextTraceLinkCounter = 1;

const createSpecNodeId = (kind: SpecNodeKind): string =>
  `spec-node-${kind}-${nextSpecNodeCounter++}`;

const createTraceLinkId = (): string => `trace-link-${nextTraceLinkCounter++}`;

const emptyDoc = (): SpecNodeDoc => createDefaultSpecNodeDoc();

const defaultNodeLabel = (
  kind: SpecNodeKind,
): { readonly titleEn: string; readonly titleJa: string } => {
  switch (kind) {
    case 'global':
      return { titleEn: 'Global', titleJa: 'Global' };
    case 'tool':
      return { titleEn: 'Tool', titleJa: 'ツール' };
    case 'concern':
      return { titleEn: 'Concern', titleJa: '関心' };
    case 'issue':
      return { titleEn: 'Issue', titleJa: '論点' };
    case 'screen':
      return { titleEn: 'Screen', titleJa: '画面仕様' };
    case 'component':
      return { titleEn: 'Component', titleJa: 'コンポーネント仕様' };
    case 'contract':
      return { titleEn: 'Contract', titleJa: '契約' };
    case 'state':
      return { titleEn: 'State', titleJa: '状態' };
    case 'interaction':
      return { titleEn: 'Interaction', titleJa: 'インタラクション' };
    case 'todo':
      return { titleEn: 'Todo', titleJa: 'TODO' };
  }
};

const sortNodes = (nodes: readonly SpecNode[]): SpecNode[] =>
  [...nodes].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const reindexSiblings = (nodes: readonly SpecNode[], parentId: string | undefined): SpecNode[] => {
  const siblings = sortNodes(nodes.filter((node) => node.parentId === parentId));
  const byId = new Map(siblings.map((node, index) => [node.id, index]));

  return nodes.map((node) =>
    node.parentId === parentId ? { ...node, order: byId.get(node.id) ?? node.order } : node,
  );
};

const collectDescendantIds = (nodes: readonly SpecNode[], nodeId: string): Set<string> => {
  const ids = new Set<string>([nodeId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }

  return ids;
};

export const addSpecNode = (
  document: SpecDocument,
  kind: SpecNodeKind,
  parentId?: string,
): SpecDocument => {
  const siblings = (document.specNodes ?? []).filter((node) => node.parentId === parentId);
  const parent = parentId ? getSpecNode(document, parentId) : null;
  const labels = defaultNodeLabel(kind);
  const nextNode: SpecNode = {
    doc: emptyDoc(),
    id: createSpecNodeId(kind),
    kind,
    links: [],
    metadata: {
      managed: 'manual',
      toolId: parent?.metadata?.toolId,
    },
    order: siblings.length,
    parentId,
    titleEn: `${labels.titleEn} ${nextSpecNodeCounter - 1}`,
    titleJa: `${labels.titleJa}${nextSpecNodeCounter - 1}`,
  };

  return {
    ...document,
    specNodes: [...(document.specNodes ?? []), nextNode],
  };
};

export const updateSpecNode = (
  document: SpecDocument,
  nodeId: string,
  updater: (node: SpecNode) => SpecNode,
): SpecDocument => ({
  ...document,
  specNodes: (document.specNodes ?? []).map((node) => (node.id === nodeId ? updater(node) : node)),
});

export const removeSpecNode = (document: SpecDocument, nodeId: string): SpecDocument => {
  const nodes = document.specNodes ?? [];
  const target = nodes.find((node) => node.id === nodeId);

  if (!target) {
    return document;
  }

  const idsToRemove = collectDescendantIds(nodes, nodeId);
  const remaining = nodes.filter((node) => !idsToRemove.has(node.id));

  return {
    ...document,
    issues: (document.issues ?? []).filter((issue) => !idsToRemove.has(issue.sourceNodeId)),
    specNodes: reindexSiblings(remaining, target.parentId),
  };
};

export const reorderSpecNode = (
  document: SpecDocument,
  nodeId: string,
  direction: 'up' | 'down',
): SpecDocument => {
  const nodes = document.specNodes ?? [];
  const target = nodes.find((node) => node.id === nodeId);

  if (!target) {
    return document;
  }

  const siblings = sortNodes(nodes.filter((node) => node.parentId === target.parentId));
  const index = siblings.findIndex((node) => node.id === nodeId);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
    return document;
  }

  const swapped = [...siblings];
  [swapped[index], swapped[nextIndex]] = [swapped[nextIndex], swapped[index]];
  const orderMap = new Map(swapped.map((node, currentIndex) => [node.id, currentIndex]));

  return {
    ...document,
    specNodes: nodes.map((node) =>
      node.parentId === target.parentId
        ? { ...node, order: orderMap.get(node.id) ?? node.order }
        : node,
    ),
  };
};

export const addTraceLink = (
  document: SpecDocument,
  nodeId: string,
  kind: TraceLinkKind = 'file',
): SpecDocument =>
  updateSpecNode(document, nodeId, (node) => ({
    ...node,
    links: [
      ...node.links,
      {
        id: createTraceLinkId(),
        kind,
        label: '',
        target: '',
      },
    ],
  }));

export const updateTraceLink = (
  document: SpecDocument,
  nodeId: string,
  linkId: string,
  updater: (link: TraceLink) => TraceLink,
): SpecDocument =>
  updateSpecNode(document, nodeId, (node) => ({
    ...node,
    links: node.links.map((link) => (link.id === linkId ? updater(link) : link)),
  }));

export const removeTraceLink = (
  document: SpecDocument,
  nodeId: string,
  linkId: string,
): SpecDocument =>
  updateSpecNode(document, nodeId, (node) => ({
    ...node,
    links: node.links.filter((link) => link.id !== linkId),
  }));

export const removeSpecNodeWithCascade = (doc: SpecDocument, nodeId: string): SpecDocument => {
  const node = getSpecNode(doc, nodeId);

  if (!node) {
    return doc;
  }

  let updated = doc;

  if (node.metadata?.managed === 'synced') {
    const meta = node.metadata as {
      readonly concernId?: string;
      readonly screenId?: string;
      readonly componentId?: string;
      readonly toolId?: string;
      readonly viewportId?: string;
    };

    if (meta.componentId && meta.screenId && meta.viewportId) {
      updated = removeComponent(
        updated,
        meta.screenId,
        meta.viewportId as ViewportId,
        meta.componentId,
      );
    } else if (meta.screenId) {
      if (updated.screens.length === 1) {
        updated = addScreen(updated);
      }
      updated = removeScreen(updated, meta.screenId);
    } else if (node.kind === 'tool' && meta.toolId) {
      updated = removeTool(updated, meta.toolId);
    } else if (meta.concernId) {
      updated = removeConcern(updated, meta.concernId);
    }
  }

  return removeSpecNode(updated, nodeId);
};
