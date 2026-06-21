import type { GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM } from './constants';
import { createOutlinerView } from './outliner-view';

type PaneConfig = {
  id: string;
  label: string;
  sourceId: string | null;   // null = root; or another pane id
  filterKeys: string[];      // property keys that must be present (ALL)
  sortKey: string | null;    // property key to sort by (null = no sort)
  sortDir: 'asc' | 'desc';  // sort direction
  width: number;             // px
};

type PaneInstance = {
  config: PaneConfig;
  view: ReturnType<typeof createOutlinerView>;
  containerEl: HTMLElement;   // the outer div (header + body)
  updateSrcBtn: () => void;
  updateFltBtn: () => void;
  updateSortBtn: () => void;
};

const STORAGE_KEY = (gId: string) => `graph-editor-panes:${gId}`;
const DEFAULT_WIDTH = 300;

function savePanes(gId: string, configs: PaneConfig[]) {
  localStorage.setItem(STORAGE_KEY(gId), JSON.stringify(configs));
}

function loadPanes(gId: string): PaneConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(gId));
    if (!raw) return null;
    const arr = JSON.parse(raw) as Partial<PaneConfig>[];
    return arr.map(c => ({ ...c, sortKey: c.sortKey ?? null, sortDir: c.sortDir ?? 'asc' })) as PaneConfig[];
  } catch { return null; }
}

