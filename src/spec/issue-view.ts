import type { SpecDocument, SpecIssue, SpecNodeTaskStatus } from './editor-schema';
import { getSpecNode, getSpecNodeAncestors } from './editor-document';

export type IssueEntry = SpecIssue & {
  readonly sourceLinkLabel?: string;
  readonly sourceLinkTarget?: string;
  readonly sourceNodeKind?: string;
  readonly sourceNodePath: readonly string[];
  readonly sourceNodeTitleJa: string;
};

export const issueStatuses = [
  'open',
  'proposed',
  'accepted',
  'done',
] as const satisfies readonly SpecNodeTaskStatus[];

const createIssueId = (): string => globalThis.crypto.randomUUID();

const nowIso = (): string => new Date().toISOString();

const mapDocItems = (
  items: readonly import('./editor-schema').SpecNodeDocItem[],
  itemId: string,
  updater: (
    item: import('./editor-schema').SpecNodeDocItem,
  ) => import('./editor-schema').SpecNodeDocItem,
): import('./editor-schema').SpecNodeDocItem[] =>
  items.map((item) =>
    item.id === itemId
      ? updater({
          ...item,
          children: mapDocItems(item.children, itemId, updater),
        })
      : {
          ...item,
          children: mapDocItems(item.children, itemId, updater),
        },
  );

const updateSourceDocItem = (
  document: SpecDocument,
  sourceNodeId: string,
  sourceItemId: string,
  updater: (
    item: import('./editor-schema').SpecNodeDocItem,
  ) => import('./editor-schema').SpecNodeDocItem,
): SpecDocument => ({
  ...document,
  specNodes: (document.specNodes ?? []).map((node) =>
    node.id !== sourceNodeId
      ? node
      : {
          ...node,
          doc: {
            ...node.doc,
            items: mapDocItems(node.doc.items, sourceItemId, updater),
          },
        },
  ),
});

export const collectIssueEntries = (document: SpecDocument, toolId: string): IssueEntry[] =>
  (document.issues ?? [])
    .filter((issue) => issue.toolId === undefined || issue.toolId === toolId)
    .map((issue) => {
      const sourceNode = getSpecNode(document, issue.sourceNodeId);
      const sourceLink =
        sourceNode?.links.find((link) => link.kind === 'file') ?? sourceNode?.links[0];

      return {
        ...issue,
        sourceLinkLabel: sourceLink?.label,
        sourceLinkTarget: sourceLink?.target,
        sourceNodeKind: sourceNode?.kind,
        sourceNodePath: sourceNode
          ? [
              ...getSpecNodeAncestors(document, sourceNode.id).map((entry) => entry.titleJa),
              sourceNode.titleJa,
            ]
          : ['Missing source node'],
        sourceNodeTitleJa: sourceNode?.titleJa ?? 'Missing source node',
      };
    })
    .sort(
      (left, right) =>
        issueStatuses.indexOf(left.status) - issueStatuses.indexOf(right.status) ||
        left.sourceNodePath.join(' > ').localeCompare(right.sourceNodePath.join(' > '), 'ja'),
    );

export const groupIssueEntriesByStatus = (
  entries: readonly IssueEntry[],
): Record<SpecNodeTaskStatus, IssueEntry[]> => ({
  open: entries.filter((entry) => entry.status === 'open'),
  proposed: entries.filter((entry) => entry.status === 'proposed'),
  accepted: entries.filter((entry) => entry.status === 'accepted'),
  done: entries.filter((entry) => entry.status === 'done'),
});

export const formatIssueShareText = (entry: IssueEntry): string => {
  const lines = [
    `Issue: ${entry.id}`,
    `Status: ${entry.status}`,
    `Text: ${entry.text}`,
    `Source: ${entry.sourceNodePath.join(' / ')}`,
    `Source Node ID: ${entry.sourceNodeId}`,
    'Data: SpecDocument.issues',
  ];

  if (entry.sourceLinkTarget) {
    lines.push(`Linked Data: ${entry.sourceLinkTarget}`);
  }

  if (entry.sourceLinkLabel) {
    lines.push(`Linked Label: ${entry.sourceLinkLabel}`);
  }

  if (entry.sourceItemId) {
    lines.push(`Source Item: ${entry.sourceItemId}`);
  }

  if (entry.screenId) {
    lines.push(`Screen: ${entry.screenId}`);
  }

  if (entry.componentId) {
    lines.push(`Component: ${entry.componentId}`);
  }

  if (entry.toolId) {
    lines.push(`Tool: ${entry.toolId}`);
  }

  return lines.join('\n');
};

