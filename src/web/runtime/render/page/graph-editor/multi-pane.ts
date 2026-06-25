import type { GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { createOutlinerView } from './outliner-view';

type PaneConfig = {
  id: string;
  label: string;
  sourceId: string | null;   // null = root; or another pane id
  filterKeys: string[];      // property keys that must be present (ALL)
  sortByProps: boolean;      // true = sort by property keyOrder ascending
  width: number;             // px
  lang: 'en' | 'ja';         // per-pane display/edit language
  pinned?: boolean;          // true = frozen: ignore source-pane selection changes
  pinnedParentId?: string | null; // parent snapshot to restore the frozen view on reload
};

type PaneInstance = {
  config: PaneConfig;
  view: ReturnType<typeof createOutlinerView>;
  containerEl: HTMLElement;   // the outer div (header + body)
  updateSrcBtn: () => void;
  updateFltBtn: () => void;
  updateSortBtn: () => void;
  updateFsBtn: () => void;
  updatePinBtn: () => void;
  updateLangBtn: () => void;
};

const STORAGE_KEY = (gId: string) => `graph-editor-panes:${gId}`;
const PANE_WIDTH = () => Math.max(280, Math.round(window.innerWidth * 0.20));

function savePanes(gId: string, configs: PaneConfig[]) {
  localStorage.setItem(STORAGE_KEY(gId), JSON.stringify(configs));
}

function loadPanes(gId: string, defaultLang: 'en' | 'ja'): PaneConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(gId));
    if (!raw) return null;
    const arr = JSON.parse(raw) as Partial<PaneConfig>[];
    // Older saved configs predate per-pane lang → fall back to the global default.
    return arr.map(c => ({ ...c, sortByProps: c.sortByProps ?? false, lang: c.lang ?? defaultLang })) as PaneConfig[];
  } catch { return null; }
}

