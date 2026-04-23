import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { ComponentInstance, NamedOption } from '../../spec/editor-schema';

type ComponentTreeProps = {
  readonly collapsedIds: ReadonlySet<string>;
  readonly components: readonly ComponentInstance[];
  readonly isActive: boolean;
  readonly onAdd: () => void;
  readonly onAddScreen: () => void;
  readonly onDeleteScreen: () => void;
  readonly onDeleteSelected: () => void;
  readonly onMoveScreen: (screenId: string, direction: 'up' | 'down') => void;
  readonly onRename: (componentId: string, nameJa: string) => void;
  readonly onRenameScreen: (screenId: string, nameJa: string) => void;
  readonly onSelect: (componentId: string) => void;
  readonly onSelectScreen: (screenId: string) => void;
  readonly onToggleCollapse: (componentId: string) => void;
  readonly screens: readonly NamedOption[];
  readonly selectedComponentId: string | null;
  readonly selectedScreenId: string;
};

export const isOutlineRenameShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean => event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey;

export const ComponentTree = ({
  collapsedIds,
  components,
  isActive,
  onAdd,
  onAddScreen,
  onDeleteScreen,
  onDeleteSelected,
  onMoveScreen,
  onRename,
  onRenameScreen,
  onSelect,
  onSelectScreen,
  onToggleCollapse,
  screens,
  selectedComponentId,
  selectedScreenId,
}: ComponentTreeProps) => {
  const labelRefs = useRef(new Map<string, HTMLButtonElement>());
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const screenInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [draftNameJa, setDraftNameJa] = useState('');
  const [editingScreenId, setEditingScreenId] = useState<string | null>(null);
  const [draftScreenNameJa, setDraftScreenNameJa] = useState('');

  useEffect(() => {
    if (!isActive || !selectedComponentId || editingComponentId) {
      return;
    }

    labelRefs.current.get(selectedComponentId)?.focus();
  }, [editingComponentId, isActive, selectedComponentId]);

  useEffect(() => {
    if (!editingComponentId) {
      return;
    }

    const input = inputRefs.current.get(editingComponentId);

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingComponentId]);

  useEffect(() => {
    if (editingComponentId && editingComponentId !== selectedComponentId) {
      setEditingComponentId(null);
    }
  }, [editingComponentId, selectedComponentId]);

  useEffect(() => {
    if (!editingScreenId) {
      return;
    }

    const input = screenInputRefs.current.get(editingScreenId);

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingScreenId]);

  const startEditingScreen = (screen: NamedOption): void => {
    setEditingScreenId(screen.id);
    setDraftScreenNameJa(screen.nameJa);
  };

  const finishEditingScreen = (screenId: string): void => {
    const nextNameJa = draftScreenNameJa.trim();

    if (nextNameJa) {
      onRenameScreen(screenId, nextNameJa);
    }

    setEditingScreenId(null);
  };

  const startEditing = (component: ComponentInstance): void => {
    setEditingComponentId(component.id);
    setDraftNameJa(component.nameJa);
  };

  const finishEditing = (componentId: string): void => {
    const nextNameJa = draftNameJa.trim();

    if (nextNameJa) {
      onRename(componentId, nextNameJa);
    }

    setEditingComponentId(null);
  };

  const renderTreeWithRefs = (parentId: string | undefined, depth: number): ReactNode => {
    const currentLevel = components.filter((component) => component.parentId === parentId);

    if (currentLevel.length === 0) {
      return null;
    }

    return (
      <ul className="component-tree">
        {currentLevel.map((component) => {
          const hasChildren = components.some((entry) => entry.parentId === component.id);
          const isCollapsed = collapsedIds.has(component.id);
          const isEditing = editingComponentId === component.id;

          return (
            <li key={component.id}>
              <div
                className={`component-tree__item${selectedComponentId === component.id ? ' is-selected' : ''}${selectedComponentId === component.id && isActive ? ' is-surface-active' : ''}`}
                style={{ '--component-tree-depth': depth } as CSSProperties}
              >
                <button
                  type="button"
                  className="component-tree__toggle"
                  aria-label={
                    isCollapsed ? `Expand ${component.nameJa}` : `Collapse ${component.nameJa}`
                  }
                  disabled={!hasChildren}
                  onClick={() => onToggleCollapse(component.id)}
                >
                  {hasChildren ? (isCollapsed ? '+' : '-') : ''}
                </button>
                {isEditing ? (
                  <input
                    ref={(node) => {
                      if (node) {
                        inputRefs.current.set(component.id, node);
                      } else {
                        inputRefs.current.delete(component.id);
                      }
                    }}
                    className="component-tree__input"
                    value={draftNameJa}
                    onBlur={() => finishEditing(component.id)}
                    onChange={(event) => setDraftNameJa(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishEditing(component.id);
                        return;
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingComponentId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    ref={(node) => {
                      if (node) {
                        labelRefs.current.set(component.id, node);
                      } else {
                        labelRefs.current.delete(component.id);
                      }
                    }}
                    type="button"
                    className="component-tree__label"
                    onClick={() => onSelect(component.id)}
                    onDoubleClick={() => startEditing(component)}
                    onKeyDown={(event) => {
                      if (!isOutlineRenameShortcut(event)) {
                        return;
                      }

                      event.preventDefault();
                      startEditing(component);
                    }}
                  >
                    <span className="component-tree__title">{component.nameJa}</span>
                  </button>
                )}
                {selectedComponentId === component.id ? (
                  <button
                    type="button"
                    className="component-tree__action"
                    aria-label="Delete component"
                    onClick={onDeleteSelected}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {!isCollapsed ? renderTreeWithRefs(component.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section className="editor-component-outline">
      <div className="editor-component-outline__header">
        <span>Outline</span>
        <button
          type="button"
          className="editor-tree-add-button"
          aria-label="Add screen"
          onClick={onAddScreen}
        >
          +
        </button>
      </div>
      <ul className="component-tree">
        {screens.map((screen) => {
          const isSelected = screen.id === selectedScreenId;
          const isEditingScreen = editingScreenId === screen.id;

          return (
            <li key={screen.id}>
              <div
                className={`component-tree__item component-tree__item--screen${isSelected ? ' is-selected' : ''}`}
                style={{ '--component-tree-depth': 0 } as CSSProperties}
              >
                <button
                  type="button"
                  className="component-tree__toggle"
                  aria-label={isSelected ? `Collapse ${screen.nameJa}` : `Expand ${screen.nameJa}`}
                  onClick={() => onSelectScreen(screen.id)}
                >
                  {isSelected ? '−' : '+'}
                </button>
                {isEditingScreen ? (
                  <input
                    ref={(node) => {
                      if (node) {
                        screenInputRefs.current.set(screen.id, node);
                      } else {
                        screenInputRefs.current.delete(screen.id);
                      }
                    }}
                    className="component-tree__input"
                    value={draftScreenNameJa}
                    onBlur={() => finishEditingScreen(screen.id)}
                    onChange={(event) => setDraftScreenNameJa(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishEditingScreen(screen.id);
                        return;
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingScreenId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="component-tree__label"
                    onClick={() => onSelectScreen(screen.id)}
                    onDoubleClick={() => startEditingScreen(screen)}
                    onKeyDown={(event) => {
                      if (isOutlineRenameShortcut(event)) {
                        event.preventDefault();
                        startEditingScreen(screen);
                        return;
                      }

                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        onMoveScreen(screen.id, 'up');
                        return;
                      }

                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        onMoveScreen(screen.id, 'down');
                        return;
                      }

                      if (event.key === 'Delete') {
                        if (window.confirm('このスクリーンを削除しますか？')) {
                          onDeleteScreen();
                        }
                      }
                    }}
                  >
                    <span className="component-tree__title">{screen.nameJa}</span>
                  </button>
                )}
                {isSelected ? (
                  <button
                    type="button"
                    className="component-tree__action"
                    aria-label="Delete screen"
                    disabled={screens.length <= 1}
                    onClick={onDeleteScreen}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {isSelected ? (
                <>
                  <div className="component-tree__section-header">
                    <span>Components</span>
                    <button
                      type="button"
                      className="editor-tree-add-button"
                      aria-label="Add component"
                      onClick={onAdd}
                    >
                      +
                    </button>
                  </div>
                  {renderTreeWithRefs(undefined, 1) ?? (
                    <p className="editor-empty component-tree__empty">
                      No components in this viewport.
                    </p>
                  )}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
