import type { GraphEditorContext, PanelView, PanelPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { createNodePanelView } from './node-panel-view';
import { createRelationPanelView } from './relation-panel-view';
import { createContextPanelView } from './context-panel-view';
import { fetchNodePath } from './api';

type NodePanelConfig = {
  id: string;
  label: string;
  sourcePanelId: string | null;   // null = root; or another pane id
  width: number;             // px
  lang: 'en' | 'ja';         // per-pane display/edit language
  pinned?: boolean;          // true = frozen: ignore source-pane selection changes
  pinnedSourceNodeId?: string | null; // parent snapshot to restore the frozen view on reload
};

type NodePanelInstance = {
  config: NodePanelConfig;
  view: ReturnType<typeof createNodePanelView>;
  containerEl: HTMLElement;   // the outer div (nodePanelHeader + body)
  updateSrcBtn: () => void;
  updateFsBtn: () => void;
  updatePinBtn: () => void;
  updateLangBtn: () => void;
};

const STORAGE_KEY = (gId: string) => `graph-editor-panes:${gId}`;
const NODE_PANEL_WIDTH = () => Math.max(280, Math.round(window.innerWidth * 0.20));

function saveNodePanels(gId: string, configs: NodePanelConfig[]) {
  localStorage.setItem(STORAGE_KEY(gId), JSON.stringify(configs));
}

function loadNodePanels(gId: string, defaultLang: 'en' | 'ja'): NodePanelConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(gId));
    if (!raw) return null;
    const arr = JSON.parse(raw) as Array<Partial<NodePanelConfig> & { sourceId?: string | null; pinnedParentId?: string | null }>;
    // Older saved configs predate per-panel lang → fall back to the global default.
    // Back-compat: the pre-rename schema used `sourceId` / `pinnedParentId`; map them onto the
    // current `sourcePanelId` / `pinnedSourceNodeId` so existing saved layouts survive the rename.
    return arr.map(({ sourceId, pinnedParentId, ...c }) => ({
      ...c,
      lang: c.lang ?? defaultLang,
      sourcePanelId: c.sourcePanelId ?? sourceId ?? null,
      pinnedSourceNodeId: c.pinnedSourceNodeId ?? pinnedParentId,
    })) as NodePanelConfig[];
  } catch { return null; }
}

