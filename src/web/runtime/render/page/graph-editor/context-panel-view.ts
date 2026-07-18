import type { GraphEditorContext, PanelView, ExplorerNode, ExplorerRelation, ContextBlock, PanelPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, showToast } from './constants';
import {
  fetchNodeContext, apiCreateBlock, apiSetBlockText, apiSetBlockHeading, apiReorderBlocks, apiDeleteBlock,
} from './api';

// コンテキスト(ノードのページ)パネル。ノードと1:1で、順序付きブロック列を縦に描画する。
// - 見出しブロック = リレーション参照(規範=定義)。h2/h3 の level と direct(このノードが参加するか)を持つ。
//   本文はリレーション(line)の共有オブジェクトなので、ここでは読み取り表示＋ナビゲート(チップで辿る)に留め、
//   定義の編集はリレーションパネル側で行う（単一ソース）。
// - テキストブロック = 非規範フリーテキスト(言語別・ノードリンク無し)。ここでインライン編集・自動保存する。
// ブロックの並び替え(▲▼)、見出しの h2/h3 切替、ブロック除去(✕)、テキスト追加(＋テキスト)を提供する。
// リレーションパネルで見出し(関係)を選ぶと ctx.focusContextHeading 経由で該当見出しへスクロールする。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

// 本文を [テキスト, メンション(⟦id⟧), …] に分解（relation-panel-view の同名ヘルパと同じ規則）。
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
  const canvas = document.createElement('canvas');
  const cctx = canvas.getContext('2d');

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:column;font-size:11px;color:${TEXT_MID};`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:8px 10px;`;
  el.appendChild(bodyEl);

  // blockId → その行の DOM。focusContextHeading のスクロール先解決に使う（見出しは lineId でも引ける）。
  const rowByBlock = new Map<string, HTMLElement>();
  const rowByLine = new Map<string, HTMLElement>();

  // ── 並べ替え ───────────────────────────────────────────────────────────────
  // 現在の並びから idx の要素を dir 方向へ1つ動かし、全順序をサーバへ保存して再描画。
  // 仮想見出し id("h:<lineId>")もそのまま送れる（サーバが実体化する）。
  const moveBlock = async (idx: number, dir: 'up' | 'down') => {
    if (!currentNodeId) return;
    const order = currentBlocks.map((b) => b.blockId);
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    const token = ++renderToken;
    const blocks = await apiReorderBlocks(ctx.gId, currentNodeId, order);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  const setHeadingLevel = async (block: Extract<ContextBlock, { kind: 'heading' }>, level: 2 | 3) => {
    if (!currentNodeId) return;
    if (block.blockId.startsWith('h:')) {
      // 未実体化の仮想見出し: 一旦 order を送って実体化 → level を当てるより、level 付きで見出し追加が要る。
      // ここでは並べ替えAPIで実体化し、再取得後に実体 blockId へ level を当てる。
      const order = currentBlocks.map((b) => b.blockId);
      const blocks = await apiReorderBlocks(ctx.gId, currentNodeId, order);
      const real = blocks.find((b) => b.kind === 'heading' && b.line.lineId === block.line.lineId);
      currentBlocks = blocks;
      if (real) await apiSetBlockHeading(ctx.gId, real.blockId, { level });
    } else {
      await apiSetBlockHeading(ctx.gId, block.blockId, { level });
    }
    await render();
  };

  const deleteBlock = async (block: ContextBlock) => {
    if (block.blockId.startsWith('h:')) {
      // 仮想見出し（未実体化の直接リレーション）はまだ実体が無い。P1 では直接リレーションの非表示は
      // 未対応（次読込で再び見出しとして出る）。実体化済みの見出し/テキストのみ除去できる。
      showToast('直接リレーションの見出しは非表示にできません（P1）');
      return;
    }
    await apiDeleteBlock(ctx.gId, block.blockId);
    await render();
  };

  const addTextBlock = async () => {
    if (!currentNodeId) return;
    const res = await apiCreateBlock(ctx.gId, currentNodeId, { kind: 'text', lang, body: '' });
    if (!res) return;
    currentBlocks = res.blocks;
    renderBody();
    // 追加したテキストブロックへフォーカス。
    const row = rowByBlock.get(res.blockId);
    (row?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
  };

  // ── 行の共通操作ツールバー（▲▼ / ✕ / h2·h3） ──────────────────────────────
  const makeToolbar = (idx: number, block: ContextBlock): HTMLElement => {
    const bar = document.createElement('div');
    bar.style.cssText = `flex-shrink:0;display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .1s;`;
    const mkBtn = (label: string, title: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:11px;padding:0 3px;line-height:1;`;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', act);
      return b;
    };
    if (block.kind === 'heading') {
      const cur = block.level === 3 ? 3 : 2;
      bar.appendChild(mkBtn(cur === 2 ? 'H2' : 'H3', 'クリックで h2/h3 を切替', () => void setHeadingLevel(block, cur === 2 ? 3 : 2)));
    }
    bar.appendChild(mkBtn('▲', '1つ上へ', () => void moveBlock(idx, 'up')));
    bar.appendChild(mkBtn('▼', '1つ下へ', () => void moveBlock(idx, 'down')));
    bar.appendChild(mkBtn('✕', block.kind === 'heading' ? 'この見出しをページから外す' : 'このテキストを削除', () => void deleteBlock(block)));
    return bar;
  };

  // ── 見出しブロック（=リレーション参照, 読み取り表示＋ナビゲート） ────────────────
  const renderHeadingRow = (idx: number, block: Extract<ContextBlock, { kind: 'heading' }>): HTMLElement => {
    const relation: ExplorerRelation = block.line;
    const labelById = new Map(relation.participants.map((p) => [p.id, labelOf(p, lang)] as const));
    const level = block.level === 3 ? 3 : 2;

    const row = document.createElement('div');
    row.dataset.blockId = block.blockId;
    row.dataset.lineId = relation.lineId;
    row.style.cssText = `display:flex;align-items:flex-start;gap:6px;margin:${level === 2 ? '14px' : '10px'} 0 4px ${level === 3 ? '16px' : '0'};`;

    const content = document.createElement('div');
    content.style.cssText = `flex:1;min-width:0;line-height:1.5;font-weight:600;color:${TEXT_HIGH};font-size:${level === 2 ? '15px' : '13px'};`;

    // 直接/間接バッジ（間接＝このノードが参加しないリレーション＝辿りによる説明）。
    if (!block.direct) {
      const badge = document.createElement('span');
      badge.textContent = '↳';
      badge.title = '間接リレーション（このノードは参加しないが、定義の合理性を辿るために掲載）';
      badge.style.cssText = `color:${TEXT_DIM};font-weight:400;margin-right:4px;`;
      content.appendChild(badge);
    }

    const body = relation.body[lang] ?? relation.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    for (const tok of splitTokens(body)) {
      if (tok.t === 'txt') {
        if (tok.v) content.appendChild(document.createTextNode(tok.v));
      } else {
        const chip = document.createElement('span');
        chip.textContent = labelById.get(tok.id) ?? tok.id;
        chip.style.cssText = `color:${TEXT_HIGH};border-bottom:1px dashed currentColor;cursor:pointer;`;
        chip.title = 'このノードの関係を右に開く';
        chip.addEventListener('click', () => ctx.openRelationPanel?.(tok.id, chip.textContent ?? undefined));
        content.appendChild(chip);
      }
    }
    if (body.trim() === '') {
      const empty = document.createElement('span');
      empty.textContent = '(空の関係)';
      empty.style.cssText = `color:${TEXT_DIM};font-weight:400;`;
      content.appendChild(empty);
    }

    row.append(content, makeToolbar(idx, block));
    row.addEventListener('mouseenter', () => { (row.lastElementChild as HTMLElement).style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { (row.lastElementChild as HTMLElement).style.opacity = '0'; });
    rowByLine.set(relation.lineId, row);
    return row;
  };

  // ── テキストブロック（非規範フリーテキスト, インライン編集） ──────────────────────
  const renderTextRow = (idx: number, block: Extract<ContextBlock, { kind: 'text' }>): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.blockId = block.blockId;
    row.style.cssText = `display:flex;align-items:flex-start;gap:6px;margin:4px 0;`;

    const ta = document.createElement('textarea');
    ta.value = block.body[lang] ?? block.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    ta.rows = 1;
    ta.placeholder = 'コンテキスト（非規範のフリーテキスト）…';
    ta.style.cssText = `flex:1;min-width:0;background:transparent;border:none;outline:none;resize:none;font-size:13px;font-family:inherit;line-height:1.6;padding:0;color:${TEXT_MID};overflow:hidden;`;
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = (immediate = false) => {
      if (saveTimer) clearTimeout(saveTimer);
      const doSave = () => { void apiSetBlockText(ctx.gId, block.blockId, lang, ta.value); block.body[lang] = ta.value; };
      if (immediate) doSave(); else saveTimer = setTimeout(doSave, 400);
    };
    ta.addEventListener('input', () => { autosize(); save(); });
    ta.addEventListener('blur', () => save(true));
    // 空のテキストブロックで Backspace（先頭）→ ブロック削除。
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && ta.value === '') { e.preventDefault(); void deleteBlock(block); }
    });
    setTimeout(autosize, 0);

    row.append(ta, makeToolbar(idx, block));
    row.addEventListener('mouseenter', () => { (row.lastElementChild as HTMLElement).style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { (row.lastElementChild as HTMLElement).style.opacity = '0'; });
    return row;
  };

  const renderBody = (): void => {
    bodyEl.innerHTML = '';
    rowByBlock.clear();
    rowByLine.clear();
    if (!currentNodeId) {
      const hint = document.createElement('div');
      hint.textContent = 'ノードを選ぶと、そのコンテキスト（ページ）が出ます。';
      hint.style.cssText = `color:${TEXT_DIM};font-size:12px;padding:8px;`;
      bodyEl.appendChild(hint);
      return;
    }
    currentBlocks.forEach((block, idx) => {
      const row = block.kind === 'heading' ? renderHeadingRow(idx, block) : renderTextRow(idx, block);
      rowByBlock.set(block.blockId, row);
      bodyEl.appendChild(row);
    });
    // 末尾のテキスト追加ボタン。
    const addRow = document.createElement('div');
    addRow.style.cssText = `margin-top:10px;`;
    const addBtn = document.createElement('button');
    addBtn.textContent = '＋ テキスト';
    addBtn.title = '非規範のテキストブロックを追加';
    addBtn.style.cssText = `background:transparent;border:1px dashed ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:12px;padding:3px 8px;border-radius:4px;`;
    addBtn.addEventListener('click', () => void addTextBlock());
    addRow.appendChild(addBtn);
    bodyEl.appendChild(addRow);
  };

  // ── ヘッダ（パンくず＋⟳＋言語） ────────────────────────────────────────────
  const render = async (): Promise<void> => {
    const token = ++renderToken;
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
    reloadBtn.addEventListener('click', () => { reloadBtn.style.color = TEXT_HIGH; void render().finally(() => { reloadBtn.style.color = TEXT_DIM; }); });
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

    if (!currentNodeId) { currentBlocks = []; renderBody(); return; }
    const blocks = await fetchNodeContext(ctx.gId, currentNodeId);
    if (token !== renderToken) return;
    currentBlocks = blocks;
    renderBody();
  };

  // リレーションパネルで見出し(関係)が選ばれたら、その見出し行へスクロール＋一瞬ハイライト。
  const focusHeading = (lineId: string) => {
    const row = rowByLine.get(lineId);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const content = row.firstElementChild as HTMLElement | null;
    if (content) {
      const prev = content.style.background;
      content.style.background = SELECT_STRONG;
      content.style.borderRadius = '3px';
      setTimeout(() => { content.style.background = prev; }, 700);
    }
  };
  ctx.focusContextHeading = focusHeading;

  void render();

  const noPath: PanelPathEntry[] = [];
  return {
    el,
    head,
    load: () => render(),
    refresh: () => { void render(); },
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
