import { useEffect, useMemo, useRef, useState } from 'react';

import type { SpecNodeDocItem } from '../../spec/editor-schema';

type GlobalOutlineTreeProps = {
  readonly collapsedIds: ReadonlySet<string>;
  readonly items: readonly SpecNodeDocItem[];
  readonly selectedItemId: string | null;
  readonly title: string;
  readonly onAddRootItem: () => void;
  readonly onDelete: (itemId: string) => void;
  readonly onRename: (itemId: string, text: string) => void;
  readonly onSelect: (itemId: string) => void;
  readonly onToggleCollapse: (itemId: string) => void;
};

const isRenameShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean => event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey;

export const GlobalOutlineTree = ({
  collapsedIds,
  items,
  selectedItemId,
  title,
  onAddRootItem,
  onDelete,
  onRename,
  onSelect,
  onToggleCollapse,
}: GlobalOutlineTreeProps) => {
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const itemsById = useMemo(() => {
    const next = new Map<string, SpecNodeDocItem>();

    const collect = (entries: readonly SpecNodeDocItem[]): void => {
      entries.forEach((item) => {
        if (item.id) {
          next.set(item.id, item);
        }
        collect(item.children);
      });
    };

    collect(items);
    return next;
  }, [items]);

  useEffect(() => {
    if (!editingItemId) {
      return;
    }

    const input = inputRefs.current.get(editingItemId);

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingItemId]);

  const startEditing = (itemId: string): void => {
    const item = itemsById.get(itemId);

    if (!item) {
      return;
    }

    setEditingItemId(itemId);
    setDraftText(item.text);
  };

  const finishEditing = (itemId: string): void => {
    const nextText = draftText.trim();

    if (nextText.length > 0) {
      onRename(itemId, nextText);
    }

    setEditingItemId(null);
  };

  const renderItems = (entries: readonly SpecNodeDocItem[]) => {
    if (entries.length === 0) {
      return null;
    }

    return (
      <ul className="spec-outline-tree">
        {entries.map((item) => {
          if (!item.id) {
            return null;
          }

          const itemId = item.id;
          const isEditing = editingItemId === itemId;
          const isCollapsed = collapsedIds.has(itemId);
          const isSelected = selectedItemId === itemId;
          const hasChildren = item.children.length > 0;

          return (
            <li key={itemId}>
              <div className={`spec-outline-tree__item${isSelected ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  className="spec-outline-tree__toggle"
                  disabled={!hasChildren}
                  onClick={() => onToggleCollapse(itemId)}
                >
                  {hasChildren ? (isCollapsed ? '+' : '-') : ''}
                </button>
                {isEditing ? (
                  <input
                    ref={(element) => {
                      if (element) {
                        inputRefs.current.set(itemId, element);
                      } else {
                        inputRefs.current.delete(itemId);
                      }
                    }}
                    className="spec-outline-tree__input"
                    lang="ja"
                    value={draftText}
                    onBlur={() => finishEditing(itemId)}
                    onChange={(event) => setDraftText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishEditing(itemId);
                        return;
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingItemId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="spec-outline-tree__label"
                    onClick={() => onSelect(itemId)}
                    onDoubleClick={() => startEditing(itemId)}
                    onKeyDown={(event) => {
                      if (isRenameShortcut(event)) {
                        event.preventDefault();
                        startEditing(itemId);
                      }
                    }}
                  >
                    <span>{item.text || 'Untitled'}</span>
                  </button>
                )}
                <div className="spec-outline-tree__actions">
                  <button type="button" onClick={() => onDelete(itemId)}>
                    ×
                  </button>
                </div>
              </div>
              {isCollapsed ? null : renderItems(item.children)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <aside className="editor-panel--spec-outline">
      <div className="editor-panel__header">
        <button
          type="button"
          className="spec-outline-tree__label"
          onClick={() => setCollapsed((current) => !current)}
        >
          <span>{collapsed ? '+' : '-'}</span>
          <span>{title}</span>
        </button>
        {collapsed ? null : (
          <button type="button" className="editor-tree-add-button" onClick={onAddRootItem}>
            +
          </button>
        )}
      </div>
      {collapsed ? null : (renderItems(items) ?? <p className="editor-empty">No global items.</p>)}
    </aside>
  );
};
