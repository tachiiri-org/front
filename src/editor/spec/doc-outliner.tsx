import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { SpecNode, SpecNodeDoc, SpecNodeDocItem } from '../../spec/editor-schema';
import { normalizeSpecNodeDocForEditing } from '../../spec/spec-node-doc';

import {
  createEmptyDocItem,
  flattenDocItems,
  getIndentedPath,
  getMovedPath,
  getOutdentedPath,
  indentDocItems,
  insertChildDocItem,
  moveDocItem,
  outdentDocItems,
  parsePastedDocItems,
  removeDocItem,
  replaceDocItemWithItems,
  setDocItemHeadingLevel,
  setDocItemText,
  splitDocItem,
  type DocItemPath,
} from './doc-outliner-state';

import './doc-outliner.css';

type SpecNodeDocOutlinerProps = {
  readonly collapsible?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly hideActions?: boolean;
  readonly hideHeader?: boolean;
  readonly hideKindBadge?: boolean;
  readonly highlightSelection?: boolean;
  readonly readonlyTitle?: boolean;
  readonly selectedPath?: DocItemPath | null;
  readonly node: SpecNode | null;
  readonly sourceText?: string;
  readonly taskStatusMode?: 'inline' | 'hidden';
  readonly onActivate: () => void;
  readonly onChange: (updater: (doc: SpecNodeDoc) => SpecNodeDoc) => void;
  readonly onClearIssue?: (item: SpecNodeDocItem) => void;
  readonly onCreateIssue?: (item: SpecNodeDocItem) => void;
  readonly onRenameTitle: (titleJa: string) => void;
  readonly onSelectPath?: (path: DocItemPath, item: SpecNodeDocItem) => void;
};

export const isCreateIssueShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): boolean =>
  event.key.toLowerCase() === 'i' &&
  event.shiftKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.metaKey;

const taskStatusLabel: Record<NonNullable<SpecNodeDocItem['status']>, string> = {
  open: 'Open',
  proposed: 'Proposed',
  accepted: 'Accepted',
  done: 'Done',
};

const autoResize = (el: HTMLTextAreaElement): void => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

const getItemKey = (path: DocItemPath): string => path.join('.');

const getHeadingLevelFromShortcut = (
  event: Pick<React.KeyboardEvent<HTMLTextAreaElement>, 'code' | 'shiftKey'>,
  allowBareDigit = false,
): 1 | 2 | 3 | 4 | 5 | 6 | null => {
  if (!event.code.startsWith('Digit')) {
    return null;
  }

  const level = Number(event.code.replace('Digit', ''));

  if (level < 1 || level > 6 || (!event.shiftKey && !allowBareDigit)) {
    return null;
  }

  return level as 1 | 2 | 3 | 4 | 5 | 6;
};

const getMarkerLabel = (item: SpecNodeDocItem): string => {
  switch (item.kind) {
    case 'heading':
      return `H${item.headingLevel ?? 1}`;
    case 'task':
      return 'Task';
    case 'item':
      return 'Bullet';
  }
};

const getMarkerText = (item: SpecNodeDocItem): string => {
  if (item.kind === 'heading') {
    return '#'.repeat(item.headingLevel ?? 1);
  }

  return item.kind === 'task' ? '◦' : '•';
};