function newPaneConfig(label: string): PaneConfig {
  return {
    id: `pane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    sourceId: null,
    filterKeys: [],
    sortKey: null,
    sortDir: 'asc',
    width: DEFAULT_WIDTH,
  };
}

export function createMultiPaneView(ctx: GraphEditorContext): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (q: string) => Promise<void>;
} {
  const el = document.createElement('div');
  el.style.cssText = `display:flex;flex-direction:row;flex:1;overflow-x:auto;overflow-y:hidden;`;

  const panes: PaneInstance[] = [];

  // ── Inter-pane wiring ──────────────────────────────────────────────
  const onPaneSelect = (paneId: string, selectedNodeId: string | null) => {
    for (const p of panes) {
      if (p.config.sourceId === paneId) {
        void p.view.setParent(selectedNodeId);
      }
    }
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
      font-size:11px;color:${TEXT_MID};user-select:none;
    `;

    // Label (editable)
    const labelEl = document.createElement('span');
    labelEl.textContent = config.label;
    labelEl.contentEditable = 'true';
    labelEl.spellcheck = false;
    labelEl.style.cssText = `flex:1;outline:none;color:${TEXT_HIGH};font-size:12px;cursor:text;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    labelEl.addEventListener('blur', () => {
      config.label = labelEl.textContent?.trim() || config.label;
      saveAll();
    });
    labelEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); } });
    header.appendChild(labelEl);

    // Source button
    const srcBtn = document.createElement('button');
    srcBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0;`;
    const updateSrcBtn = () => {
      const src = panes.find(p => p.config.id === config.sourceId);
      srcBtn.textContent = src ? src.config.label : 'ルート';
    };
    srcBtn.addEventListener('click', (e) => { e.stopPropagation(); showSourceMenu(config.id, srcBtn); });
    header.appendChild(srcBtn);

    // Filter area — shows active filter keys as colored pills
    const fltArea = document.createElement('div');
    fltArea.style.cssText = `display:flex;align-items:center;gap:3px;flex-wrap:wrap;cursor:pointer;min-width:0;`;
    fltArea.title = 'フィルタを設定';
    const updateFltBtn = () => {
      fltArea.innerHTML = '';
      // "フィルタ" label is always shown
      const placeholder = document.createElement('span');
      placeholder.textContent = 'フィルタ';
      placeholder.style.cssText = `color:${config.filterKeys.length > 0 ? TEXT_MID : TEXT_DIM};font-size:10px;padding:1px 3px;border:1px solid ${BORDER};border-radius:3px;flex-shrink:0;`;
      fltArea.appendChild(placeholder);
      for (const key of config.filterKeys) {
        const col = ctx.allPropColors.get(key)?.code ?? TEXT_DIM;
        const tag = document.createElement('span');
        tag.style.cssText = `display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:3px;background:${col};color:#fff;font-size:10px;white-space:nowrap;`;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = key;
        const xSpan = document.createElement('span');
        xSpan.textContent = '×';
        xSpan.style.cssText = `cursor:pointer;font-size:11px;line-height:1;opacity:0.8;`;
        xSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          config.filterKeys = config.filterKeys.filter(k => k !== key);
          saveAll();
          const inst = panes.find(p => p.config.id === config.id);
          inst?.view.setPaneFilterKeys(new Set(config.filterKeys));
          updateFltBtn();
        });
        tag.append(labelSpan, xSpan);
        fltArea.appendChild(tag);
      }
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

    // Sort area — shows active sort key with direction
    const sortArea = document.createElement('div');
    sortArea.style.cssText = `display:flex;align-items:center;gap:3px;cursor:pointer;flex-shrink:0;`;
    sortArea.title = '並び替えを設定';
    const updateSortBtn = () => {
      sortArea.innerHTML = '';
      if (config.sortKey) {
        const col = ctx.allPropColors.get(config.sortKey)?.code ?? TEXT_DIM;
        const tag = document.createElement('span');
        tag.style.cssText = `display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:3px;background:${col};color:#fff;font-size:10px;white-space:nowrap;`;
        tag.textContent = `${config.sortKey} ${config.sortDir === 'asc' ? '↑' : '↓'}`;
        sortArea.appendChild(tag);
      } else {
        const placeholder = document.createElement('span');
        placeholder.textContent = '順';
        placeholder.style.cssText = `color:${TEXT_DIM};font-size:10px;padding:1px 3px;border:1px solid ${BORDER};border-radius:3px;flex-shrink:0;`;
        sortArea.appendChild(placeholder);
      }
    };
    updateSortBtn();
    sortArea.addEventListener('click', (e) => {
      e.stopPropagation();
      const inst = panes.find(p => p.config.id === config.id);
      if (!inst) return;
      let menuSortKey = config.sortKey;
      let menuSortDir = config.sortDir;
      inst.view.openKeyMenu({
        anchor: sortArea,
        mode: 'pane-sort',
        isActive: (key) => key === menuSortKey,
        onToggle: (key) => {
          if (key === menuSortKey) {
            menuSortDir = menuSortDir === 'asc' ? 'desc' : 'asc';
            if (menuSortDir === 'asc') {
              // Second toggle back to asc clears sort
              menuSortKey = null;
              menuSortDir = 'asc';
            }
          } else {
            menuSortKey = key;
            menuSortDir = 'asc';
          }
          config.sortKey = menuSortKey;
          config.sortDir = menuSortDir;
          saveAll();
          inst.view.setPaneSortConfig(menuSortKey, menuSortDir);
          inst.updateSortBtn();
        },
        getSuffix: (key) => key === menuSortKey ? (menuSortDir === 'asc' ? '↑' : '↓') : '',
      });
    });
    header.appendChild(sortArea);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    closeBtn.addEventListener('click', () => { removePane(config.id); });
    header.appendChild(closeBtn);

    containerEl.appendChild(header);

    // ── Outliner body ────────────────────────────────────────────────
    const sourcePane = panes.find(p => p.config.id === config.sourceId);
    const initParent = sourcePane ? (sourcePane.view.getSelectedId() ?? null) : null;
    const paneParentId = config.sourceId !== null ? initParent : undefined;

    const view = createOutlinerView(ctx, {
      paneParentId,
      paneFilterKeys: new Set(config.filterKeys),
      onNodeSelect: (nodeId) => onPaneSelect(config.id, nodeId),
      onContentWidthChange: (w) => {
        // Measure only non-flex-1 header children to avoid feedback loop
        // (header.scrollWidth includes labelEl which stretches to container width)
        const minHeaderW = srcBtn.offsetWidth + fltArea.scrollWidth + sortArea.scrollWidth + closeBtn.offsetWidth + 36;
        const actualW = Math.max(w, minHeaderW);
        containerEl.style.width = `${actualW}px`;
        config.width = actualW;
      },
    });
    view.el.style.flex = '1';
    // Hide the breadcrumb bar inside pane (compact)
    const bcEl = view.el.querySelector<HTMLElement>('div:first-child');
    if (bcEl) bcEl.style.display = 'none';
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
        config.width = Math.max(180, startW + ev.clientX - startX);
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

    const instance: PaneInstance = { config, view, containerEl, updateSrcBtn, updateFltBtn, updateSortBtn };

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
        saveAll();
        menu.remove();
        // Update source button label
        const inst = panes.find(p => p.config.id === paneId);
        if (inst) inst.updateSrcBtn();
        // Trigger load from new source
        if (value === null) {
          // Reset pane to root (no external parent)
          inst?.view.setPaneFilterKeys(new Set(config.filterKeys));
          void inst?.view.load();
        } else {
          const srcInst = panes.find(p => p.config.id === value);
          const selId = srcInst ? (srcInst.view.getSelectedId() ?? null) : null;
          void inst?.view.setParent(selId);
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
    const config = newPaneConfig(`パネル ${panes.length + 1}`);
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

    const saved = loadPanes(ctx.gId);
    const configs: PaneConfig[] = saved?.length
      ? saved
      : [newPaneConfig('パネル 1')];

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

  return { el, load, refresh, search };
}
