import { componentCatalogMap } from '../../catalog/components';
import { Canvas } from './canvas';
import { ComponentTree } from './component-tree';
import { Inspector } from './inspector';
import { ScreenInspector } from './screen-inspector';
import { SearchableSelect, filterOptions } from './searchable-select';
import { type InteractionState, useCanvasSelectionKeyboard } from './canvas-interaction';
import { useComponentOutlineState } from './component-interaction';
import {
  addComponent,
  addScreen,
  addTool,
  canAssignParent,
  getViewport,
  outdentComponent,
  removeComponent,
  removeScreen,
  removeTool,
  reorderComponent,
  reorderScreen,
  reparentComponent,
  updateComponent,
  updateScreen,
} from '../../state/editor';
import { validateComponentInstance } from '../../spec/editor-document';
import type { ScreenSpec, SpecDocument, ViewportId, ViewportSpec } from '../../spec/editor-schema';
import { viewportIds } from '../../spec/editor-schema';

type UiPanelProps = {
  readonly document: SpecDocument;
  readonly applyDocument: (doc: SpecDocument) => Promise<void>;
  readonly screen: ScreenSpec;
  readonly viewport: ViewportSpec;
  readonly selectedScreenId: string;
  readonly setSelectedScreenId: (id: string) => void;
  readonly selectedViewportId: ViewportId;
  readonly setSelectedViewportId: (id: ViewportId) => void;
  readonly selectedComponentId: string | null;
  readonly setSelectedComponentId: (id: string | null) => void;
  readonly activeSelectionSurface: 'outline' | 'canvas' | null;
  readonly setActiveSelectionSurface: (surface: 'outline' | 'canvas' | null) => void;
  readonly selectedToolId: string;
  readonly setSelectedToolId: (id: string) => void;
  readonly toolSearch: string;
  readonly setToolSearch: (s: string) => void;
  readonly setValidationMessage: (msg: string) => void;
  readonly setInteraction: (s: InteractionState) => void;
};