export const SpecNodeDocOutliner = ({
  collapsible = false,
  defaultCollapsed = false,
  hideActions = false,
  hideHeader = false,
  hideKindBadge = false,
  highlightSelection = true,
  node,
  readonlyTitle = false,
  selectedPath = null,
  sourceText = '',
  taskStatusMode = 'inline',
  onActivate,
  onChange,
  onClearIssue,
  onCreateIssue,
  onRenameTitle,
  onSelectPath,
}: SpecNodeDocOutlinerProps) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [viewMode, setViewMode] = useState<'edit' | 'source'>('edit');
  const [titleDraft, setTitleDraft] = useState(node?.titleJa ?? '');
  const headingShortcutRef = useRef<{
    readonly itemKey: string;
    readonly expiresAt: number;
  } | null>(null);
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());

  useEffect(() => {
    setTitleDraft(node?.titleJa ?? '');
  }, [node?.id, node?.titleJa]);

  useEffect(() => {
    if (!selectedPath || viewMode === 'source') {
      return;
    }

    setTimeout(() => focusKey(getItemKey(selectedPath)), 0);
  }, [node?.id, selectedPath, viewMode]);

  const editableDoc = useMemo(
    () => (node ? normalizeSpecNodeDocForEditing(node.doc) : { items: [] }),
    [node],
  );

  const flattenedItems = useMemo(() => flattenDocItems(editableDoc.items), [editableDoc]);

  if (!node) {
    return (
      <section className="spec-doc-outliner">
        <p className="editor-empty">Select a spec node.</p>
      </section>
    );
  }

  const allVisibleKeys = flattenedItems.map(({ path }) => getItemKey(path));

  const updateDocItems = (updater: (items: SpecNodeDocItem[]) => SpecNodeDocItem[]): void => {
    onChange((current) => ({
      ...current,
      items: updater(normalizeSpecNodeDocForEditing(current).items),
    }));
  };

  const focusKey = (key: string, cursorPos?: number): void => {
    const el = textareaRefs.current.get(key);

    if (!el) {
      return;
    }

    el.focus();
    const pos = cursorPos ?? el.value.length;
    el.setSelectionRange(pos, pos);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    path: DocItemPath,
    item: SpecNodeDocItem,
  ): void => {
    const currentKey = getItemKey(path);
    const currentIdx = allVisibleKeys.indexOf(currentKey);
    const el = e.currentTarget;
    const pendingHeadingShortcut = headingShortcutRef.current;
    const pendingHeadingLevel =
      pendingHeadingShortcut &&
      pendingHeadingShortcut.itemKey === currentKey &&
      pendingHeadingShortcut.expiresAt > Date.now()
        ? getHeadingLevelFromShortcut(e, true)
        : null;

    if (pendingHeadingLevel) {
      e.preventDefault();
      headingShortcutRef.current = null;
      updateDocItems((current) => setDocItemHeadingLevel(current, path, pendingHeadingLevel));
      return;
    }

    if (e.key.toLowerCase() === 'h' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      headingShortcutRef.current = {
        itemKey: currentKey,
        expiresAt: Date.now() + 1200,
      };
      updateDocItems((current) => setDocItemHeadingLevel(current, path, 1));
      return;
    }

    const directHeadingLevel = getHeadingLevelFromShortcut(e);

    if (directHeadingLevel) {
      e.preventDefault();
      updateDocItems((current) => setDocItemHeadingLevel(current, path, directHeadingLevel));
      return;
    }

    if (isCreateIssueShortcut(e)) {
      if (item.kind !== 'heading' && item.id && onCreateIssue) {
        e.preventDefault();
        onCreateIssue(item);
      }
      return;
    }

    if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey && !e.altKey) {
      e.preventDefault();
      updateDocItems((current) => removeDocItem(current, path));

      const neighborKey = allVisibleKeys[currentIdx + 1] ?? allVisibleKeys[currentIdx - 1] ?? null;

      if (neighborKey) {
        setTimeout(() => focusKey(neighborKey), 0);
      }

      return;
    }

    if (e.key === 'Backspace' && item.text === '') {
      e.preventDefault();
      updateDocItems((current) => removeDocItem(current, path));

      if (currentIdx > 0) {
        setTimeout(() => focusKey(allVisibleKeys[currentIdx - 1]!), 0);
      }

      return;
    }

    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const nextPath = e.shiftKey
        ? getOutdentedPath(path)
        : getIndentedPath(editableDoc.items, path);
      updateDocItems((current) =>
        e.shiftKey ? outdentDocItems(current, path) : indentDocItems(current, path),
      );
      setTimeout(() => focusKey(getItemKey(nextPath), el.selectionStart ?? item.text.length), 0);
      return;
    }

    if (e.key === 'ArrowUp' && e.shiftKey && e.altKey && !e.ctrlKey) {
      e.preventDefault();
      const nextPath = getMovedPath(editableDoc.items, path, 'up');
      updateDocItems((current) => moveDocItem(current, path, 'up'));
      setTimeout(() => focusKey(getItemKey(nextPath), el.selectionStart ?? item.text.length), 0);
      return;
    }

    if (e.key === 'ArrowDown' && e.shiftKey && e.altKey && !e.ctrlKey) {
      e.preventDefault();
      const nextPath = getMovedPath(editableDoc.items, path, 'down');
      updateDocItems((current) => moveDocItem(current, path, 'down'));
      setTimeout(() => focusKey(getItemKey(nextPath), el.selectionStart ?? item.text.length), 0);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();

      if (item.kind === 'heading' && item.children.length === 0) {
        updateDocItems((current) => insertChildDocItem(current, path, createEmptyDocItem()));
        setTimeout(() => focusKey(getItemKey([...path, 0]), 0), 0);
        return;
      }

      const cursorPos = el.selectionStart ?? item.text.length;
      const result = splitDocItem(editableDoc.items, path, cursorPos);
      updateDocItems(() => result.items);
      setTimeout(() => focusKey(getItemKey(result.focusPath), 0), 0);
      return;
    }

    if (
      e.key === 'ArrowUp' &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0
    ) {
      if (currentIdx > 0) {
        e.preventDefault();
        focusKey(allVisibleKeys[currentIdx - 1]!);
      }
      return;
    }

    if (
      e.key === 'ArrowDown' &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      el.selectionStart === item.text.length &&
      el.selectionEnd === item.text.length
    ) {
      if (currentIdx < allVisibleKeys.length - 1) {
        e.preventDefault();
        focusKey(allVisibleKeys[currentIdx + 1]!, 0);
      }
    }
  };

  return (
    <section className="spec-doc-outliner" onFocus={onActivate}>
      {hideHeader ? null : (
        <div className="spec-doc-outliner__header">
          {collapsible ? (
            <button
              type="button"
              className="spec-doc-outliner__collapse"
              aria-label={collapsed ? 'Expand section' : 'Collapse section'}
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? '+' : '-'}
            </button>
          ) : null}
          <input
            className="spec-doc-outliner__title-input"
            readOnly={readonlyTitle}
            lang="ja"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (readonlyTitle) {
                return;
              }
              if (titleDraft.trim() && titleDraft.trim() !== node.titleJa) {
                onRenameTitle(titleDraft.trim());
              } else {
                setTitleDraft(node.titleJa);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }

              if (e.key === 'Escape') {
                setTitleDraft(node.titleJa);
                e.currentTarget.blur();
              }
            }}
          />
          {hideKindBadge ? null : <span className="spec-doc-outliner__kind">{node.kind}</span>}
          {hideActions ? null : (
            <>
              <button
                type="button"
                className="spec-doc-outliner__add"
                title="Add root item"
                onClick={() => {
                  updateDocItems((current) => [...current, createEmptyDocItem()]);
                  setTimeout(() => focusKey(getItemKey([editableDoc.items.length]), 0), 0);
                }}
              >
                +
              </button>
              <button
                type="button"
                className={`spec-doc-outliner__source-toggle${viewMode === 'source' ? ' is-active' : ''}`}
                title="Toggle source view"
                onClick={() => setViewMode((m) => (m === 'source' ? 'edit' : 'source'))}
              >
                {'{ }'}
              </button>
            </>
          )}
        </div>
      )}

      {collapsed ? null : viewMode === 'source' ? (
        <pre className="spec-doc-outliner__source">{sourceText}</pre>
      ) : (
        <div className="spec-doc-outliner__outline">
          {flattenedItems.length === 0 ? (
            <button
              type="button"
              className="spec-doc-outliner__empty-action"
              aria-label="Add first item"
              onClick={() => {
                updateDocItems((current) => [...current, createEmptyDocItem()]);
                setTimeout(() => focusKey(getItemKey([0]), 0), 0);
              }}
            />
          ) : (
            flattenedItems.map(({ depth, item, path }) => (
              <div
                key={getItemKey(path)}
                className={`spec-doc-outliner__item-row spec-doc-outliner__item-row--${item.kind}${highlightSelection && selectedPath?.join('.') === path.join('.') ? ' is-selected' : ''}`}
                style={{ '--doc-depth': depth } as CSSProperties}
              >
                {item.kind === 'task' && taskStatusMode === 'inline' ? (
                  <button
                    type="button"
                    className="spec-doc-outliner__checkbox"
                    aria-label={`Issue status: ${taskStatusLabel[item.status ?? 'open']}`}
                    title={`Issue status: ${taskStatusLabel[item.status ?? 'open']}`}
                    onClick={() => onClearIssue?.(item)}
                  >
                    <input type="checkbox" checked={false} readOnly tabIndex={-1} />
                  </button>
                ) : (
                  <span
                    className={`spec-doc-outliner__bullet${item.kind === 'heading' ? ` spec-doc-outliner__bullet--heading-${item.headingLevel ?? 1}` : ''}`}
                    aria-label={getMarkerLabel(item)}
                  >
                    {getMarkerText(item)}
                  </span>
                )}
                <textarea
                  ref={(el) => {
                    const key = getItemKey(path);

                    if (el) {
                      textareaRefs.current.set(key, el);
                      autoResize(el);
                    } else {
                      textareaRefs.current.delete(key);
                    }
                  }}
                  className={`spec-doc-outliner__item-textarea spec-doc-outliner__item-textarea--${item.kind}${item.text ? '' : ' spec-doc-outliner__item-textarea--ghost'}${
                    item.kind === 'heading'
                      ? ` spec-doc-outliner__item-textarea--heading-${item.headingLevel ?? 1}`
                      : ''
                  }`}
                  lang="ja"
                  value={item.text}
                  placeholder={
                    item.kind === 'heading'
                      ? 'Heading'
                      : item.kind === 'task'
                        ? 'Task'
                        : 'List item'
                  }
                  rows={1}
                  onChange={(e) => {
                    updateDocItems((current) => setDocItemText(current, path, e.target.value));
                    autoResize(e.currentTarget);
                  }}
                  onFocus={() => onSelectPath?.(path, item)}
                  onKeyDown={(e) => handleKeyDown(e, path, item)}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text/plain');

                    if (!pasted.includes('\n')) {
                      return;
                    }

                    const parsedItems = parsePastedDocItems(pasted);

                    if (parsedItems.length === 0) {
                      return;
                    }

                    event.preventDefault();
                    const result = replaceDocItemWithItems(editableDoc.items, path, parsedItems);
                    updateDocItems(() => result.items);
                    setTimeout(() => focusKey(getItemKey(result.focusPath), 0), 0);
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
