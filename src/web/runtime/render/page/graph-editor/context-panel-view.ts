import type { GraphEditorContext, PanelView, ExplorerNode, ExplorerRelation, ContextBlock, PanelPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import {
  fetchNodeContext, apiCreateBlock, apiSetBlockText, apiSetBlockHeading, apiReorderBlocks, apiDeleteBlock,
} from './api';

// コンテキスト(ノードのページ)パネル。ノードと1:1で、順序付きブロック列をアウトライナー的に描画する。
// リレーション/ノードパネルと基盤 UI を揃える: 左に四角のガター、行フォーカスで操作、キーボード駆動。
// - 見出しブロック = リレーション参照(規範=定義)。太字。h2/h3 はサイズではなくインデントで表す。direct=
//   このノードが参加するか(間接は ↳)。本文はリレーション(line)の共有オブジェクトなので、ここでは読み取り
//   表示＋チップで辿るに留め、定義編集はリレーションパネルで行う(単一ソース)。
// - テキストブロック = 非規範フリーテキスト(言語別・ノードリンク無し)。通常字。インライン編集・自動保存。
// 操作: Enter=テキスト追加 / Shift+Alt+↑↓=並び替え / Ctrl+Shift+Backspace=削除（大元データを参照で更新）。
// リレーションパネルで見出し(関係)を選ぶと ctx.focusContextHeading 経由で該当見出しへスクロールする。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

function splitTokens(body: string): Array<{ t: 'txt'; v: string } | { t: 'men'; id: string }> {
  const out: Array<{ t: 'txt'; v: string } | { t: 'men'; id: string }> = [];
  const re = /⟦([^⟧]+)⟧/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ t: 'txt', v: body.slice(last, m.index) });
    out.push({ t: 'men', id: m[1] });
    last = m.index + m[0].length;
  }
  out.push({ t: 'txt', v: body.slice(last) });
  return out;
}

