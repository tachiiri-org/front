// 値の入力そのもの。表の中でもエディタの中でも同じものを使う。
//
// 型ごとに置き場所が違うが（p_cell_* / j_choice / j_reference）、画面から見れば
// 「その列の型に合う入れ物」でしかない。二か所に書くと片方だけ直す事故が起きる。

import * as api from './api';
import type { OptionDef, PropertyDef } from './api';
import { el } from './style';

export interface CellInputs {
  /** 1つの値の入力要素。保存は変更のたびに行う（決定を押させない）。 */
  cellInput: (blockId: string, prop: PropertyDef, raw: unknown) => HTMLElement;
}

export function createCellInputs(opts: {
  onError: (message: string) => void;
  /** リレーションのリンクを押したとき。 */
  onOpenPage: (blockId: string) => void;
  /** 値を直したあと。表の見出しや一覧を引き直すために使う。 */
  onChanged?: () => void;
}): CellInputs {
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) {
      opts.onError(e instanceof Error ? e.message : String(e));
    }
  };

/** 選択肢を選ぶポップオーバー。multi_select は複数、select は1つ。 */
const openOptionPicker = (
  anchor: HTMLElement,
  prop: PropertyDef,
  selectedIds: string[],
  onDone: (picked: OptionDef[]) => void,
): void => {
  const options = prop.options ?? [];
  if (!options.length) {
    opts.onError('この列にはまだ選択肢がありません（Notion 側で使われている値が選択肢になります）');
    return;
  }
  const overlay = el('div', { class: 's-overlay' });
  const pop = el('div', { class: 's-pop' });
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 260)}px`;
  pop.style.maxHeight = '240px';
  pop.style.overflowY = 'auto';

  const chosen = new Set(selectedIds);
  const close = (): void => { overlay.remove(); pop.remove(); };
  // 選んだ時点で保存する。「決定」を押さずに閉じると消える作りだと、
  // 選んだのに保存されていないことに気づけない。
  const apply = (): void => onDone(options.filter((o) => chosen.has(o.id)));
  for (const o of options) {
    const item = el('button', { class: 's-pop-item s-opt' });
    const mark = el('span', { class: 's-opt-mark', text: chosen.has(o.id) ? '✓' : '' });
    item.append(mark, el('span', { class: 's-chip', text: o.name }));
    item.addEventListener('click', () => {
      if (prop.type === 'select') { chosen.clear(); chosen.add(o.id); apply(); close(); return; }
      if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
      mark.textContent = chosen.has(o.id) ? '✓' : '';
      apply();
    });
    pop.append(item);
  }
  if (prop.type === 'multi_select') {
    const done = el('button', { class: 's-pop-item s-opt-done', text: '閉じる' });
    done.addEventListener('click', close);
    pop.append(done);
  }
  overlay.addEventListener('click', close);
  document.body.append(overlay, pop);
};

/**
 * リレーションの参照先を選ぶ。候補は「その列が実際に指しているデータベース」の行。
 * 指し先が未取り込みなら候補が出ないので、その旨を伝える。
 */
const openPagePicker = async (
  anchor: HTMLElement,
  propertyId: string,
  selectedIds: string[],
  onDone: (picked: Array<{ id: string; title: string }>) => void,
): Promise<void> => {
  let candidates: Array<{ id: string; title: string }> = [];
  try {
    candidates = (await api.relationCandidates(propertyId)).pages;
  } catch (e) {
    opts.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!candidates.length) {
    opts.onError('参照先の候補がありません。指し先のデータベースをまだ取り込んでいない可能性があります。');
    return;
  }
  const overlay = el('div', { class: 's-overlay' });
  const pop = el('div', { class: 's-pop' });
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 300)}px`;
  pop.style.maxHeight = '280px';
  pop.style.overflowY = 'auto';
  pop.style.minWidth = '240px';

  const chosen = new Set(selectedIds);
  const close = (): void => { overlay.remove(); pop.remove(); };
  const filter = el('input', { class: 's-search', placeholder: '絞り込み' }) as HTMLInputElement;
  pop.append(filter);
  const list = el('div');
  pop.append(list);
  const paint = (q: string): void => {
    list.innerHTML = '';
    for (const c of candidates.filter((x) => !q || (x.title || '').includes(q)).slice(0, 100)) {
      const item = el('button', { class: 's-pop-item s-opt' });
      const mark = el('span', { class: 's-opt-mark', text: chosen.has(c.id) ? '✓' : '' });
      item.append(mark, el('span', { text: c.title || '（無題）' }));
      item.addEventListener('click', () => {
        if (chosen.has(c.id)) chosen.delete(c.id); else chosen.add(c.id);
        mark.textContent = chosen.has(c.id) ? '✓' : '';
        onDone(candidates.filter((x) => chosen.has(x.id)));   // 選んだ時点で保存する
      });
      list.append(item);
    }
  };
  paint('');
  filter.addEventListener('input', () => paint(filter.value.trim()));
  const done = el('button', { class: 's-pop-item s-opt-done', text: '閉じる' });
  done.addEventListener('click', close);
  pop.append(done);
  overlay.addEventListener('click', close);
  document.body.append(overlay, pop);
};

