import type { GraphEditorContext, PaneView, ExplorerNode, ExplorerLine, PaneViewPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import {
  fetchNodeLines, apiCreateRelation, apiSetLineBody, apiAddRay, apiRemoveRay,
  fetchAllNodes, apiCreateNode,
} from './api';

// 関係 (line) 列。左の node 列で選ばれたノードを「主語」として、そのノードが参加している関係 line を
// 一覧・作成・編集する。各 line はテキスト本文(body)＋順序付き参加者(participants, 先頭=主語)を持つ。
// 参加者の追加は列内のノード検索（ヒットすれば紐付け、無ければ新規ノード化）で行う。
// PaneView を満たすので multi-pane に node 列と同じように並ぶ。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

export function createLineView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; initialNodeId?: string | null },
): PaneView {
  let lang = opts.lang;
  let currentNodeId: string | null = opts.initialNodeId ?? null;
  let renderToken = 0;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MID};display:flex;align-items:center;gap:6px;`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:6px 8px;`;
  el.appendChild(bodyEl);

  // ── 参加者の追加（列内ノード検索：ヒット→紐付け / 無し→新規ノード化）─────────────
  const mountAddParticipant = (lineId: string, onAdded: () => void): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;margin-top:4px;`;
    const input = document.createElement('input');
    input.placeholder = '＋参加者を検索／新規作成…';
    input.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:1px solid ${BORDER};color:${TEXT_HIGH};font-size:12px;padding:3px 6px;border-radius:4px;outline:none;`;
    wrap.appendChild(input);

    const menu = document.createElement('div');
    menu.style.cssText = `position:absolute;left:0;right:0;top:100%;z-index:50;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:0 0 6px 6px;max-height:180px;overflow-y:auto;display:none;`;
    wrap.appendChild(menu);

    let results: ExplorerNode[] = [];
    let seq = 0;

    const closeMenu = () => { menu.style.display = 'none'; menu.innerHTML = ''; };

    const addNode = async (nodeId: string) => {
      await apiAddRay(ctx.gId, lineId, nodeId);
      input.value = '';
      closeMenu();
      onAdded();
    };

    const renderResults = (q: string) => {
      menu.innerHTML = '';
      const exact = results.find((n) => labelOf(n, lang) === q);
      const rows: Array<{ label: string; act: () => void }> = results.map((n) => ({
        label: labelOf(n, lang),
        act: () => void addNode(n.id),
      }));
      // 完全一致が無ければ「新規作成」行を先頭に
      if (q && !exact) {
        rows.unshift({
          label: `＋「${q}」を新規ノードで作成`,
          act: async () => {
            const created = await apiCreateNode(ctx.gId, null, lang, q);
            if (created) await addNode(created.id);
          },
        });
      }
      if (rows.length === 0) { closeMenu(); return; }
      for (const r of rows) {
        const item = document.createElement('div');
        item.textContent = r.label;
        item.style.cssText = `padding:4px 8px;cursor:pointer;color:${TEXT_MID};font-size:12px;`;
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.07)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
        item.addEventListener('mousedown', (e) => { e.preventDefault(); r.act(); });
        menu.appendChild(item);
      }
      menu.style.display = 'block';
    };

    input.addEventListener('input', async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { closeMenu(); return; }
      const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, q);
      if (my !== seq) return;
      results = nodes;
      renderResults(q);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        const exact = results.find((n) => labelOf(n, lang) === q);
        if (exact) void addNode(exact.id);
        else void (async () => { const c = await apiCreateNode(ctx.gId, null, lang, q); if (c) await addNode(c.id); })();
      } else if (e.key === 'Escape') {
        input.value = ''; closeMenu();
      }
    });
    input.addEventListener('blur', () => { setTimeout(closeMenu, 150); });

    return wrap;
  };

  // ── 関係 line 1件のカード ─────────────────────────────────────────────────────
  const renderLine = (line: ExplorerLine): HTMLElement => {
    const card = document.createElement('div');
    card.style.cssText = `border:1px solid ${BORDER};border-radius:6px;padding:6px 8px;margin-bottom:8px;`;

    // 本文(body)
    const ta = document.createElement('textarea');
    ta.value = line.body[lang] ?? line.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    ta.placeholder = '関係をテキストで（例: 車は道路を走る）';
    ta.rows = 2;
    ta.style.cssText = `width:100%;box-sizing:border-box;resize:vertical;background:transparent;border:none;border-bottom:1px solid ${BORDER};color:${TEXT_HIGH};font-size:13px;line-height:1.5;padding:2px 0 4px;outline:none;`;
    ta.addEventListener('blur', () => { void apiSetLineBody(ctx.gId, line.lineId, lang, ta.value); });
    card.appendChild(ta);

    // 参加者(順序付き、先頭=主語)
    const chips = document.createElement('div');
    chips.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;`;
    line.participants.forEach((p, i) => {
      const chip = document.createElement('span');
      chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;border:1px solid ${i === 0 ? SELECT_STRONG : BORDER};color:${TEXT_HIGH};font-size:12px;padding:1px 4px 1px 7px;border-radius:10px;`;
      const txt = document.createElement('span');
      txt.textContent = (i === 0 ? '◉ ' : '') + labelOf(p, lang);
      if (p.color) txt.style.color = p.color;
      chip.appendChild(txt);
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = '参加者から外す';
      x.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;line-height:1;padding:0 2px;`;
      x.addEventListener('click', async () => { await apiRemoveRay(ctx.gId, line.lineId, p.id); void render(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    // 参加者追加
    card.appendChild(mountAddParticipant(line.lineId, () => void render()));

    return card;
  };

  // ── 列全体の描画 ─────────────────────────────────────────────────────────────
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    head.innerHTML = '';
    bodyEl.innerHTML = '';

    if (!currentNodeId) {
      const hint = document.createElement('div');
      hint.textContent = '左の列でノードを選ぶと、その関係が出ます';
      hint.style.cssText = `color:${TEXT_DIM};font-size:12px;padding:8px 2px;`;
      bodyEl.appendChild(hint);
      return;
    }
    const nodeId = currentNodeId;

    const title = document.createElement('span');
    title.textContent = '関係';
    title.style.cssText = `color:${TEXT_HIGH};font-size:12px;`;
    head.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.textContent = '＋ 新しい関係';
    addBtn.title = 'このノードを主語にした関係を作る';
    addBtn.style.cssText = `margin-left:auto;background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px;`;
    addBtn.addEventListener('click', async () => {
      await apiCreateRelation(ctx.gId, nodeId, lang, '');
      await render();
    });
    head.appendChild(addBtn);

    const lines = await fetchNodeLines(ctx.gId, nodeId);
    if (token !== renderToken) return;

    if (lines.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'まだ関係はありません。「＋ 新しい関係」で作成';
      empty.style.cssText = `color:${TEXT_DIM};font-size:12px;padding:8px 2px;`;
      bodyEl.appendChild(empty);
      return;
    }
    for (const line of lines) bodyEl.appendChild(renderLine(line));
  };

  // 初期描画
  void render();

  // ── PaneView 実装 ───────────────────────────────────────────────────────────
  // node 列専用のメソッド（key-move / ancestors / path）は line 列では無害な no-op。
  const noPath: PaneViewPathEntry[] = [];
  return {
    el,
    load: () => render(),
    refresh: () => { void render(); },
    search: async () => { /* top-bar 検索は関係列には作用しない */ },
    setParent: async (nodeId) => { currentNodeId = nodeId; await render(); },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getPaneParentId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { currentNodeId = null; await render(); },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* 関係列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { /* グローバル購読なし */ },
  };
}