export const updateIssueEntry = (
  document: SpecDocument,
  issueId: string,
  updater: (issue: SpecIssue) => Pick<SpecIssue, 'status' | 'text'>,
): SpecDocument => {
  const currentIssue = (document.issues ?? []).find((issue) => issue.id === issueId);

  if (!currentIssue) {
    return document;
  }

  const nextValues = updater(currentIssue);
  const nextDocument = {
    ...document,
    issues: (document.issues ?? []).map((issue) =>
      issue.id !== issueId
        ? issue
        : {
            ...issue,
            ...nextValues,
            updatedAt: nowIso(),
          },
    ),
  };

  return updateSourceDocItem(
    nextDocument,
    currentIssue.sourceNodeId,
    currentIssue.sourceItemId,
    (item) => ({
      ...item,
      kind: 'task',
      status: nextValues.status,
      text: nextValues.text,
    }),
  );
};

export const removeIssueEntry = (document: SpecDocument, issueId: string): SpecDocument => {
  const currentIssue = (document.issues ?? []).find((issue) => issue.id === issueId);

  if (!currentIssue) {
    return document;
  }

  const nextDocument = {
    ...document,
    issues: (document.issues ?? []).filter((issue) => issue.id !== issueId),
  };

  return updateSourceDocItem(
    nextDocument,
    currentIssue.sourceNodeId,
    currentIssue.sourceItemId,
    (item) => ({
      ...item,
      kind: 'item',
      status: undefined,
    }),
  );
};

export const moveIssueEntry = (
  document: SpecDocument,
  issueId: string,
  status: SpecNodeTaskStatus,
  targetIndex: number,
): SpecDocument => {
  const currentIssues = [...(document.issues ?? [])];
  const sourceIndex = currentIssues.findIndex((issue) => issue.id === issueId);

  if (sourceIndex < 0) {
    return document;
  }

  const [movedIssue] = currentIssues.splice(sourceIndex, 1);

  if (!movedIssue) {
    return document;
  }

  const nextIssue = {
    ...movedIssue,
    status,
    updatedAt: nowIso(),
  };
  const targetIssues = currentIssues.filter((issue) => issue.status === status);
  const clampedIndex = Math.max(0, Math.min(targetIndex, targetIssues.length));

  if (targetIssues.length === 0) {
    const insertIndex = currentIssues.findIndex(
      (issue) => issueStatuses.indexOf(issue.status) > issueStatuses.indexOf(status),
    );
    currentIssues.splice(insertIndex >= 0 ? insertIndex : currentIssues.length, 0, nextIssue);
    return updateSourceDocItem(
      { ...document, issues: currentIssues },
      nextIssue.sourceNodeId,
      nextIssue.sourceItemId,
      (item) => ({
        ...item,
        kind: 'task',
        status,
      }),
    );
  }

  const targetIssueId =
    clampedIndex >= targetIssues.length ? targetIssues.at(-1)?.id : targetIssues[clampedIndex]?.id;
  const insertBefore = clampedIndex < targetIssues.length;
  const targetFlatIndex = targetIssueId
    ? currentIssues.findIndex((issue) => issue.id === targetIssueId)
    : currentIssues.length;
  const insertIndex =
    targetFlatIndex < 0
      ? currentIssues.length
      : insertBefore
        ? targetFlatIndex
        : targetFlatIndex + 1;

  currentIssues.splice(insertIndex, 0, nextIssue);

  return updateSourceDocItem(
    { ...document, issues: currentIssues },
    nextIssue.sourceNodeId,
    nextIssue.sourceItemId,
    (item) => ({
      ...item,
      kind: 'task',
      status,
    }),
  );
};

const findDocItemById = (
  items: readonly import('./editor-schema').SpecNodeDocItem[],
  itemId: string,
): import('./editor-schema').SpecNodeDocItem | null => {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }

    const nested = findDocItemById(item.children, itemId);

    if (nested) {
      return nested;
    }
  }

  return null;
};

export const createIssueFromDocItem = (
  document: SpecDocument,
  sourceNodeId: string,
  sourceItemId: string,
): SpecDocument => {
  const sourceNode = getSpecNode(document, sourceNodeId);

  if (!sourceNode) {
    return document;
  }

  const sourceItem = findDocItemById(sourceNode.doc.items, sourceItemId);

  if (!sourceItem || sourceItem.kind === 'heading') {
    return document;
  }

  const existingIssue = (document.issues ?? []).find(
    (issue) => issue.sourceNodeId === sourceNodeId && issue.sourceItemId === sourceItemId,
  );

  if (existingIssue) {
    return updateSourceDocItem(document, sourceNodeId, sourceItemId, (item) => ({
      ...item,
      kind: 'task',
      status: existingIssue.status,
    }));
  }

  const timestamp = nowIso();
  const nextDocument = {
    ...document,
    issues: [
      ...(document.issues ?? []),
      {
        componentId: sourceNode.metadata?.componentId,
        createdAt: timestamp,
        id: createIssueId(),
        screenId: sourceNode.metadata?.screenId,
        sourceItemId,
        sourceNodeId,
        status: 'open' as const,
        text: sourceItem.text,
        toolId: sourceNode.metadata?.toolId,
        updatedAt: timestamp,
      },
    ],
  };

  return updateSourceDocItem(nextDocument, sourceNodeId, sourceItemId, (item) => ({
    ...item,
    kind: 'task',
    status: 'open',
  }));
};