const cellInput = (blockId: string, prop: PropertyDef, raw: unknown): HTMLElement => {
  const save = (value: unknown): void => {
    void guard(async () => {
      await api.setCell({ blockId, propertyId: prop.id, value });
    });
  };

  if (prop.type === 'checkbox') {
    const cb = el('input', { class: 's-cell-cb', type: 'checkbox' }) as HTMLInputElement;
    cb.checked = raw === true;
    cb.addEventListener('change', () => save(cb.checked));
    return cb;
  }

  if (prop.type === 'select' || prop.type === 'multi_select') {
    // Notion と同じく四角いチップで出す。クリックで選び直せる。
    const chosen = Array.isArray(raw) ? (raw as OptionDef[]) : [];
    const box = el('div', { class: 's-cell s-chips' });
    const paint = (list: OptionDef[]): void => {
      box.innerHTML = '';
      if (!list.length) { box.append(el('span', { class: 's-chip-empty', text: '—' })); return; }
      for (const c of list) {
        box.append(el('span', { class: 's-chip', text: c.name }));
      }
    };
    paint(chosen);
    box.addEventListener('click', () => {
      openOptionPicker(box, prop, chosen.map((c) => c.id), (picked) => {
        save(picked.map((o) => o.id));
        paint(picked);
      });
    });
    return box;
  }

  if (prop.type === 'relation') {
    // リンクを押せば相手のページを開く。余白を押せば参照先を選び直す。
    // 両方を1つのセルに載せるので、押した場所で分ける。
    const box = el('div', { class: 's-cell s-chips s-chips-scroll' });
    const paintRefs = (refs: Array<{ id: string; title: string }>): void => {
      box.innerHTML = '';
      if (!refs.length) {
        box.append(el('span', { class: 's-chip-empty', text: '＋' }));
      } else {
        for (const r of refs) {
          const link = el('a', { class: 's-ref', text: r.title || '（無題）', href: '#' });
          link.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            opts.onOpenPage(r.id);
          });
          box.append(link);
        }
      }
      const add = el('span', { class: 's-ref-add', text: '▾', title: '参照先を選ぶ' });
      box.append(add);
    };
    paintRefs(Array.isArray(raw) ? (raw as Array<{ id: string; title: string }>) : []);
    box.addEventListener('click', () => {
      const current = (Array.isArray(raw) ? (raw as Array<{ id: string }>) : []).map((r) => r.id);
      void openPagePicker(box, prop.id, current, (picked) => {
        save(picked.map((p) => p.id));
        paintRefs(picked);
      });
    });
    return box;
  }

  // URL が入っているテキストはリンクにする。取り込みログから元のページへ飛ぶため。
  if (prop.type === 'text' && typeof raw === 'string' && /^https?:\/\//.test(raw)) {
    const box = el('div', { class: 's-cell s-chips' });
    const a = el('a', { class: 's-ref', href: raw, target: '_blank', rel: 'noopener noreferrer' });
    a.textContent = raw.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40);
    box.append(a);
    return box;
  }

  const input = el('input', { class: 's-cell' }) as HTMLInputElement;
  if (prop.type === 'number') {
    input.type = 'number';
    input.value = raw == null ? '' : String(raw);
  } else if (prop.type === 'date') {
    input.type = 'date';
    // p_cell_date は epoch(ms)。<input type=date> は YYYY-MM-DD しか受けない。
    input.value = typeof raw === 'number' ? new Date(raw).toISOString().slice(0, 10) : '';
  } else {
    input.value = raw == null ? '' : String(raw);
  }
  input.addEventListener('change', () => save(input.value === '' ? null : input.value));
  return input;
};

  return { cellInput };
}
