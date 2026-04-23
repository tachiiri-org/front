import { useEffect, useRef, useState } from 'react';

import { RuntimeDiagnosticsPanel } from './ui/runtime-diagnostics-panel';
import { UiPanel } from './ui/panel';
import { SpecPanel } from './spec/panel';
import { IssuePanel } from './issue/panel';
import { type InteractionState } from './ui/canvas-interaction';
import type { RuntimeServices } from '../runtime/contracts';
import { createRuntimeViewModel } from '../state/runtime-view-model';
import { getScreen, getViewport, moveComponent, updateComponent } from '../state/editor';
import {
  exportPromptDocument,
  getDefaultSelectedSpecNodeId,
  getSpecNode,
  getSpecNodes,
  loadSpecDocument,
  syncStructureNodesFromUiDocument,
} from '../spec/editor-document';
import { collectIssueEntries } from '../spec/issue-view';
import type { SpecDocument, ViewportId } from '../spec/editor-schema';

type EditorScreenProps = {
  readonly bootstrapError?: string | null;
  readonly runtimeServices?: RuntimeServices | null;
};

export const EditorScreen = ({
  bootstrapError = null,
  runtimeServices = null,
}: EditorScreenProps) => {
  const [document, setDocument] = useState<SpecDocument>(() => loadSpecDocument(null));
  const [selectedToolId, setSelectedToolId] = useState('');
  const [selectedScreenId, setSelectedScreenId] = useState('');
  const [selectedViewportId, setSelectedViewportId] = useState<ViewportId>('desktop');
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedSpecNodeId, setSelectedSpecNodeId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [activeSelectionSurface, setActiveSelectionSurface] = useState<'outline' | 'canvas' | null>(
    null,
  );
  const [activeEditorSurface, setActiveEditorSurface] = useState<
    'outline' | 'document' | 'links' | 'global' | null
  >(null);
  const [toolSearch, setToolSearch] = useState('');
  const [, setPromptExport] = useState('');
  const [interaction, setInteraction] = useState<InteractionState>(null);
  const [runtime, setRuntime] = useState(createRuntimeViewModel(null, bootstrapError));
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(bootstrapError);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [validationMessage, setValidationMessage] = useState('');
  const [editorMode, setEditorMode] = useState<'spec' | 'issue' | 'ui'>('spec');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('editor-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runtimeServices) {
      setIsBootstrapping(false);
      setDocumentLoadError(bootstrapError ?? 'Runtime services are unavailable.');
      setRuntime(
        createRuntimeViewModel(null, bootstrapError ?? 'Runtime services are unavailable.'),
      );
      return;
    }

    let isMounted = true;
    let unsubscribe = () => {};

    const load = async (): Promise<void> => {
      try {
        const [loadedDocument, snapshot] = await Promise.all([
          runtimeServices.specDocumentRepository.load(),
          runtimeServices.runtimeDiagnosticsSource.getInitialSnapshot(),
        ]);

        const nextDocument = loadSpecDocument(loadedDocument);

        if (isMounted) {
          setDocument(nextDocument);
          setSelectedToolId(nextDocument.tools[0]?.id ?? '');
          setSelectedScreenId(nextDocument.screens[0]?.id ?? '');
          setSelectedSpecNodeId(
            getDefaultSelectedSpecNodeId(nextDocument, nextDocument.tools[0]?.id),
          );
          setPromptExport(exportPromptDocument(nextDocument));
          setDocumentLoadError(null);
          setRuntime(createRuntimeViewModel(snapshot));
          setIsBootstrapping(false);
        }

        unsubscribe = runtimeServices.runtimeDiagnosticsSource.subscribe((nextSnapshot) => {
          setRuntime(createRuntimeViewModel(nextSnapshot));
        });
      } catch (error) {
        if (isMounted) {
          const message =
            error instanceof Error ? error.message : 'Runtime snapshot is unavailable.';

          setDocumentLoadError(message);
          setRuntime(createRuntimeViewModel(null, message));
          setIsBootstrapping(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [bootstrapError, runtimeServices]);

  useEffect(() => {
    if (!document || !interaction) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const deltaX = Math.round((event.clientX - interaction.originX) / 6);
      const deltaY = Math.round((event.clientY - interaction.originY) / 6);

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      if (interaction.mode === 'move') {
        const nextDocument = moveComponent(
          document,
          selectedScreenId,
          selectedViewportId,
          interaction.componentId,
          { x: deltaX, y: deltaY },
        );

        setDocument(nextDocument);
        setPromptExport(exportPromptDocument(nextDocument));
      } else {
        const viewport = getViewport(document, selectedScreenId, selectedViewportId);
        const component = viewport.components.find((entry) => entry.id === interaction.componentId);

        if (!component) {
          return;
        }

        const nextDocument = updateComponent(
          document,
          selectedScreenId,
          selectedViewportId,
          interaction.componentId,
          (current) => ({
            ...current,
            frame: {
              ...current.frame,
              w: Math.max(1, Math.min(120, current.frame.w + deltaX)),
              h: Math.max(1, Math.min(120, current.frame.h + deltaY)),
            },
          }),
        );

        setDocument(nextDocument);
        setPromptExport(exportPromptDocument(nextDocument));
      }

      setInteraction({
        ...interaction,
        originX: event.clientX,
        originY: event.clientY,
      });
    };

    const handlePointerUp = (): void => {
      setInteraction(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [document, interaction, selectedScreenId, selectedViewportId]);

  useEffect(() => {
    globalThis.document.documentElement.dataset.theme = theme;
    localStorage.setItem('editor-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isHelpOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!helpRef.current?.contains(event.target as Node)) {
        setIsHelpOpen(false);
      }
    };

    globalThis.document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      globalThis.document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isHelpOpen]);

  useEffect(() => {
    if (!document.tools.some((tool) => tool.id === selectedToolId)) {
      setSelectedToolId(document.tools[0]?.id ?? '');
    }

    if (!document.screens.some((screen) => screen.id === selectedScreenId)) {
      setSelectedScreenId(document.screens[0]?.id ?? '');
      setSelectedComponentId(null);
    }

    const selectedSpecNode = selectedSpecNodeId ? getSpecNode(document, selectedSpecNodeId) : null;

    if (
      !selectedSpecNodeId ||
      !selectedSpecNode ||
      (selectedToolId && selectedSpecNode.metadata?.toolId !== selectedToolId)
    ) {
      setSelectedSpecNodeId(getDefaultSelectedSpecNodeId(document, selectedToolId));
    }

    const issueEntries = collectIssueEntries(document, selectedToolId);

    if (!selectedIssueId || !issueEntries.some((entry) => entry.id === selectedIssueId)) {
      setSelectedIssueId(issueEntries[0]?.id ?? null);
    }
  }, [document, selectedScreenId, selectedSpecNodeId, selectedToolId]);

  const screen = getScreen(document, selectedScreenId);
  const viewport = screen ? getViewport(document, screen.id, selectedViewportId) : null;
  const specNodes = getSpecNodes(document, selectedToolId);
  const selectedSpecNode = getSpecNode(document, selectedSpecNodeId);

  const persist = async (nextDocument: SpecDocument): Promise<void> => {
    setPromptExport(exportPromptDocument(nextDocument));
    setDocumentLoadError(null);

    if (!runtimeServices) {
      throw new Error('Runtime services are unavailable.');
    }

    await runtimeServices.specDocumentRepository.save(nextDocument);
  };

  const applyDocument = async (
    nextDocument: SpecDocument,
    options?: {
      readonly nextSelectedSpecNodeId?: string | null;
    },
  ): Promise<void> => {
    const syncedDocument = syncStructureNodesFromUiDocument(nextDocument);

    setDocument(syncedDocument);

    if (options?.nextSelectedSpecNodeId !== undefined) {
      setSelectedSpecNodeId(options.nextSelectedSpecNodeId);
    }

    await persist(syncedDocument);
  };

  if (isBootstrapping) {
    return <div className="editor-loading">Loading editor...</div>;
  }

  if (documentLoadError) {
    return (
      <main className="editor-loading">
        <section className="editor-panel">
          <div className="editor-panel__header">
            <span>Bootstrap Failed</span>
            <span>blocked</span>
          </div>
          <p className="editor-error">{documentLoadError}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <h1>ui-spec-editor</h1>
        <div className="editor-segmented">
          <button
            type="button"
            className={editorMode === 'spec' ? 'is-active' : ''}
            onClick={() => setEditorMode('spec')}
          >
            Spec
          </button>
          <button
            type="button"
            className={editorMode === 'issue' ? 'is-active' : ''}
            onClick={() => setEditorMode('issue')}
          >
            Issue
          </button>
          <button
            type="button"
            className={editorMode === 'ui' ? 'is-active' : ''}
            onClick={() => setEditorMode('ui')}
          >
            UI
          </button>
        </div>
        <div className="editor-topbar__actions">
          <button
            type="button"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            onClick={() => {
              void persist(document);
            }}
          >
            Save Local Draft
          </button>
          <div className="editor-help" ref={helpRef}>
            <button type="button" onClick={() => setIsHelpOpen((current) => !current)}>
              Help
            </button>
            {isHelpOpen ? (
              <div className="editor-help__panel">
                <section className="editor-help__section">
                  <div className="editor-panel__header">
                    <span>Keyboard</span>
                  </div>
                  <ul className="editor-help__list">
                    <li>UI mode: arrow keys move selected component</li>
                    <li>UI mode: Shift + Arrow keys resize selected component</li>
                    <li>Spec outline / Global: F2 renames the selected item</li>
                    <li>Spec outline / Global: ArrowUp / ArrowDown moves selection</li>
                    <li>
                      Spec outline / Global: Shift + Alt + ArrowUp / ArrowDown reorders siblings
                    </li>
                    <li>Spec outline / Global: Tab / Shift + Tab indents or outdents</li>
                    <li>
                      Spec outline / Global: Ctrl + ArrowUp collapses, Ctrl + ArrowDown expands
                    </li>
                    <li>Spec outline / Global: Ctrl + Enter adds a sibling, Delete removes it</li>
                    <li>Spec document: Shift + I creates an issue from the focused row</li>
                  </ul>
                </section>
                <RuntimeDiagnosticsPanel runtime={runtime} />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {editorMode === 'ui' ? (
        !screen || !viewport ? (
          <div className="editor-loading">Loading editor...</div>
        ) : (
          <UiPanel
            document={document}
            applyDocument={applyDocument}
            screen={screen}
            viewport={viewport}
            selectedScreenId={selectedScreenId}
            setSelectedScreenId={setSelectedScreenId}
            selectedViewportId={selectedViewportId}
            setSelectedViewportId={setSelectedViewportId}
            selectedComponentId={selectedComponentId}
            setSelectedComponentId={setSelectedComponentId}
            activeSelectionSurface={activeSelectionSurface}
            setActiveSelectionSurface={setActiveSelectionSurface}
            selectedToolId={selectedToolId}
            setSelectedToolId={setSelectedToolId}
            toolSearch={toolSearch}
            setToolSearch={setToolSearch}
            setValidationMessage={setValidationMessage}
            setInteraction={setInteraction}
          />
        )
      ) : editorMode === 'spec' ? (
        <SpecPanel
          selectedToolId={selectedToolId}
          setSelectedToolId={setSelectedToolId}
          toolSearch={toolSearch}
          setToolSearch={setToolSearch}
          document={document}
          applyDocument={applyDocument}
          selectedSpecNodeId={selectedSpecNodeId}
          setSelectedSpecNodeId={setSelectedSpecNodeId}
          activeEditorSurface={activeEditorSurface}
          setActiveEditorSurface={setActiveEditorSurface}
          specNodes={specNodes}
          selectedSpecNode={selectedSpecNode}
        />
      ) : (
        <IssuePanel
          document={document}
          applyDocument={applyDocument}
          selectedIssueId={selectedIssueId}
          setSelectedIssueId={setSelectedIssueId}
          selectedToolId={selectedToolId}
          setSelectedToolId={setSelectedToolId}
          toolSearch={toolSearch}
          setToolSearch={setToolSearch}
        />
      )}

      {editorMode === 'ui' && screen ? (
        <footer className="editor-statusbar">
          <span>
            {screen.nameEn} / {screen.nameJa} / {selectedViewportId}
          </span>
          <span>{selectedToolId || 'tool'}</span>
          <span>{validationMessage || 'Ready'}</span>
        </footer>
      ) : editorMode === 'spec' ? (
        <footer className="editor-statusbar">
          <span>
            {selectedSpecNode
              ? `${selectedSpecNode.kind} / ${selectedSpecNode.titleJa}`
              : 'No node selected'}
          </span>
          <span>{activeEditorSurface ?? 'spec'}</span>
        </footer>
      ) : editorMode === 'issue' ? (
        <footer className="editor-statusbar">
          <span>{selectedIssueId ?? 'No issue selected'}</span>
          <span>{selectedToolId || 'tool'}</span>
        </footer>
      ) : null}
    </main>
  );
};