export const UiPanel = ({
  document,
  applyDocument,
  screen,
  viewport,
  selectedScreenId,
  setSelectedScreenId,
  selectedViewportId,
  setSelectedViewportId,
  selectedComponentId,
  setSelectedComponentId,
  activeSelectionSurface,
  setActiveSelectionSurface,
  selectedToolId,
  setSelectedToolId,
  toolSearch,
  setToolSearch,
  setValidationMessage,
  setInteraction,
}: UiPanelProps) => {
  const filteredTools = filterOptions(document.tools, toolSearch);
  const selectedComponent = viewport.components.find((c) => c.id === selectedComponentId) ?? null;

  const applyComponentUpdate = async (
    componentId: string,
    updater: Parameters<typeof updateComponent>[4],
  ): Promise<void> => {
    const nextDocument = updateComponent(
      document,
      screen.id,
      selectedViewportId,
      componentId,
      updater,
    );
    const nextComponent =
      getViewport(nextDocument, screen.id, selectedViewportId).components.find(
        (c) => c.id === componentId,
      ) ?? null;

    if (nextComponent) {
      const validation = validateComponentInstance(nextComponent);

      setValidationMessage(validation.success ? '' : validation.error.join(', '));
    }

    await applyDocument(nextDocument);
  };

  const deleteSelectedComponent = (): void => {
    if (!selectedComponentId) {
      return;
    }

    const nextDocument = removeComponent(
      document,
      screen.id,
      selectedViewportId,
      selectedComponentId,
    );
    setSelectedComponentId(null);
    setActiveSelectionSurface(null);
    void applyDocument(nextDocument);
  };

  const addComponentToViewport = (): void => {
    const selectedComponentEntry =
      viewport.components.find((c) => c.id === selectedComponentId) ?? null;
    const parentId = selectedComponentEntry?.parentId;
    const nextDocument = addComponent(document, screen.id, selectedViewportId, 'Text', parentId);
    const nextViewport = getViewport(nextDocument, screen.id, selectedViewportId);

    setSelectedComponentId(nextViewport.components.at(-1)?.id ?? null);
    setActiveSelectionSurface('outline');
    void applyDocument(nextDocument);
  };

  useCanvasSelectionKeyboard({
    applyDocument,
    document,
    isActive: activeSelectionSurface === 'canvas',
    onDeleteSelected: deleteSelectedComponent,
    selectedComponentId,
    selectedScreenId,
    selectedViewportId,
  });

  const { collapsedIds, toggleCollapsed } = useComponentOutlineState({
    isActive: activeSelectionSurface === 'outline',
    canAssignParent: (componentId, parentId) =>
      canAssignParent(viewport.components, componentId, parentId),
    components: viewport.components,
    onAddSibling: addComponentToViewport,
    onDeleteSelected: deleteSelectedComponent,
    onIndentSelected: (parentId) => {
      if (!selectedComponentId) {
        return;
      }

      void applyDocument(
        reparentComponent(document, screen.id, selectedViewportId, selectedComponentId, parentId),
      );
    },
    onMoveSelected: (direction) => {
      if (!selectedComponentId) {
        return;
      }

      void applyDocument(
        reorderComponent(document, screen.id, selectedViewportId, selectedComponentId, direction),
      );
    },
    onOutdentSelected: () => {
      if (!selectedComponentId) {
        return;
      }

      void applyDocument(
        outdentComponent(document, screen.id, selectedViewportId, selectedComponentId),
      );
    },
    onSelectVisible: (componentId) => {
      setSelectedComponentId(componentId);
      setActiveSelectionSurface('outline');
    },
    selectedComponentId,
  });

  return (
    <section className="editor-layout">
      <aside className="editor-sidebar">
        <SearchableSelect
          addLabel="Tool"
          items={filteredTools}
          label="Tool"
          onAdd={() => {
            const nextDocument = addTool(document);
            setSelectedToolId(nextDocument.tools.at(-1)?.id ?? selectedToolId);
            void applyDocument(nextDocument);
          }}
          onDelete={() => {
            const nextDocument = removeTool(document, selectedToolId);
            setSelectedToolId(nextDocument.tools[0]?.id ?? '');
            void applyDocument(nextDocument);
          }}
          onSearchChange={setToolSearch}
          onSelect={setSelectedToolId}
          search={toolSearch}
          selectedId={selectedToolId}
          selectedLabel={document.tools.find((item) => item.id === selectedToolId)?.nameJa ?? ''}
        />
        <ComponentTree
          collapsedIds={collapsedIds}
          components={viewport.components}
          isActive={activeSelectionSurface === 'outline'}
          onAdd={addComponentToViewport}
          onDeleteSelected={deleteSelectedComponent}
          onAddScreen={() => {
            const nextDocument = addScreen(document);
            setSelectedScreenId(nextDocument.screens.at(-1)?.id ?? selectedScreenId);
            setSelectedComponentId(null);
            setActiveSelectionSurface(null);
            void applyDocument(nextDocument);
          }}
          onDeleteScreen={() => {
            const nextDocument = removeScreen(document, selectedScreenId);
            setSelectedScreenId(nextDocument.screens[0]?.id ?? '');
            setSelectedComponentId(null);
            setActiveSelectionSurface(null);
            void applyDocument(nextDocument);
          }}
          onMoveScreen={(screenId, direction) => {
            void applyDocument(reorderScreen(document, screenId, direction));
          }}
          onRename={(componentId, nameJa) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              nameJa,
            }));
          }}
          onRenameScreen={(screenId, nameJa) => {
            void applyDocument(updateScreen(document, screenId, (entry) => ({ ...entry, nameJa })));
          }}
          onSelect={(componentId) => {
            setSelectedComponentId(componentId);
            setActiveSelectionSurface('outline');
          }}
          onSelectScreen={(screenId) => {
            setSelectedScreenId(screenId);
            setSelectedComponentId(null);
            setActiveSelectionSurface(null);
          }}
          onToggleCollapse={toggleCollapsed}
          screens={document.screens}
          selectedComponentId={selectedComponentId}
          selectedScreenId={selectedScreenId}
        />
      </aside>

      <div className="editor-workspace">
        <div className="editor-workspace__viewport-bar">
          <div className="editor-segmented">
            {viewportIds.map((viewportId) => (
              <button
                key={viewportId}
                type="button"
                className={selectedViewportId === viewportId ? 'is-active' : ''}
                onClick={() => {
                  setSelectedViewportId(viewportId);
                  setSelectedComponentId(null);
                }}
              >
                {viewportId}
              </button>
            ))}
          </div>
        </div>
        <Canvas
          components={viewport.components}
          isActive={activeSelectionSurface === 'canvas'}
          onPointerDownMove={(componentId, clientX, clientY) =>
            setInteraction({ componentId, mode: 'move', originX: clientX, originY: clientY })
          }
          onPointerDownResize={(componentId, clientX, clientY) =>
            setInteraction({
              componentId,
              mode: 'resize',
              originX: clientX,
              originY: clientY,
            })
          }
          onUpdatePrimaryText={(componentId, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              props: { ...component.props, title: value },
            }));
          }}
          onSelect={(componentId) => {
            setSelectedComponentId(componentId);
            setActiveSelectionSurface(componentId ? 'canvas' : null);
          }}
          selectedComponentId={selectedComponentId}
          viewportId={selectedViewportId}
        />
      </div>

      {selectedComponent ? (
        <Inspector
          components={viewport.components}
          onChange={(componentId, field, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              [field]: value,
            }));
          }}
          onChangeType={(componentId, value) => {
            const definition = componentCatalogMap[value];
            const component = viewport.components.find((entry) => entry.id === componentId);

            if (!definition || !component) {
              return;
            }

            const nextParentId = canAssignParent(
              viewport.components.map((entry) =>
                entry.id === componentId ? { ...entry, type: value } : entry,
              ),
              componentId,
              component.parentId,
            )
              ? component.parentId
              : undefined;

            void applyComponentUpdate(componentId, (current) => ({
              ...current,
              parentId: nextParentId,
              props: { ...definition.defaultProps },
              type: value,
            }));
          }}
          onChangeFrame={(componentId, field, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              frame: {
                ...component.frame,
                [field]:
                  field === 'w' || field === 'h'
                    ? Math.max(1, Math.min(120, value))
                    : Math.max(0, Math.min(119, value)),
              },
            }));
          }}
          onChangeZIndex={(componentId, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              zIndex: Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)),
            }));
          }}
          onChangeNote={(componentId, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              editorMetadata: { ...component.editorMetadata, note: value },
            }));
          }}
          onChangeParent={(componentId, parentId) => {
            if (!canAssignParent(viewport.components, componentId, parentId || undefined)) {
              setValidationMessage('Invalid parent assignment.');
              return;
            }

            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              parentId: parentId || undefined,
            }));
          }}
          onChangeProp={(componentId, propName, value) => {
            void applyComponentUpdate(componentId, (component) => ({
              ...component,
              props: { ...component.props, [propName]: value },
            }));
          }}
          onDelete={(componentId) => {
            const nextDocument = removeComponent(
              document,
              screen.id,
              selectedViewportId,
              componentId,
            );
            setSelectedComponentId(null);
            setActiveSelectionSurface(null);
            void applyDocument(nextDocument);
          }}
          selectedComponent={selectedComponent}
        />
      ) : (
        <ScreenInspector
          selectedScreen={screen}
          onUpdate={(updater) =>
            void applyDocument(updateScreen(document, selectedScreenId, updater))
          }
        />
      )}
    </section>
  );
};
