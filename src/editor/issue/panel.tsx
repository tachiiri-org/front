import { useEffect, useMemo, useRef, useState } from 'react';

import type { SpecDocument, SpecNodeTaskStatus } from '../../spec/editor-schema';
import {
  issueStatuses,
  collectIssueEntries,
  formatIssueShareText,
  groupIssueEntriesByStatus,
  moveIssueEntry,
  removeIssueEntry,
  updateIssueEntry,
  type IssueEntry,
} from '../../spec/issue-view';
import { getToolSpecNodeId } from '../../spec/editor-document';
import { addTool, removeTool } from '../../state/editor';
import { SearchableSelect, filterOptions } from '../ui/searchable-select';
import { IssueEditor } from './editor';

type IssuePanelProps = {
  readonly document: SpecDocument;
  readonly applyDocument: (
    doc: SpecDocument,
    options?: { readonly nextSelectedSpecNodeId?: string | null },
  ) => Promise<void>;
  readonly selectedIssueId: string | null;
  readonly setSelectedIssueId: (id: string | null) => void;
  readonly selectedToolId: string;
  readonly setSelectedToolId: (id: string) => void;
  readonly toolSearch: string;
  readonly setToolSearch: (value: string) => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    tagName === 'OPTION'
  );
};

export const isIssueRenameShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean => event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey;

export const isIssueDeleteShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): boolean =>
  event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

const taskStatusLabel: Record<SpecNodeTaskStatus, string> = {
  open: 'Open',
  proposed: 'Proposed',
  accepted: 'Accepted',
  done: 'Done',
};

