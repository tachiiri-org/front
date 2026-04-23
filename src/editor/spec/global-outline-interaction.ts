import { useEffect, useMemo, useState } from 'react';

import type { SpecNodeDocItem } from '../../spec/editor-schema';

type GlobalOutlineOptions = {
  readonly isActive: boolean;
  readonly items: readonly SpecNodeDocItem[];
  readonly selectedItemId: string | null;
  readonly onAddSibling: () => void;
  readonly onDeleteSelected: () => void;
  readonly onIndentSelected: () => void;
  readonly onMoveSelected: (direction: 'up' | 'down') => void;
  readonly onOutdentSelected: () => void;
  readonly onSelectVisible: (itemId: string) => void;
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

const collectVisibleGlobalItemIds = (items: readonly SpecNodeDocItem[]): string[] =>
  items.flatMap((item) => (item.id ? [item.id] : []));

const collectItemIds = (items: readonly SpecNodeDocItem[]): string[] =>
  items.flatMap((item) => (item.id ? [item.id] : []));

export const getVisibleGlobalItemIds = (
  items: readonly SpecNodeDocItem[],
  collapsedIds: ReadonlySet<string>,
): string[] => {
  void collapsedIds;
  return collectVisibleGlobalItemIds(items);
};

export const useGlobalOutlineState = ({
  isActive,
  items,
  selectedItemId,
  onAddSibling,
  onDeleteSelected,
  onIndentSelected,
  onMoveSelected,
  onOutdentSelected,
  onSelectVisible,
}: GlobalOutlineOptions) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const visibleItemIds = useMemo(
    () => getVisibleGlobalItemIds(items, collapsedIds),
    [collapsedIds, items],
  );

  useEffect(() => {
    setCollapsedIds((current) => {
      const allIds = new Set(collectItemIds(items));
      const next = new Set([...current].filter((itemId) => allIds.has(itemId)));

      return next.size === current.size ? current : next;
    });
  }, [items]);

  useEffect(() => {
    if (!isActive || !selectedItemId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.metaKey) {
        return;
      }

      if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
        const selectedIndex = visibleItemIds.indexOf(selectedItemId);

        if (event.key === 'ArrowUp' && selectedIndex > 0) {
          event.preventDefault();
          onSelectVisible(visibleItemIds[selectedIndex - 1]!);
          return;
        }

        if (event.key === 'ArrowDown' && selectedIndex >= 0) {
          const nextId = visibleItemIds[selectedIndex + 1];

          if (nextId) {
            event.preventDefault();
            onSelectVisible(nextId);
          }

          return;
        }
      }

      if (event.key === 'ArrowUp' && event.shiftKey && event.altKey && !event.ctrlKey) {
        event.preventDefault();
        onMoveSelected('up');
        return;
      }

      if (event.key === 'ArrowDown' && event.shiftKey && event.altKey && !event.ctrlKey) {
        event.preventDefault();
        onMoveSelected('down');
        return;
      }

      if (event.key === 'Delete' && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onDeleteSelected();
        return;
      }

      if (event.key === 'ArrowUp' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setCollapsedIds((current) => new Set(current).add(selectedItemId));
        return;
      }

      if (event.key === 'ArrowDown' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setCollapsedIds((current) => {
          const next = new Set(current);
          next.delete(selectedItemId);
          return next;
        });
        return;
      }

      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        onIndentSelected();
        return;
      }

      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && event.shiftKey) {
        event.preventDefault();
        onOutdentSelected();
        return;
      }

      if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        onAddSibling();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isActive,
    onAddSibling,
    onDeleteSelected,
    onIndentSelected,
    onMoveSelected,
    onOutdentSelected,
    onSelectVisible,
    selectedItemId,
    visibleItemIds,
  ]);

  const toggleCollapsed = (itemId: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      return next;
    });
  };

  return {
    collapsedIds,
    toggleCollapsed,
    visibleItemIds,
  };
};
