import type { SpecDocument, SpecNode, SpecNodeDoc } from '../../spec/editor-schema';
import { useEffect, useMemo, useState } from 'react';

import {
  createEmptyDocItem,
  findDocItemPathById,
  normalizeGlobalSpecNodeDocForOutline,
} from '../../spec/spec-node-doc';
import { useGlobalOutlineState } from './global-outline-interaction';
import { GlobalOutlineTree } from './global-outline-tree';
import {
  indentDocItems,
  insertDocItemAfterPath,
  getDocItemAtPath,
  moveDocItem,
  outdentDocItems,
  removeDocItem,
  setDocItemChildren,
  setDocItemText,
} from './doc-outliner-state';
import { useSpecNodeOutlineState } from './outline-interaction';
import { SpecOutlineTree } from './outline-tree';
import { SpecNodeDocOutliner } from './doc-outliner';
import {
  createSelectedGlobalDocumentNode,
  getSelectedGlobalOutlineItemId,
  getSelectedSpecOutlineNodeId,
  type SelectedDocumentSource,
} from './selected-document';
import { SearchableSelect, filterOptions } from '../ui/searchable-select';
import { TraceLinkInspector } from '../../components/editor/trace-link-inspector';
import {
  addConcern,
  addSpecNode,
  addTool,
  addTraceLink,
  removeTool,
  removeTraceLink,
  reorderSpecNode,
  updateSpecNode,
  updateTool,
  updateTraceLink,
} from '../../state/editor';
import {
  exportSpecNodeContextPrompt,
  getDefaultSelectedSpecNodeId,
  getGlobalSpecNode,
  getSpecNode,
  getToolSpecNodeId,
} from '../../spec/editor-document';
import { createIssueFromDocItem, removeIssueEntry } from '../../spec/issue-view';
import { removeSpecNodeWithCascade } from '../../state/editor/spec-node-state';

type SpecPanelProps = {
  readonly document: SpecDocument;
  readonly applyDocument: (
    doc: SpecDocument,
    options?: { readonly nextSelectedSpecNodeId?: string | null },
  ) => Promise<void>;
  readonly selectedSpecNodeId: string | null;
  readonly setSelectedSpecNodeId: (id: string | null) => void;
  readonly selectedToolId: string;
  readonly setSelectedToolId: (id: string) => void;
  readonly toolSearch: string;
  readonly setToolSearch: (value: string) => void;
  readonly activeEditorSurface: 'outline' | 'document' | 'links' | 'global' | null;
  readonly setActiveEditorSurface: (
    surface: 'outline' | 'document' | 'links' | 'global' | null,
  ) => void;
  readonly specNodes: readonly SpecNode[];
  readonly selectedSpecNode: SpecNode | null;
};

