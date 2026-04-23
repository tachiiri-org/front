import { useEffect, useMemo, useState } from 'react';

import type { SpecNode } from '../../spec/editor-schema';

type SpecNodeOutlineOptions = {
  readonly isActive: boolean;
  readonly nodes: readonly SpecNode[];
  readonly selectedNodeId: string | null;
  readonly isSelectedManaged: boolean;
  readonly onAddSibling: () => void;
  readonly onDeleteSelected: () => void;
  readonly onIndentSelected: (newParentId: string) => void;
  readonly onOutdentSelected: () => void;
  readonly onMoveSelected: (direction: 'up' | 'down') => void;
  readonly onSelectVisible: (nodeId: string) => void;
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

const collectVisibleSpecNodeIds = (
  nodes: readonly SpecNode[],
  parentId: string | undefined,
  collapsedIds: ReadonlySet<string>,
): string[] => {
  const currentLevel = nodes.filter((node) => node.parentId === parentId);

  return currentLevel.flatMap((node) =>
    collapsedIds.has(node.id)
      ? [node.id]
      : [node.id, ...collectVisibleSpecNodeIds(nodes, node.id, collapsedIds)],
  );
};

export const getVisibleSpecNodeIds = (
  nodes: readonly SpecNode[],
  collapsedIds: ReadonlySet<string>,
): string[] => collectVisibleSpecNodeIds(nodes, undefined, collapsedIds);

export const useSpecNodeOutlineState = ({
  isActive,
  nodes,
  selectedNodeId,
  isSelectedManaged,
  onAddSibling,
  onDeleteSelected,
  onIndentSelected,
  onOutdentSelected,
  onMoveSelected,
  onSelectVisible,
}: SpecNodeOutlineOptions) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const visibleNodeIds = useMemo(
    () => getVisibleSpecNodeIds(nodes, collapsedIds),
    [collapsedIds, nodes],
  );

  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set(
        [...current].filter((nodeId) => nodes.some((entry) => entry.id === nodeId)),
      );

      return next.size === current.size ? current : next;
    });
  }, [nodes]);

  useEffect(() => {
    if (!isActive || !selectedNodeId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.metaKey) {
        return;
      }

      if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
        const selectedIndex = visibleNodeIds.indexOf(selectedNodeId);

        if (event.key === 'ArrowUp' && selectedIndex > 0) {
          event.preventDefault();
          onSelectVisible(visibleNodeIds[selectedIndex - 1]!);
          return;
        }

        if (event.key === 'ArrowDown' && selectedIndex >= 0) {
          const nextId = visibleNodeIds[selectedIndex + 1];

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
        setCollapsedIds((current) => new Set(current).add(selectedNodeId));
        return;
      }

      if (event.key === 'ArrowDown' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setCollapsedIds((current) => {
          const next = new Set(current);
          next.delete(selectedNodeId);
          return next;
        });
        return;
      }

      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (isSelectedManaged) {
          return;
        }

        event.preventDefault();
        const selectedIndex = visibleNodeIds.indexOf(selectedNodeId);
        const prevVisibleId = selectedIndex > 0 ? visibleNodeIds[selectedIndex - 1] : null;

        if (prevVisibleId) {
          onIndentSelected(prevVisibleId);
        }

        return;
      }

      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && event.shiftKey) {
        if (isSelectedManaged) {
          return;
        }

        event.preventDefault();
        onOutdentSelected();
        return;
      }

      if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        onAddSibling();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isActive,
    isSelectedManaged,
    onAddSibling,
    onDeleteSelected,
    onIndentSelected,
    onMoveSelected,
    onOutdentSelected,
    onSelectVisible,
    selectedNodeId,
    visibleNodeIds,
  ]);

  const toggleCollapsed = (nodeId: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });
  };

  return {
    collapsedIds,
    toggleCollapsed,
  };
};
