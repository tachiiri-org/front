import type { GraphEditorContext, PanelView, CtxBlock, PanelPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { fetchLineContext, apiCreateCtxBlock, apiSetBlockText, apiReorderCtxBlocks, apiDeleteBlock } from './api';

// コンテキストパネル。キーは (node, relation) の複合。リレーションパネルで選択中のリレーション × 現在ノード
// に添える【非規範のフリーテキスト】注釈だけを、アウトライナー的に縦に並べる（見出し/階層はここには無い）。
// リレーション未選択のときは空（プロンプト表示）。ctx.setContextTarget(nodeId, lineId) で対象が切り替わる。
// 操作: Enter=テキスト追加 / Shift+Alt+↑↓=並び替え / Ctrl+Shift+Backspace=削除 / ↑↓=行移動。

export function createContextPanelView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; onClose?: () => void; leadingHeadEl?: HTMLElement },
): PanelView {
  let lang = opts.lang;
  let currentNodeId: string | null = null;
  let currentLineId: string | null = null;
  let currentBlocks: CtxBlock[] = [];
  let renderToken = 0;
  let pendingFocus: { type: 'block'; key: string } | { type: 'draft' } | null = null;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:column;font-size:11px;color:${TEXT_MID};`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:6px 8px;`;
  el.appendChild(bodyEl);

  const rowByBlock = new Map<string, HTMLElement>();
  let draftTa: HTMLTextAreaElement | null = null;

  // ── 左ガター（四角） ── 他パネルと同じ 6px spacer + 18px 四角ラッパ。フォーカス中は四角が青くなる。
  const makeGutter = (): { bw: HTMLElement; square: HTMLElement; spacer: HTMLElement } => {
    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span');
    bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;height:21px;cursor:pointer;`;
    const square = document.createElement('span');
    square.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(square);
    return { bw, square, spacer };
  };
  const setSquareActive = (square: HTMLElement, on: boolean) => {
    if (on) { square.style.background = SELECT_STRONG; square.style.border = 'none'; }
    else { square.style.background = 'transparent'; square.style.border = `1.5px solid ${TEXT_DIM}`; }
  };

  const focusAdjacentRow = (fromEl: HTMLElement, dir: 'up' | 'down'): boolean => {
    const rows = Array.from(bodyEl.children) as HTMLElement[];
    const idx = rows.findIndex((r) => r.contains(fromEl));
    if (idx === -1) return false;
    const target = rows[idx + (dir === 'down' ? 1 : -1)];
    const ta = target?.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta) { ta.focus(); const p = ta.value.length; ta.setSelectionRange(p, p); return true; }
    return false;
  };

  // ── 大元データを参照した並び替え・削除・追加（すべて (node,line) スコープ） ────────────
  const moveBlock = async (block: CtxBlock, dir: 'up' | 'down') => {
    if (!currentNodeId || !currentLineId) return;
    const idx = currentBlocks.indexOf(block);
    if (idx < 0) return;
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= currentBlocks.length) return;
    const order = currentBlocks.map((b) => b.blockId);
    [order[idx], order[j]] = [order[j], order[idx]];
    pendingFocus = { type: 'block', key: block.blockId };
    const token = ++renderToken;
    const blocks = await apiReorderCtxBlocks(ctx.gId, currentNodeId, currentLineId, order);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  const deleteBlock = async (block: CtxBlock) => {
    const idx = currentBlocks.indexOf(block);
    await apiDeleteBlock(ctx.gId, block.blockId);
    currentBlocks = currentBlocks.filter((b) => b !== block);
    const n = currentBlocks[Math.min(idx, currentBlocks.length - 1)];
    pendingFocus = n ? { type: 'block', key: n.blockId } : { type: 'draft' };
    renderBody();
  };

  const addTextAfter = async (anchor: CtxBlock | null, initial = '') => {
    if (!currentNodeId || !currentLineId) return;
    const res = await apiCreateCtxBlock(ctx.gId, currentNodeId, currentLineId, lang, initial);
    if (!res) return;
    let blocks = res.blocks;
    const newId = res.blockId;
    if (anchor) {
      const order = blocks.map((b) => b.blockId).filter((id) => id !== newId);
      const ai = order.indexOf(anchor.blockId);
      if (ai >= 0) { order.splice(ai + 1, 0, newId); blocks = await apiReorderCtxBlocks(ctx.gId, currentNodeId, currentLineId, order); }
    }
    currentBlocks = blocks;
    pendingFocus = { type: 'block', key: newId };
    renderBody();
  };

  const addTextAtStart = async (initial = '') => {
    if (!currentNodeId || !currentLineId) return;
    const res = await apiCreateCtxBlock(ctx.gId, currentNodeId, currentLineId, lang, initial);
    if (!res) return;
    const newId = res.blockId;
    const order = res.blocks.map((b) => b.blockId).filter((id) => id !== newId);
    order.unshift(newId);
    currentBlocks = await apiReorderCtxBlocks(ctx.gId, currentNodeId, currentLineId, order);
    pendingFocus = { type: 'block', key: newId };
    renderBody();
  };

  // ── テキストブロック行 ──────────────────────────────────────────────────────
  const renderTextRow = (block: CtxBlock): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.blockId = block.blockId;
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const { bw, square, spacer } = makeGutter();

    const ta = document.createElement('textarea');
    ta.value = block.body[lang] ?? block.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    ta.rows = 1;
    ta.style.cssText = `flex:1;min-width:0;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0;color:${TEXT_HIGH};overflow:hidden;`;
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = (immediate = false) => {
      if (saveTimer) clearTimeout(saveTimer);
      const doSave = () => { void apiSetBlockText(ctx.gId, block.blockId, lang, ta.value); block.body[lang] = ta.value; };
      if (immediate) doSave(); else saveTimer = setTimeout(doSave, 400);
    };
    ta.addEventListener('focus', () => setSquareActive(square, true));
    ta.addEventListener('blur', () => { setSquareActive(square, false); save(true); });
    ta.addEventListener('input', () => { autosize(); save(); });
    ta.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) { e.preventDefault(); void moveBlock(block, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Backspace' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void deleteBlock(block); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(true); void addTextAfter(block); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusAdjacentRow(ta, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Tab') { e.preventDefault(); return; }
      if (e.key === 'Backspace' && ta.value === '') { e.preventDefault(); void deleteBlock(block); return; }
    });
    setTimeout(autosize, 0);

    row.append(spacer, bw, ta);
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    return row;
  };

  // ── ドラフト行（追加の入口。top=先頭に追加 / bottom=末尾に追加。Enter で確定） ──────────
  const makeDraftRow = (atTop: boolean): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const { bw, spacer } = makeGutter();
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.style.cssText = `flex:1;min-width:0;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0;color:${TEXT_DIM};overflow:hidden;`;
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
    ta.addEventListener('focus', () => { ta.style.color = TEXT_HIGH; });
    ta.addEventListener('blur', () => { if (!ta.value.trim()) ta.style.color = TEXT_DIM; });
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = ta.value;
        if (!val.trim()) return;
        ta.value = ''; autosize();
        if (atTop) void addTextAtStart(val); else void addTextAfter(null, val);
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusAdjacentRow(ta, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Tab') { e.preventDefault(); return; }
    });
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    row.append(spacer, bw, ta);
    if (!atTop) draftTa = ta;
    return row;
  };

  const applyPendingFocus = () => {
    const pf = pendingFocus; pendingFocus = null;
    if (!pf) return;
    if (pf.type === 'draft') { draftTa?.focus(); return; }
    if (pf.type === 'block') { (rowByBlock.get(pf.key)?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(); return; }
  };

  const renderBody = (): void => {
    bodyEl.innerHTML = '';
    rowByBlock.clear();
    draftTa = null;
    if (!currentNodeId || !currentLineId) {
      const hint = document.createElement('div');
      hint.textContent = 'リレーションを選ぶと、そのコンテキスト（注釈）が出ます。';
      hint.style.cssText = `color:${TEXT_DIM};font-size:12px;padding:8px;`;
      bodyEl.appendChild(hint);
      return;
    }
    bodyEl.appendChild(makeDraftRow(true)); // 一番上の空行
    for (const block of currentBlocks) {
      const row = renderTextRow(block);
      rowByBlock.set(block.blockId, row);
      bodyEl.appendChild(row);
    }
    bodyEl.appendChild(makeDraftRow(false)); // 末尾の空行
    applyPendingFocus();
  };

  // 本体だけ再取得して描画（head は作り直さない）。
  const reload = async (): Promise<void> => {
    if (!currentNodeId || !currentLineId) { currentBlocks = []; renderBody(); return; }
    const token = ++renderToken;
    const blocks = await fetchLineContext(ctx.gId, currentNodeId, currentLineId);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  const render = async (): Promise<void> => {
    head.innerHTML = '';
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = `display:flex;align-items:center;gap:4px;height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};`;
    if (opts.leadingHeadEl) ctrlRow.appendChild(opts.leadingHeadEl);
    const title = document.createElement('span');
    title.textContent = 'コンテキスト';
    title.style.cssText = `flex:1;min-width:0;color:${TEXT_HIGH};font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    ctrlRow.appendChild(title);
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = 'コンテキストを再読み込み';
    reloadBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    reloadBtn.addEventListener('click', () => { reloadBtn.style.color = TEXT_HIGH; void reload().finally(() => { reloadBtn.style.color = TEXT_DIM; }); });
    ctrlRow.appendChild(reloadBtn);
    const langBtn = document.createElement('button');
    langBtn.textContent = lang.toUpperCase();
    langBtn.title = lang === 'ja' ? 'このコンテキストパネルの言語: 日本語（クリックでEN）' : 'このコンテキストパネルの言語: 英語（クリックでJA）';
    langBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;flex-shrink:0;line-height:1.4;`;
    langBtn.addEventListener('click', () => { lang = lang === 'ja' ? 'en' : 'ja'; void render(); });
    ctrlRow.appendChild(langBtn);
    if (opts.onClose) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;`;
      closeBtn.addEventListener('click', () => opts.onClose!());
      ctrlRow.appendChild(closeBtn);
    }
    head.appendChild(ctrlRow);
    // 2行目: 中身が空の行（他パネルのヘッダ段数・高さと揃えるための空行）。
    const emptyRow = document.createElement('div');
    emptyRow.style.cssText = `height:28px;box-sizing:border-box;border-bottom:1px solid ${BORDER};`;
    head.appendChild(emptyRow);
    await reload();
  };

  // リレーションパネルからの通知: 表示対象の (node, line) を切り替える。未選択(null)なら空。
  const setContextTarget = (nodeId: string | null, lineId: string | null) => {
    if (nodeId === currentNodeId && lineId === currentLineId) return;
    currentNodeId = nodeId; currentLineId = lineId;
    void reload();
  };
  ctx.setContextTarget = setContextTarget;

  void render();

  const noPath: PanelPathEntry[] = [];
  return {
    el,
    head,
    load: () => render(),
    refresh: () => { void reload(); },
    search: async () => { /* コンテキスト列は top-bar 検索の対象外 */ },
    setParent: async () => { /* コンテキストはノード選択ではなく選択中リレーションで駆動する */ },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getSourceNodeId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { /* no-op */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* コンテキスト列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { if (ctx.setContextTarget === setContextTarget) ctx.setContextTarget = undefined; },
  };
}
