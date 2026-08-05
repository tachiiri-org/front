// 中央ペイン: データベースのテーブルビュー。
//
// 列（プロパティ）はユーザーが実行時に定義でき、値は型ごとに列固定の p_cell_* に入る。
// 画面側は p_property_type を見て入力要素を選ぶだけで、EAV の型分岐は持たない。

import * as api from './api';
import type { DatabaseDetail, OptionDef, PropertyType } from './api';
import { el } from './style';

const TYPE_LABEL: Record<PropertyType, string> = {
  text: 'テキスト', number: '数値', date: '日付', checkbox: 'チェック',
  select: '選択', multi_select: '複数選択', relation: 'リレーション',
};

const TYPE_ORDER: PropertyType[] = ['text', 'number', 'date', 'checkbox', 'select', 'multi_select'];

export interface DatabaseView {
  el: HTMLElement;
  open: (databaseId: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function createDatabaseView(opts: {
  onError: (message: string) => void;
  onOpenPage: (blockId: string) => void;
  onChanged: () => void;
}): DatabaseView {

  let databaseId: string | null = null;
  let detail: DatabaseDetail | null = null;
  let dbTitle = '';

  const root = el('div', { class: 's-main' });
  const head = el('div', { class: 's-main-head' });
  const titleEl = el('div', { class: 's-title' });
  head.append(titleEl);
  const body = el('div', { class: 's-main-body' });
  root.append(head, body);

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) {
      opts.onError(e instanceof Error ? e.message : String(e));
    }
  };

  // 列追加のポップオーバー。名前と型を決めて j_schema に足す。
  const openAddColumn = (anchor: HTMLElement): void => {
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop' });
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.position = 'fixed';

    const name = el('input', { class: 's-search', placeholder: '列の名前' }) as HTMLInputElement;
    pop.append(name);
    for (const t of TYPE_ORDER) {
      const b = el('button', { class: 's-pop-item', text: TYPE_LABEL[t] });
      b.addEventListener('click', () => {
        const label = name.value.trim() || TYPE_LABEL[t];
        overlay.remove(); pop.remove();
        void guard(async () => {
          // 選択型は最初の選択肢を用意しておかないと、値を入れる手段がない。
          const options = t === 'select' || t === 'multi_select' ? ['未分類'] : undefined;
          await api.addProperty(databaseId!, { name: label, type: t, options });
          await reload();
        });
      });
      pop.append(b);
    }
    overlay.addEventListener('click', () => { overlay.remove(); pop.remove(); });
    document.body.append(overlay, pop);
    name.focus();
  };

  /** 選択肢を選ぶポップオーバー。multi_select は複数、select は1つ。 */
  const openOptionPicker = (
    anchor: HTMLElement,
    prop: { id: string; type: PropertyType },
    selectedIds: string[],
    onDone: (picked: OptionDef[]) => void,
  ): void => {
    const options = detail?.properties.find((p) => p.id === prop.id)?.options ?? [];
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

  const cellInput = (blockId: string, prop: { id: string; type: PropertyType }, raw: unknown): HTMLElement => {
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
          box.append(el('span', { class: 's-chip-empty', text: '＋ 選ぶ' }));
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

  const paint = (): void => {
    body.innerHTML = '';
    titleEl.textContent = dbTitle || 'データベース';
    if (!detail) {
      body.append(el('div', { class: 's-note', text: '左からデータベースを選んでください。' }));
      return;
    }

    if (detail.views.length) {
      const tabs = el('div', { class: 's-db-tabs' });
      detail.views.forEach((v, i) => {
        const t = el('button', { class: `s-db-tab${i === 0 ? ' on' : ''}`, text: v.name || v.type });
        // ビューの切り替え（フィルタ・ソート）はまだ持たせていない。タブは表示だけ。
        tabs.append(t);
      });
      body.append(tabs);
    }

    const table = el('table', { class: 's-tbl' });
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', { text: 'タイトル' }));
    for (const p of detail.properties) {
      const th = el('th');
      th.append(document.createTextNode(p.name));
      th.append(el('span', { class: 's-col-kind', text: TYPE_LABEL[p.type] ?? p.type }));
      hr.append(th);
    }
    const addTh = el('th', { class: 's-col-add' });
    const addBtn = el('button', { class: 's-col-add-btn', text: '＋', title: '列を追加' });
    addBtn.addEventListener('click', () => openAddColumn(addBtn));
    addTh.append(addBtn);
    hr.append(addTh);
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    for (const row of detail.rows) {
      const tr = el('tr');
      const td = el('td', { class: 's-td-title' });
      // タイトル自体が開く導線。名前の変更は鉛筆で入力に切り替える。
      // 常時入力にすると、開きたいのか直したいのかが押すまで決まらない。
      const link = el('a', { class: 's-row-link', text: row.title || '（無題）', href: '#' });
      link.addEventListener('click', (e) => { e.preventDefault(); opts.onOpenPage(row.id); });
      const pen = el('button', { class: 's-row-pen', text: '✎', title: '名前を変更' });
      pen.addEventListener('click', () => {
        const input = el('input', { class: 's-row-ti' }) as HTMLInputElement;
        input.value = row.title;
        const finish = (save: boolean): void => {
          if (save && input.value !== row.title) {
            const next = input.value;
            void guard(async () => {
              await api.patchBlock(row.id, { text: next });
              row.title = next;
              opts.onChanged();
            });
          }
          link.textContent = (save ? input.value : row.title) || '（無題）';
          input.replaceWith(link);
          pen.style.display = '';
        };
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (ev) => {
          const k = ev as KeyboardEvent;
          if (k.key === 'Enter') { ev.preventDefault(); finish(true); }
          if (k.key === 'Escape') { ev.preventDefault(); finish(false); }
        });
        link.replaceWith(input);
        pen.style.display = 'none';
        input.focus();
        input.select();
      });
      td.append(link, pen);
      tr.append(td);

      for (const p of detail.properties) {
        const cell = el('td');
        cell.append(cellInput(row.id, p, row.cells[p.id]));
        tr.append(cell);
      }
      tr.append(el('td'));
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);

    const addRow = el('button', { class: 's-add-row', text: '＋ 行を追加' });
    addRow.addEventListener('click', () => {
      void guard(async () => {
        await api.addRow(databaseId!, { title: '' });
        opts.onChanged();
        await reload();
      });
    });
    body.append(addRow);

    if (!detail.properties.length) {
      body.append(el('div', {
        class: 's-note',
        text: '列がまだありません。右上の ＋ から、テキスト・数値・日付などの列を足せます。',
      }));
    }
  };

  const reload = async (): Promise<void> => {
    if (!databaseId) return;
    detail = await api.readDatabase(databaseId);
    paint();
  };

  return {
    el: root,
    open: async (id: string) => {
      databaseId = id;
      const list = await api.listDatabases().catch(() => null);
      dbTitle = list?.databases.find((d) => d.databaseId === id)?.title ?? '';
      await guard(reload);
    },
    reload: () => guard(reload),
  };
}
