import type { GraphEditorContext, PanelView } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { createNodePanelView } from './node-panel-view';
import { createRelationPanelView } from './relation-panel-view';
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
  // Outer wrapper: a horizontally-scrolling node area on the left + one persistent line (relation)
  // dock pinned to the right. Node panels (複数) drill the hierarchy; the line dock always shows
  // the edges of the active node.
  const el = document.createElement('div');
  el.style.cssText = `display:flex;flex-direction:row;flex:1;overflow:hidden;`;

  // Node panels take only their own width on the left (shrinkable + horizontally scrollable when
  // they overflow); the line dock fills ALL remaining space to the right (右余白全体).
  const nodeArea = document.createElement('div');
  nodeArea.style.cssText = `display:flex;flex-direction:row;flex:0 1 auto;overflow-x:auto;overflow-y:hidden;min-width:0;`;
  el.appendChild(nodeArea);

  // ── Line dock (常時表示・右余白を全部使う) ──────────────────────────────────
  // A horizontal stack of relation panels. The primary panel (leftmost) follows the active node
  // selection; right-clicking a node-link chip appends an extra panel to its right (Miller-column
  // style, ②). Extra panels each carry their own close button.
  const relationDock = document.createElement('div');
  relationDock.style.cssText = `flex:1 1 0;min-width:300px;display:flex;flex-direction:row;border-left:1px solid ${BORDER};overflow-x:auto;overflow-y:hidden;`;

  const primaryPanel = document.createElement('div');
  primaryPanel.style.cssText = `flex:1 1 0;min-width:300px;display:flex;flex-direction:column;overflow:hidden;`;
  const relationView: PanelView = createRelationPanelView(ctx, { lang: ctx.state.lang, initialNodeId: null });
  relationView.el.style.flex = '1';
  primaryPanel.appendChild(relationView.el);
  relationDock.appendChild(primaryPanel);
  el.appendChild(relationDock);

  // ② Open an additional relation panel to the right showing `nodeId`'s relations. Independent of
  // the primary dock (does not follow selection); closed via its own × button.
  ctx.openRelationPanel = (nodeId, label) => {
    const panel = document.createElement('div');
    panel.style.cssText = `flex:1 1 0;min-width:300px;display:flex;flex-direction:column;border-left:1px solid ${BORDER};overflow:hidden;`;
    let view: PanelView;
    const close = () => { panel.remove(); view.unregister(); };
    view = createRelationPanelView(ctx, { lang: ctx.state.lang, initialNodeId: nodeId, onClose: close });
    view.el.style.flex = '1';
    panel.appendChild(view.el);
    relationDock.appendChild(panel);
    // createRelationPanelView renders once from initialNodeId; setParent re-renders with the full breadcrumb
    // (ルート › … › node) so the nodePanelHeader matches the node dock's breadcrumb, not just the bare name.
    void (async () => {
      const path = await fetchNodePath(ctx.gId, nodeId, label ?? '', ctx.rootNodeId, ctx.state.lang);
      await view.setParent(nodeId, undefined, path);
    })();
    requestAnimationFrame(() => { relationDock.scrollLeft = relationDock.scrollWidth; });
  };

  const nodePanels: NodePanelInstance[] = [];
  let fullscreenNodePanelId: string | null = null;
  let draggingNodePanelId: string | null = null;

  // Clear the pane-reorder drop indicator (blue vertical line) from every pane.
  const clearNodePanelDropIndicators = () => {
    for (const p of nodePanels) p.containerEl.style.boxShadow = '';
  };

  // Reorder nodePanels via nodePanelHeader drag-and-drop. `before` = drop on the left half of the target.
  const reorderNodePanel = (draggedId: string, targetId: string, before: boolean) => {
    if (draggedId === targetId) return;
    const from = nodePanels.findIndex(p => p.config.id === draggedId);
    if (from === -1) return;
    const [moved] = nodePanels.splice(from, 1);
    let to = nodePanels.findIndex(p => p.config.id === targetId);
    if (to === -1) { nodePanels.splice(from, 0, moved); return; }
    if (!before) to += 1;
    nodePanels.splice(to, 0, moved);
    for (const p of nodePanels) nodeArea.appendChild(p.containerEl);
    saveAll();
    updateAllSrcBtns();
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
    // The persistent line dock always reflects the most recently selected node (across all nodePanels).
    // Selecting a different node clears the active relation, so squares fall back to marking the
    // selected node (and setActiveRelation(null) also triggers a marker redraw for that).
    if (selectedNodeId !== null) {
      ctx.setActiveRelation(null);
      void relationView.setParent(selectedNodeId, ancestorIds, path);
    }
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
    // Swap positions in the array, then re-insert every container in the new order.
    [nodePanels[idx], nodePanels[targetIdx]] = [nodePanels[targetIdx], nodePanels[idx]];
    for (const p of nodePanels) nodeArea.appendChild(p.containerEl);
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

    // Drag handle — drag onto another pane's nodePanelHeader to reorder nodePanels
    const grip = document.createElement('span');
    grip.textContent = '⠿';
    grip.title = 'ドラッグでパネルを並び替え';
    grip.draggable = true;
    grip.style.cssText = `flex-shrink:0;cursor:grab;color:${TEXT_DIM};font-size:13px;user-select:none;padding:0 2px;`;
    grip.addEventListener('dragstart', (e) => {
      draggingNodePanelId = config.id;
      e.dataTransfer?.setData('text/plain', config.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => { draggingNodePanelId = null; clearNodePanelDropIndicators(); });
    nodePanelHeader.appendChild(grip);

    // Header is the drop zone (body has its own node drag-and-drop; guard on draggingNodePanelId).
    // Show a blue vertical line on the side the dragged pane will be inserted (left/right half),
    // matching the node-reorder insertion indicator.
    nodePanelHeader.addEventListener('dragover', (e) => {
      if (!draggingNodePanelId || draggingNodePanelId === config.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = containerEl.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      clearNodePanelDropIndicators();
      containerEl.style.boxShadow = before ? 'inset 2px 0 0 0 #4a9eff' : 'inset -2px 0 0 0 #4a9eff';
    });
    nodePanelHeader.addEventListener('dragleave', (e) => {
      if (!containerEl.contains(e.relatedTarget as Node | null)) containerEl.style.boxShadow = '';
    });
    nodePanelHeader.addEventListener('drop', (e) => {
      if (!draggingNodePanelId || draggingNodePanelId === config.id) return;
      e.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      reorderNodePanel(draggingNodePanelId, config.id, (e.clientX - rect.left) < rect.width / 2);
      draggingNodePanelId = null;
      clearNodePanelDropIndicators();
    });

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
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); addNodePanel(); });
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
  // Add a new independent node panel to the right. Triggered from each pane nodePanelHeader's "+" button.
  const addNodePanel = () => {
    // New pane inherits the language of the rightmost pane (or the global default).
    const inheritLang = nodePanels.length > 0 ? nodePanels[nodePanels.length - 1].config.lang : ctx.state.lang;
    const config = newNodePanelConfig(`パネル ${nodePanels.length + 1}`, inheritLang);
    // Default = independent (source = root/null). Linking to another pane is opt-in via the
    // source menu.
    const inst = createNodePanel(config);
    nodePanels.push(inst);
    nodeArea.appendChild(inst.containerEl);
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
  const init = () => {
    nodeArea.innerHTML = '';
    nodePanels.length = 0;

    const saved = loadNodePanels(ctx.gId, ctx.state.lang);
    const configs: NodePanelConfig[] = saved?.length
      ? saved
      : [newNodePanelConfig('パネル 1', ctx.state.lang)];

    for (const cfg of configs) {
      const inst = createNodePanel(cfg);
      nodePanels.push(inst);
      nodeArea.appendChild(inst.containerEl);
    }

    // After all nodePanels are created, update source buttons
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
    saveAll();
  };

  return { el, load, refresh, search, setAllLang };
}