export function createContextPanelView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; initialNodeId?: string | null; onClose?: () => void; leadingHeadEl?: HTMLElement },
): PanelView {
  let lang = opts.lang;
  let currentNodeId: string | null = opts.initialNodeId ?? null;
  let currentPath: PanelPathEntry[] | null = null;
  let currentBlocks: ContextBlock[] = [];
  let renderToken = 0;
  // 再描画後にフォーカスを戻す先。行を作り直すため、blockId/lineId/ドラフト で指定する。
  let pendingFocus: { type: 'block'; key: string } | { type: 'line'; key: string } | { type: 'draft' } | null = null;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:column;font-size:11px;color:${TEXT_MID};`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:6px 8px;`;
  el.appendChild(bodyEl);

  const rowByBlock = new Map<string, HTMLElement>();
  const rowByLine = new Map<string, HTMLElement>();
  // 折りたたみ中の見出し(lineId)。空 = 全展開（既定）。h2 をたたむと配下のテキスト・h3（とそのテキスト）が、
  // h3 をたたむとその直後のテキストが隠れる。
  const collapsedLines = new Set<string>();
  let draftTa: HTMLTextAreaElement | null = null;

  // ── 大元データを参照した並び替え・削除・追加 ──────────────────────────────────
  // 並び替え: currentBlocks の順を入れ替え → 全順序を apiReorderBlocks で保存（仮想見出し "h:<lineId>" は
  // サーバが実体化）。返りで currentBlocks を更新して再描画。
  const moveBlock = async (block: ContextBlock, dir: 'up' | 'down') => {
    if (!currentNodeId) return;
    const idx = currentBlocks.indexOf(block);
    if (idx < 0) return;
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= currentBlocks.length) return;
    const order = currentBlocks.map((b) => b.blockId);
    [order[idx], order[j]] = [order[j], order[idx]];
    pendingFocus = block.kind === 'heading' ? { type: 'line', key: block.line.lineId } : { type: 'block', key: block.blockId };
    const token = ++renderToken;
    const blocks = await apiReorderBlocks(ctx.gId, currentNodeId, order);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  // 削除: テキストブロックのみ削除できる（見出し＝リレーション由来は削除しない）。楽観的に外し隣へフォーカス。
  const deleteBlock = async (block: ContextBlock) => {
    if (block.kind !== 'text') return;
    const idx = currentBlocks.indexOf(block);
    await apiDeleteBlock(ctx.gId, block.blockId);
    currentBlocks = currentBlocks.filter((b) => b !== block);
    const n = currentBlocks[Math.min(idx, currentBlocks.length - 1)];
    pendingFocus = n
      ? (n.kind === 'heading' ? { type: 'line', key: n.line.lineId } : { type: 'block', key: n.blockId })
      : { type: 'draft' };
    renderBody();
  };

  // テキスト追加: 末尾に作成 → anchor の直後へ並べ替え（anchor 見出しは lineId で対応づけ）。
  const addTextAfter = async (anchor: ContextBlock | null, initial = '') => {
    if (!currentNodeId) return;
    const res = await apiCreateBlock(ctx.gId, currentNodeId, { kind: 'text', lang, body: initial });
    if (!res) return;
    let blocks = res.blocks;
    const newId = res.blockId;
    if (anchor) {
      const anchorId = anchor.kind === 'heading'
        ? blocks.find((b) => b.kind === 'heading' && b.line.lineId === anchor.line.lineId)?.blockId
        : anchor.blockId;
      if (anchorId && anchorId !== newId) {
        const order = blocks.map((b) => b.blockId).filter((id) => id !== newId);
        const ai = order.indexOf(anchorId);
        if (ai >= 0) { order.splice(ai + 1, 0, newId); blocks = await apiReorderBlocks(ctx.gId, currentNodeId, order); }
      }
    }
    currentBlocks = blocks;
    pendingFocus = { type: 'block', key: newId };
    renderBody();
  };

  // 見出しの h2/h3 を切替（Tab=h3 / Shift+Tab=h2）。仮想見出しは並べ替えで実体化してから level を当てる。
  const setHeadingLevel = async (block: Extract<ContextBlock, { kind: 'heading' }>, level: 2 | 3) => {
    if (!currentNodeId) return;
    let blockId = block.blockId;
    if (blockId.startsWith('h:')) {
      const blocks = await apiReorderBlocks(ctx.gId, currentNodeId, currentBlocks.map((b) => b.blockId));
      currentBlocks = blocks;
      const real = blocks.find((b) => b.kind === 'heading' && b.line.lineId === block.line.lineId);
      if (!real) return;
      blockId = real.blockId;
    }
    await apiSetBlockHeading(ctx.gId, blockId, { level });
    pendingFocus = { type: 'line', key: block.line.lineId };
    await reload();
  };

  // 上下カーソルで行（ノード）間をフォーカス移動。bodyEl 直下の行（ブロック行＋ドラフト行）単位で上下する。
  const focusAdjacentRow = (fromEl: HTMLElement, dir: 'up' | 'down'): boolean => {
    const rows = Array.from(bodyEl.children) as HTMLElement[];
    const idx = rows.findIndex((r) => r.contains(fromEl));
    if (idx === -1) return false;
    const target = rows[idx + (dir === 'down' ? 1 : -1)];
    if (!target) return false;
    const ta = target.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta) { ta.focus(); const p = ta.value.length; ta.setSelectionRange(p, p); return true; }
    if (target.tabIndex >= 0) { target.focus(); return true; } // 読み取り専用の見出し行（div）
    return false;
  };

  // 見出しの折りたたみ/展開（Ctrl+↑=たたむ / Ctrl+↓=ひらく・クリックでも）。既定は全展開。
  const toggleCollapse = (lineId: string, collapse?: boolean) => {
    const c = collapse ?? !collapsedLines.has(lineId);
    if (c) collapsedLines.add(lineId); else collapsedLines.delete(lineId);
    pendingFocus = { type: 'line', key: lineId };
    renderBody();
  };

  // 共通キー: Shift+Alt+↑↓ = 並び替え / Ctrl(Cmd)+Shift+Backspace = 削除。処理したら true。
  const handleCommonKey = (e: KeyboardEvent, block: ContextBlock): boolean => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
      e.preventDefault(); void moveBlock(block, e.key === 'ArrowDown' ? 'down' : 'up'); return true;
    }
    if (e.key === 'Backspace' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); void deleteBlock(block); return true;
    }
    return false;
  };

  // ── 左ガター（四角） ── リレーション/ノードパネルと同じ 6px spacer + 18px 四角ラッパ。
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
  // フォーカス中の行の四角を塗る（アクティブ表示・リレーションパネルの流儀）。
  const setSquareActive = (square: HTMLElement, on: boolean) => {
    if (on) { square.style.background = SELECT_STRONG; square.style.border = 'none'; }
    else { square.style.background = 'transparent'; square.style.border = `1.5px solid ${TEXT_DIM}`; }
  };

  // ── 見出しブロック（=リレーション参照）── リレーションテキスト由来なので【読み取り専用】。太字(bold)。
  // 編集はしない（定義の編集はリレーションパネル側）。行フォーカスでキーボード操作: 階層移動(Tab/Shift+Tab)・
  // 並び替え(Shift+Alt+↑↓)・折りたたみ(Ctrl+↑↓)・行移動(↑↓)・テキスト追加(Enter)。削除はしない。
  // ノードリンクは読み取りテキスト内のクリック可能な語（クリックで下方展開）として描く（textarea 構成にしない）。
  const renderHeadingRow = (block: Extract<ContextBlock, { kind: 'heading' }>, opts: { depth: number; hasChildren: boolean; collapsed: boolean }): HTMLElement => {
    const relation: ExplorerRelation = block.line;
    const labelById = new Map(relation.participants.map((p) => [p.id, labelOf(p, lang)] as const));

    const row = document.createElement('div');
    row.dataset.blockId = block.blockId;
    row.dataset.lineId = relation.lineId;
    row.tabIndex = 0;
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;outline:none;margin-left:${opts.depth * 18}px;`;
    // 折りたたみキャレット（配下がある見出しのみ）。全行に 12px スロットを置いて左端を揃える。
    const caret = document.createElement('span');
    caret.style.cssText = `flex-shrink:0;width:12px;display:flex;align-items:center;justify-content:center;height:21px;color:${TEXT_DIM};font-size:9px;`;
    if (opts.hasChildren) {
      caret.textContent = opts.collapsed ? '▸' : '▾';
      caret.style.cursor = 'pointer';
      caret.title = opts.collapsed ? '展開 (Ctrl+↓)' : 'たたむ (Ctrl+↑)';
      caret.addEventListener('mousedown', (e) => e.preventDefault());
      caret.addEventListener('click', () => toggleCollapse(relation.lineId));
    }
    const { bw, square, spacer } = makeGutter();

    const content = document.createElement('div');
    content.style.cssText = `flex:1;min-width:0;line-height:1.5;font-size:14px;font-weight:bold;color:${TEXT_HIGH};`;
    if (!block.direct) {
      const badge = document.createElement('span');
      badge.textContent = '↳ ';
      badge.title = '間接リレーション（このノードは参加しないが、定義の合理性を辿るために掲載）';
      badge.style.cssText = `color:${TEXT_DIM};font-weight:400;`;
      content.appendChild(badge);
    }
    const body = relation.body[lang] ?? relation.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    for (const tok of splitTokens(body)) {
      if (tok.t === 'txt') { if (tok.v) content.appendChild(document.createTextNode(tok.v)); }
      else {
        const link = document.createElement('span');
        link.textContent = labelById.get(tok.id) ?? tok.id;
        link.style.cssText = `border-bottom:1px dashed currentColor;cursor:pointer;`;
        link.title = 'このノードの関係を開く';
        link.addEventListener('mousedown', (e) => e.preventDefault());
        link.addEventListener('click', (e) => { e.stopPropagation(); ctx.openRelationPanel?.(tok.id, link.textContent ?? undefined); });
        content.appendChild(link);
      }
    }
    if (body.trim() === '') {
      const empty = document.createElement('span');
      empty.textContent = '(空の関係)';
      empty.style.cssText = `color:${TEXT_DIM};font-weight:400;`;
      content.appendChild(empty);
    }

    row.append(caret, spacer, bw, content);
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => row.focus());
    row.addEventListener('focus', () => setSquareActive(square, true));
    row.addEventListener('blur', () => setSquareActive(square, false));
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) { e.preventDefault(); void moveBlock(block, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); toggleCollapse(relation.lineId, e.key === 'ArrowUp'); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusAdjacentRow(row, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Tab') { e.preventDefault(); void setHeadingLevel(block, e.shiftKey ? 2 : 3); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addTextAfter(block); return; }
      // 削除（Ctrl+Shift+Backspace）は見出しには無し。
    });
    rowByLine.set(relation.lineId, row);
    return row;
  };

  // ── テキストブロック（非規範フリーテキスト, 通常字, インライン編集） ──────────────
  const renderTextRow = (block: Extract<ContextBlock, { kind: 'text' }>, opts: { depth: number }): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.blockId = block.blockId;
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;margin-left:${opts.depth * 18}px;`;
    const caretSlot = document.createElement('span');
    caretSlot.style.cssText = `flex-shrink:0;width:12px;`;
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
      if (handleCommonKey(e, block)) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(true); void addTextAfter(block); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusAdjacentRow(ta, e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Tab') { e.preventDefault(); return; } // テキストは階層を持たない: フォーカスが飛ばないよう握り潰す
      if (e.key === 'Backspace' && ta.value === '') { e.preventDefault(); void deleteBlock(block); return; }
    });
    setTimeout(autosize, 0);

    row.append(caretSlot, spacer, bw, ta);
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    return row;
  };

  // ── 末尾のドラフト行（＝追加の入口。＋ボタンの代替。Enter で確定＋作成） ──────────────
  const makeDraftRow = (): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const caretSlot = document.createElement('span');
    caretSlot.style.cssText = `flex-shrink:0;width:12px;`;
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
        pendingFocus = { type: 'draft' };
        void addTextAfter(null, val);
        return;
      }
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focusAdjacentRow(ta, 'up'); return; }
      if (e.key === 'Tab') { e.preventDefault(); return; }
    });
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    row.append(caretSlot, spacer, bw, ta);
    draftTa = ta;
    return row;
  };

  const applyPendingFocus = () => {
    const pf = pendingFocus; pendingFocus = null;
    if (!pf) return;
    if (pf.type === 'draft') { draftTa?.focus(); return; }
    if (pf.type === 'block') { (rowByBlock.get(pf.key)?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(); return; }
    if (pf.type === 'line') { rowByLine.get(pf.key)?.focus(); return; }
  };

  const renderBody = (): void => {
    bodyEl.innerHTML = '';
    rowByBlock.clear();
    rowByLine.clear();
    draftTa = null;
    if (!currentNodeId) {
      const hint = document.createElement('div');
      hint.textContent = 'ノードを選ぶと、そのコンテキスト（ページ）が出ます。';
      hint.style.cssText = `color:${TEXT_DIM};font-size:12px;padding:8px;`;
      bodyEl.appendChild(hint);
      return;
    }
    // ブロック列の見出し階層（h2 > h3 > テキスト）を先頭から解釈しながら、可視ブロックだけ描画する。
    // h2 の配下 = 次の h2 までの「テキスト＋h3（とそのテキスト）」、h3 の配下 = 次の見出しまでのテキスト。
    let curH2: string | null = null; let h2Collapsed = false;
    let curH3: string | null = null; let h3Collapsed = false;
    currentBlocks.forEach((block, i) => {
      const next = currentBlocks[i + 1];
      let depth = 0; let visible = true; let hasChildren = false;
      if (block.kind === 'heading' && block.level !== 3) {
        curH2 = block.line.lineId; h2Collapsed = collapsedLines.has(curH2);
        curH3 = null; h3Collapsed = false;
        depth = 0; visible = true;
        hasChildren = !!next && !(next.kind === 'heading' && next.level !== 3);
      } else if (block.kind === 'heading') {
        curH3 = block.line.lineId; h3Collapsed = collapsedLines.has(curH3);
        depth = 1; visible = !h2Collapsed;
        hasChildren = !!next && next.kind === 'text';
      } else {
        // データ上は親見出しの配下だが、見た目の左右位置は「親見出しと同じ」に揃える
        // （h2 の直下テキストは h2 と、h3 の直下テキストは h3 と同じインデント）。
        depth = curH3 !== null ? 1 : 0;
        visible = !h2Collapsed && !(curH3 !== null && h3Collapsed);
      }
      if (!visible) return;
      const row = block.kind === 'heading'
        ? renderHeadingRow(block, { depth, hasChildren, collapsed: collapsedLines.has(block.line.lineId) })
        : renderTextRow(block, { depth });
      rowByBlock.set(block.blockId, row);
      bodyEl.appendChild(row);
    });
    bodyEl.appendChild(makeDraftRow());
    applyPendingFocus();
  };

  // 本体だけ再取得して描画（head は作り直さない）。
  const reload = async (): Promise<void> => {
    if (!currentNodeId) { currentBlocks = []; renderBody(); return; }
    const token = ++renderToken;
    const blocks = await fetchNodeContext(ctx.gId, currentNodeId);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  // ── ヘッダ（パンくず＋⟳＋言語） ────────────────────────────────────────────
  const render = async (): Promise<void> => {
    head.innerHTML = '';
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = `display:flex;align-items:center;gap:4px;height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};`;
    if (opts.leadingHeadEl) ctrlRow.appendChild(opts.leadingHeadEl);
    const title = document.createElement('span');
    title.textContent = currentPath?.[currentPath.length - 1]?.label || 'コンテキスト';
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
      closeBtn.title = 'このコンテキストパネルを閉じる';
      closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;`;
      closeBtn.addEventListener('click', () => opts.onClose!());
      ctrlRow.appendChild(closeBtn);
    }
    head.appendChild(ctrlRow);
    await reload();
  };

  // リレーションパネルで見出し(関係)が選ばれたら、その見出し行へスクロールする（全体ハイライトはしない。
  // 選択の表示は各パネルと同様に「フォーカス行の四角が青くなる」だけに揃える）。
  const focusHeading = (lineId: string) => {
    const row = rowByLine.get(lineId);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  ctx.focusContextHeading = focusHeading;

  void render();

  const noPath: PanelPathEntry[] = [];
  return {
    el,
    head,
    load: () => render(),
    refresh: () => { void reload(); },
    search: async () => { /* コンテキスト列は top-bar 検索の対象外 */ },
    setParent: async (nodeId, _excl, path) => { currentNodeId = nodeId; currentPath = path ?? null; await render(); },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getSourceNodeId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { currentNodeId = null; currentPath = null; await render(); },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* コンテキスト列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { if (ctx.focusContextHeading === focusHeading) ctx.focusContextHeading = undefined; },
  };
}
