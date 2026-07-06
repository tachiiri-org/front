import type { GraphEditorComponent } from '../../../../schema/component/kind/graph-editor';
import type { ExplorerNode, ExplorerState, GraphEditorContext } from './types';
import {
  BG, BORDER, TEXT_HIGH, TEXT_MID, SELECT_STRONG,
} from './constants';
import { createPanelsView } from './panels-view';
import { apiAddRay, apiRemoveRay, onSessionExpired } from './api';

export function renderGraphEditor(
  id: string,
  comp: GraphEditorComponent,
  graphId?: string,
): HTMLElement {
  const gId = graphId ?? comp.graphId;
  const limit = typeof comp.limit === 'number' && comp.limit > 0 ? comp.limit : 100;

  const state: ExplorerState = {
    graphId: gId,
    lang: comp.lang ?? 'ja',
    limit,
    bookmarks: new Set(),
    showFallback: false,
    searchQuery: '',
  };

  // No-cache / always-online: the editor holds no persistent cache; every read hits the DO.
  const outer = document.createElement('div');
  outer.id = id;
  outer.style.cssText = `position:relative;display:flex;flex-direction:column;height:100%;background:${BG};color:${TEXT_HIGH};font-family:sans-serif;font-size:13px;line-height:1.5;overflow:hidden;`;

  // Scrollbar styles
  const style = document.createElement('style');
  style.textContent = `
    #${id} ::-webkit-scrollbar { width: 6px; height: 6px; }
    #${id} ::-webkit-scrollbar-track { background: transparent; }
    #${id} ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
    #${id} * { scrollbar-width: thin; scrollbar-color: #555 transparent; }
  `;
  outer.appendChild(style);

  // 上部バー（全体ヘッダ）は廃止。言語切替はパネルごと、検索バーも撤去した。

  // ── Context assembly ──────────────────────────────────────────────
  const rootNodeId = comp.rootNodeId ?? null;
  const colorPalette = new Map<string, string>();
  const relationRerender = new Set<() => void>();
  const refreshRelations = new Set<() => void>();
  // temp-id → real-id registry (see GraphEditorContext). `tempPending` holds the promise a waiter
  // gets while a create is still in flight; resolved (and cleared) the moment the real id lands.
  const tempRealId = new Map<string, string>();
  const tempPending = new Map<string, { promise: Promise<string>; resolve: (real: string) => void }>();
  const ctx = {
    gId, limit, rootNodeId, outer, state,
    colorPalette,
    tempNodeCounter: 0,
    tempRealId,
    registerTempId: (tempId: string) => {
      if (tempRealId.has(tempId) || tempPending.has(tempId)) return;
      let resolve!: (real: string) => void;
      const promise = new Promise<string>((res) => { resolve = res; });
      tempPending.set(tempId, { promise, resolve });
    },
    resolveTempId: (tempId: string, realId: string) => {
      tempRealId.set(tempId, realId);
      const p = tempPending.get(tempId);
      if (p) { p.resolve(realId); tempPending.delete(tempId); }
    },
    awaitRealId: (id: string): Promise<string> => {
      if (!id.startsWith('temp-')) return Promise.resolve(id);
      const real = tempRealId.get(id);
      if (real) return Promise.resolve(real);
      const p = tempPending.get(id);
      if (p) return p.promise;
      return Promise.resolve(id); // unknown temp — pass through rather than hang
    },
    nodePanelDrag: null,
    activeRelation: null,
    relationRerender,
    refreshRelations,
    setActiveRelation: (r: { lineId: string; participants: Set<string> } | null) => {
      ctx.activeRelation = r;
      relationRerender.forEach((f) => f());
    },
    toggleParticipant: async (nodeId: string) => {
      const ar = ctx.activeRelation;
      if (!ar) return;
      if (ar.participants.has(nodeId)) {
        await apiRemoveRay(gId, ar.lineId, nodeId);
        ar.participants.delete(nodeId);
      } else {
        await apiAddRay(gId, ar.lineId, nodeId);
        ar.participants.add(nodeId);
      }
      relationRerender.forEach((f) => f());
      refreshRelations.forEach((f) => f()); // re-fetch relation rows so participants stay fresh
    },
  } as unknown as GraphEditorContext;

  // ── Session-expiry notice ─────────────────────────────────────────
  // When the login expires mid-session, further edits can't be saved. Surface a clear, persistent
  // banner (not a silent redirect that would drop unsaved work) inviting the user back to /login.
  onSessionExpired(() => {
    if (outer.querySelector('[data-graph-session-notice]')) return;
    const banner = document.createElement('div');
    banner.dataset.graphSessionNotice = '1';
    banner.style.cssText = `flex-shrink:0;display:flex;align-items:center;gap:10px;padding:8px 14px;background:#5a1e1e;color:#ffdede;font-size:13px;border-bottom:1px solid #7a2a2a;`;
    const msg = document.createElement('span');
    msg.style.cssText = 'flex:1;';
    msg.textContent = 'ログインの有効期限が切れました。この後の編集は保存されていません。再ログインしてください。';
    const btn = document.createElement('a');
    btn.href = '/login';
    btn.textContent = 'ログイン画面へ';
    btn.style.cssText = `flex-shrink:0;padding:4px 12px;background:#ffdede;color:#5a1e1e;border-radius:4px;text-decoration:none;font-weight:600;`;
    banner.append(msg, btn);
    // Insert just below the <style> element so the banner sits at the very top of the editor.
    outer.insertBefore(banner, panels.el);
  });

  // ── Multi-pane view ───────────────────────────────────────────────
  const panels = createPanelsView(ctx);
  panels.el.style.display = 'flex';
  outer.appendChild(panels.el);

  void panels.load();

  return outer;
}
