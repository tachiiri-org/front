import type { GraphEditorContext, PaneView, ExplorerNode, ExplorerLine, PaneViewPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, ORPHAN_ID } from './constants';
import {
  fetchNodeLines, apiCreateRelation, apiSetLineBody, apiAddRay, apiRemoveRay, fetchAllNodes, apiCreateNode,
  fetchOrphanLines, apiDeleteLine, apiDeleteNode,
} from './api';

// 関係 (line) パネル。関係 = テキストとノード参照(チップ)が交互に並ぶ1行（セグメント分割編集）。
// - テキスト片は普通の <textarea>（IMEはその中で素直に効く・部分装飾の問題が起きない）。
// - 「@」でノード検索→選ぶと、その場でテキストを割ってノード参照チップを差し込み、参加者リンク(j_ray)。
// - 本文は p_line_body に「…⟦nodeId⟧…」の id 入りで保存。描画時に分割し、チップのラベルは id から解決。
// - 関係にフォーカスでアクティブ化 → ノードの四角が塗り(参加)/空(非参加)。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

// 本文を [テキスト, メンション, テキスト, …] に分解。
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

export function createLineView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; initialNodeId?: string | null },
): PaneView {
  let lang = opts.lang;
  let currentNodeId: string | null = opts.initialNodeId ?? null;
  let currentPath: PaneViewPathEntry[] | null = null; // ヘッダのパンくず（ルート›…›現在ノード）。
  let orphanMode = false; // true = 参加ノードを持たない「リンクなし関係」一覧を表示。
  let renderToken = 0;
  const sqByLine = new Map<string, HTMLElement>();
  const canvas = document.createElement('canvas');
  const cctx = canvas.getContext('2d');

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  // ノードパネルと同じ2行構成: 1行目=操作（言語切替 + ⟳ + リンクなし, 28px）、2行目=パンくず。
  // 各行が自分の border-bottom を持つので行間にも線が入り、ノードパネルと高さ・見た目が揃う。
  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:column;font-size:11px;color:${TEXT_MID};`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:6px 8px;`;
  el.appendChild(bodyEl);

  // ── @メンション ドロップダウン（使い回し） ──────────────────────────────────
  const menu = document.createElement('div');
  menu.style.cssText = `position:fixed;z-index:300;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;max-height:200px;overflow-y:auto;min-width:180px;display:none;box-shadow:0 4px 12px rgba(0,0,0,.4);`;
  document.body.appendChild(menu);
  let mention: { anchor: HTMLTextAreaElement; onPick: (n: ExplorerNode, createLabel?: string) => Promise<void> } | null = null;
  let mentionSeq = 0;
  // メニュー（@ドロップダウン / チップ検索）共通のキーボード選択。
  let navItems: Array<{ el: HTMLElement; act: () => void }> = [];
  let navIdx = -1;
  let menuOpen = false;
  const navHighlight = () => navItems.forEach((it, i) => { it.el.style.background = i === navIdx ? 'rgba(255,255,255,.12)' : 'transparent'; });
  const navMove = (d: number) => { if (!navItems.length) return; navIdx = (navIdx + d + navItems.length) % navItems.length; navHighlight(); navItems[navIdx].el.scrollIntoView({ block: 'nearest' }); };
  const navPick = () => { if (navIdx >= 0 && navItems[navIdx]) navItems[navIdx].act(); };
  const addMenuItem = (container: HTMLElement, label: string, act: () => void) => {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.cssText = `padding:4px 8px;cursor:pointer;color:${TEXT_MID};font-size:12px;white-space:nowrap;`;
    const i = navItems.length;
    item.addEventListener('mouseenter', () => { navIdx = i; navHighlight(); });
    item.addEventListener('mousedown', (e) => { e.preventDefault(); act(); });
    navItems.push({ el: item, act });
    container.appendChild(item);
  };
  const closeMenu = () => { menu.style.display = 'none'; menu.innerHTML = ''; mention = null; navItems = []; navIdx = -1; menuOpen = false; };
  const showMenu = (anchor: HTMLTextAreaElement, query: string, nodes: ExplorerNode[]) => {
    menu.innerHTML = ''; navItems = []; navIdx = -1;
    nodes.slice(0, 20).forEach((n) => addMenuItem(menu, labelOf(n, lang), () => void mention?.onPick(n)));
    const exact = nodes.find((n) => labelOf(n, lang) === query);
    if (query && !exact) addMenuItem(menu, `＋「${query}」を新規ノードで作成して挿入`, () => void mention?.onPick({ id: '' }, query));
    if (navItems.length === 0) { closeMenu(); return; }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.display = 'block';
    navIdx = 0; navHighlight(); menuOpen = true;
  };

  // チップ（ノードリンク）クリック時の検索ポップオーバー。入力＋候補（先頭に「削除」）。↑↓/Enter 対応。
  const openSearchPopover = (
    anchor: HTMLElement,
    onPick: (n: ExplorerNode, createLabel?: string) => void,
    onDelete?: () => void,
  ) => {
    menu.innerHTML = ''; navItems = []; navIdx = -1; mention = null;
    const input = document.createElement('input');
    input.placeholder = 'ノードを検索…';
    input.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid ${BORDER};color:${TEXT_HIGH};font-size:12px;padding:4px 8px;outline:none;`;
    const list = document.createElement('div');
    menu.append(input, list);
    let seq = 0;
    const renderList = (q: string, nodes: ExplorerNode[]) => {
      list.innerHTML = ''; navItems = []; navIdx = -1;
      if (onDelete) addMenuItem(list, '削除', () => { onDelete(); closeMenu(); });
      nodes.slice(0, 20).forEach((n) => addMenuItem(list, labelOf(n, lang), () => { onPick(n); closeMenu(); }));
      const exact = nodes.find((n) => labelOf(n, lang) === q);
      if (q && !exact) addMenuItem(list, `＋「${q}」を新規作成`, () => { onPick({ id: '' }, q); closeMenu(); });
      navIdx = navItems.length ? 0 : -1; navHighlight();
    };
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      const my = ++seq;
      const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, q || undefined);
      if (my !== seq) return;
      renderList(q, nodes);
    });
    input.addEventListener('blur', () => setTimeout(closeMenu, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); navPick(); }
      else if (e.key === 'Escape') { closeMenu(); }
    });
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.display = 'block';
    menuOpen = true;
    void (async () => { const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang); renderList('', nodes); })();
    setTimeout(() => input.focus(), 0);
  };

  const setActive = (line: ExplorerLine) => {
    const cur = ctx.activeRelation;
    if (!cur || cur.lineId !== line.lineId) {
      ctx.setActiveRelation({ lineId: line.lineId, participants: new Set(line.participants.map((p) => p.id)) });
    }
    updateActiveHighlight();
  };
  const updateActiveHighlight = () => {
    const activeId = ctx.activeRelation?.lineId ?? null;
    for (const [lid, sq] of sqByLine) {
      if (lid === activeId) { sq.style.border = 'none'; sq.style.background = SELECT_STRONG; }
      else { sq.style.background = 'transparent'; sq.style.border = `1.5px solid ${TEXT_DIM}`; }
    }
  };

  // ── 関係 1 件 = セグメント分割行 ─────────────────────────────────────────────
  const renderRelationRow = (line: ExplorerLine): HTMLElement => {
    const labelById = new Map(line.participants.map((p) => [p.id, labelOf(p, lang)] as const));

    const row = document.createElement('div');
    row.dataset.lineId = line.lineId;
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span');
    bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;height:21px;cursor:pointer;`;
    const sq = document.createElement('span');
    sq.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(sq);
    sqByLine.set(line.lineId, sq);
    // セグメント/チップを並べるインライン領域。
    const content = document.createElement('div');
    // padding-left:8px = 全行一律の先頭インデント（クリック可能なガター）。先頭の空テキスト片は
    // 非フォーカス時 0px に畳むので、先頭がノードリンクの行もテキストの行も content 内容左端で揃う。
    content.style.cssText = `flex:1;min-width:0;line-height:1.5;padding-left:8px;`;
    row.append(spacer, bw, content);
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => { content.querySelector('textarea')?.focus(); });
    // テキストの無い余白クリックでフォーカス。左ガター（先頭子要素より左＝padding 部）→ 先頭テキスト片の先頭、
    // それ以外（末尾より右の余白）→ 末尾テキスト片の末尾。末尾を固定幅で広げない代わりにここで受ける。
    content.addEventListener('mousedown', (e) => {
      if (e.target !== content) return;
      const first = content.firstElementChild as HTMLTextAreaElement | null;
      const last = content.lastElementChild as HTMLTextAreaElement | null;
      const leftGutter = !!first && (e as MouseEvent).clientX < first.getBoundingClientRect().left;
      const target = leftGutter ? first : last;
      if (target && target.tagName === 'TEXTAREA') {
        e.preventDefault();
        target.focus();
        const pos = leftGutter ? 0 : target.value.length;
        target.setSelectionRange(pos, pos);
      }
    });

    const rebuild = (): string => Array.from(content.children).map((c) => {
      const id = (c as HTMLElement).dataset.men;
      return id ? `⟦${id}⟧` : (c as HTMLTextAreaElement).value;
    }).join('');
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = (immediate = false) => {
      if (saveTimer) clearTimeout(saveTimer);
      const doSave = () => { void apiSetLineBody(ctx.gId, line.lineId, lang, rebuild()); };
      if (immediate) doSave(); else saveTimer = setTimeout(doSave, 400);
    };

    const autosize = (ta: HTMLTextAreaElement) => {
      const text = ta.value || '';
      let w = 8;
      // +2 はキャレット表示分のみ。以前は +6 で各テキスト片の右に余分な空きが出ていた。
      if (cctx) { cctx.font = '14px sans-serif'; w = cctx.measureText(text).width + 2; }
      const max = content.clientWidth || 99999;
      // 先頭の空テキスト片: 非フォーカス時は幅0（直後のノードリンク/テキストを他行と content 内容左端で揃える）、
      // フォーカス時のみキャレットが見える幅に広げる（focus/blur で autosize を呼び直す）。入力した文字は
      // content 内容左端(=padding-left の右)から右へ伸びるので、入力テキストの左端も他行と揃う。
      // 末尾は右端まで固定幅で広げない（手前への入力で折り返すため。右余白クリックは content 側で受ける）。
      const isFirst = content.firstElementChild === ta;
      if (isFirst && content.lastElementChild !== ta && text === '') {
        ta.style.width = document.activeElement === ta ? '8px' : '0px';
      } else {
        ta.style.width = w <= max ? `${Math.max(8, w)}px` : '100%';
      }
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };

    const mkChip = (id: string, label?: string): HTMLElement => {
      const chip = document.createElement('span');
      chip.dataset.men = id;
      chip.contentEditable = 'false';
      // 下線はテキストと同じ色。クリックで検索ポップオーバー（差し替え／削除）。× は廃止。
      chip.style.cssText = `display:inline-block;vertical-align:top;line-height:1.5;font-size:14px;color:${TEXT_HIGH};border-bottom:1px solid currentColor;margin:0;user-select:none;cursor:pointer;`;
      const txt = document.createElement('span');
      txt.textContent = label ?? labelById.get(id) ?? id;
      chip.appendChild(txt);
      chip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        openSearchPopover(chip, (n, cl) => void replaceChip(chip, n, cl), () => removeChip(chip));
      });
      return chip;
    };

    // チップのリンク先ノードを差し替える（ray も付け替え）。
    const replaceChip = async (chip: HTMLElement, n: ExplorerNode, createLabel?: string) => {
      const oldId = chip.dataset.men!;
      let newId = n.id;
      if (createLabel) { const c = await apiCreateNode(ctx.gId, null, lang, createLabel); if (!c) return; newId = c.id; }
      if (newId === oldId) return;
      const label = createLabel ?? labelOf(n, lang);
      chip.dataset.men = newId;
      (chip.firstChild as HTMLElement).textContent = label;
      save(true);
      await apiAddRay(ctx.gId, line.lineId, newId);
      const ar = ctx.activeRelation;
      const usesOld = Array.from(content.children).some((c) => (c as HTMLElement).dataset.men === oldId);
      if (!usesOld) await apiRemoveRay(ctx.gId, line.lineId, oldId);
      if (ar && ar.lineId === line.lineId) {
        ar.participants.add(newId);
        if (!usesOld) ar.participants.delete(oldId);
        ctx.setActiveRelation(ar);
      }
    };

    const mkTextarea = (v: string): HTMLTextAreaElement => {
      const ta = document.createElement('textarea');
      ta.value = v;
      ta.rows = 1;
      ta.style.cssText = `display:inline-block;vertical-align:top;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0;margin:0;overflow:hidden;color:${TEXT_HIGH};`;
      // focus/blur で autosize を呼び直し、先頭の空テキスト片を フォーカス時=8px / 非フォーカス時=0px に。
      ta.addEventListener('focus', () => { setActive(line); autosize(ta); });
      ta.addEventListener('input', () => { autosize(ta); void handleMention(ta); save(); });
      // 他の場所を選んで textarea からフォーカスが外れたら、@ドロップダウンは閉じる。
      // （項目は mousedown+preventDefault でフォーカスを奪わないので、項目選択では blur しない。
      //   確定時は onPick が先に closeMenu→mention=null するため、ガードで二重閉じも防ぐ。）
      ta.addEventListener('blur', () => { save(true); autosize(ta); if (mention?.anchor === ta) closeMenu(); });
      ta.addEventListener('keydown', (e) => {
        // @ メニューが開いている間は ↑↓/Enter で候補選択。
        if (menuOpen) {
          if (e.key === 'ArrowDown') { e.preventDefault(); navMove(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); navMove(-1); return; }
          if (e.key === 'Enter') { e.preventDefault(); navPick(); return; }
          if (e.key === 'Escape') { closeMenu(); return; }
        }
        if (e.key === 'Escape') { closeMenu(); return; }
        // Ctrl+Shift+Backspace で関係(行)そのものを削除。
        if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          void (async () => { await apiDeleteLine(ctx.gId, line.lineId); await render(); })();
          return;
        }
        // テキストを範囲選択して @ → 選択ワードを検索初期値にメニューを開き、選択範囲をチップに置換。
        if (e.key === '@' && ta.selectionStart !== ta.selectionEnd) {
          e.preventDefault();
          const s = ta.selectionStart, en = ta.selectionEnd;
          void openMention(ta, ta.value.slice(0, s), ta.value.slice(en), ta.value.slice(s, en));
          return;
        }
        // 既存リレーションで Enter は改行ではなく「新しいリレーションを追加」（Shift+Enterで改行）。
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const nid = currentNodeId;
          if (nid) void (async () => { const created = await apiCreateRelation(ctx.gId, nid, lang, ''); await render(); if (created) focusLine(created.lineId); })();
          return;
        }
        const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
        const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
        // 連続caret: 端で←→を押すと隣のテキスト片へ（チップを跨ぐ）。
        if (e.key === 'ArrowLeft' && atStart) {
          const chip = ta.previousElementSibling as HTMLElement | null;
          const prevTa = chip?.previousElementSibling as HTMLTextAreaElement | null;
          if (chip?.dataset.men && prevTa) { e.preventDefault(); prevTa.focus(); prevTa.setSelectionRange(prevTa.value.length, prevTa.value.length); }
          return;
        }
        if (e.key === 'ArrowRight' && atEnd) {
          const chip = ta.nextElementSibling as HTMLElement | null;
          const nextTa = chip?.nextElementSibling as HTMLTextAreaElement | null;
          if (chip?.dataset.men && nextTa) { e.preventDefault(); nextTa.focus(); nextTa.setSelectionRange(0, 0); }
          return;
        }
        // Backspace（先頭）で直前チップ削除、Delete（末尾）で直後チップ削除。
        if (e.key === 'Backspace' && atStart) {
          const prev = ta.previousElementSibling as HTMLElement | null;
          if (prev?.dataset.men) { e.preventDefault(); removeChip(prev); return; }
          // 先頭の空ガター片にいて、関係全体が空（チップも本文も無い）なら、関係そのものを削除。
          // 全行が先頭に空ガター片を持つので、テキストのみの行を巻き込んで消さないよう全体の空を確認する。
          const allEmpty = Array.from(content.children).every(
            (c) => !(c as HTMLElement).dataset.men && (c as HTMLTextAreaElement).value === '',
          );
          if (!prev && allEmpty) {
            e.preventDefault();
            void (async () => { await apiDeleteLine(ctx.gId, line.lineId); await render(); })();
            return;
          }
        }
        if (e.key === 'Delete' && atEnd) {
          const next = ta.nextElementSibling as HTMLElement | null;
          if (next?.dataset.men) { e.preventDefault(); removeChip(next); }
        }
      });
      setTimeout(() => autosize(ta), 0);
      return ta;
    };

    const removeChip = (chip: HTMLElement) => {
      const id = chip.dataset.men!;
      const prev = chip.previousElementSibling as HTMLTextAreaElement | null;
      const next = chip.nextElementSibling as HTMLTextAreaElement | null;
      // 前後のテキスト片を結合してチップを除去。
      if (prev && next) {
        const caret = prev.value.length;
        prev.value = prev.value + next.value;
        next.remove();
        autosize(prev);
        prev.focus();
        prev.setSelectionRange(caret, caret);
      }
      chip.remove();
      save(true);
      // 同じ id のチップが他に無ければ参加も解除。
      const stillUsed = Array.from(content.children).some((c) => (c as HTMLElement).dataset.men === id);
      if (!stillUsed) {
        void apiRemoveRay(ctx.gId, line.lineId, id);
        const ar = ctx.activeRelation;
        if (ar && ar.lineId === line.lineId) { ar.participants.delete(id); ctx.setActiveRelation(ar); }
      }
    };

    // メニューを開いて、選んだら ta を leftStr / チップ / rightStr に割って参照を差し込む共通処理。
    // - @入力: leftStr=@より前, rightStr=caret以降, query=@に続く文字。
    // - 範囲選択+@: leftStr=選択前, rightStr=選択後, query=選択テキスト（選択範囲をチップに置換）。
    const openMention = async (ta: HTMLTextAreaElement, leftStr: string, rightStr: string, query: string) => {
      mention = {
        anchor: ta,
        onPick: async (n, createLabel) => {
          let nodeId = n.id;
          if (createLabel) {
            const created = await apiCreateNode(ctx.gId, null, lang, createLabel);
            if (!created) { closeMenu(); return; }
            nodeId = created.id;
          }
          const label = createLabel ?? labelOf(n, lang);
          ta.value = leftStr;
          autosize(ta);
          const chip = mkChip(nodeId, label);
          const newTa = mkTextarea(rightStr);
          content.insertBefore(chip, ta.nextSibling);
          content.insertBefore(newTa, chip.nextSibling);
          closeMenu();
          newTa.focus();
          newTa.setSelectionRange(0, 0);
          save(true);
          await apiAddRay(ctx.gId, line.lineId, nodeId);
          const ar = ctx.activeRelation;
          if (ar && ar.lineId === line.lineId) { ar.participants.add(nodeId); ctx.setActiveRelation(ar); }
        },
      };
      const seq = ++mentionSeq;
      const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, query || undefined);
      if (seq !== mentionSeq || !mention) return;
      showMenu(ta, query, nodes);
    };

    const handleMention = async (ta: HTMLTextAreaElement) => {
      const caret = ta.selectionStart;
      const before = ta.value.slice(0, caret);
      const mm = before.match(/@([^\s@]*)$/);
      if (!mm) { closeMenu(); return; }
      const atStart = caret - mm[0].length;
      await openMention(ta, ta.value.slice(0, atStart), ta.value.slice(ta.selectionStart), mm[1]);
    };

    // 初期トークンを並べる（必ずテキスト片で始まり/終わる）。
    const body = line.body[lang] ?? line.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    for (const tok of splitTokens(body)) {
      if (tok.t === 'txt') content.appendChild(mkTextarea(tok.v));
      else content.appendChild(mkChip(tok.id));
    }
    return row;
  };

  // ノードパネルの draft 行と同じ構成（spacer+四角+入力）。テキストを書いて Enter で作成。
  const makeDraftRow = (nodeId: string): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const spacer = document.createElement('span'); spacer.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span'); bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;height:21px;cursor:pointer;`;
    const sq = document.createElement('span'); sq.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(sq);
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px;overflow:hidden;min-width:0;color:${TEXT_DIM};`;
    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('focus', () => { ta.style.color = TEXT_HIGH; });
    ta.addEventListener('blur', () => { if (!ta.value.trim()) ta.style.color = TEXT_DIM; });
    ta.addEventListener('input', resize);
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const body = ta.value.trim();
        ta.value = '';
        await apiCreateRelation(ctx.gId, nodeId, lang, body);
        await render();
      }
    });
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    row.append(spacer, bw, ta);
    return row;
  };

  // ── 列全体の描画 ─────────────────────────────────────────────────────────────
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    head.innerHTML = '';
    bodyEl.innerHTML = '';
    sqByLine.clear();

    // ── 1行目: 操作（言語切替 + ⟳ + リンクなし） ── ノードペインヘッダと同じ 28px+下線。
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = `display:flex;align-items:center;gap:4px;height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};`;
    // 言語切替（ノードパネルのパネル別 JA/EN と同じ）。
    const langBtn = document.createElement('button');
    langBtn.textContent = lang.toUpperCase();
    langBtn.title = lang === 'ja' ? 'この関係パネルの言語: 日本語（クリックでEN）' : 'この関係パネルの言語: 英語（クリックでJA）';
    langBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;flex-shrink:0;line-height:1.4;`;
    langBtn.addEventListener('click', () => { lang = lang === 'ja' ? 'en' : 'ja'; void render(); });
    ctrlRow.appendChild(langBtn);
    // パネル内更新ボタン（ノードパネルの ⟳ と同じ）。関係一覧を再取得する。
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = '関係を再読み込み';
    reloadBtn.style.cssText = `margin-left:auto;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    reloadBtn.addEventListener('click', () => { reloadBtn.style.color = TEXT_HIGH; void render().finally(() => { reloadBtn.style.color = TEXT_DIM; }); });
    ctrlRow.appendChild(reloadBtn);
    // 「リンクなし」トグル: 参加ノードを持たない関係の一覧（移行・編集中の受け皿）。
    const orphanBtn = document.createElement('button');
    orphanBtn.textContent = 'リンクなし';
    orphanBtn.title = '参加ノードを持たない関係（リンクなし）を表示';
    orphanBtn.style.cssText = `flex-shrink:0;background:${orphanMode ? SELECT_STRONG : 'transparent'};border:1px solid ${BORDER};color:${orphanMode ? '#fff' : TEXT_MID};cursor:pointer;font-size:10px;padding:1px 6px;border-radius:3px;`;
    orphanBtn.addEventListener('click', () => { orphanMode = !orphanMode; void render(); });
    ctrlRow.appendChild(orphanBtn);
    head.appendChild(ctrlRow);

    // ── 2行目: パンくず（ルート › … › 現在ノード） ── アウトラインの bcEl と同じ見た目。
    const bcRow = document.createElement('div');
    bcRow.style.cssText = `display:flex;align-items:center;gap:2px;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;min-width:0;`;
    const title = document.createElement('span');
    title.style.cssText = `flex:1;min-width:0;color:${TEXT_HIGH};font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    if (orphanMode) {
      title.textContent = 'リンクなし関係';
    } else if (currentPath && currentPath.length) {
      currentPath.forEach((e, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.textContent = ' › '; sep.style.color = TEXT_DIM;
          title.appendChild(sep);
        }
        const seg = document.createElement('span');
        seg.textContent = e.label || '(無題)';
        seg.style.color = i === currentPath!.length - 1 ? TEXT_HIGH : TEXT_MID;
        title.appendChild(seg);
      });
    } else {
      title.textContent = '関係';
    }
    bcRow.appendChild(title);
    head.appendChild(bcRow);

    if (orphanMode) {
      const lines = await fetchOrphanLines(ctx.gId);
      if (token !== renderToken) return;
      for (const line of lines) bodyEl.appendChild(renderRelationRow(line));
      updateActiveHighlight();
      return;
    }

    if (!currentNodeId) { updateActiveHighlight(); return; }
    const nodeId = currentNodeId;
    const lines = await fetchNodeLines(ctx.gId, nodeId);
    if (token !== renderToken) return;
    // 追加用ドラフト行は常に先頭。
    bodyEl.appendChild(makeDraftRow(nodeId));
    for (const line of lines) bodyEl.appendChild(renderRelationRow(line));
    updateActiveHighlight();
  };

  const focusLine = (lineId: string) => {
    const row = bodyEl.querySelector(`[data-line-id="${CSS.escape(lineId)}"]`);
    (row?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
  };

  // ── ノード → 関係への変換 ─────────────────────────────────────────────────────
  // ノード X を関係に変換する：X のラベルを本文にした関係を作り、紐づけ先ノード Y を参加者に
  // （本文に ⟦Y⟧ チップを入れてテキストにノードリンクを持たせ、次回も Y の関係として出るように）、
  // X ノード自体は削除する。Y が無ければ X を主語に作るだけ（削除しない）。戻り値 = X を削除したか。
  const makeRelationFromNode = async (node: ExplorerNode, y: string | null): Promise<boolean> => {
    const xLabel = labelOf(node, lang);
    if (y && y !== node.id) {
      const created = await apiCreateRelation(ctx.gId, y, lang, '');
      if (!created) return false;
      await apiSetLineBody(ctx.gId, created.lineId, lang, `${xLabel}⟦${y}⟧`);
      await apiDeleteNode(ctx.gId, node.id);
      return true;
    }
    const created = await apiCreateRelation(ctx.gId, node.id, lang, '');
    if (created) await apiSetLineBody(ctx.gId, created.lineId, lang, `⟦${node.id}⟧`);
    return false;
  };
  // Shift+Alt+→ ショートカット用フック（ノードパネルから呼ぶ）。focus でドックが X 自身に切り替わる
  // ため、紐づけ先 Y はノードパネル側が渡す親 (targetNodeId)。変換後はドックを Y の関係表示に。
  ctx.moveNodeToRelation = async (node, targetNodeId) => {
    const y = targetNodeId && targetNodeId !== ORPHAN_ID ? targetNodeId : null;
    await makeRelationFromNode(node, y);
    if (y) { currentNodeId = y; currentPath = null; }
    await render();
  };

  // ── ノードパネルからのドロップ ───────────────────────────────────────────────
  el.addEventListener('dragover', (e) => {
    if (!ctx.paneDrag) return;          // ノードパネル発のノードドラッグのみ受ける
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    bodyEl.style.boxShadow = `inset 0 0 0 2px ${SELECT_STRONG}`;
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) bodyEl.style.boxShadow = '';
  });
  el.addEventListener('drop', (e) => {
    if (!ctx.paneDrag) return;
    e.preventDefault();
    bodyEl.style.boxShadow = '';
    const pd = ctx.paneDrag;
    const movers = [...pd.movers];
    // ドロップ先 = いま開いているノード Y（ドラッグは focus を変えないので currentNodeId が Y のまま）。
    const y = currentNodeId && currentNodeId !== ORPHAN_ID ? currentNodeId : null;
    void (async () => {
      const deleted: ExplorerNode[] = [];
      for (const m of movers) { if (await makeRelationFromNode(m.node, y)) deleted.push(m.node); }
      if (deleted.length) pd.detachFromSource(deleted); // ノードパネルから消す
      await render();
    })();
  });

  void render();

  // 四角の右クリックで参加が変わったら関係行を再取得（participants を最新に保つ）。
  const refresh = () => { void render(); };
  ctx.refreshRelations.add(refresh);

  const noPath: PaneViewPathEntry[] = [];
  return {
    el,
    load: () => render(),
    refresh: () => { void render(); },
    search: async () => { /* top-bar 検索は関係列には作用しない */ },
    setParent: async (nodeId, _excl, path) => { currentNodeId = nodeId; currentPath = path ?? null; await render(); },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getPaneParentId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { currentNodeId = null; currentPath = null; await render(); },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* 関係列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { ctx.refreshRelations.delete(refresh); menu.remove(); },
  };
}