function newNodePanelConfig(label: string, lang: 'en' | 'ja'): NodePanelConfig {
  return {
    id: `pane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    sourcePanelId: null,
    width: NODE_PANEL_WIDTH(),
    lang,
  };
}

export function createPanelsView(ctx: GraphEditorContext): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (q: string) => Promise<void>;
  setAllLang: (lang: 'en' | 'ja') => void;
} {
  // 選択中ノードをソースにする特別値。このソースのノードパネルは「最後にクリックされたノード」の子を出す。
  const SELECTION_SRC = '__selection__';

  // Outer wrapper: ONE horizontally-scrolling flex row holding all panels (node + relation) in order,
  // so they can be freely interleaved / reordered (例: ノード-リレーション-ノード)。Node panels take a
  // fixed width; relation panels flex-grow to fill the remaining space wherever they sit.
  const el = document.createElement('div');
  el.style.cssText = `display:flex;flex-direction:row;flex:1;overflow-x:auto;overflow-y:hidden;min-width:0;`;

  type RelationPanelInstance = { id: string; view: PanelView; containerEl: HTMLElement; primary: boolean };
  const nodePanels: NodePanelInstance[] = [];
  const relationPanels: RelationPanelInstance[] = [];
  let fullscreenNodePanelId: string | null = null;
  let draggingPanelId: string | null = null;
  let relPanelSeq = 0;

  // ── Reorder (grip drag-and-drop, node ⇄ relation unified) ──────────────────
  const allContainers = () => [...nodePanels.map(p => p.containerEl), ...relationPanels.map(p => p.containerEl)];
  const clearDropIndicators = () => { for (const c of allContainers()) c.style.boxShadow = ''; };
  const containerOf = (panelId: string): HTMLElement | undefined =>
    nodePanels.find(p => p.config.id === panelId)?.containerEl ?? relationPanels.find(p => p.id === panelId)?.containerEl;

  // Move the dragged panel's container next to the target in the single flex row, then resync the
  // nodePanels array order from the DOM (so node adjacency / save stay consistent). Order is not
  // persisted across reload (relation panels aren't saved) — it's a within-session arrangement.
  const reorderPanel = (draggedId: string, targetId: string, before: boolean) => {
    if (draggedId === targetId) return;
    const dragged = containerOf(draggedId), target = containerOf(targetId);
    if (!dragged || !target) return;
    el.insertBefore(dragged, before ? target : target.nextSibling);
    const domOrder = [...el.children];
    nodePanels.sort((a, b) => domOrder.indexOf(a.containerEl) - domOrder.indexOf(b.containerEl));
    saveAll();
    updateAllSrcBtns();
  };

  // A reorder grip (⠿). Dragging it starts a panel reorder. (For relation panels the grip is passed
  // into the view and re-inserted each render, since the relation head is rebuilt on render.)
  const makeGrip = (panelId: string): HTMLElement => {
    const grip = document.createElement('span');
    grip.textContent = '⠿';
    grip.title = 'ドラッグでパネルを並び替え';
    grip.draggable = true;
    grip.style.cssText = `flex-shrink:0;cursor:grab;color:${TEXT_DIM};font-size:13px;user-select:none;padding:0 2px;`;
    grip.addEventListener('dragstart', (e) => {
      draggingPanelId = panelId;
      e.dataTransfer?.setData('text/plain', panelId);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => { draggingPanelId = null; clearDropIndicators(); });
    return grip;
  };
  // Make a panel container a drop target for a reorder drag. Guarded on draggingPanelId, so it never
  // reacts to node-body DnD (which uses ctx.nodePanelDrag). Uses the container (stable across the
  // relation head's re-renders) rather than the header.
  const addDropZone = (panelId: string, containerEl: HTMLElement) => {
    containerEl.addEventListener('dragover', (e) => {
      if (!draggingPanelId || draggingPanelId === panelId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = containerEl.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      clearDropIndicators();
      containerEl.style.boxShadow = before ? 'inset 2px 0 0 0 #4a9eff' : 'inset -2px 0 0 0 #4a9eff';
    });
    containerEl.addEventListener('dragleave', (e) => {
      if (!containerEl.contains(e.relatedTarget as Node | null)) containerEl.style.boxShadow = '';
    });
    containerEl.addEventListener('drop', (e) => {
      if (!draggingPanelId || draggingPanelId === panelId) return;
      e.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      reorderPanel(draggingPanelId, panelId, (e.clientX - rect.left) < rect.width / 2);
      draggingPanelId = null;
      clearDropIndicators();
    });
  };

  // Wrap a relation PanelView (whose head already hosts a reorder grip via leadingHeadEl) in a
  // reorderable container. Every panel gets a × close. Closing the primary keeps its shared view
  // alive (reopened by the next node-row selection via ensurePrimaryPanel); extras are disposed.
  // A relation panel stacked vertically inside relationColumn (flex row -> now a column entry). Every
  // panel gets a × close. Closing the primary keeps its shared view alive (reopened by the next
  // node-row selection via ensurePrimaryPanel); extras are disposed.
  const createRelationPanel = (id: string, view: PanelView, primary: boolean): RelationPanelInstance => {
    const containerEl = document.createElement('div');
    containerEl.dataset.panelId = id;
    // Content-height (可変): the panel takes its natural height; relationColumn scrolls the stack.
    containerEl.style.cssText = `flex:0 0 auto;display:flex;flex-direction:column;overflow:hidden;position:relative;`;
    containerEl.appendChild(view.el);
    const inst: RelationPanelInstance = { id, view, containerEl, primary };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `position:absolute;top:2px;right:4px;z-index:3;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;line-height:1;`;
    closeBtn.addEventListener('click', () => {
      const i = relationPanels.indexOf(inst);
      if (i >= 0) relationPanels.splice(i, 1);
      containerEl.remove();
      refreshRelationBorders();
      if (!primary) view.unregister();
    });
    containerEl.appendChild(closeBtn);
    return inst;
  };

  // The primary relation panel's view (follows the global selection; closable via ×, and re-opened by
  // ensurePrimaryPanel on the next node-row selection). Its grip lives in the relation head.
  const relationView: PanelView = createRelationPanelView(ctx, { lang: ctx.state.lang, initialNodeId: null, autoHeight: true });

  // The persistent context (node page) panel — the right-hand DOCUMENT view, driven by the global
  // selection alongside the relation panel (which stays the navigator/outline). A fixed right column
  // for P1 (not reorderable/closable). Selecting a heading in the relation panel scrolls this to it.
  const contextView: PanelView = createContextPanelView(ctx, { lang: ctx.state.lang });
  const contextContainer = document.createElement('div');
  contextContainer.dataset.panelId = 'ctx-primary';
  contextContainer.style.cssText = `flex:1 1 0;min-width:320px;display:flex;flex-direction:column;border-left:1px solid ${BORDER};overflow:hidden;position:relative;`;
  contextView.el.style.flex = '1';
  contextContainer.appendChild(contextView.el);

  // リレーションパネルは1つの列の中に「縦スタック」で積む。ノードリンク(チップ)をクリックすると、右に
  // 新しい列を増やすのではなく、この列の一番下にリレーションパネルを追加する（下方展開）。
  const relationColumn = document.createElement('div');
  relationColumn.style.cssText = `flex:1 1 0;min-width:320px;display:flex;flex-direction:column;overflow-y:auto;border-left:1px solid ${BORDER};`;
  const refreshRelationBorders = () => {
    Array.from(relationColumn.children).forEach((c, i) => { (c as HTMLElement).style.borderTop = i === 0 ? 'none' : `1px solid ${BORDER}`; });
  };

  // Open an additional relation panel showing `nodeId`'s relations (independent; closable), appended
  // at the right end. Triggered by left-clicking a node-link chip in a relation — so you drill into a
  // node's relations by following its links, building a left→right trail of relation panels.
  ctx.openRelationPanel = (nodeId, label) => {
    const id = `rel-x-${++relPanelSeq}`;
    const view = createRelationPanelView(ctx, { lang: ctx.state.lang, initialNodeId: nodeId, autoHeight: true, compact: true });
    const inst = createRelationPanel(id, view, false);
    relationPanels.push(inst);
    relationColumn.appendChild(inst.containerEl);   // stack BELOW the current relation panel(s)
    refreshRelationBorders();
    void (async () => {
      const path = await fetchNodePath(ctx.gId, nodeId, label ?? '', ctx.rootNodeId, ctx.state.lang);
      await view.setParent(nodeId, undefined, path);
    })();
    requestAnimationFrame(() => { relationColumn.scrollTop = relationColumn.scrollHeight; });
  };

  // Re-create the primary relation panel (wrapping the persistent relationView) if it has been closed,
  // so selecting a node row always has a panel to show that node's relations. Re-inserted at its home
  // spot: right after the first node panel (matching the initial layout).
  const ensurePrimaryPanel = () => {
    if (relationPanels.some((p) => p.primary)) return;
    const relInst = createRelationPanel('rel-primary', relationView, true);
    relationPanels.push(relInst);
    relationColumn.insertBefore(relInst.containerEl, relationColumn.firstChild); // primary sits on top
    refreshRelationBorders();
  };

  const applyFullscreenLayout = () => {
    const isFs = fullscreenNodePanelId !== null;
    for (const p of nodePanels) {
      const isThis = p.config.id === fullscreenNodePanelId;
      if (!isFs) {
        p.containerEl.style.display = '';
        p.containerEl.style.width = `${p.config.width}px`;
        p.containerEl.style.flex = '';
      } else if (isThis) {
        p.containerEl.style.display = '';
        p.containerEl.style.flex = '1';
        p.containerEl.style.width = '';
      } else {
        p.containerEl.style.display = 'none';
      }
      p.updateFsBtn();
    }
    // In fullscreen, hide the relation column + context panel too (only the one node panel is shown).
    relationColumn.style.display = isFs ? 'none' : '';
    contextContainer.style.display = isFs ? 'none' : '';
  };

  // ── Global selection (最後にクリックされたノード) ──────────────────────────
  // Selecting drives (a) the relation panel(s) → the node's relations and (b) any node panel sourced
  // from 「選択中」(SELECTION_SRC) → the node's children. Set by node-row focus and by left-clicking a
  // relation node-link chip.
  let selectedNodeId: string | null = null;
  // `updateRelation` = also switch the relation panel to this node's relations. True for node-row
  // selection; FALSE for a relation chip left-click — clicking a chip only drills the 「選択中」node
  // panel to the chip's children and must NOT re-render (=flash) the relation panel you're reading.
  const setSelectedNode = (nodeId: string | null, ancestorIds: Set<string> = new Set(), path: PanelPathEntry[] = [], updateRelation = true) => {
    // 同じノードの再選択（ウィンドウ復帰でノード行 textarea が再フォーカスされる等）では関係/コンテキスト
    // パネルを再描画しない — 無駄な再取得・チラつきを防ぐ。
    const changed = nodeId !== selectedNodeId;
    selectedNodeId = nodeId;
    if (nodeId !== null && updateRelation && changed) {
      ctx.setActiveRelation(null);
      ctx.setContextTarget?.(null, null); // ノードを変えたら、リレーション未選択＝コンテキストは空に
      ensurePrimaryPanel();
      void relationView.setParent(nodeId, ancestorIds, path);
    }
    for (const p of nodePanels) {
      if (p.config.sourcePanelId === SELECTION_SRC && !p.config.pinned) {
        void p.view.setParent(nodeId, ancestorIds, path);
      }
    }
  };
  // Chip left-click → select this node (drives the 「選択中」node panel's children). Fetches the node's
  // path so that panel's breadcrumb reads ルート › … › {node} (not just ルート). updateRelation=false
  // keeps the relation panel you're reading from re-rendering.
  ctx.selectNode = (nodeId, label) => {
    void (async () => {
      const path = await fetchNodePath(ctx.gId, nodeId, label ?? '', ctx.rootNodeId, ctx.state.lang);
      setSelectedNode(nodeId, new Set(), path, false);
    })();
  };

  // ── Inter-pane wiring ──────────────────────────────────────────────
  // Selection changes are debounced: navigating (arrow keys, expanding — each focuses a row) fires
  // a selection per step, and every propagation refetches the line dock's /lines plus any sourced
  // pane's /children. Coalescing to the final selection after a short quiet period keeps the editor
  // well under the backend's read rate limit without a perceptible lag.
  let selectTimer: ReturnType<typeof setTimeout> | null = null;
  const onNodePanelSelect = (nodePanelId: string, selectedNodeId: string | null) => {
    if (selectTimer) clearTimeout(selectTimer);
    selectTimer = setTimeout(() => { selectTimer = null; propagateSelect(nodePanelId, selectedNodeId); }, 180);
  };
  const propagateSelect = (nodePanelId: string, selectedNodeId: string | null) => {
    // Selecting a node no longer auto-opens a child pane — drilling is done inline (▸/▾) within
    // the panel. Selection only (a) updates any pane the user has explicitly sourced from this one
    // and (b) feeds the persistent line dock. Extra node panels are added manually (＋).
    // Get ancestors of the selected node from the source pane to exclude from linked nodePanels
    // (graph edges are undirected so ancestors appear as neighbors; filtering prevents backward nav)
    const srcPanel = nodePanels.find(p => p.config.id === nodePanelId);
    const ancestorIds = selectedNodeId && srcPanel
      ? srcPanel.view.getAncestorIds(selectedNodeId)
      : new Set<string>();
    const path = selectedNodeId && srcPanel ? srcPanel.view.getNodePath(selectedNodeId) : [];
    for (const p of nodePanels) {
      // Pinned nodePanels are frozen — they ignore changes to their source pane's selection.
      if (p.config.sourcePanelId === nodePanelId && !p.config.pinned) {
        void p.view.setParent(selectedNodeId, ancestorIds, path);
      }
    }
    // Focusing a node row also sets the global selection → relation panel(s) + 「選択中」node panels.
    if (selectedNodeId !== null) setSelectedNode(selectedNodeId, ancestorIds, path);
  };

  // Move a node from `nodePanelId` to the adjacent pane (Ctrl/Cmd+→/←). Reuses the cross-pane
  // DnD primitives: source publishes the node, the neighbour consumes it. Returns true when
  // a neighbour exists and can host the node (so the outliner suppresses caret movement).
  const moveToAdjacentNodePanel = (nodePanelId: string, nodeId: string, direction: 'left' | 'right'): boolean => {
    if (fullscreenNodePanelId !== null) return false; // neighbours are hidden in fullscreen
    const idx = nodePanels.findIndex(p => p.config.id === nodePanelId);
    if (idx === -1) return false;
    const targetIdx = idx + (direction === 'right' ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= nodePanels.length) return false;
    const source = nodePanels[idx];
    const target = nodePanels[targetIdx];
    const targetParent = target.view.getEffectiveParentId();
    if (targetParent === null) return false;                 // target can't host a node
    const sourceParent = source.view.getNodeParentId(nodeId);
    if (sourceParent === undefined) return false;            // node not in source pane
    // Target pane shows this very node's children (it's sourced from this pane and the node
    // is the current selection) → moving it there would make it its own parent (cycle/freeze).
    if (targetParent === nodeId) return false;
    // Same parent (e.g. both nodePanels show the graph root) → no reparent to do. Returning
    // false leaves the keypress to its default caret-by-word behaviour rather than
    // silently corrupting the sibling chain with a duplicate.
    if (sourceParent === targetParent) return false;
    if (!source.view.beginKeyMove(nodeId)) return false;
    void target.view.acceptKeyMove().finally(() => { ctx.nodePanelDrag = null; });
    return true;
  };

  // Move a whole pane (column) one slot left/right, swapping with its neighbour (Ctrl/Cmd+Shift+→/←).
  // Same array+DOM reorder as the nodePanelHeader drag, just driven by the keyboard. Returns true when
  // a swap happened (so the outliner suppresses the default caret-by-word movement).
  const moveNodePanel = (nodePanelId: string, direction: 'left' | 'right'): boolean => {
    if (fullscreenNodePanelId !== null) return false; // neighbours are hidden in fullscreen
    const idx = nodePanels.findIndex(p => p.config.id === nodePanelId);
    if (idx === -1) return false;
    const targetIdx = idx + (direction === 'right' ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= nodePanels.length) return false;
    // Moving a container via insertBefore blurs any focused descendant (the textarea), so
    // capture it and restore focus afterwards — otherwise repeated Ctrl+Shift+←/→ stops
    // firing because the key events no longer land on a node's textarea.
    const active = document.activeElement as HTMLElement | null;
    // Swap positions in the array, then move just the dragged container past the target (jumping any
    // relation panel that may sit between them in the unified row).
    const moved = nodePanels[idx].containerEl;
    const target = nodePanels[targetIdx].containerEl;
    [nodePanels[idx], nodePanels[targetIdx]] = [nodePanels[targetIdx], nodePanels[idx]];
    el.insertBefore(moved, direction === 'right' ? target.nextSibling : target);
    saveAll();
    updateAllSrcBtns();
    if (active && typeof active.focus === 'function') active.focus();
    return true;
  };

  // ── Pane creation ──────────────────────────────────────────────────
  const createNodePanel = (config: NodePanelConfig): NodePanelInstance => {
    const containerEl = document.createElement('div');
    containerEl.dataset.nodePanelId = config.id;
    containerEl.style.cssText = `
      flex-shrink:0;display:flex;flex-direction:column;
      width:${config.width}px;border-right:1px solid ${BORDER};
      overflow:hidden;position:relative;
    `;

    // ── Header ──────────────────────────────────────────────────────
    const nodePanelHeader = document.createElement('div');
    // Fixed 28px (box-sized) so the node pane nodePanelHeader and the relation panel nodePanelHeader line up.
    nodePanelHeader.style.cssText = `
      flex-shrink:0;display:flex;align-items:center;gap:4px;
      height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};
      font-size:11px;color:${TEXT_MID};
    `;

    // Drag handle (⠿) at the header's left + drop zone on the container — reorder among ALL panels.
    nodePanelHeader.appendChild(makeGrip(config.id));
    addDropZone(config.id, containerEl);

    // Label (editable) — user-select:text overrides any parent user-select:none
    const labelEl = document.createElement('span');
    labelEl.textContent = config.label;
    labelEl.contentEditable = 'true';
    labelEl.spellcheck = false;
    labelEl.style.cssText = `flex:1;outline:none;color:${TEXT_HIGH};font-size:12px;cursor:text;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;border-bottom:1px solid transparent;`;
    labelEl.addEventListener('focus', () => { labelEl.style.borderBottom = `1px solid ${TEXT_DIM}`; });
    labelEl.addEventListener('blur', () => {
      labelEl.style.borderBottom = '1px solid transparent';
      config.label = labelEl.textContent?.trim() || config.label;
      saveAll();
    });
    labelEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); } });
    nodePanelHeader.appendChild(labelEl);

    // Per-pane language toggle (JA ⇄ EN) — compact single button to save nodePanelHeader width
    const langBtn = document.createElement('button');
    const updateLangBtn = () => {
      langBtn.textContent = config.lang.toUpperCase();
      langBtn.title = config.lang === 'ja' ? 'このパネルの言語: 日本語（クリックでEN）' : 'このパネルの言語: 英語（クリックでJA）';
      langBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;flex-shrink:0;line-height:1.4;`;
    };
    updateLangBtn();
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      config.lang = config.lang === 'ja' ? 'en' : 'ja';
      updateLangBtn();
      view.setLang(config.lang);
      saveAll();
    });
    nodePanelHeader.appendChild(langBtn);

    // Source button
    const srcPanelBtn = document.createElement('button');
    srcPanelBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0;`;
    const updateSrcBtn = () => {
      if (config.sourcePanelId === SELECTION_SRC) { srcPanelBtn.textContent = '選択中'; return; }
      const src = nodePanels.find(p => p.config.id === config.sourcePanelId);
      srcPanelBtn.textContent = src ? src.config.label : 'ルート';
    };
    srcPanelBtn.addEventListener('click', (e) => { e.stopPropagation(); showSourcePanelMenu(config.id, srcPanelBtn); });
    nodePanelHeader.appendChild(srcPanelBtn);

    // Pin (固定) toggle — when on, this pane stops following its source pane's selection,
    // freezing the currently-displayed nodes. Only meaningful when source is another pane.
    const pinBtn = document.createElement('button');
    const updatePinBtn = () => {
      const on = !!config.pinned;
      // ❄ (freeze) with VS15 to force monochrome text rendering (avoid emoji presentation).
      pinBtn.textContent = '❄︎';
      pinBtn.title = on ? '固定中（ソースの選択に追従しない）。クリックで解除' : '表示を固定（ソースの選択に追従しない）';
      pinBtn.style.cssText = on
        ? `background:${SELECT_STRONG};border:none;color:#fff;cursor:pointer;font-size:13px;padding:1px 3px;border-radius:3px;line-height:1;flex-shrink:0;`
        : `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    };
    updatePinBtn();
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      config.pinned = !config.pinned;
      if (config.pinned) {
        // Snapshot the current parent so the frozen view can be restored on reload.
        config.pinnedSourceNodeId = view.getSourceNodeId();
      } else {
        config.pinnedSourceNodeId = undefined;
        // Resume following: re-sync to the source pane's current selection.
        if (config.sourcePanelId !== null) {
          const srcInst = nodePanels.find(p => p.config.id === config.sourcePanelId);
          const selId = srcInst ? (srcInst.view.getSelectedId() ?? null) : null;
          const srcPath = selId && srcInst ? srcInst.view.getNodePath(selId) : [];
          void view.setParent(selId, undefined, srcPath);
        }
      }
      saveAll();
      updatePinBtn();
    });
    nodePanelHeader.appendChild(pinBtn);

    // Reload button — re-fetch this pane's nodes from the backend
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = 'パネル内のノードを再読み込み';
    reloadBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    reloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reloadBtn.style.color = TEXT_HIGH;
      void view.load().finally(() => { reloadBtn.style.color = TEXT_DIM; });
    });
    nodePanelHeader.appendChild(reloadBtn);

    // Fullscreen toggle button
    const fsBtn = document.createElement('button');
    const updateFsBtn = () => {
      const isThis = fullscreenNodePanelId === config.id;
      fsBtn.textContent = isThis ? '⤡' : '⤢';
      fsBtn.title = isThis ? '全幅表示を解除' : '全幅表示';
      fsBtn.style.cssText = `background:transparent;border:none;color:${isThis ? TEXT_HIGH : TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    };
    updateFsBtn();
    fsBtn.addEventListener('click', () => {
      fullscreenNodePanelId = fullscreenNodePanelId === config.id ? null : config.id;
      applyFullscreenLayout();
    });
    nodePanelHeader.appendChild(fsBtn);

    // Add-pane button (＋) — lives in the nodePanelHeader, just left of ×, matching its look. Adding panels
    // is manual now (no standalone + between the panels and the line dock), so node panels and the
    // line dock sit flush against each other.
    const addBtn = document.createElement('button');
    addBtn.textContent = '＋';
    addBtn.title = '列を追加';
    addBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); addNodePanel(config.id); });
    nodePanelHeader.appendChild(addBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    closeBtn.addEventListener('click', () => { removeNodePanel(config.id); });
    nodePanelHeader.appendChild(closeBtn);

    containerEl.appendChild(nodePanelHeader);

    // ── Outliner body ────────────────────────────────────────────────
    const sourcePanel = nodePanels.find(p => p.config.id === config.sourcePanelId);
    // Pinned pane restores its frozen parent snapshot; otherwise it derives from the
    // source pane's current selection.
    const pinnedActive = config.sourcePanelId !== null && config.pinned && config.pinnedSourceNodeId !== undefined;
    const initParent = pinnedActive
      ? (config.pinnedSourceNodeId ?? null)
      : (sourcePanel ? (sourcePanel.view.getSelectedId() ?? null) : null);
    const sourceNodeId = config.sourcePanelId !== null ? initParent : undefined;
    const nodePanelPath = (config.sourcePanelId !== null && initParent && sourcePanel)
      ? sourcePanel.view.getNodePath(initParent) : [];

    const view = createNodePanelView(ctx, {
      nodePanelId: config.id,
      sourceNodeId,
      nodePanelPath,
      lang: config.lang,
      onNodeSelect: (nodeId) => onNodePanelSelect(config.id, nodeId),
      onMoveNodeToNodePanel: (nodeId, direction) => moveToAdjacentNodePanel(config.id, nodeId, direction),
      onReorderNodePanel: (direction) => moveNodePanel(config.id, direction),
      onContentWidthChange: (w) => {
        // Measure only non-flex-1 nodePanelHeader children to avoid feedback loop
        // (nodePanelHeader.scrollWidth includes labelEl which stretches to container width)
        const minHeaderW = langBtn.offsetWidth + srcPanelBtn.offsetWidth + pinBtn.offsetWidth + reloadBtn.offsetWidth + fsBtn.offsetWidth + addBtn.offsetWidth + closeBtn.offsetWidth + 36;
        const actualW = Math.max(w, minHeaderW);
        containerEl.style.width = `${actualW}px`;
        config.width = actualW;
      },
    });
    view.el.style.flex = '1';
    containerEl.appendChild(view.el);

    // ── Resize handle ────────────────────────────────────────────────
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = `
      position:absolute;right:0;top:0;bottom:0;width:4px;
      cursor:col-resize;z-index:1;
    `;
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = config.width;
      const onMove = (ev: MouseEvent) => {
        config.width = Math.max(NODE_PANEL_WIDTH(), startW + ev.clientX - startX);
        containerEl.style.width = `${config.width}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveAll();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    containerEl.appendChild(resizeHandle);

    const instance: NodePanelInstance = { config, view, containerEl, updateSrcBtn, updateFsBtn, updatePinBtn, updateLangBtn };

    return instance;
  };

  // ── Source selector popover ──────────────────────────────────────
  const showSourcePanelMenu = (nodePanelId: string, anchor: HTMLElement) => {
    document.querySelector('[data-node-panel-src-menu]')?.remove();
    const menu = document.createElement('div');
    menu.dataset.nodePanelSrcMenu = '1';
    const ar = anchor.getBoundingClientRect();
    menu.style.cssText = `
      position:fixed;left:${ar.left}px;top:${ar.bottom + 2}px;
      z-index:200;background:hsl(240,14%,9%);border:1px solid ${BORDER};
      border-radius:6px;padding:4px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.4);
      min-width:140px;
    `;
    const config = nodePanels.find(p => p.config.id === nodePanelId)?.config;
    if (!config) return;

    const addItem = (label: string, value: string | null) => {
      const item = document.createElement('div');
      item.textContent = label;
      const active = config.sourcePanelId === value;
      item.style.cssText = `
        padding:4px 8px;border-radius:4px;cursor:pointer;
        color:${active ? TEXT_HIGH : TEXT_MID};
        background:${active ? 'rgba(255,255,255,.07)' : 'transparent'};
      `;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.07)'; });
      item.addEventListener('mouseleave', () => { item.style.background = active ? 'rgba(255,255,255,.07)' : 'transparent'; });
      item.addEventListener('click', () => {
        config.sourcePanelId = value;
        // Changing the source invalidates any frozen snapshot — unpin so it follows the new source.
        config.pinned = false;
        config.pinnedSourceNodeId = undefined;
        saveAll();
        menu.remove();
        // Update source button label
        const inst = nodePanels.find(p => p.config.id === nodePanelId);
        if (inst) { inst.updateSrcBtn(); inst.updatePinBtn(); }
        // Trigger load from new source
        if (value === null) {
          // Reset pane to root (clears any stale pane-parent so root children show)
          void inst?.view.setSourceRoot();
        } else if (value === SELECTION_SRC) {
          // Follow the global selection: show the currently-selected node's children now.
          void inst?.view.setParent(selectedNodeId, undefined, []);
        } else {
          const srcInst = nodePanels.find(p => p.config.id === value);
          const selId = srcInst ? (srcInst.view.getSelectedId() ?? null) : null;
          const path = selId && srcInst ? srcInst.view.getNodePath(selId) : [];
          void inst?.view.setParent(selId, undefined, path);
        }
      });
      menu.appendChild(item);
    };

    addItem('ルート', null);
    for (const p of nodePanels) {
      if (p.config.id !== nodePanelId) addItem(p.config.label, p.config.id);
    }

    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${ar.top - r.height - 2}px`;
    });
    const onOut = (e: MouseEvent) => {
      if (!menu.contains(e.target as Element)) { menu.remove(); document.removeEventListener('mousedown', onOut); }
    };
    setTimeout(() => document.addEventListener('mousedown', onOut), 0);
  };


  // ── Pane add / remove ────────────────────────────────────────────
  // Add a new node panel. Triggered from each pane nodePanelHeader's "+" button, which passes its own
  // id as `sourceId`: the new panel is sourced from (drills into) the panel it was added from, and is
  // inserted right after it. Called with null → an independent root panel appended at the end.
  const addNodePanel = (sourceId: string | null = null) => {
    const srcIdx = sourceId ? nodePanels.findIndex(p => p.config.id === sourceId) : -1;
    const inheritLang = srcIdx >= 0 ? nodePanels[srcIdx].config.lang
      : (nodePanels.length > 0 ? nodePanels[nodePanels.length - 1].config.lang : ctx.state.lang);
    const config = newNodePanelConfig(`パネル ${nodePanels.length + 1}`, inheritLang);
    config.sourcePanelId = srcIdx >= 0 ? sourceId : null;
    const inst = createNodePanel(config);
    if (srcIdx >= 0) {
      const srcEl = nodePanels[srcIdx].containerEl;
      nodePanels.splice(srcIdx + 1, 0, inst);
      srcEl.parentElement?.insertBefore(inst.containerEl, srcEl.nextSibling);
    } else {
      nodePanels.push(inst);
      el.appendChild(inst.containerEl);
    }
    saveAll();
    updateAllSrcBtns();
    void inst.view.load();
  };

  const removeNodePanel = (nodePanelId: string) => {
    const idx = nodePanels.findIndex(p => p.config.id === nodePanelId);
    if (idx === -1) return;
    const [removed] = nodePanels.splice(idx, 1);
    removed.view.unregister();
    removed.containerEl.remove();
    if (fullscreenNodePanelId === nodePanelId) {
      fullscreenNodePanelId = null;
      applyFullscreenLayout();
    }
    // Orphan dependent nodePanels (reset source to null = root)
    for (const p of nodePanels) {
      if (p.config.sourcePanelId === nodePanelId) {
        p.config.sourcePanelId = null;
        updateAllSrcBtns();
      }
    }
    saveAll();
    updateAllSrcBtns();
  };

  const updateAllSrcBtns = () => {
    for (const p of nodePanels) {
      p.updateSrcBtn();
    }
  };

  const saveAll = () => {
    saveNodePanels(ctx.gId, nodePanels.map(p => p.config));
  };

  // ── Init ─────────────────────────────────────────────────────────
  // Default layout = ノード(ルート) + リレーション. The primary relation panel is inserted right after
  // the FIRST node panel; node panel configs persist (order among themselves) but the mixed order with
  // the relation panel is not persisted (resets to this on reload). Node-link left-click opens a further
  // relation panel to the right, so drilling into relations is how you navigate (no children pane).
  const defaultConfigs = (): NodePanelConfig[] => [
    { ...newNodePanelConfig('パネル 1', ctx.state.lang), sourcePanelId: null },
  ];
  const init = () => {
    el.innerHTML = '';
    nodePanels.length = 0;
    relationPanels.length = 0;

    const saved = loadNodePanels(ctx.gId, ctx.state.lang);
    // Drop the vestigial 「選択中の子」 (SELECTION_SRC) node panels: node hierarchy/children was removed,
    // so such a panel now shows nothing useful. Existing saved layouts are cleaned up on load.
    const savedClean = saved?.filter((c) => c.sourcePanelId !== SELECTION_SRC) ?? null;
    const configs: NodePanelConfig[] = (savedClean && savedClean.length) ? savedClean : defaultConfigs();

    // The relation column holds a vertical stack of relation panels (primary on top).
    relationColumn.innerHTML = '';
    const relInst = createRelationPanel('rel-primary', relationView, true);
    relationPanels.push(relInst);
    relationColumn.appendChild(relInst.containerEl);
    refreshRelationBorders();

    configs.forEach((cfg, i) => {
      const inst = createNodePanel(cfg);
      nodePanels.push(inst);
      el.appendChild(inst.containerEl);
      // Insert the relation column right after the first node panel.
      if (i === 0) el.appendChild(relationColumn);
    });
    if (configs.length === 0) el.appendChild(relationColumn);
    // The context (document) panel is the right-most column.
    el.appendChild(contextContainer);

    updateAllSrcBtns();
  };

  init();

  const load = async () => {
    for (const p of nodePanels) await p.view.load();
  };

  const refresh = () => {
    for (const p of nodePanels) p.view.refresh();
  };

  const search = async (q: string) => {
    for (const p of nodePanels) await p.view.search(q);
  };

  // Apply a language to every pane at once (the top-bar JA/EN acts as "set all").
  const setAllLang = (lang: 'en' | 'ja') => {
    for (const p of nodePanels) {
      p.config.lang = lang;
      p.updateLangBtn();
      p.view.setLang(lang);
    }
    relationView.setLang(lang);
    contextView.setLang(lang);
    saveAll();
  };

  return { el, load, refresh, search, setAllLang };
}
