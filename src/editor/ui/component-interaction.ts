import { useEffect, useMemo, useState } from 'react';

import type { ComponentInstance } from '../../spec/editor-schema';

type OutlineKeyboardOptions = {
  readonly isActive: boolean;
  readonly canAssignParent: (componentId: string, parentId: string | undefined) => boolean;
  readonly components: readonly ComponentInstance[];
  readonly onAddSibling: () => void;
  readonly onDeleteSelected: () => void;
  readonly onIndentSelected: (parentId: string | undefined) => void;
  readonly onMoveSelected: (direction: 'up' | 'down') => void;
  readonly onOutdentSelected: () => void;
  readonly onSelectVisible: (componentId: string) => void;
  readonly selectedComponentId: string | null;
};

type OutlineMoveShortcutKey = 'ArrowUp' | 'ArrowDown';

export const getOutlineHierarchyAction = (
  key: string,
  modifiers: {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
  },
): 'indent' | 'outdent' | null => {
  if (key !== 'Tab' || modifiers.altKey || modifiers.ctrlKey) {
    return null;
  }

  return modifiers.shiftKey ? 'outdent' : 'indent';
};

export const isOutlineAddShortcut = (
  key: string,
  modifiers: {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
  },
): boolean => key === 'Enter' && modifiers.ctrlKey && !modifiers.altKey && !modifiers.shiftKey;

export const getOutlineMoveDirection = (
  key: string,
  modifiers: {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
  },
): 'up' | 'down' | null => {
  if (!modifiers.shiftKey || !modifiers.altKey || modifiers.ctrlKey) {
    return null;
  }

  if (key === 'ArrowUp') {
    return 'up';
  }

  if (key === 'ArrowDown') {
    return 'down';
  }

  return null;
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

const collectVisibleIds = (
  components: readonly ComponentInstance[],
  parentId: string | undefined,
  collapsedIds: ReadonlySet<string>,
): string[] => {
  const currentLevel = components.filter((component) => component.parentId === parentId);

  return currentLevel.flatMap((component) =>
    collapsedIds.has(component.id)
      ? [component.id]
      : [component.id, ...collectVisibleIds(components, component.id, collapsedIds)],
  );
};

export const getVisibleComponentIds = (
  components: readonly ComponentInstance[],
  collapsedIds: ReadonlySet<string>,
): string[] => collectVisibleIds(components, undefined, collapsedIds);

export const useComponentOutlineState = ({
  isActive,
  canAssignParent,
  components,
  onAddSibling,
  onDeleteSelected,
  onIndentSelected,
  onMoveSelected,
  onOutdentSelected,
  onSelectVisible,
  selectedComponentId,
}: OutlineKeyboardOptions) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const visibleComponentIds = useMemo(
    () => getVisibleComponentIds(components, collapsedIds),
    [collapsedIds, components],
  );

  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set(
        [...current].filter((componentId) => components.some((entry) => entry.id === componentId)),
      );

      return next.size === current.size ? current : next;
    });
  }, [components]);

  useEffect(() => {
    if (!isActive || !selectedComponentId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.metaKey) {
        return;
      }

      const hierarchyAction = getOutlineHierarchyAction(event.key, {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      });

      if (hierarchyAction === 'indent') {
        event.preventDefault();
        const selectedIndex = visibleComponentIds.indexOf(selectedComponentId);
        const previousVisibleId = selectedIndex > 0 ? visibleComponentIds[selectedIndex - 1] : null;

        if (!previousVisibleId || !canAssignParent(selectedComponentId, previousVisibleId)) {
          return;
        }

        onIndentSelected(previousVisibleId);
        return;
      }

      if (hierarchyAction === 'outdent') {
        event.preventDefault();
        onOutdentSelected();
        return;
      }

      if (
        isOutlineAddShortcut(event.key, {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        })
      ) {
        event.preventDefault();
        onAddSibling();
        return;
      }

      if (event.key === 'Delete' && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onDeleteSelected();
        return;
      }

      if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
        const selectedIndex = visibleComponentIds.indexOf(selectedComponentId);

        if (event.key === 'ArrowUp' && selectedIndex > 0) {
          event.preventDefault();
          onSelectVisible(visibleComponentIds[selectedIndex - 1]!);
          return;
        }

        if (event.key === 'ArrowDown' && selectedIndex >= 0) {
          const nextId = visibleComponentIds[selectedIndex + 1];

          if (nextId) {
            event.preventDefault();
            onSelectVisible(nextId);
          }

          return;
        }
      }

      const moveDirection = getOutlineMoveDirection(event.key as OutlineMoveShortcutKey, {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      });

      if (moveDirection) {
        event.preventDefault();
        onMoveSelected(moveDirection);
        return;
      }

      if (event.ctrlKey && !event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        setCollapsedIds((current) => new Set(current).add(selectedComponentId));
        return;
      }

      if (event.ctrlKey && !event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        setCollapsedIds((current) => {
          const next = new Set(current);
          next.delete(selectedComponentId);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    canAssignParent,
    isActive,
    onAddSibling,
    onDeleteSelected,
    onIndentSelected,
    onMoveSelected,
    onOutdentSelected,
    onSelectVisible,
    selectedComponentId,
    visibleComponentIds,
  ]);

  const toggleCollapsed = (componentId: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current);

      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }

      return next;
    });
  };

  return {
    collapsedIds,
    toggleCollapsed,
  };
};
