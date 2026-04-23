import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { SpecNode } from '../../spec/editor-schema';

type SpecOutlineTreeProps = {
  readonly collapsedIds: ReadonlySet<string>;
  readonly nodes: readonly SpecNode[];
  readonly onAddConcern: () => void;
  readonly onDelete: (nodeId: string) => void;
  readonly onRename: (nodeId: string, titleJa: string, titleEn: string) => void;
  readonly onSelect: (nodeId: string) => void;
  readonly onToggleCollapse: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
};

const isRenameShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean => event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey;

export const SpecOutlineTree = ({
  collapsedIds,
  nodes,
  onAddConcern,
  onDelete,
  onRename,
  onSelect,
  onToggleCollapse,
  selectedNodeId,
}: SpecOutlineTreeProps) => {
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftTitleJa, setDraftTitleJa] = useState('');

  useEffect(() => {
    if (!editingNodeId) {
      return;
    }

    const input = inputRefs.current.get(editingNodeId);

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingNodeId]);

  const startEditing = (node: SpecNode): void => {
    setEditingNodeId(node.id);
    setDraftTitleJa(node.titleJa);
  };

  const finishEditing = (nodeId: string): void => {
    const current = nodes.find((node) => node.id === nodeId);
    const nextTitleJa = draftTitleJa.trim();

    if (current && nextTitleJa.length > 0) {
      onRename(nodeId, nextTitleJa, current.titleEn);
    }

    setEditingNodeId(null);
  };

  const renderNodes = (parentId?: string): ReactNode => {
    const currentLevel = nodes.filter((node) => node.parentId === parentId);

    if (currentLevel.length === 0) {
      return null;
    }

    return (
      <ul className="spec-outline-tree">
        {currentLevel.map((node) => {
          const childNodes = nodes.filter((child) => child.parentId === node.id);
          const isCollapsed = collapsedIds.has(node.id);
          const isEditing = editingNodeId === node.id;
          const isManaged = node.metadata?.managed === 'synced';

          return (
            <li key={node.id}>
              <div
                className={`spec-outline-tree__item${selectedNodeId === node.id ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="spec-outline-tree__toggle"
                  disabled={childNodes.length === 0}
                  onClick={() => onToggleCollapse(node.id)}
                >
                  {childNodes.length > 0 ? (isCollapsed ? '+' : '-') : ''}
                </button>
                {isEditing ? (
                  <input
                    ref={(element) => {
                      if (element) {
                        inputRefs.current.set(node.id, element);
                      } else {
                        inputRefs.current.delete(node.id);
                      }
                    }}
                    className="spec-outline-tree__input"
                    lang="ja"
                    value={draftTitleJa}
                    onBlur={() => finishEditing(node.id)}
                    onChange={(event) => setDraftTitleJa(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishEditing(node.id);
                        return;
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingNodeId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="spec-outline-tree__label"
                    onClick={() => onSelect(node.id)}
                    onDoubleClick={() => {
                      if (isManaged) {
                        return;
                      }

                      startEditing(node);
                    }}
                    onKeyDown={(event) => {
                      if (!isManaged && isRenameShortcut(event)) {
                        event.preventDefault();
                        startEditing(node);
                      }
                    }}
                  >
                    <span>{node.titleJa}</span>
                  </button>
                )}
                <div className="spec-outline-tree__actions">
                  <button type="button" onClick={() => onDelete(node.id)}>
                    ×
                  </button>
                </div>
              </div>
              {!isCollapsed ? renderNodes(node.id) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <aside className="editor-panel--spec-outline">
      <div className="editor-panel__header">
        <span>Spec Outline</span>
        <button type="button" className="editor-tree-add-button" onClick={onAddConcern}>
          + Concern
        </button>
      </div>
      {renderNodes() ?? <p className="editor-empty">No spec nodes.</p>}
    </aside>
  );
};
