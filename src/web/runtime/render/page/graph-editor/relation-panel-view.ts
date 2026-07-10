import type { GraphEditorContext, PanelView, ExplorerNode, ExplorerRelation, PanelPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, ORPHAN_ID, showToast } from './constants';
import {
  fetchNodeRelations, apiCreateRelation, apiSetRelationText, apiAddRay, apiRemoveRay, fetchAllNodes, apiCreateNode,
  fetchOrphanRelations, apiDeleteRelation, apiDeleteNode, apiReorderNodeRelations, apiLinkNode, apiOrient,
} from './api';

// 関係 (relation) パネル。関係 = テキストとノード参照(チップ)が交互に並ぶ1行（セグメント分割編集）。
// - テキスト片は普通の <textarea>（IMEはその中で素直に効く・部分装飾の問題が起きない）。
// - 「@」でノード検索→選ぶと、その場でテキストを割ってノード参照チップを差し込み、参加者リンク(j_ray)。
// - 本文は p_line_body に「…⟦nodeId⟧…」の id 入りで保存。描画時に分割し、チップのラベルは id から解決。
// - 関係にフォーカスでアクティブ化 → ノードの四角が塗り(参加)/空(非参加)。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

// 本文にノードリンク(⟦id⟧チップ)が1つでも含まれるか。
function hasNodeLink(body: string): boolean {
  return /⟦[^⟧]+⟧/.test(body);
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

export function createRelationPanelView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; initialNodeId?: string | null; onClose?: () => void; leadingHeadEl?: HTMLElement },
): PanelView {
  let lang = opts.lang;
  let currentNodeId: string | null = opts.initialNodeId ?? null;
  let currentPath: PanelPathEntry[] | null = null; // ヘッダのパンくず（ルート›…›現在ノード）。
  let orphanMode = false; // true = 参加ノードを持たない「リンクなし関係」一覧を表示。
  let renderToken = 0;
  // 複数選択: アンカー(固定端)とカーソル(移動端)の関係 lineId。両者の間の行が選択範囲。
  // ノードパネルと同じ Shift+↑↓ で範囲を伸縮、Shift+Alt+↑↓ で選択ブロックを並び替え。
  let selAnchor: string | null = null;
  let selCursor: string | null = null;
  const relationBoxByRelation = new Map<string, HTMLElement>();
  // 検索: 最上部の検索行のクエリでいま表示中の関係行を絞る（クライアント側フィルタ・再取得はしない）。
  // 対象1ノードの関係一覧（高々数十件）なので取得済みを filter するだけで足り、サーバ検索は不要。
  let filterQuery = '';
  let currentRelations: ExplorerRelation[] = [];
  let currentDraftNodeId: string | null = null; // 追加ドラフト行の対象ノード（orphan 表示中は null）。
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
    placeholder = 'ノードを検索…',
  ) => {
    menu.innerHTML = ''; navItems = []; navIdx = -1; mention = null;
    const input = document.createElement('input');
    input.placeholder = placeholder;
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

  // @から新規作成したノードは親が無く「リンクなし」になる。以前は親選択ポップオーバーを開いていたが、
  // 既定でルートノード直下に紐づける（構造リンク＋親向き付け）。辺作成を await してから向き付けし、
  // 向き漏れ＝リンクなし化を防ぐ。ルート未設定時は何もしない（従来通りリンクなしのまま）。
  const linkToRoot = async (childId: string) => {
    const parentId = ctx.rootNodeId;
    if (!parentId || parentId === childId) return;
    await apiLinkNode(ctx.gId, childId, parentId);
    await apiOrient(ctx.gId, childId, parentId);
  };

  const setActive = (relation: ExplorerRelation) => {
    const cur = ctx.activeRelation;
    if (!cur || cur.lineId !== relation.lineId) {
      ctx.setActiveRelation({ lineId: relation.lineId, participants: new Set(relation.participants.map((p) => p.id)) });
    }
    updateActiveHighlight();
  };
  const updateActiveHighlight = () => {
    const activeId = ctx.activeRelation?.lineId ?? null;
    for (const [lid, relationBox] of relationBoxByRelation) {
      if (lid === activeId) { relationBox.style.border = 'none'; relationBox.style.background = SELECT_STRONG; }
      else { relationBox.style.background = 'transparent'; relationBox.style.border = `1.5px solid ${TEXT_DIM}`; }
    }
  };

  // ── 複数選択（関係行）─────────────────────────────────────────────────────────
  // 関係行(data-line-id を持つ行)を上から順に。draft 行は含まれない。
  const relationRows = (): HTMLElement[] =>
    Array.from(bodyEl.querySelectorAll<HTMLElement>('[data-line-id]'));
  // アンカー〜カーソル間の連続する lineId 群。未選択なら空。
  const selectedRelationIds = (): string[] => {
    if (!selAnchor) return [];
    const ids = relationRows().map((r) => r.dataset.lineId!);
    const ai = ids.indexOf(selAnchor);
    if (ai === -1) return [];
    const ci = selCursor ? ids.indexOf(selCursor) : ai;
    if (ci === -1) return [ids[ai]];
    return ids.slice(Math.min(ai, ci), Math.max(ai, ci) + 1);
  };
  // 複数選択中(2件以上)のみ行背景を塗る。1件はフォーカス＋四角ハイライトで足りる。
  const updateSelHighlight = () => {
    const sel = selectedRelationIds();
    const set = new Set(sel.length > 1 ? sel : []);
    for (const row of relationRows()) {
      row.style.backgroundColor = set.has(row.dataset.lineId!) ? 'rgba(99,102,241,0.12)' : '';
    }
  };
  const clearSelection = () => { selAnchor = null; selCursor = null; updateSelHighlight(); };
  // 上下カーソルで上下の行へフォーカス移動（ノードパネルと同じ挙動）。draft 行も含めて上下移動する。
  // 行内は複数のテキスト片に分かれるので、セグメント単位ではなく「行」単位で移動する。移動できたら true。
  const focusAdjacentRow = (ta: HTMLTextAreaElement, dir: 'up' | 'down'): boolean => {
    const rows = Array.from(bodyEl.children) as HTMLElement[];
    const idx = rows.findIndex((r) => r.contains(ta));
    if (idx === -1) return false;
    const target = rows[idx + (dir === 'down' ? 1 : -1)];
    const nta = target?.querySelector('textarea') as HTMLTextAreaElement | null;
    if (nta) { nta.focus(); const p = nta.value.length; nta.setSelectionRange(p, p); return true; }
    return false;
  };
  // 行境界のキャレット送り（⑥）: 隣接行の先頭/末尾テキスト片へキャレットを着地させる。
  // dir='up' → 上の行の最後のテキスト片の末尾、dir='down' → 下の行の先頭テキスト片の文頭。
  const focusRowEdge = (ta: HTMLTextAreaElement, dir: 'up' | 'down'): boolean => {
    const rows = Array.from(bodyEl.children) as HTMLElement[];
    const idx = rows.findIndex((r) => r.contains(ta));
    if (idx === -1) return false;
    const target = rows[idx + (dir === 'down' ? 1 : -1)];
    if (!target) return false;
    const tas = target.querySelectorAll('textarea');
    const nta = (dir === 'up' ? tas[tas.length - 1] : tas[0]) as HTMLTextAreaElement | undefined;
    if (!nta) return false;
    nta.focus();
    const p = dir === 'up' ? nta.value.length : 0;
    nta.setSelectionRange(p, p);
    return true;
  };
  // 現在行の末尾テキスト片の末尾へキャレット（最下行で↓を押した時の「行末」着地）。
  const focusRowEnd = (ta: HTMLTextAreaElement) => {
    const row = (Array.from(bodyEl.children) as HTMLElement[]).find((r) => r.contains(ta));
    const tas = row?.querySelectorAll('textarea');
    const last = tas && tas.length ? (tas[tas.length - 1] as HTMLTextAreaElement) : ta;
    last.focus();
    last.setSelectionRange(last.value.length, last.value.length);
  };
  // Shift+↑↓: カーソル端を上下に動かして選択範囲を伸縮（フォーカスはアンカー行に残す）。
  const extendSelection = (dir: 'up' | 'down') => {
    const ids = relationRows().map((r) => r.dataset.lineId!);
    if (!selAnchor || ids.indexOf(selAnchor) === -1) return;
    const cur = selCursor && ids.includes(selCursor) ? selCursor : selAnchor;
    const ci = ids.indexOf(cur);
    const ni = dir === 'down' ? Math.min(ids.length - 1, ci + 1) : Math.max(0, ci - 1);
    selCursor = ids[ni];
    updateSelHighlight();
  };
  // Shift+Alt+↑↓: 選択ブロックを1つ上/下へ。DOM を並べ替えて全順序をバックエンドへ保存。
  const moveSelectedRelations = async (dir: 'up' | 'down') => {
    if (orphanMode || !currentNodeId) return; // 並び順はノード別。orphan/未選択時は不可。
    const rows = relationRows();
    const ids = rows.map((r) => r.dataset.lineId!);
    const sel = selectedRelationIds();
    if (!sel.length) return;
    const idxs = sel.map((id) => ids.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
    const first = idxs[0], last = idxs[idxs.length - 1];
    if (dir === 'up') {
      if (first <= 0) return;
      rows[last].after(rows[first - 1]); // 直上の行を選択ブロックの下へ = ブロックが1つ上がる
    } else {
      if (last >= rows.length - 1) return;
      rows[first].before(rows[last + 1]); // 直下の行を選択ブロックの上へ = ブロックが1つ下がる
    }
    updateSelHighlight();
    await apiReorderNodeRelations(ctx.gId, currentNodeId, relationRows().map((r) => r.dataset.lineId!));
  };

  // 関係(行)の楽観削除。全体を render() し直すと点滅＆フォーカスが飛ぶので、対象の行だけ
  // DOM から外し、隣の行へフォーカスを送ってそのまま編集を続けられるようにする。
  const deleteRelationsOptimistic = (relationIds: string[]) => {
    if (!relationIds.length) return;
    const rows = relationRows();
    const targetSet = new Set(relationIds);
    const idxs = rows.map((r, i) => (targetSet.has(r.dataset.lineId!) ? i : -1)).filter((i) => i >= 0);
    const firstIdx = idxs.length ? Math.min(...idxs) : 0;
    const remaining = rows.filter((r) => !targetSet.has(r.dataset.lineId!));
    const focusTarget = remaining[Math.min(firstIdx, remaining.length - 1)] ?? null;
    for (const id of relationIds) {
      rows.find((r) => r.dataset.lineId === id)?.remove();
      relationBoxByRelation.delete(id);
      if (ctx.activeRelation?.lineId === id) ctx.setActiveRelation(null);
      void apiDeleteRelation(ctx.gId, id);
    }
    clearSelection();
    (focusTarget?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
  };
  const deleteRelationOptimistic = (lineId: string) => deleteRelationsOptimistic([lineId]);

  // ── 関係 1 件 = セグメント分割行 ─────────────────────────────────────────────
  const renderRelationRow = (relation: ExplorerRelation): HTMLElement => {
    const labelById = new Map(relation.participants.map((p) => [p.id, labelOf(p, lang)] as const));

    const row = document.createElement('div');
    row.dataset.lineId = relation.lineId;
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span');
    bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;height:21px;cursor:pointer;`;
    const relationBox = document.createElement('span');
    relationBox.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(relationBox);
    relationBoxByRelation.set(relation.lineId, relationBox);
    // セグメント/チップを並べるインライン領域。
    const content = document.createElement('div');
    // padding-left:8px = 全行一律の先頭インデント（クリック可能なガター）。先頭の空テキスト片は
    // 非フォーカス時 0px に畳むので、先頭がノードリンクの行もテキストの行も content 内容左端で揃う。
    content.style.cssText = `flex:1;min-width:0;line-height:1.5;padding-left:8px;`;
    row.append(spacer, bw, content);
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => { content.querySelector('textarea')?.focus(); });

    // ③ コピーボタン: ノードの ❐ と同様に行の右端へ。`[lineId]ラベル解決済み本文` をコピー
    // （⟦id⟧ はチップの表示ラベルへ解決）。AIエージェントとのやり取り用の参照文字列。
    const relCopyText = () => Array.from(content.children).map((c) => {
      const cel = c as HTMLElement;
      if (cel.dataset.nodeLink) return cel.textContent ?? '';
      return (c as HTMLTextAreaElement).value;
    }).join('');
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '❐';
    copyBtn.title = '関係テキストの参照をコピー';
    copyBtn.style.cssText = `flex-shrink:0;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:12px;padding:0 6px;line-height:1;`;
    copyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(`[${relation.lineId}]${relCopyText()}`).then(() => showToast('コピーしました'));
    });
    row.appendChild(copyBtn);
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

    // ── チップまたぎ選択 ─────────────────────────────────────────────────────
    // ta 内では native の青い選択のまま。右端で Shift+→ すると「隣のチップだけ」を選択状態にして、
    // その先の ta 先頭へキャレットを移す（native 選択はフォーカス中の ta 内だけに保たれるので、行全体が
    // まとめて選択されて白飛びする問題が起きない）。@ で anchor〜現在キャレットを親チップに畳む。
    // startTa/startOff = 選択を開始した固定アンカー位置。focusTa = 現在フォーカス中の ta。方向は DOM 順で
    // start と focus の前後により決まる（右向き=start が左／左向き=start が右）。Shift+←→ が ta の端に達し
    // たら隣のチップを選択に含めて先の ta へフォーカスを移す。左右どちらからでも開始できる。
    let groupSel: { startTa: HTMLTextAreaElement; startOff: number; focusTa: HTMLTextAreaElement } | null = null;
    let crossing = false; // プログラム的な focus 移動中は clearGroupSel を抑止
    const segChildren = () => Array.from(content.children) as HTMLElement[];
    // 選択の見た目。OS システム色(Highlight/HighlightText)は環境により白飛びするので使わず、読める青の
    // 半透明背景にする（暗背景でも文字が潰れないよう文字色は据え置き）。
    const SEL_BG = 'rgba(70,120,235,0.5)';
    // 非選択に戻すときは '' ではなく 'transparent'。textarea は cssText で background:transparent を
    // 明示しており、'' にすると背景指定ごと消えてブラウザ既定の白背景になり、薄いグレー文字が白地で
    // 読めなくなる（＝「白いハイライト」に見える）。'transparent' で元のダーク配色に戻す。
    const paintEl = (el: HTMLElement, on: boolean) => { el.style.background = on ? SEL_BG : 'transparent'; };
    // 文字列のピクセル幅（autosize と同じ近似フォントで測る）。起点 textarea の部分選択を塗るのに使う。
    const textWidth = (s: string) => { if (!s || !cctx) return 0; cctx.font = '14px sans-serif'; return cctx.measureText(s).width; };
    const clearGroupSel = () => {
      if (!groupSel) return;
      for (const c of segChildren()) paintEl(c, false);
      groupSel = null;
    };
    // 選択範囲を塗り直す。フォーカス中の ta は native の青選択が見えるので塗らず、またいだチップ・中間 ta・
    // 丸ごと選択された start ta を OS ハイライト色で塗って範囲全体を繋げて見せる（focus 移動で前 ta の
    // native 選択が消える問題の補完）。
    const paintGroupSel = () => {
      if (!groupSel) return;
      const kids = segChildren();
      const sIdx = kids.indexOf(groupSel.startTa);
      const fIdx = kids.indexOf(groupSel.focusTa);
      if (sIdx < 0 || fIdx < 0) return;
      const lo = Math.min(sIdx, fIdx), hi = Math.max(sIdx, fIdx);
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (el.dataset.nodeLink) { paintEl(el, i > lo && i < hi); continue; }
        if (i === fIdx) { paintEl(el, false); continue; }         // フォーカス ta は native 選択が見える
        if (i !== sIdx) { paintEl(el, i > lo && i < hi); continue; } // 中間 ta は丸ごと／範囲外は消す
        // start ta は「選択された部分」だけ塗る（右向き=[startOff..末尾]／左向き=[0..startOff]）。丸ごとなら
        // 単色、部分なら文字幅を測ってグラデーションで部分ハイライト（focus 移動で native 選択が消える補完）。
        const val = groupSel.startTa.value;
        const from = sIdx < fIdx ? groupSel.startOff : 0;
        const to = sIdx < fIdx ? val.length : groupSel.startOff;
        if (from <= 0 && to >= val.length) paintEl(el, true);
        else if (from >= to) paintEl(el, false);
        else {
          const lpx = textWidth(val.slice(0, from)), rpx = textWidth(val.slice(0, to));
          el.style.background = `linear-gradient(to right, transparent ${lpx}px, ${SEL_BG} ${lpx}px, ${SEL_BG} ${rpx}px, transparent ${rpx}px)`;
        }
      }
    };

    const rebuild = (): string => Array.from(content.children).map((c) => {
      const id = (c as HTMLElement).dataset.nodeLink;
      return id ? `⟦${id}⟧` : (c as HTMLTextAreaElement).value;
    }).join('');
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let detachedSource = false; // ⑤: ソース参加を外したら二重に外さない。
    const save = (immediate = false) => {
      if (saveTimer) clearTimeout(saveTimer);
      const doSave = () => {
        const body = rebuild();
        void apiSetRelationText(ctx.gId, relation.lineId, lang, body);
        // ⑤: 本文はあるがノードリンク(チップ)が1つも無い関係は、ソースノード配下に残さず「リンクなし」へ。
        // ソース参加者を外す＝本文が残るのでバックエンドは行を保持し（orphan）、当該ノードでは出なくなる。
        // 編集中に画面から消さない（DOMはそのまま）ため、再描画はしない。リンクなし表示や別ノードは対象外。
        const src = currentNodeId;
        if (!orphanMode && src && !detachedSource && body.trim() !== '' && !hasNodeLink(body)
            && relation.participants.some((p) => p.id === src)) {
          detachedSource = true;
          relation.participants = relation.participants.filter((p) => p.id !== src);
          void apiRemoveRay(ctx.gId, relation.lineId, src);
          const ar = ctx.activeRelation;
          if (ar && ar.lineId === relation.lineId) { ar.participants.delete(src); ctx.setActiveRelation(ar); }
        }
      };
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

    const mkNodeLink = (id: string, label?: string): HTMLElement => {
      const nodeLink = document.createElement('span');
      nodeLink.dataset.nodeLink = id;
      nodeLink.contentEditable = 'false';
      // 下線はテキストと同じ色・dashed。左クリックで検索ポップオーバー（差し替え／削除）、
      // 右クリックで右にそのノードの関係パネルを開く（②）。× は廃止。
      nodeLink.style.cssText = `display:inline-block;vertical-align:top;line-height:1.5;font-size:14px;color:${TEXT_HIGH};border-bottom:1px dashed currentColor;margin:0;user-select:none;cursor:pointer;`;
      const txt = document.createElement('span');
      txt.textContent = label ?? labelById.get(id) ?? id;
      nodeLink.appendChild(txt);
      // 左クリック = このノードを選択（＝表示切替: 関係パネルはこのノードの関係、選択中ソースの
      // ノードパネルはこのノードの子を出す）。右クリック = ノード検索メニュー（差し替え／削除）。
      nodeLink.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        clearGroupSel(); // チップクリックは focus を奪わない＝blur が来ないので、ここで選択を解除
        e.preventDefault();
        ctx.selectNode?.(id, nodeLink.textContent ?? undefined);
      });
      nodeLink.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openSearchPopover(nodeLink, (n, cl) => void replaceNodeLink(nodeLink, n, cl), () => removeNodeLink(nodeLink));
      });
      return nodeLink;
    };

    // チップのリンク先ノードを差し替える（ray も付け替え）。
    const replaceNodeLink = async (nodeLink: HTMLElement, n: ExplorerNode, createLabel?: string) => {
      const oldId = nodeLink.dataset.nodeLink!;
      let newId = n.id;
      if (createLabel) { const c = await apiCreateNode(ctx.gId, null, lang, createLabel); if (!c) return; newId = c.id; }
      newId = await ctx.awaitRealId(newId); // never persist a temp id
      if (newId === oldId) return;
      const label = createLabel ?? labelOf(n, lang);
      nodeLink.dataset.nodeLink = newId;
      (nodeLink.firstChild as HTMLElement).textContent = label;
      save(true);
      await apiAddRay(ctx.gId, relation.lineId, newId);
      const ar = ctx.activeRelation;
      const usesOld = Array.from(content.children).some((c) => (c as HTMLElement).dataset.nodeLink === oldId);
      if (!usesOld) await apiRemoveRay(ctx.gId, relation.lineId, oldId);
      if (ar && ar.lineId === relation.lineId) {
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
      // フォーカスした行を選択アンカーにし、複数選択はリセット（Shift+↑↓ でここから伸ばす）。
      ta.addEventListener('focus', () => {
        setActive(relation);
        selAnchor = relation.lineId; selCursor = null; updateSelHighlight();
        if (!crossing) clearGroupSel(); // またぎ中のプログラム focus では選択を保つ
        autosize(ta);
      });
      // 同じ ta 内をクリックしてキャレットを置き直す時は focus が再発火しないので、mousedown で解除。
      ta.addEventListener('mousedown', () => { if (!crossing) clearGroupSel(); });
      ta.addEventListener('input', () => { clearGroupSel(); autosize(ta); void handleMention(ta); save(); });
      // 他の場所を選んで textarea からフォーカスが外れたら、@ドロップダウンは閉じる。
      // （項目は mousedown+preventDefault でフォーカスを奪わないので、項目選択では blur しない。
      //   確定時は onPick が先に closeMenu→mention=null するため、ガードで二重閉じも防ぐ。）
      ta.addEventListener('blur', () => { save(true); autosize(ta); if (mention?.anchor === ta) closeMenu(); if (!crossing) clearGroupSel(); });
      ta.addEventListener('keydown', (e) => {
        // @ メニューが開いている間は ↑↓/Enter で候補選択。
        if (menuOpen) {
          if (e.key === 'ArrowDown') { e.preventDefault(); navMove(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); navMove(-1); return; }
          if (e.key === 'Enter') { e.preventDefault(); navPick(); return; }
          if (e.key === 'Escape') { closeMenu(); return; }
        }
        // チップまたぎ選択中に、選択操作(Shift+←→)・@・Shift 以外のキーが来たら選択解除（キー処理は続行）。
        if (groupSel && e.key !== '@' && e.key !== 'Shift'
            && !((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey)) {
          clearGroupSel();
        }
        if (e.key === 'Escape') { closeMenu(); clearSelection(); return; }
        // Ctrl/Cmd+Shift+Backspace で関係(行)そのものを削除。複数選択中は選択行すべて。
        if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
          e.preventDefault();
          const sel = selectedRelationIds();
          deleteRelationsOptimistic(sel.length > 1 ? sel : [relation.lineId]);
          return;
        }
        // Shift+Alt+↑↓: 選択(または現在行)を並び替え。Shift+↑↓: 選択範囲を伸縮。
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (e.altKey) void moveSelectedRelations(e.key === 'ArrowDown' ? 'down' : 'up');
          else extendSelection(e.key === 'ArrowDown' ? 'down' : 'up');
          return;
        }
        // Shift+→: 右向きに伸ばす（左向き選択中なら縮める）。ta 右端に達したら隣のチップを選択に含め、
        // その先の ta 先頭へフォーカスを移す。ta 内で伸縮の余地があれば native に委ねる。
        if (e.key === 'ArrowRight' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
          if (ta.selectionDirection === 'backward' && ta.selectionStart !== ta.selectionEnd) return; // 左向き選択を native で縮める
          if (ta.selectionEnd !== ta.value.length) return; // ta 内でまだ右へ伸びる → native
          const chip = ta.nextElementSibling as HTMLElement | null;
          const nextTa = chip?.nextElementSibling as HTMLTextAreaElement | null;
          if (!chip?.dataset.nodeLink || !nextTa) return;
          e.preventDefault();
          if (!groupSel) groupSel = { startTa: ta, startOff: ta.selectionStart, focusTa: ta };
          groupSel.focusTa = nextTa;
          crossing = true; nextTa.focus(); nextTa.setSelectionRange(0, 0); crossing = false;
          if (groupSel.focusTa === groupSel.startTa) clearGroupSel(); else paintGroupSel();
          return;
        }
        // Shift+←: 左向きに伸ばす（右向き選択中なら縮める）。ta 左端に達したら直前のチップを選択に含め、
        // その手前の ta 末尾へフォーカスを移す。
        if (e.key === 'ArrowLeft' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
          if (ta.selectionDirection === 'forward' && ta.selectionStart !== ta.selectionEnd) return; // 右向き選択を native で縮める
          if (ta.selectionStart !== 0) return; // ta 内でまだ左へ伸びる → native
          const chip = ta.previousElementSibling as HTMLElement | null;
          const prevTa = chip?.previousElementSibling as HTMLTextAreaElement | null;
          if (!chip?.dataset.nodeLink || !prevTa) return;
          e.preventDefault();
          if (!groupSel) groupSel = { startTa: ta, startOff: ta.selectionEnd, focusTa: ta };
          groupSel.focusTa = prevTa;
          crossing = true; prevTa.focus(); prevTa.setSelectionRange(prevTa.value.length, prevTa.value.length); crossing = false;
          if (groupSel.focusTa === groupSel.startTa) clearGroupSel(); else paintGroupSel();
          return;
        }
        // ↑↓（修飾なし）: 上下の行へフォーカス移動。複数選択は解除。
        // 最下行で↓ → 移動先が無いので、現在行の行末へキャレットを送る（⑥）。
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          clearSelection();
          const dir = e.key === 'ArrowDown' ? 'down' : 'up';
          if (!focusAdjacentRow(ta, dir) && dir === 'down') focusRowEnd(ta);
          return;
        }
        // チップまたぎ選択中に @ → start 〜 現在キャレットを親チップ1つに畳む（グループ化）。
        if (e.key === '@' && groupSel && groupSel.focusTa !== groupSel.startTa) {
          e.preventDefault();
          const snap = {
            startTa: groupSel.startTa, startOff: groupSel.startOff,
            focusTa: ta, focusStart: ta.selectionStart, focusEnd: ta.selectionEnd,
          };
          openSearchPopover(ta, (nn, cl) => void collapseToParent(snap, nn, cl), undefined, '親ノードを検索 / 新規作成…');
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
        // この行の直後へ楽観挿入（全再描画しない＝点滅しない）。
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void insertRelationAfter(row);
          return;
        }
        const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
        const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
        // 連続caret: 端で←→を押すと隣のテキスト片へ（チップを跨ぐ）。行内に隣が無ければ（＝文頭/文末）
        // 上下の行のテキスト末尾/文頭へ送る（⑥）。
        if (e.key === 'ArrowLeft' && atStart) {
          const nodeLink = ta.previousElementSibling as HTMLElement | null;
          const prevTa = nodeLink?.previousElementSibling as HTMLTextAreaElement | null;
          if (nodeLink?.dataset.nodeLink && prevTa) { e.preventDefault(); prevTa.focus(); prevTa.setSelectionRange(prevTa.value.length, prevTa.value.length); }
          else if (!ta.previousElementSibling) { if (focusRowEdge(ta, 'up')) e.preventDefault(); }
          return;
        }
        if (e.key === 'ArrowRight' && atEnd) {
          const nodeLink = ta.nextElementSibling as HTMLElement | null;
          const nextTa = nodeLink?.nextElementSibling as HTMLTextAreaElement | null;
          if (nodeLink?.dataset.nodeLink && nextTa) { e.preventDefault(); nextTa.focus(); nextTa.setSelectionRange(0, 0); }
          else if (!ta.nextElementSibling) { if (focusRowEdge(ta, 'down')) e.preventDefault(); }
          return;
        }
        // Backspace（先頭）で直前チップ削除、Delete（末尾）で直後チップ削除。
        if (e.key === 'Backspace' && atStart) {
          const prev = ta.previousElementSibling as HTMLElement | null;
          if (prev?.dataset.nodeLink) { e.preventDefault(); removeNodeLink(prev); return; }
          // 先頭の空ガター片にいて、関係全体が空（チップも本文も無い）なら、関係そのものを削除。
          // 全行が先頭に空ガター片を持つので、テキストのみの行を巻き込んで消さないよう全体の空を確認する。
          const allEmpty = Array.from(content.children).every(
            (c) => !(c as HTMLElement).dataset.nodeLink && (c as HTMLTextAreaElement).value === '',
          );
          if (!prev && allEmpty) {
            e.preventDefault();
            deleteRelationOptimistic(relation.lineId);
            return;
          }
        }
        if (e.key === 'Delete' && atEnd) {
          const next = ta.nextElementSibling as HTMLElement | null;
          if (next?.dataset.nodeLink) { e.preventDefault(); removeNodeLink(next); }
        }
      });
      setTimeout(() => autosize(ta), 0);
      return ta;
    };

    const removeNodeLink = (nodeLink: HTMLElement) => {
      const id = nodeLink.dataset.nodeLink!;
      const prev = nodeLink.previousElementSibling as HTMLTextAreaElement | null;
      const next = nodeLink.nextElementSibling as HTMLTextAreaElement | null;
      // 前後のテキスト片を結合してチップを除去。
      if (prev && next) {
        const caret = prev.value.length;
        prev.value = prev.value + next.value;
        next.remove();
        autosize(prev);
        prev.focus();
        prev.setSelectionRange(caret, caret);
      }
      nodeLink.remove();
      save(true);
      // 同じ id のチップが他に無ければ参加も解除。
      const stillUsed = Array.from(content.children).some((c) => (c as HTMLElement).dataset.nodeLink === id);
      if (!stillUsed) {
        void apiRemoveRay(ctx.gId, relation.lineId, id);
        const ar = ctx.activeRelation;
        if (ar && ar.lineId === relation.lineId) { ar.participants.delete(id); ctx.setActiveRelation(ar); }
      }
    };

    // 範囲選択+@ のグループ化: 選択範囲（テキスト＋複数チップ）を親チップ1つに畳み、範囲内のリンク
    // ノードを親の子に登録する（加算・多重所属＝既存の親からは外さない）。snap は @ を押した時点の
    // セグメント範囲スナップショット（以降 content を作り直すので index を確定させておく）。
    const collapseToParent = async (
      snap: { startTa: HTMLTextAreaElement; startOff: number; focusTa: HTMLTextAreaElement; focusStart: number; focusEnd: number },
      n: ExplorerNode, createLabel?: string,
    ) => {
      let parentId = n.id;
      if (createLabel) { const c = await apiCreateNode(ctx.gId, null, lang, createLabel); if (!c) return; parentId = c.id; }
      parentId = await ctx.awaitRealId(parentId); // never persist a temp id
      const label = createLabel ?? labelOf(n, lang);
      labelById.set(parentId, label); // so the rebuilt parent chip shows its label, not the raw id

      const kids = segChildren();
      const sIdx = kids.indexOf(snap.startTa);
      const fIdx = kids.indexOf(snap.focusTa);
      if (sIdx < 0 || fIdx < 0 || sIdx === fIdx) { clearGroupSel(); return; } // 構造が変わっていたら中止
      const tokenStr = (el: HTMLElement): string =>
        el.dataset.nodeLink ? `⟦${el.dataset.nodeLink}⟧` : (el as HTMLTextAreaElement).value;
      // 左右の境界を DOM 順で決める。右向き(start が左)=start[0..startOff] を左に残し focus[focusEnd..] を
      // 右に残す。左向き(focus が左)=focus[0..focusStart] を左、start[startOff..] を右に残す。中間は畳む。
      const rightward = sIdx < fIdx;
      const lo = Math.min(sIdx, fIdx), hi = Math.max(sIdx, fIdx);
      const leftTa = rightward ? snap.startTa : snap.focusTa;
      const leftOff = rightward ? snap.startOff : snap.focusStart;
      const rightTa = rightward ? snap.focusTa : snap.startTa;
      const rightOff = rightward ? snap.focusEnd : snap.startOff;
      let left = '';
      for (let i = 0; i < lo; i++) left += tokenStr(kids[i]);
      left += leftTa.value.slice(0, leftOff);
      let right = rightTa.value.slice(rightOff);
      for (let i = hi + 1; i < kids.length; i++) right += tokenStr(kids[i]);
      const memberIds = [...new Set(kids.slice(lo + 1, hi)
        .filter((c) => c.dataset.nodeLink).map((c) => c.dataset.nodeLink!))].filter((id) => id !== parentId);

      const newBody = `${left}⟦${parentId}⟧${right}`;
      clearGroupSel();
      content.innerHTML = '';
      for (const tok of splitTokens(newBody)) {
        content.appendChild(tok.t === 'txt' ? mkTextarea(tok.v) : mkNodeLink(tok.id));
      }
      for (const c of segChildren()) if (c.tagName === 'TEXTAREA') autosize(c as HTMLTextAreaElement);
      const parentChip = segChildren().find((c) => c.dataset.nodeLink === parentId);
      const afterTa = parentChip?.nextElementSibling as HTMLTextAreaElement | null;
      if (afterTa) { afterTa.focus(); afterTa.setSelectionRange(0, 0); }
      save(true);

      // 参加者(ray): 親を追加、body に残らないメンバーは外す。
      await apiAddRay(ctx.gId, relation.lineId, parentId);
      const ar = ctx.activeRelation;
      if (ar && ar.lineId === relation.lineId) ar.participants.add(parentId);
      const bodyNow = rebuild();
      for (const mid of memberIds) {
        if (!bodyNow.includes(`⟦${mid}⟧`)) {
          await apiRemoveRay(ctx.gId, relation.lineId, mid);
          if (ar && ar.lineId === relation.lineId) ar.participants.delete(mid);
        }
      }
      if (ar && ar.lineId === relation.lineId) ctx.setActiveRelation(ar);

      // グループ登録: メンバーを親の子にする（加算・向き付け）。新規親はルート直下へ。
      for (const mid of memberIds) {
        await apiLinkNode(ctx.gId, mid, parentId);
        await apiOrient(ctx.gId, mid, parentId);
      }
      if (createLabel) await linkToRoot(parentId);
      showToast(`${memberIds.length}件を「${label}」の子にまとめました`);
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
          // Never persist a temp id (e.g. linking to a node still mid-create in another pane).
          nodeId = await ctx.awaitRealId(nodeId);
          const label = createLabel ?? labelOf(n, lang);
          ta.value = leftStr;
          autosize(ta);
          const nodeLink = mkNodeLink(nodeId, label);
          const newTa = mkTextarea(rightStr);
          content.insertBefore(nodeLink, ta.nextSibling);
          content.insertBefore(newTa, nodeLink.nextSibling);
          closeMenu();
          newTa.focus();
          newTa.setSelectionRange(0, 0);
          save(true);
          await apiAddRay(ctx.gId, relation.lineId, nodeId);
          const ar = ctx.activeRelation;
          if (ar && ar.lineId === relation.lineId) { ar.participants.add(nodeId); ctx.setActiveRelation(ar); }
          // 新規作成ノードは親を持たない＝リンクなしになるので、既定でルートノード直下に紐づける。
          if (createLabel) await linkToRoot(nodeId);
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
    const body = relation.body[lang] ?? relation.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    for (const tok of splitTokens(body)) {
      if (tok.t === 'txt') content.appendChild(mkTextarea(tok.v));
      else content.appendChild(mkNodeLink(tok.id));
    }
    return row;
  };

  // 新しい関係行を anchorRow の直後に「楽観的に」挿入する（全再描画しない＝画面が点滅しない・①）。
  // 本文にノードリンク(チップ)が無ければ末尾にこのノードの ⟦id⟧ を付けて当該ノードに紐づける。
  // 後で手動でその末尾チップを外せばチップ0になり ⑤ で「リンクなし」へ移る。並び順は保存する。
  const insertRelationAfter = async (anchorRow: HTMLElement, extraText = ''): Promise<void> => {
    if (!currentNodeId) return;
    // The subject may still be a freshly-created node whose real id hasn't landed — never persist a
    // ⟦temp-N⟧ chip / temp participant (it can never resolve to a real node). Wait for the real id.
    const nid = await ctx.awaitRealId(currentNodeId);
    if (!nid) return;
    const newBody = hasNodeLink(extraText) ? extraText : `${extraText}⟦${nid}⟧`;
    const created = await apiCreateRelation(ctx.gId, nid, lang, newBody);
    if (!created) return;
    const subjLabel = currentPath?.[currentPath.length - 1]?.label ?? '';
    const subj: ExplorerNode = { id: nid, ...(lang === 'ja' ? { ja: subjLabel } : { en: subjLabel }) };
    const newRow = renderRelationRow({ lineId: created.lineId, body: { [lang]: newBody }, participants: [subj] });
    anchorRow.insertAdjacentElement('afterend', newRow);
    // キャレットは末尾チップの手前＝先頭テキスト片の末尾へ。続けて本文を書ける。
    const firstTa = newRow.querySelector('textarea') as HTMLTextAreaElement | null;
    if (firstTa) { firstTa.focus(); firstTa.setSelectionRange(firstTa.value.length, firstTa.value.length); }
    await apiReorderNodeRelations(ctx.gId, nid, relationRows().map((r) => r.dataset.lineId!));
  };

  // ノードパネルの draft 行と同じ構成（spacer+四角+入力）。テキストを書いて Enter で作成。
  const makeDraftRow = (nodeId: string): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:flex-start;padding:2px 0;`;
    const spacer = document.createElement('span'); spacer.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span'); bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;height:21px;cursor:pointer;`;
    const relationBox = document.createElement('span'); relationBox.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(relationBox);
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px;overflow:hidden;min-width:0;color:${TEXT_DIM};`;
    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    // ドラフト行でも @ メンションを使えるようにする。素の1行 textarea なのでチップは差し込めないため、
    // 候補を選んだ時点で「本文に ⟦id⟧ を埋めた関係」を作成して本物の関係行へ切り替える。新規作成なら
    // 続けて親ノードを選べる（関係行と同じフロー）。入力中はライブで候補を絞り込む（変換は選択時のみ）。
    const draftMention = async () => {
      const caret = ta.selectionStart ?? ta.value.length;
      const mm = ta.value.slice(0, caret).match(/@([^\s@]*)$/);
      if (!mm) { if (mention?.anchor === ta) closeMenu(); return; }
      const query = mm[1];
      const atIdx = caret - mm[0].length;
      const leftStr = ta.value.slice(0, atIdx);
      const rightStr = ta.value.slice(caret);
      mention = {
        anchor: ta,
        onPick: async (n, createLabel) => {
          let mentionId = n.id;
          if (createLabel) { const c = await apiCreateNode(ctx.gId, null, lang, createLabel); if (!c) { closeMenu(); return; } mentionId = c.id; }
          mentionId = await ctx.awaitRealId(mentionId);   // never persist a temp id
          const subjId = await ctx.awaitRealId(nodeId);   // subject may itself be a freshly-created node
          closeMenu();
          ta.value = ''; ta.style.color = TEXT_DIM;
          const rel = await apiCreateRelation(ctx.gId, subjId, lang, `${leftStr}⟦${mentionId}⟧${rightStr}`);
          if (!rel) return;
          // Attach the mentioned node as a participant (and root-link a newly-created one) BEFORE
          // re-rendering: render() re-fetches the relation, and the chip's label is resolved from the
          // participant list. Rendering first showed the raw id (UUID) until a reload re-fetched it.
          await apiAddRay(ctx.gId, rel.lineId, mentionId);
          if (createLabel) await linkToRoot(mentionId);
          await render();
          const rrow = bodyEl.querySelector(`[data-line-id="${CSS.escape(rel.lineId)}"]`);
          const nodeLink = rrow?.querySelector(`[data-node-link="${CSS.escape(mentionId)}"]`) as HTMLElement | null;
          ((nodeLink?.nextElementSibling as HTMLTextAreaElement | null) ?? (rrow?.querySelector('textarea') as HTMLTextAreaElement | null))?.focus();
        },
      };
      const seq = ++mentionSeq;
      const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, query || undefined);
      if (seq !== mentionSeq || mention?.anchor !== ta) return;
      showMenu(ta, query, nodes);
    };
    ta.addEventListener('focus', () => { ta.style.color = TEXT_HIGH; clearSelection(); });
    ta.addEventListener('blur', () => { if (!ta.value.trim()) ta.style.color = TEXT_DIM; if (mention?.anchor === ta) closeMenu(); });
    ta.addEventListener('input', () => { resize(); void draftMention(); });
    ta.addEventListener('keydown', async (e) => {
      // @ メニューが開いている間は ↑↓/Enter で候補選択、Esc で閉じる。
      if (menuOpen) {
        if (e.key === 'ArrowDown') { e.preventDefault(); navMove(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); navMove(-1); return; }
        if (e.key === 'Enter') { e.preventDefault(); navPick(); return; }
        if (e.key === 'Escape') { closeMenu(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        ta.value = ''; resize();
        // ドラフト直後へ楽観挿入（点滅しない）。本文にノードリンクが無ければ末尾に ⟦node⟧ を付けて
        // 当該ノードに紐づける（後で手動で外せば ⑤ でリンクなしへ）。
        await insertRelationAfter(row, text);
        return;
      }
      // ↑↓（修飾なし）: 下の関係行 / 上の行へフォーカス移動。
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        focusAdjacentRow(ta, e.key === 'ArrowDown' ? 'down' : 'up');
      }
    });
    bw.addEventListener('mousedown', (e) => e.preventDefault());
    bw.addEventListener('click', () => ta.focus());
    row.append(spacer, bw, ta);
    return row;
  };

  // 関係が検索クエリに一致するか。本文（⟦id⟧チップは参加者ラベルに解決）＋参加者ラベルを対象に部分一致。
  const relationMatchesQuery = (r: ExplorerRelation, q: string): boolean => {
    if (!q) return true;
    const byId = new Map(r.participants.map((p) => [p.id, p]));
    const body = r.body[lang] || r.body.ja || r.body.en || '';
    const text =
      splitTokens(body).map((tok) => (tok.t === 'txt' ? tok.v : labelOf(byId.get(tok.id) ?? { id: tok.id }, lang))).join('') +
      ' ' + r.participants.map((p) => labelOf(p, lang)).join(' ');
    return text.toLowerCase().includes(q);
  };

  // 本体（関係行）だけを描画。検索クエリ変更時は再取得せずこれだけ呼ぶ（head は作り直さない＝入力が保持される）。
  const renderBody = (): void => {
    bodyEl.innerHTML = '';
    relationBoxByRelation.clear();
    selAnchor = null; selCursor = null; // 行を作り直すので複数選択はリセット。
    const q = filterQuery.trim().toLowerCase();
    if (!orphanMode && currentDraftNodeId && !q) bodyEl.appendChild(makeDraftRow(currentDraftNodeId)); // 検索中は追加ドラフト行を隠す
    for (const relation of currentRelations) {
      if (!relationMatchesQuery(relation, q)) continue;
      bodyEl.appendChild(renderRelationRow(relation));
    }
    updateActiveHighlight();
  };

  // ── 列全体の描画 ─────────────────────────────────────────────────────────────
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    head.innerHTML = '';
    bodyEl.innerHTML = '';
    relationBoxByRelation.clear();
    selAnchor = null; selCursor = null; // 行を作り直すので複数選択はリセット。
    filterQuery = ''; // ノード切替/再読込では検索状態をリセット（新しい関係一覧を全件表示）。

    // ── 0行目: 検索（ノードパネルの検索行と同形・最上部・プレースホルダ文言なし＝虫眼鏡のみ） ──
    const searchRow = document.createElement('div');
    searchRow.style.cssText = `display:flex;align-items:center;gap:4px;height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};`;
    const searchIconWrap = document.createElement('span');
    searchIconWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;color:${TEXT_DIM};`;
    // Inline SVG magnifier（ノードパネルと同じ）: color-emoji 非搭載環境で🔍が豆腐化するのを避ける。
    searchIconWrap.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line></svg>';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.style.cssText = `flex:1;background:transparent;border:none;outline:none;font-size:13px;font-family:inherit;line-height:1.5;color:${TEXT_HIGH};padding:0 4px;min-height:20px;`;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    const applyFilter = (v: string) => { filterQuery = v; renderBody(); };
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyFilter(searchInput.value), 200);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); searchInput.value = ''; if (searchTimer) clearTimeout(searchTimer); applyFilter(''); searchInput.blur(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (searchTimer) clearTimeout(searchTimer); applyFilter(searchInput.value); }
    });
    searchRow.append(searchIconWrap, searchInput);
    // 並び替え用グリップ（panels-view から渡される）を最上部行の左端に。head は render 毎に作り直される
    // ので、同じ要素をここで毎回先頭へ差し込む（リスナは要素に付いているので保持される）。
    if (opts.leadingHeadEl) searchRow.insertBefore(opts.leadingHeadEl, searchRow.firstChild);
    head.appendChild(searchRow);

    // ── 1行目: 操作（リンクなし + ⟳ + 言語切替） ── ノードペインヘッダと同じ 28px+下線。
    // 並び: 左=リンクなし、右寄せで ⟳・JA/EN（ノードパネルと同様に言語切替を右端へ）。
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = `display:flex;align-items:center;gap:4px;height:28px;box-sizing:border-box;padding:0 6px;border-bottom:1px solid ${BORDER};`;
    // 「リンクなし」トグル: 参加ノードを持たない関係の一覧（移行・編集中の受け皿）。左端。
    const orphanBtn = document.createElement('button');
    orphanBtn.textContent = 'リンクなし';
    orphanBtn.title = '参加ノードを持たない関係（リンクなし）を表示';
    orphanBtn.style.cssText = `flex-shrink:0;background:${orphanMode ? SELECT_STRONG : 'transparent'};border:1px solid ${BORDER};color:${orphanMode ? '#fff' : TEXT_MID};cursor:pointer;font-size:10px;padding:1px 6px;border-radius:3px;`;
    orphanBtn.addEventListener('click', () => { orphanMode = !orphanMode; void render(); });
    ctrlRow.appendChild(orphanBtn);
    // パネル内更新ボタン（ノードパネルの ⟳ と同じ）。関係一覧を再取得する。右寄せの先頭。
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = '関係を再読み込み';
    reloadBtn.style.cssText = `margin-left:auto;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;`;
    reloadBtn.addEventListener('click', () => { reloadBtn.style.color = TEXT_HIGH; void render().finally(() => { reloadBtn.style.color = TEXT_DIM; }); });
    ctrlRow.appendChild(reloadBtn);
    // 言語切替（ノードパネルのパネル別 JA/EN と同じ）。右端。
    const langBtn = document.createElement('button');
    langBtn.textContent = lang.toUpperCase();
    langBtn.title = lang === 'ja' ? 'この関係パネルの言語: 日本語（クリックでEN）' : 'この関係パネルの言語: 英語（クリックでJA）';
    langBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;flex-shrink:0;line-height:1.4;`;
    langBtn.addEventListener('click', () => { lang = lang === 'ja' ? 'en' : 'ja'; void render(); });
    ctrlRow.appendChild(langBtn);
    // ② 右クリックで開いた追加パネルには閉じるボタンを付ける（固定 dock には付かない）。右端。
    if (opts.onClose) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.title = 'この関係パネルを閉じる';
      closeBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;`;
      closeBtn.addEventListener('click', () => opts.onClose!());
      ctrlRow.appendChild(closeBtn);
    }
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
      const relations = await fetchOrphanRelations(ctx.gId);
      if (token !== renderToken) return;
      currentRelations = relations; currentDraftNodeId = null;
      renderBody();
      return;
    }

    if (!currentNodeId) { currentRelations = []; currentDraftNodeId = null; renderBody(); return; }
    const nodeId = currentNodeId;
    const relations = await fetchNodeRelations(ctx.gId, nodeId);
    if (token !== renderToken) return;
    currentRelations = relations; currentDraftNodeId = nodeId; // 追加ドラフト行はこのノード宛て
    renderBody();
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
      await apiSetRelationText(ctx.gId, created.lineId, lang, `${xLabel}⟦${y}⟧`);
      await apiDeleteNode(ctx.gId, node.id);
      return true;
    }
    const created = await apiCreateRelation(ctx.gId, node.id, lang, '');
    if (created) await apiSetRelationText(ctx.gId, created.lineId, lang, `⟦${node.id}⟧`);
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
    if (!ctx.nodePanelDrag) return;          // ノードパネル発のノードドラッグのみ受ける
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    bodyEl.style.boxShadow = `inset 0 0 0 2px ${SELECT_STRONG}`;
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) bodyEl.style.boxShadow = '';
  });
  el.addEventListener('drop', (e) => {
    if (!ctx.nodePanelDrag) return;
    e.preventDefault();
    bodyEl.style.boxShadow = '';
    const pd = ctx.nodePanelDrag;
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

  const noPath: PanelPathEntry[] = [];
  return {
    el,
    head,
    load: () => render(),
    refresh: () => { void render(); },
    search: async () => { /* top-bar 検索は関係列には作用しない */ },
    setParent: async (nodeId, _excl, path) => {
      // ノードを選んだら「リンクなし」表示は解除し、他と同様にそのノードの関係を出す。
      if (nodeId !== null) orphanMode = false;
      currentNodeId = nodeId; currentPath = path ?? null; await render();
    },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getSourceNodeId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { currentNodeId = null; currentPath = null; await render(); },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* 関係列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { ctx.refreshRelations.delete(refresh); menu.remove(); },
  };
}
