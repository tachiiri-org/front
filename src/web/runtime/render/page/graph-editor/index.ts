import type { GraphEditorComponent } from '../../../../schema/component/kind/graph-editor';
import type { ExplorerNode, ExplorerState, GraphEditorContext } from './types';
import {
  BG, BORDER, TEXT_HIGH, TEXT_MID, SELECT_STRONG,
} from './constants';
import { createPanelsView } from './panels-view';
import { apiAddRay, apiRemoveRay } from './api';

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
  const ctx = {
    gId, limit, rootNodeId, outer, state,
    colorPalette,
    tempNodeCounter: 0,
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

  // ── Multi-pane view ───────────────────────────────────────────────
  const panels = createPanelsView(ctx);
  panels.el.style.display = 'flex';
  outer.appendChild(panels.el);

  void panels.load();

  return outer;
}