export const IssuePanel = ({
  document,
  applyDocument,
  selectedIssueId,
  setSelectedIssueId,
  selectedToolId,
  setSelectedToolId,
  toolSearch,
  setToolSearch,
}: IssuePanelProps) => {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<SpecNodeTaskStatus>>(
    () => new Set(),
  );
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [draftIssueText, setDraftIssueText] = useState('');
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dropMarker, setDropMarker] = useState<string | null>(null);
  const filteredTools = filterOptions(document.tools, toolSearch);
  const entries = useMemo(
    () => collectIssueEntries(document, selectedToolId),
    [document, selectedToolId],
  );
  const entriesByStatus = useMemo(() => groupIssueEntriesByStatus(entries), [entries]);
  const selectedEntry = entries.find((entry) => entry.id === selectedIssueId) ?? null;
  const visibleIssueIds = useMemo(
    () =>
      issueStatuses.flatMap((status) =>
        collapsedStatuses.has(status) ? [] : entriesByStatus[status].map((entry) => entry.id),
      ),
    [collapsedStatuses, entriesByStatus],
  );

  useEffect(() => {
    if (!selectedIssueId || editingIssueId) {
      return;
    }

    itemRefs.current.get(selectedIssueId)?.focus();
  }, [editingIssueId, selectedIssueId]);

  useEffect(() => {
    if (!editingIssueId) {
      return;
    }

    const input = inputRefs.current.get(editingIssueId);

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingIssueId]);

  useEffect(() => {
    if (!selectedIssueId || visibleIssueIds.includes(selectedIssueId)) {
      return;
    }

    setSelectedIssueId(visibleIssueIds[0] ?? null);
  }, [selectedIssueId, setSelectedIssueId, visibleIssueIds]);

  const startEditing = (entry: IssueEntry): void => {
    setEditingIssueId(entry.id);
    setDraftIssueText(entry.text);
    setSelectedIssueId(entry.id);
  };

  const finishEditing = (entry: IssueEntry): void => {
    const nextText = draftIssueText.trim();

    if (nextText.length > 0) {
      void applyDocument(
        updateIssueEntry(document, entry.id, () => ({ status: entry.status, text: nextText })),
      );
    }

    setEditingIssueId(null);
  };

  const deleteSelectedIssue = (): void => {
    if (!selectedEntry) {
      return;
    }

    const nextVisibleIds = visibleIssueIds.filter((id) => id !== selectedEntry.id);
    setEditingIssueId(null);
    setSelectedIssueId(nextVisibleIds[0] ?? null);
    void applyDocument(removeIssueEntry(document, selectedEntry.id));
  };

  const moveToTarget = (
    draggedId: string,
    status: SpecNodeTaskStatus,
    targetIndex: number,
  ): void => {
    setDropMarker(null);
    setDraggedIssueId(null);
    void applyDocument(moveIssueEntry(document, draggedId, status, targetIndex));
  };

  const copyIssueSummary = async (entry: IssueEntry): Promise<void> => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    setSelectedIssueId(entry.id);
    await navigator.clipboard.writeText(formatIssueShareText(entry));
  };

  useEffect(() => {
    if (!selectedIssueId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.metaKey) {
        return;
      }

      if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
        const selectedIndex = visibleIssueIds.indexOf(selectedIssueId);

        if (event.key === 'ArrowUp' && selectedIndex > 0) {
          event.preventDefault();
          setSelectedIssueId(visibleIssueIds[selectedIndex - 1] ?? null);
          return;
        }

        if (event.key === 'ArrowDown' && selectedIndex >= 0) {
          const nextId = visibleIssueIds[selectedIndex + 1];

          if (nextId) {
            event.preventDefault();
            setSelectedIssueId(nextId);
          }

          return;
        }
      }

      if (isIssueDeleteShortcut(event)) {
        event.preventDefault();
        deleteSelectedIssue();
        return;
      }

      if (isIssueRenameShortcut(event)) {
        const entry = entries.find((item) => item.id === selectedIssueId);

        if (!entry) {
          return;
        }

        event.preventDefault();
        startEditing(entry);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [entries, selectedIssueId, visibleIssueIds]);

  return (
    <section className="editor-layout editor-layout--issue">
      <aside className="editor-panel--spec-outline editor-panel--issue-sidebar">
        <SearchableSelect
          addLabel="Tool"
          items={filteredTools}
          label="Tool"
          onAdd={() => {
            const nextDocument = addTool(document);
            const nextToolId = nextDocument.tools.at(-1)?.id ?? selectedToolId;
            setSelectedToolId(nextToolId);
            setToolSearch('');
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
            setSelectedIssueId(null);
            void applyDocument(nextDocument, {
              nextSelectedSpecNodeId: getToolSpecNodeId(nextToolId),
            });
          }}
          onSearchChange={setToolSearch}
          onSelect={(toolId) => {
            setSelectedToolId(toolId);
            setSelectedIssueId(null);
          }}
          search={toolSearch}
          selectedId={selectedToolId}
          selectedLabel={document.tools.find((item) => item.id === selectedToolId)?.nameJa ?? ''}
        />

        <div className="issue-outline">
          {issueStatuses.map((status) => {
            const items = entriesByStatus[status];
            const isCollapsed = collapsedStatuses.has(status);

            return (
              <section className="issue-outline__group" key={status}>
                <button
                  type="button"
                  data-testid={`issue-group:${status}`}
                  className="issue-outline__group-header"
                  onClick={() =>
                    setCollapsedStatuses((current) => {
                      const next = new Set(current);

                      if (next.has(status)) {
                        next.delete(status);
                      } else {
                        next.add(status);
                      }

                      return next;
                    })
                  }
                  onDragOver={(event) => {
                    if (!draggedIssueId) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropMarker(`group:${status}`);
                  }}
                  onDragLeave={() => {
                    setDropMarker((current) => (current === `group:${status}` ? null : current));
                  }}
                  onDrop={(event) => {
                    if (!draggedIssueId) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    moveToTarget(draggedIssueId, status, items.length);
                  }}
                >
                  <span className="issue-outline__toggle" aria-hidden="true">
                    {isCollapsed ? '+' : '-'}
                  </span>
                  <span className="issue-outline__group-label">{taskStatusLabel[status]}</span>
                  <span className="issue-outline__count">{items.length}</span>
                </button>

                {isCollapsed ? null : (
                  <div
                    className={`issue-outline__items${dropMarker === `group:${status}` ? ' is-drop-target' : ''}`}
                  >
                    {items.length === 0 ? (
                      <p className="editor-empty issue-outline__empty">No issues.</p>
                    ) : (
                      <ol className="issue-outline__list">
                        {items.map((entry, index) => (
                          <li key={entry.id} className="issue-outline__list-item">
                            {dropMarker === `${entry.id}:before` ? (
                              <span className="issue-outline__drop-indicator issue-outline__drop-indicator--before" />
                            ) : null}
                            {editingIssueId === entry.id ? (
                              <input
                                ref={(node) => {
                                  if (node) {
                                    inputRefs.current.set(entry.id, node);
                                  } else {
                                    inputRefs.current.delete(entry.id);
                                  }
                                }}
                                className="issue-outline__item-input"
                                lang="ja"
                                spellCheck={false}
                                value={draftIssueText}
                                onBlur={() => finishEditing(entry)}
                                onChange={(event) => setDraftIssueText(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    finishEditing(entry);
                                  }

                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingIssueId(null);
                                  }
                                }}
                              />
                            ) : (
                              <div
                                className={`issue-outline__item-row${selectedIssueId === entry.id ? ' is-selected' : ''}`}
                              >
                                <button
                                  ref={(node) => {
                                    if (node) {
                                      itemRefs.current.set(entry.id, node);
                                    } else {
                                      itemRefs.current.delete(entry.id);
                                    }
                                  }}
                                  type="button"
                                  data-testid={`issue-item:${entry.id}`}
                                  className={`issue-outline__item${selectedIssueId === entry.id ? ' is-selected' : ''}`}
                                  draggable
                                  onClick={() => setSelectedIssueId(entry.id)}
                                  onDoubleClick={() => startEditing(entry)}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', entry.id);
                                    setDraggedIssueId(entry.id);
                                    setSelectedIssueId(entry.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedIssueId(null);
                                    setDropMarker(null);
                                  }}
                                  onDragOver={(event) => {
                                    if (!draggedIssueId || draggedIssueId === entry.id) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = 'move';
                                    const bounds = event.currentTarget.getBoundingClientRect();
                                    const placement =
                                      event.clientY < bounds.top + bounds.height / 2
                                        ? 'before'
                                        : 'after';
                                    setDropMarker(`${entry.id}:${placement}`);
                                  }}
                                  onDragLeave={() => {
                                    setDropMarker((current) =>
                                      current?.startsWith(`${entry.id}:`) ? null : current,
                                    );
                                  }}
                                  onDrop={(event) => {
                                    if (!draggedIssueId || draggedIssueId === entry.id) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    const placement = dropMarker?.endsWith(':before')
                                      ? 'before'
                                      : 'after';
                                    moveToTarget(
                                      draggedIssueId,
                                      status,
                                      index + (placement === 'after' ? 1 : 0),
                                    );
                                  }}
                                >
                                  <span className="issue-outline__item-body">
                                    <span className="issue-outline__item-text">{entry.text}</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="issue-outline__copy-button"
                                  aria-label={`Copy issue context for ${entry.text}`}
                                  title="Copy issue context"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void copyIssueSummary(entry);
                                  }}
                                >
                                  <svg aria-hidden="true" viewBox="0 0 16 16">
                                    <rect
                                      x="5"
                                      y="3"
                                      width="8"
                                      height="8"
                                      rx="1.5"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.25"
                                    />
                                    <rect
                                      x="3"
                                      y="5"
                                      width="8"
                                      height="8"
                                      rx="1.5"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.25"
                                    />
                                  </svg>
                                </button>
                              </div>
                            )}
                            {dropMarker === `${entry.id}:after` ? (
                              <span className="issue-outline__drop-indicator issue-outline__drop-indicator--after" />
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>

      <IssueEditor
        issue={selectedEntry}
        onChangeIssueText={(issueId, text) => {
          void applyDocument(
            updateIssueEntry(document, issueId, (issue) => ({ status: issue.status, text })),
          );
        }}
        onChangeStatus={(status) => {
          if (!selectedEntry) {
            return;
          }

          const targetIndex = entriesByStatus[status].findIndex(
            (entry) => entry.id === selectedEntry.id,
          );
          void applyDocument(
            moveIssueEntry(
              document,
              selectedEntry.id,
              status,
              targetIndex >= 0 ? targetIndex : entriesByStatus[status].length,
            ),
          );
        }}
      />
    </section>
  );
};
