import { useEffect } from 'react';

import {
  expandComponentToEdge,
  moveComponentToEdge,
  nudgeComponent,
  resizeComponentByKeyboard,
} from '../../state/editor';
import type { SpecDocument, ViewportId } from '../../spec/editor-schema';

export type InteractionState = {
  readonly componentId: string;
  readonly mode: 'move' | 'resize';
  readonly originX: number;
  readonly originY: number;
} | null;

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

type CanvasKeyboardOptions = {
  readonly applyDocument: (nextDocument: SpecDocument) => Promise<void>;
  readonly document: SpecDocument | null;
  readonly isActive: boolean;
  readonly onDeleteSelected: () => void;
  readonly selectedComponentId: string | null;
  readonly selectedScreenId: string;
  readonly selectedViewportId: ViewportId;
};

export const useCanvasSelectionKeyboard = ({
  applyDocument,
  document,
  isActive,
  onDeleteSelected,
  selectedComponentId,
  selectedScreenId,
  selectedViewportId,
}: CanvasKeyboardOptions): void => {
  useEffect(() => {
    if (!isActive || !document || !selectedComponentId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || event.metaKey) {
        return;
      }

      const movementByKey = {
        ArrowLeft: { x: -1, y: 0, w: -1, h: 0 },
        ArrowRight: { x: 1, y: 0, w: 1, h: 0 },
        ArrowUp: { x: 0, y: -1, w: 0, h: -1 },
        ArrowDown: { x: 0, y: 1, w: 0, h: 1 },
      } as const;

      const delta = movementByKey[event.key as keyof typeof movementByKey];

      if (event.key === 'Delete' && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onDeleteSelected();
        return;
      }

      if (!delta || event.altKey) {
        return;
      }

      event.preventDefault();

      const nextDocument =
        event.ctrlKey && event.shiftKey
          ? expandComponentToEdge(
              document,
              selectedScreenId,
              selectedViewportId,
              selectedComponentId,
              event.key === 'ArrowLeft'
                ? 'left'
                : event.key === 'ArrowRight'
                  ? 'right'
                  : event.key === 'ArrowUp'
                    ? 'up'
                    : 'down',
            )
          : event.ctrlKey
            ? moveComponentToEdge(
                document,
                selectedScreenId,
                selectedViewportId,
                selectedComponentId,
                event.key === 'ArrowLeft'
                  ? 'left'
                  : event.key === 'ArrowRight'
                    ? 'right'
                    : event.key === 'ArrowUp'
                      ? 'up'
                      : 'down',
              )
            : event.shiftKey
              ? resizeComponentByKeyboard(
                  document,
                  selectedScreenId,
                  selectedViewportId,
                  selectedComponentId,
                  { w: delta.w, h: delta.h },
                )
              : nudgeComponent(
                  document,
                  selectedScreenId,
                  selectedViewportId,
                  selectedComponentId,
                  {
                    x: delta.x,
                    y: delta.y,
                  },
                );

      if (nextDocument === document) {
        return;
      }

      void applyDocument(nextDocument);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    applyDocument,
    document,
    isActive,
    onDeleteSelected,
    selectedComponentId,
    selectedScreenId,
    selectedViewportId,
  ]);
};