function newPaneConfig(label: string, lang: 'en' | 'ja'): PaneConfig {
  return {
    id: `pane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    sourceId: null,
    filterKeys: [],
    sortByProps: false,
    width: PANE_WIDTH(),
    lang,
  };
}

export function createMultiPaneView(ctx: GraphEditorContext): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (q: string) => Promise<void>;
  setAllLang: (lang: 'en' | 'ja') => void;
} {
  const el = document.createElement('div');
  el.style.cssText = `display:flex;flex-direction:row;flex:1;overflow-x:auto;overflow-y:hidden;`;

  const panes: PaneInstance[] = [];
  let fullscreenPaneId: string | null = null;
  let draggingPaneId: string | null = null;

  // Clear the pane-reorder drop indicator (blue vertical line) from every pane.
  const clearPaneDropIndicators = () => {
    for (const p of panes) p.containerEl.style.boxShadow = '';
  };

  // Reorder panes via header drag-and-drop. `before` = drop on the left half of the target.
  const reorderPane = (draggedId: string, targetId: string, before: boolean) => {
    if (draggedId === targetId) return;
    const from = panes.findIndex(p => p.config.id === draggedId);
    if (from === -1) return;
    const [moved] = panes.splice(from, 1);
    let to = panes.findIndex(p => p.config.id === targetId);
    if (to === -1) { panes.splice(from, 0, moved); return; }
    if (!before) to += 1;
    panes.splice(to, 0, moved);
    for (const p of panes) el.insertBefore(p.containerEl, addPaneBtn);
    saveAll();
    updateAllSrcBtns();
  };

  const applyFullscreenLayout = () => {
    const isFs = fullscreenPaneId !== null;
    addPaneBtn.style.display = isFs ? 'none' : '';
    for (const p of panes) {
      const isThis = p.config.id === fullscreenPaneId;
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
  const onPaneSelect = (paneId: string, selectedNodeId: string | null) => {
    // Get ancestors of the selected node from the source pane to exclude from child panes
    // (graph edges are undirected so ancestors appear as neighbors; filtering prevents backward nav)
    const srcPane = panes.find(p => p.config.id === paneId);
    const ancestorIds = selectedNodeId && srcPane
      ? srcPane.view.getAncestorIds(selectedNodeId)
      : new Set<string>();
    const path = selectedNodeId && srcPane ? srcPane.view.getNodePath(selectedNodeId) : [];
    for (const p of panes) {
      // Pinned panes are frozen — they ignore changes to their source pane's selection.
      if (p.config.sourceId === paneId && !p.config.pinned) {
        void p.view.setParent(selectedNodeId, ancestorIds, path);
      }
    }
  };

  // Move a node from `paneId` to the adjacent pane (Ctrl/Cmd+→/←). Reuses the cross-pane
  // DnD primitives: source publishes the node, the neighbour consumes it. Returns true when
  // a neighbour exists and can host the node (so the outliner suppresses caret movement).
  const moveToAdjacentPane = (paneId: string, nodeId: string, direction: 'left' | 'right'): boolean => {
    if (fullscreenPaneId !== null) return false; // neighbours are hidden in fullscreen
    const idx = panes.findIndex(p => p.config.id === paneId);
    if (idx === -1) return false;
    const targetIdx = idx + (direction === 'right' ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= panes.length) return false;
    const source = panes[idx];
    const target = panes[targetIdx];
    const targetParent = target.view.getEffectiveParentId();
    if (targetParent === null) return false;                 // target can't host a node
    const sourceParent = source.view.getNodeParentId(nodeId);
    if (sourceParent === undefined) return false;            // node not in source pane
    // Target pane shows this very node's children (it's sourced from this pane and the node
    // is the current selection) → moving it there would make it its own parent (cycle/freeze).
    if (targetParent === nodeId) return false;
    // Same parent (e.g. both panes show the graph root) → no reparent to do. Returning
    // false leaves the keypress to its default caret-by-word behaviour rather than
    // silently corrupting the sibling chain with a duplicate.
    if (sourceParent === targetParent) return false;
    if (!source.view.beginKeyMove(nodeId)) return false;
    void target.view.acceptKeyMove().finally(() => { ctx.paneDrag = null; });
    return true;
  };

  // Move a whole pane (column) one slot left/right, swapping with its neighbour (Ctrl/Cmd+Shift+→/←).
  // Same array+DOM reorder as the header drag, just driven by the keyboard. Returns true when
  // a swap happened (so the outliner suppresses the default caret-by-word movement).
  const movePane = (paneId: string, direction: 'left' | 'right'): boolean => {
    if (fullscreenPaneId !== null) return false; // neighbours are hidden in fullscreen
    const idx = panes.findIndex(p => p.config.id === paneId);
    if (idx === -1) return false;
    const targetIdx = idx + (direction === 'right' ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= panes.length) return false;
    // Moving a container via insertBefore blurs any focused descendant (the textarea), so
    // capture it and restore focus afterwards — otherwise repeated Ctrl+Shift+←/→ stops
    // firing because the key events no longer land on a node's textarea.
    const active = document.activeElement as HTMLElement | null;
    // Swap positions in the array, then re-insert every container in the new order.
    [panes[idx], panes[targetIdx]] = [panes[targetIdx], panes[idx]];
    for (const p of panes) el.insertBefore(p.containerEl, addPaneBtn);
    saveAll();
    updateAllSrcBtns();
    if (active && typeof active.focus === 'function') active.focus();
    return true;
  };

  // ── Pane creation ──────────────────────────────────────────────────
  const createPane = (config: PaneConfig): PaneInstance => {
    const containerEl = document.createElement('div');
    containerEl.dataset.paneId = config.id;
    containerEl.style.cssText = `
      flex-shrink:0;display:flex;flex-direction:column;
      width:${config.width}px;border-right:1px solid ${BORDER};
      overflow:hidden;position:relative;
    `;

    // ── Header ──────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
      flex-shrink:0;display:flex;align-items:center;gap:4px;
      padding:3px 6px;border-bottom:1px solid ${BORDER};
      font-size:11px;color:${TEXT_MID};
    `;

    // Drag handle — drag onto another pane's header to reorder panes
    const grip = document.createElement('span');
    grip.textContent = '⠿';
    grip.title = 'ドラッグでパネルを並び替え';
    grip.draggable = true;
    grip.style.cssText = `flex-shrink:0;cursor:grab;color:${TEXT_DIM};font-size:13px;user-select:none;padding:0 2px;`;
    grip.addEventListener('dragstart', (e) => {
      draggingPaneId = config.id;
      e.dataTransfer?.setData('text/plain', config.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => { draggingPaneId = null; clearPaneDropIndicators(); });
    header.appendChild(grip);

    // Header is the drop zone (body has its own node drag-and-drop; guard on draggingPaneId).
    // Show a blue vertical line on the side the dragged pane will be inserted (left/right half),
    // matching the node-reorder insertion indicator.
    header.addEventListener('dragover', (e) => {
      if (!draggingPaneId || draggingPaneId === config.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = containerEl.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      clearPaneDropIndicators();
      containerEl.style.boxShadow = before ? 'inset 2px 0 0 0 #4a9eff' : 'inset -2px 0 0 0 #4a9eff';
    });
    header.addEventListener('dragleave', (e) => {
      if (!containerEl.contains(e.relatedTarget as Node | null)) containerEl.style.boxShadow = '';
    });
    header.addEventListener('drop', (e) => {
      if (!draggingPaneId || draggingPaneId === config.id) return;
      e.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      reorderPane(draggingPaneId, config.id, (e.clientX - rect.left) < rect.width / 2);
      draggingPaneId = null;
      clearPaneDropIndicators();
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
    header.appendChild(labelEl);

    // Per-pane language toggle (JA ⇄ EN) — compact single button to save header width
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
    header.appendChild(langBtn);

    // Source button
    const srcBtn = document.createElement('button');
    srcBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0;`;
    const updateSrcBtn = () => {
      const src = panes.find(p => p.config.id === config.sourceId);
      srcBtn.textContent = src ? src.config.label : 'ルート';
    };
    srcBtn.addEventListener('click', (e) => { e.stopPropagation(); showSourceMenu(config.id, srcBtn); });
    header.appendChild(srcBtn);

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
        config.pinnedParentId = view.getPaneParentId();
      } else {
        config.pinnedParentId = undefined;
        // Resume following: re-sync to the source pane's current selection.
        if (config.sourceId !== null) {
          const srcInst = panes.find(p => p.config.id === config.sourceId);
          const selId = srcInst ? (srcInst.view.getSelectedId() ?? null) : null;
          const srcPath = selId && srcInst ? srcInst.view.getNodePath(selId) : [];
          void view.setParent(selId, undefined, srcPath);
        }
      }
      saveAll();
      updatePinBtn();
    });
    header.appendChild(pinBtn);

    // Filter area — the "フィルタ" button is tinted when a filter is active (active keys are
    // toggled via the menu that opens on click, so no per-key pills are shown here)
    const fltArea = document.createElement('div');
    fltArea.style.cssText = `display:flex;align-items:center;cursor:pointer;flex-shrink:0;padding:0 2px;`;
    const updateFltBtn = () => {
      fltArea.innerHTML = '';
      const active = config.filterKeys.length > 0;
      const col = active ? (ctx.allPropColors.get(config.filterKeys[0])?.code ?? TEXT_HIGH) : TEXT_DIM;
      const icon = document.createElement('span');
      icon.textContent = '▽';
      icon.style.cssText = `color:${col};font-size:13px;line-height:1;`;
      fltArea.appendChild(icon);
      fltArea.title = active ? `フィルタ: ${config.filterKeys.join(', ')}` : 'フィルタを設定';
    };
    updateFltBtn();
    fltArea.addEventListener('click', (e) => {
      e.stopPropagation();
      const inst = panes.find(p => p.config.id === config.id);
      if (!inst) return;
      inst.view.openKeyMenu({
        anchor: fltArea,
        mode: 'pane-filter',
        isActive: (key) => config.filterKeys.includes(key),
        onToggle: (key) => {
          if (config.filterKeys.includes(key)) {
            config.filterKeys = config.filterKeys.filter(k => k !== key);
          } else {
            config.filterKeys.push(key);
          }
          saveAll();
          inst.view.setPaneFilterKeys(new Set(config.filterKeys));
          updateFltBtn();
        },
      });
    });
    header.appendChild(fltArea);

    // Sort action button — press to reorder the stored sibling order by property keyOrder
    // (persists to the backend; this is an action, not a view toggle)
    const sortBtn = document.createElement('button');
    const updateSortBtn = () => {
      sortBtn.textContent = '⇅';
      sortBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    };
    updateSortBtn();
    sortBtn.title = 'プロパティ順でDB上の並び順を並び替える';
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sortBtn.disabled = true;
      void view.applyPropertySort().finally(() => { sortBtn.disabled = false; });
    });
    header.appendChild(sortBtn);

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
    header.appendChild(reloadBtn);

    // Fullscreen toggle button
    const fsBtn = document.createElement('button');
    const updateFsBtn = () => {
      const isThis = fullscreenPaneId === config.id;
      fsBtn.textContent = isThis ? '⤡' : '⤢';
      fsBtn.title = isThis ? '全幅表示を解除' : '全幅表示';
      fsBtn.style.cssText = `background:transparent;border:none;color:${isThis ? TEXT_HIGH : TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    };
    updateFsBtn();
    fsBtn.addEventListener('click', () => {
      fullscreenPaneId = fullscreenPaneId === config.id ? null : config.id;
      applyFullscreenLayout();
    });
    header.appendChild(fsBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    closeBtn.addEventListener('click', () => { removePane(config.id); });
    header.appendChild(closeBtn);

    containerEl.appendChild(header);

    // ── Outliner body ────────────────────────────────────────────────
    const sourcePane = panes.find(p => p.config.id === config.sourceId);
    // Pinned pane restores its frozen parent snapshot; otherwise it derives from the
    // source pane's current selection.
    const pinnedActive = config.sourceId !== null && config.pinned && config.pinnedParentId !== undefined;
    const initParent = pinnedActive
      ? (config.pinnedParentId ?? null)
      : (sourcePane ? (sourcePane.view.getSelectedId() ?? null) : null);
    const paneParentId = config.sourceId !== null ? initParent : undefined;
    const panePath = (config.sourceId !== null && initParent && sourcePane)
      ? sourcePane.view.getNodePath(initParent) : [];

    const view = createOutlinerView(ctx, {
      paneParentId,
      panePath,
      paneFilterKeys: new Set(config.filterKeys),
      paneSortByProps: false, // 並び替えは即時DB反映アクション化したのでビューソートは無効
      lang: config.lang,
      onNodeSelect: (nodeId) => onPaneSelect(config.id, nodeId),
      onMoveNodeToPane: (nodeId, direction) => moveToAdjacentPane(config.id, nodeId, direction),
      onReorderPane: (direction) => movePane(config.id, direction),
      onContentWidthChange: (w) => {
        // Measure only non-flex-1 header children to avoid feedback loop
        // (header.scrollWidth includes labelEl which stretches to container width)
        const minHeaderW = langBtn.offsetWidth + srcBtn.offsetWidth + pinBtn.offsetWidth + fltArea.scrollWidth + sortBtn.offsetWidth + reloadBtn.offsetWidth + fsBtn.offsetWidth + closeBtn.offsetWidth + 36;
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
        config.width = Math.max(PANE_WIDTH(), startW + ev.clientX - startX);
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

    const instance: PaneInstance = { config, view, containerEl, updateSrcBtn, updateFltBtn, updateSortBtn, updateFsBtn, updatePinBtn, updateLangBtn };

    return instance;
  };

  // ── Source selector popover ──────────────────────────────────────
  const showSourceMenu = (paneId: string, anchor: HTMLElement) => {
    document.querySelector('[data-pane-src-menu]')?.remove();
    const menu = document.createElement('div');
    menu.dataset.paneSrcMenu = '1';
    const ar = anchor.getBoundingClientRect();
    menu.style.cssText = `
      position:fixed;left:${ar.left}px;top:${ar.bottom + 2}px;
      z-index:200;background:hsl(240,14%,9%);border:1px solid ${BORDER};
      border-radius:6px;padding:4px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.4);
      min-width:140px;
    `;
    const config = panes.find(p => p.config.id === paneId)?.config;
    if (!config) return;

    const addItem = (label: string, value: string | null) => {
      const item = document.createElement('div');
      item.textContent = label;
      const active = config.sourceId === value;
      item.style.cssText = `
        padding:4px 8px;border-radius:4px;cursor:pointer;
        color:${active ? TEXT_HIGH : TEXT_MID};
        background:${active ? 'rgba(255,255,255,.07)' : 'transparent'};
      `;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.07)'; });
      item.addEventListener('mouseleave', () => { item.style.background = active ? 'rgba(255,255,255,.07)' : 'transparent'; });
      item.addEventListener('click', () => {
        config.sourceId = value;
        // Changing the source invalidates any frozen snapshot — unpin so it follows the new source.
        config.pinned = false;
        config.pinnedParentId = undefined;
        saveAll();
        menu.remove();
        // Update source button label
        const inst = panes.find(p => p.config.id === paneId);
        if (inst) { inst.updateSrcBtn(); inst.updatePinBtn(); }
        // Trigger load from new source
        if (value === null) {
          // Reset pane to root (clears any stale pane-parent so root children show)
          inst?.view.setPaneFilterKeys(new Set(config.filterKeys));
          void inst?.view.setSourceRoot();
        } else {
          const srcInst = panes.find(p => p.config.id === value);
          const selId = srcInst ? (srcInst.view.getSelectedId() ?? null) : null;
          const path = selId && srcInst ? srcInst.view.getNodePath(selId) : [];
          void inst?.view.setParent(selId, undefined, path);
        }
      });
      menu.appendChild(item);
    };

    addItem('ルート', null);
    for (const p of panes) {
      if (p.config.id !== paneId) addItem(p.config.label, p.config.id);
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
  const addPaneBtn = document.createElement('button');
  addPaneBtn.textContent = '+';
  addPaneBtn.title = '列を追加';
  addPaneBtn.style.cssText = `
    flex-shrink:0;align-self:flex-start;margin:8px 6px;
    background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};
    cursor:pointer;font-size:16px;padding:2px 10px;border-radius:4px;
    line-height:1.4;
  `;
  addPaneBtn.addEventListener('click', () => {
    // New pane inherits the language of the rightmost pane (or the global default).
    const inheritLang = panes.length > 0 ? panes[panes.length - 1].config.lang : ctx.state.lang;
    const config = newPaneConfig(`パネル ${panes.length + 1}`, inheritLang);
    // Default source = rightmost existing pane (1つ左のカラム)
    if (panes.length > 0) config.sourceId = panes[panes.length - 1].config.id;
    const inst = createPane(config);
    panes.push(inst);
    el.insertBefore(inst.containerEl, addPaneBtn);
    saveAll();
    updateAllSrcBtns();
    void inst.view.load();
  });

  const removePane = (paneId: string) => {
    const idx = panes.findIndex(p => p.config.id === paneId);
    if (idx === -1) return;
    const [removed] = panes.splice(idx, 1);
    removed.view.unregister();
    removed.containerEl.remove();
    if (fullscreenPaneId === paneId) {
      fullscreenPaneId = null;
      applyFullscreenLayout();
    }
    // Orphan dependent panes (reset source to null = root)
    for (const p of panes) {
      if (p.config.sourceId === paneId) {
        p.config.sourceId = null;
        updateAllSrcBtns();
      }
    }
    saveAll();
    updateAllSrcBtns();
  };

  const updateAllSrcBtns = () => {
    for (const p of panes) {
      p.updateSrcBtn();
    }
  };

  const saveAll = () => {
    savePanes(ctx.gId, panes.map(p => p.config));
  };

  // ── Init ─────────────────────────────────────────────────────────
  const init = () => {
    el.innerHTML = '';
    panes.length = 0;

    const saved = loadPanes(ctx.gId, ctx.state.lang);
    const configs: PaneConfig[] = saved?.length
      ? saved
      : [newPaneConfig('パネル 1', ctx.state.lang)];

    for (const cfg of configs) {
      const inst = createPane(cfg);
      panes.push(inst);
      el.appendChild(inst.containerEl);
    }
    el.appendChild(addPaneBtn);

    // After all panes are created, update source buttons
    updateAllSrcBtns();
  };

  init();

  const load = async () => {
    for (const p of panes) await p.view.load();
  };

  const refresh = () => {
    for (const p of panes) p.view.refresh();
  };

  const search = async (q: string) => {
    for (const p of panes) await p.view.search(q);
  };

  // Apply a language to every pane at once (the top-bar JA/EN acts as "set all").
  const setAllLang = (lang: 'en' | 'ja') => {
    for (const p of panes) {
      p.config.lang = lang;
      p.updateLangBtn();
      p.view.setLang(lang);
    }
    saveAll();
  };

  return { el, load, refresh, search, setAllLang };
}
