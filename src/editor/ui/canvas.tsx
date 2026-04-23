import { useEffect, useRef, useState } from 'react';

import { componentCatalogMap } from '../../catalog/components';
import {
  viewportDisplayPresets,
  type ComponentInstance,
  type ViewportId,
} from '../../spec/editor-schema';

type CanvasProps = {
  readonly components: readonly ComponentInstance[];
  readonly isActive: boolean;
  readonly onPointerDownMove: (componentId: string, clientX: number, clientY: number) => void;
  readonly onPointerDownResize: (componentId: string, clientX: number, clientY: number) => void;
  readonly onUpdatePrimaryText: (componentId: string, value: string) => void;
  readonly onSelect: (componentId: string | null) => void;
  readonly selectedComponentId: string | null;
  readonly viewportId: ViewportId;
};

export const calculateCanvasSize = (
  availableWidth: number,
  availableHeight: number,
  aspectRatio: number,
): { readonly width: number; readonly height: number } => {
  const nextWidth = Math.max(
    0,
    Math.floor(Math.min(availableWidth, availableHeight * aspectRatio)),
  );
  const nextHeight = Math.max(0, Math.floor(nextWidth / aspectRatio));

  return { width: nextWidth, height: nextHeight };
};

export const isCanvasPrimaryTextEditShortcut = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean => event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey;

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

export const Canvas = ({
  components,
  isActive,
  onPointerDownMove,
  onPointerDownResize,
  onUpdatePrimaryText,
  onSelect,
  selectedComponentId,
  viewportId,
}: CanvasProps) => {
  const shellRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [draftPrimaryText, setDraftPrimaryText] = useState('');
  const viewportPreset = viewportDisplayPresets[viewportId];
  const sortedComponents = [...components].sort(
    (left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0),
  );
  const selectedComponent = sortedComponents.find(
    (component) => component.id === selectedComponentId,
  );
  const selectedDefinition = selectedComponent
    ? componentCatalogMap[selectedComponent.type]
    : undefined;
  const selectedPrimaryTextProp = selectedDefinition?.primaryTextProp;
  const selectionOverlayZIndex =
    sortedComponents.reduce(
      (currentMax, component) => Math.max(currentMax, component.zIndex ?? 0),
      0,
    ) + 1;

  useEffect(() => {
    if (editingComponentId && editingComponentId !== selectedComponentId) {
      setEditingComponentId(null);
    }
  }, [editingComponentId, selectedComponentId]);

  useEffect(() => {
    if (!isActive && editingComponentId) {
      setEditingComponentId(null);
    }
  }, [editingComponentId, isActive]);

  useEffect(() => {
    if (!isActive || !selectedComponent || !selectedPrimaryTextProp || editingComponentId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || !isCanvasPrimaryTextEditShortcut(event)) {
        return;
      }

      event.preventDefault();
      setEditingComponentId(selectedComponent.id);
      setDraftPrimaryText(String(selectedComponent.props[selectedPrimaryTextProp] ?? ''));
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingComponentId, isActive, selectedComponent, selectedPrimaryTextProp]);

  useEffect(() => {
    const shell = shellRef.current;
    const stage = stageRef.current;

    if (!shell || !stage || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateCanvasSize = (): void => {
      const stageStyle = window.getComputedStyle(stage);
      const horizontalPadding =
        Number.parseFloat(stageStyle.paddingLeft) + Number.parseFloat(stageStyle.paddingRight);
      const verticalPadding =
        Number.parseFloat(stageStyle.paddingTop) + Number.parseFloat(stageStyle.paddingBottom);
      const nextSize = calculateCanvasSize(
        Math.max(0, stage.clientWidth - horizontalPadding),
        Math.max(0, stage.clientHeight - verticalPadding),
        viewportPreset.aspectRatio,
      );

      setCanvasSize(nextSize);
    };

    updateCanvasSize();

    const observer = new ResizeObserver(() => {
      updateCanvasSize();
    });

    observer.observe(shell);
    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [viewportPreset.aspectRatio]);

  return (
    <section className="editor-canvas-shell" ref={shellRef}>
      <div className="editor-canvas-toolbar">
        <span>
          {viewportPreset.label} {viewportPreset.frame} Frame
        </span>
        <span>Normalized 120 x 120 coordinates</span>
      </div>
      <div className="editor-canvas-stage" ref={stageRef}>
        <div
          className="editor-canvas"
          style={
            canvasSize
              ? {
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  aspectRatio: `${viewportPreset.aspectRatio}`,
                }
              : { aspectRatio: `${viewportPreset.aspectRatio}` }
          }
          onClick={() => onSelect(null)}
        >
          {sortedComponents.map((component) => {
            const definition = componentCatalogMap[component.type];
            const isEditing = editingComponentId === component.id;
            const primaryTextProp = definition?.primaryTextProp;

            return (
              <div
                key={component.id}
                className={`editor-canvas__component${selectedComponentId === component.id ? ' is-selected' : ''}`}
                style={{
                  left: `${(component.frame.x / 120) * 100}%`,
                  top: `${(component.frame.y / 120) * 100}%`,
                  width: `${(component.frame.w / 120) * 100}%`,
                  height: `${(component.frame.h / 120) * 100}%`,
                  zIndex: component.zIndex,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(component.id);
                }}
              >
                {isEditing && primaryTextProp ? (
                  <textarea
                    autoFocus
                    className="editor-canvas__inline-editor"
                    value={draftPrimaryText}
                    onBlur={() => {
                      onUpdatePrimaryText(component.id, draftPrimaryText);
                      setEditingComponentId(null);
                    }}
                    onChange={(event) => setDraftPrimaryText(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingComponentId(null);
                        return;
                      }

                      if (event.key === 'Enter' && event.ctrlKey) {
                        event.preventDefault();
                        onUpdatePrimaryText(component.id, draftPrimaryText);
                        setEditingComponentId(null);
                      }
                    }}
                  />
                ) : null}
                <div
                  className="editor-canvas__drag-surface"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onPointerDownMove(component.id, event.clientX, event.clientY);
                  }}
                >
                  <div className="editor-canvas__label">
                    <span>{component.nameEn}</span>
                    <span>{definition?.displayNameEn ?? component.type}</span>
                  </div>
                  <div className="editor-canvas__preview">
                    {definition?.render(component.props)}
                  </div>
                </div>
                <button
                  type="button"
                  className="editor-canvas__resize-handle"
                  aria-label={`Resize ${component.nameJa}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onPointerDownResize(component.id, event.clientX, event.clientY);
                  }}
                />
              </div>
            );
          })}
          {selectedComponent && isActive ? (
            <div
              className="editor-canvas__selection-frame"
              style={{
                left: `${(selectedComponent.frame.x / 120) * 100}%`,
                top: `${(selectedComponent.frame.y / 120) * 100}%`,
                width: `${(selectedComponent.frame.w / 120) * 100}%`,
                height: `${(selectedComponent.frame.h / 120) * 100}%`,
                zIndex: selectionOverlayZIndex,
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
};