export const SpecPanel = ({
  document,
  applyDocument,
  selectedSpecNodeId,
  setSelectedSpecNodeId,
  selectedToolId,
  setSelectedToolId,
  toolSearch,
  setToolSearch,
  activeEditorSurface,
  setActiveEditorSurface,
  specNodes,
  selectedSpecNode,
}: SpecPanelProps) => {
  const filteredTools = filterOptions(document.tools, toolSearch);
  const globalNode = getGlobalSpecNode(document);
  const globalOutlineItems = useMemo(
    () => (globalNode ? normalizeGlobalSpecNodeDocForOutline(globalNode.doc).items : []),
    [globalNode],
  );
  const [selectedGlobalItemId, setSelectedGlobalItemId] = useState<string | null>(
    globalOutlineItems[0]?.id ?? null,
  );
  const [selectedDocumentSource, setSelectedDocumentSource] =
    useState<SelectedDocumentSource>('spec');
  const selectedGlobalItemPath = useMemo(
    () =>
      selectedGlobalItemId ? findDocItemPathById(globalOutlineItems, selectedGlobalItemId) : null,
    [globalOutlineItems, selectedGlobalItemId],
  );
  const selectedGlobalItem = useMemo(
    () =>
      selectedGlobalItemPath ? getDocItemAtPath(globalOutlineItems, selectedGlobalItemPath) : null,
    [globalOutlineItems, selectedGlobalItemPath],
  );
  const isEditingGlobalDocument = selectedDocumentSource === 'global' && !!selectedGlobalItem;
  const selectedDocumentNode =
    isEditingGlobalDocument && globalNode && selectedGlobalItem
      ? createSelectedGlobalDocumentNode(globalNode, selectedGlobalItem)
      : selectedSpecNode;

  useEffect(() => {
    if (globalOutlineItems.length === 0) {
      setSelectedGlobalItemId(null);
      return;
    }

    setSelectedGlobalItemId((current) =>
      current && findDocItemPathById(globalOutlineItems, current) !== null
        ? current
        : (globalOutlineItems[0]?.id ?? null),
    );
  }, [globalOutlineItems]);

  const updateGlobalOutline = (
    updater: (
      items: ReturnType<typeof normalizeGlobalSpecNodeDocForOutline>['items'],
    ) => ReturnType<typeof normalizeGlobalSpecNodeDocForOutline>['items'],
  ): void => {
    if (!globalNode) {
      return;
    }

    void applyDocument(
      updateSpecNode(document, globalNode.id, (node) => ({
        ...node,
        doc: {
          items: updater(normalizeGlobalSpecNodeDocForOutline(node.doc).items),
        },
      })),
    );
  };

  const { collapsedIds: collapsedSpecNodeIds, toggleCollapsed: toggleSpecNodeCollapsed } =
    useSpecNodeOutlineState({
      isActive: activeEditorSurface === 'outline',
      nodes: specNodes,
      selectedNodeId: selectedSpecNodeId,
      isSelectedManaged: selectedSpecNode?.metadata?.managed === 'synced',
      onSelectVisible: (nodeId) => {
        setSelectedSpecNodeId(nodeId);
        setSelectedDocumentSource('spec');
        setActiveEditorSurface('outline');
      },
      onAddSibling: () => {
        if (!selectedSpecNode) {
          return;
        }

        const nextDocument = addSpecNode(
          document,
          selectedSpecNode.kind,
          selectedSpecNode.parentId,
        );
        const nextNodeId = nextDocument.specNodes?.at(-1)?.id ?? selectedSpecNode.id;

        setSelectedDocumentSource('spec');
        setActiveEditorSurface('document');
        void applyDocument(nextDocument, { nextSelectedSpecNodeId: nextNodeId });
      },
      onDeleteSelected: () => {
        if (!selectedSpecNodeId) {
          return;
        }

        setSelectedDocumentSource('spec');
        setActiveEditorSurface('outline');
        void applyDocument(removeSpecNodeWithCascade(document, selectedSpecNodeId), {
          nextSelectedSpecNodeId: getDefaultSelectedSpecNodeId(
            removeSpecNodeWithCascade(document, selectedSpecNodeId),
          ),
        });
      },
      onIndentSelected: (newParentId) => {
        if (!selectedSpecNode) {
          return;
        }

        setSelectedDocumentSource('spec');
        setActiveEditorSurface('outline');
        void applyDocument(
          updateSpecNode(document, selectedSpecNode.id, (node) => ({
            ...node,
            parentId: newParentId,
            order: specNodes.filter((n) => n.parentId === newParentId).length,
          })),
        );
      },
      onOutdentSelected: () => {
        if (!selectedSpecNode) {
          return;
        }

        const parent = selectedSpecNode.parentId
          ? getSpecNode(document, selectedSpecNode.parentId)
          : null;
        const grandParentId = parent?.parentId;

        setSelectedDocumentSource('spec');
        setActiveEditorSurface('outline');
        void applyDocument(
          updateSpecNode(document, selectedSpecNode.id, (node) => ({
            ...node,
            parentId: grandParentId,
            order: specNodes.filter((n) => n.parentId === grandParentId).length,
          })),
        );
      },
      onMoveSelected: (direction) => {
        if (!selectedSpecNodeId) {
          return;
        }

        setSelectedDocumentSource('spec');
        setActiveEditorSurface('outline');
        void applyDocument(reorderSpecNode(document, selectedSpecNodeId, direction));
      },
    });
  const {
    collapsedIds: collapsedGlobalItemIds,
    toggleCollapsed: toggleGlobalItemCollapsed,
    visibleItemIds: visibleGlobalItemIds,
  } = useGlobalOutlineState({
    isActive: activeEditorSurface === 'global',
    items: globalOutlineItems,
    selectedItemId: selectedGlobalItemId,
    onSelectVisible: (itemId) => {
      setSelectedGlobalItemId(itemId);
      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
    },
    onAddSibling: () => {
      if (!selectedGlobalItemId) {
        return;
      }

      const path = findDocItemPathById(globalOutlineItems, selectedGlobalItemId);

      if (!path) {
        return;
      }

      const inserted = createEmptyDocItem();
      const result = insertDocItemAfterPath(globalOutlineItems, path, inserted);
      setSelectedGlobalItemId(inserted.id ?? null);
      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
      updateGlobalOutline(() => result.items);
    },
    onDeleteSelected: () => {
      if (!selectedGlobalItemId) {
        return;
      }

      const path = findDocItemPathById(globalOutlineItems, selectedGlobalItemId);

      if (!path) {
        return;
      }

      const selectedIndex = visibleGlobalItemIds.indexOf(selectedGlobalItemId);
      const nextSelectedId =
        visibleGlobalItemIds[selectedIndex + 1] ?? visibleGlobalItemIds[selectedIndex - 1] ?? null;
      setSelectedGlobalItemId(nextSelectedId);
      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
      updateGlobalOutline((items) => removeDocItem(items, path));
    },
    onIndentSelected: () => {
      if (!selectedGlobalItemId) {
        return;
      }

      const path = findDocItemPathById(globalOutlineItems, selectedGlobalItemId);

      if (!path) {
        return;
      }

      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
      updateGlobalOutline((items) => indentDocItems(items, path));
    },
    onOutdentSelected: () => {
      if (!selectedGlobalItemId) {
        return;
      }

      const path = findDocItemPathById(globalOutlineItems, selectedGlobalItemId);

      if (!path) {
        return;
      }

      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
      updateGlobalOutline((items) => outdentDocItems(items, path));
    },
    onMoveSelected: (direction) => {
      if (!selectedGlobalItemId) {
        return;
      }

      const path = findDocItemPathById(globalOutlineItems, selectedGlobalItemId);

      if (!path) {
        return;
      }

      setSelectedDocumentSource('global');
      setActiveEditorSurface('global');
      updateGlobalOutline((items) => moveDocItem(items, path, direction));
    },
  });

  return (
    <section className="editor-layout editor-layout--spec">
      <aside className="editor-panel--spec-outline editor-panel--spec-sidebar">
        <SearchableSelect
          addLabel="Tool"
          items={filteredTools}
          label="Tool"
          onAdd={() => {
            const nextDocument = addTool(document);
            const nextToolId = nextDocument.tools.at(-1)?.id ?? selectedToolId;
            setSelectedToolId(nextToolId);
            setToolSearch('');
            setSelectedDocumentSource('spec');
            void applyDocument(nextDocument, {
              nextSelectedSpecNodeId: getToolSpecNodeId(nextToolId),
            });
          }}
          onDelete={() => {
            const nextDocument = removeTool(document, selectedToolId);
            const nextToolId =
              nextDocument.tools.find((tool) => tool.id !== selectedToolId)?.id ??
              nextDocument.tools[0]?.id ??
              selectedToolId;
            setSelectedToolId(nextToolId);
            setToolSearch('');
            setSelectedDocumentSource('spec');
            void applyDocument(nextDocument, {
              nextSelectedSpecNodeId: getDefaultSelectedSpecNodeId(nextDocument, nextToolId),
            });
          }}
          onSearchChange={setToolSearch}
          onSelect={(toolId) => {
            setSelectedToolId(toolId);
            setSelectedDocumentSource('spec');
            setSelectedSpecNodeId(getDefaultSelectedSpecNodeId(document, toolId));
          }}
          search={toolSearch}
          selectedId={selectedToolId}
          selectedLabel={document.tools.find((item) => item.id === selectedToolId)?.nameJa ?? ''}
        />
        <section className="editor-panel--spec-global">
          <GlobalOutlineTree
            collapsedIds={collapsedGlobalItemIds}
            items={globalOutlineItems}
            selectedItemId={getSelectedGlobalOutlineItemId(
              selectedDocumentSource,
              selectedGlobalItemId,
            )}
            title={globalNode?.titleJa ?? 'Global'}
            onAddRootItem={() => {
              const inserted = createEmptyDocItem();
              setSelectedGlobalItemId(inserted.id ?? null);
              setSelectedDocumentSource('global');
              setActiveEditorSurface('global');
              updateGlobalOutline((items) => [...items, inserted]);
            }}
            onDelete={(itemId) => {
              const path = findDocItemPathById(globalOutlineItems, itemId);

              if (!path) {
                return;
              }

              const selectedIndex = visibleGlobalItemIds.indexOf(itemId);
              const nextSelectedId =
                visibleGlobalItemIds[selectedIndex + 1] ??
                visibleGlobalItemIds[selectedIndex - 1] ??
                null;
              setSelectedGlobalItemId(nextSelectedId);
              setSelectedDocumentSource('global');
              setActiveEditorSurface('global');
              updateGlobalOutline((items) => removeDocItem(items, path));
            }}
            onRename={(itemId, text) => {
              const path = findDocItemPathById(globalOutlineItems, itemId);

              if (!path) {
                return;
              }

              setSelectedDocumentSource('global');
              setActiveEditorSurface('global');
              updateGlobalOutline((items) => setDocItemText(items, path, text));
            }}
            onSelect={(itemId) => {
              setSelectedGlobalItemId(itemId);
              setSelectedDocumentSource('global');
              setActiveEditorSurface('global');
            }}
            onToggleCollapse={toggleGlobalItemCollapsed}
          />
        </section>
        <SpecOutlineTree
          collapsedIds={collapsedSpecNodeIds}
          nodes={specNodes}
          onAddConcern={() => {
            const nextDocument = addConcern(document);
            const nextConcernId = nextDocument.concerns.at(-1)?.id ?? null;

            setSelectedDocumentSource('spec');
            void applyDocument(nextDocument, {
              nextSelectedSpecNodeId: nextConcernId
                ? `concern-node:${selectedToolId}:${nextConcernId}`
                : selectedSpecNodeId,
            });
          }}
          onDelete={(nodeId) => {
            setSelectedDocumentSource('spec');
            setActiveEditorSurface('outline');
            void applyDocument(removeSpecNodeWithCascade(document, nodeId), {
              nextSelectedSpecNodeId:
                nodeId === selectedSpecNodeId
                  ? getDefaultSelectedSpecNodeId(removeSpecNodeWithCascade(document, nodeId))
                  : selectedSpecNodeId,
            });
          }}
          onRename={(nodeId, titleJa, titleEn) => {
            setSelectedDocumentSource('spec');
            setActiveEditorSurface('outline');
            void applyDocument(
              updateSpecNode(document, nodeId, (node) => ({
                ...node,
                titleEn,
                titleJa,
              })),
            );
          }}
          onSelect={(nodeId) => {
            setSelectedSpecNodeId(nodeId);
            setSelectedDocumentSource('spec');
            setActiveEditorSurface('outline');
          }}
          onToggleCollapse={toggleSpecNodeCollapsed}
          selectedNodeId={getSelectedSpecOutlineNodeId(selectedDocumentSource, selectedSpecNodeId)}
        />
      </aside>
      <SpecNodeDocOutliner
        hideActions
        node={selectedDocumentNode}
        readonlyTitle={isEditingGlobalDocument}
        onClearIssue={(item) => {
          const sourceNode = isEditingGlobalDocument && globalNode ? globalNode : selectedSpecNode;

          if (!sourceNode || !item.id) {
            return;
          }

          const linkedIssue = (document.issues ?? []).find(
            (issue) => issue.sourceNodeId === sourceNode.id && issue.sourceItemId === item.id,
          );

          if (!linkedIssue) {
            return;
          }

          setSelectedDocumentSource(isEditingGlobalDocument ? 'global' : 'spec');
          setActiveEditorSurface('document');
          void applyDocument(removeIssueEntry(document, linkedIssue.id));
        }}
        onCreateIssue={(item) => {
          const sourceNode = isEditingGlobalDocument && globalNode ? globalNode : selectedSpecNode;

          if (!sourceNode || !item.id) {
            return;
          }

          setSelectedDocumentSource(isEditingGlobalDocument ? 'global' : 'spec');
          setActiveEditorSurface('document');
          void applyDocument(createIssueFromDocItem(document, sourceNode.id, item.id));
        }}
        sourceText={
          selectedDocumentNode ? exportSpecNodeContextPrompt(document, selectedDocumentNode.id) : ''
        }
        onActivate={() => {
          setSelectedDocumentSource(isEditingGlobalDocument ? 'global' : 'spec');
          setActiveEditorSurface('document');
        }}
        onRenameTitle={(titleJa) => {
          if (isEditingGlobalDocument) {
            if (!titleJa.trim() || !selectedGlobalItemPath) {
              return;
            }

            void applyDocument(
              updateSpecNode(document, globalNode!.id, (node) => ({
                ...node,
                doc: {
                  items: setDocItemText(
                    normalizeGlobalSpecNodeDocForOutline(node.doc).items,
                    selectedGlobalItemPath,
                    titleJa.trim(),
                  ),
                },
              })),
            );
            return;
          }

          if (!selectedSpecNode || !titleJa.trim()) return;
          if (selectedSpecNode.kind === 'global') {
            return;
          }
          if (selectedSpecNode.kind === 'tool' && selectedSpecNode.metadata?.toolId) {
            void applyDocument(
              updateTool(document, selectedSpecNode.metadata.toolId, (tool) => ({
                ...tool,
                nameEn: titleJa.trim(),
                nameJa: titleJa.trim(),
              })),
            );
            return;
          }

          void applyDocument(
            updateSpecNode(document, selectedSpecNode.id, (n) => ({
              ...n,
              titleJa: titleJa.trim(),
            })),
          );
        }}
        onChange={(updater) => {
          if (isEditingGlobalDocument) {
            if (!globalNode || !selectedGlobalItemPath || !selectedGlobalItem) {
              return;
            }

            setSelectedDocumentSource('global');
            setActiveEditorSurface('document');
            void applyDocument(
              updateSpecNode(document, globalNode.id, (n) => ({
                ...n,
                doc: {
                  items: setDocItemChildren(
                    normalizeGlobalSpecNodeDocForOutline(n.doc).items,
                    selectedGlobalItemPath,
                    updater({ items: selectedGlobalItem.children }).items,
                  ),
                },
              })),
            );
            return;
          }

          if (!selectedSpecNode) {
            return;
          }

          setSelectedDocumentSource('spec');
          setActiveEditorSurface('document');
          void applyDocument(
            updateSpecNode(document, selectedSpecNode.id, (n) => ({
              ...n,
              doc: updater(n.doc as SpecNodeDoc),
            })),
          );
        }}
      />
      <TraceLinkInspector
        links={selectedSpecNode?.links ?? []}
        onAdd={(kind) => {
          if (!selectedSpecNode) {
            return;
          }

          setActiveEditorSurface('links');
          void applyDocument(addTraceLink(document, selectedSpecNode.id, kind));
        }}
        onChange={(linkId, field, value) => {
          if (!selectedSpecNode) {
            return;
          }

          setActiveEditorSurface('links');
          void applyDocument(
            updateTraceLink(document, selectedSpecNode.id, linkId, (link) => ({
              ...link,
              [field]: value,
            })),
          );
        }}
        onRemove={(linkId) => {
          if (!selectedSpecNode) {
            return;
          }

          setActiveEditorSurface('links');
          void applyDocument(removeTraceLink(document, selectedSpecNode.id, linkId));
        }}
      />
    </section>
  );
};
