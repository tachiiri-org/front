// ビューの絞り込みを画面から組み立てる。
//
// 式は Notion と同じ形（プロパティ ID を鍵に {型:{演算:値}}）で作る。同じ形で持って
// おけば、取り込み直しても壊れないし、MCP から触ったものと行き来できる。
// 取り込んでいない型（formula / rollup / people / files）は選ばせない。
// 選べてしまうと、効かない条件を作れることになる。

import type { PropertyDef } from './api';
import { el } from './style';

/** 型ごとに選べる演算。ここに無いものは評価できないので出さない。 */
const OPS: Record<string, Array<[string, string]>> = {
  text: [['contains', 'を含む'], ['does_not_contain', 'を含まない'], ['equals', 'と等しい'],
    ['does_not_equal', 'と等しくない'], ['starts_with', 'で始まる'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
  number: [['equals', '='], ['does_not_equal', '≠'], ['greater_than', '>'], ['less_than', '<'],
    ['greater_than_or_equal_to', '≥'], ['less_than_or_equal_to', '≤'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
  select: [['equals', 'が'], ['does_not_equal', 'が以外'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
  multi_select: [['contains', 'を含む'], ['does_not_contain', 'を含まない'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
  checkbox: [['equals', 'が']],
  date: [['after', 'より後'], ['before', 'より前'], ['on_or_after', '以降'], ['on_or_before', '以前'],
    ['past_week', '過去1週間'], ['past_month', '過去1か月'], ['this_week', '今週'],
    ['next_week', '来週'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
  relation: [['contains', 'を含む'], ['does_not_contain', 'を含まない'], ['is_empty', 'が空'], ['is_not_empty', 'が空でない']],
};

/** 値を取らない演算。相対日付と空判定。 */
const NO_VALUE = new Set(['is_empty', 'is_not_empty', 'past_week', 'past_month', 'past_year',
  'this_week', 'next_week', 'next_month', 'next_year']);

export function openFilterEditor(opts: {
  anchor: HTMLElement;
  properties: PropertyDef[];
  current: Record<string, Record<string, unknown>>;
  onSave: (quickFilters: Record<string, unknown> | null) => void;
}): void {
  const usable = opts.properties.filter((p) => p.notionId && OPS[p.type]);
  const overlay = el('div', { class: 's-overlay' });
  const pop = el('div', { class: 's-pop s-filter' });
  const r = opts.anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${Math.min(r.left, window.innerWidth - 360)}px`;
  pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 340)}px`;
  const close = (): void => { overlay.remove(); pop.remove(); };
  overlay.addEventListener('click', close);

  const draft: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(opts.current ?? {}));

  const list = el('div', { class: 's-filter-list' });
  const paint = (): void => {
    list.innerHTML = '';
    const keys = Object.keys(draft);
    if (!keys.length) list.append(el('div', { class: 's-note', text: '条件はありません' }));
    for (const notionId of keys) {
      const p = usable.find((x) => x.notionId === notionId);
      const cond = draft[notionId];
      const kind = Object.keys(cond)[0] ?? '';
      const body = (cond[kind] ?? {}) as Record<string, unknown>;
      const [op, val] = Object.entries(body)[0] ?? ['', ''];
      const row = el('div', { class: 's-filter-row' });
      const label = OPS[p?.type ?? 'text']?.find(([o]) => o === op)?.[1] ?? op;
      row.append(el('span', {
        class: 's-filter-tx',
        text: `${p?.name ?? notionId} ${label}${NO_VALUE.has(op) ? '' : ` ${String(val)}`}`,
      }));
      const del = el('button', { class: 's-filter-del', text: '×', title: '外す' });
      del.addEventListener('click', () => { delete draft[notionId]; paint(); });
      row.append(del);
      list.append(row);
    }
  };
  paint();

  // 追加。列 → 演算 → 値 の順に決める。
  const add = el('div', { class: 's-filter-add' });
  const col = el('select', { class: 's-filter-sel' }) as HTMLSelectElement;
  col.append(el('option', { value: '', text: '列を選ぶ' }));
  for (const p of usable) col.append(el('option', { value: p.notionId ?? '', text: p.name }));
  const opSel = el('select', { class: 's-filter-sel' }) as HTMLSelectElement;
  const valInput = el('input', { class: 's-search s-filter-val', placeholder: '値' }) as HTMLInputElement;
  const refreshOps = (): void => {
    const p = usable.find((x) => x.notionId === col.value);
    opSel.innerHTML = '';
    for (const [o, label] of OPS[p?.type ?? 'text'] ?? []) opSel.append(el('option', { value: o, text: label }));
    valInput.style.display = NO_VALUE.has(opSel.value) ? 'none' : '';
  };
  col.addEventListener('change', refreshOps);
  opSel.addEventListener('change', () => { valInput.style.display = NO_VALUE.has(opSel.value) ? 'none' : ''; });
  refreshOps();

  const addBtn = el('button', { class: 's-btn', text: '条件を足す' });
  addBtn.addEventListener('click', () => {
    const p = usable.find((x) => x.notionId === col.value);
    if (!p?.notionId) return;
    const op = opSel.value;
    // 型の名前は Notion の式の鍵になる。checkbox は真偽、それ以外は入力そのまま。
    const kind = p.type === 'select' ? 'select' : p.type;
    const value = NO_VALUE.has(op)
      ? (op.startsWith('is_') ? true : true)
      : p.type === 'number' ? Number(valInput.value)
      : p.type === 'checkbox' ? valInput.value === 'true' || valInput.value === '1'
      : valInput.value;
    draft[p.notionId] = { [kind]: { [op]: value } };
    valInput.value = '';
    paint();
  });
  add.append(col, opSel, valInput, addBtn);

  const foot = el('div', { class: 's-filter-foot' });
  const save = el('button', { class: 's-btn s-filter-save', text: '適用' });
  save.addEventListener('click', () => {
    opts.onSave(Object.keys(draft).length ? draft : null);
    close();
  });
  const cancel = el('button', { class: 's-btn', text: 'やめる' });
  cancel.addEventListener('click', close);
  foot.append(save, cancel);

  pop.append(el('div', { class: 's-filter-head', text: 'このビューの絞り込み' }), list, add, foot);
  document.body.append(overlay, pop);
}
