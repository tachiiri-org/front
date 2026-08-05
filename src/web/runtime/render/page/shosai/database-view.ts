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
  // 選択肢の色。graph と同じ ID 空間だが、ここでは名前から安定した色を選ぶだけにする。
  const CHIP_HUES = [8, 32, 55, 96, 150, 190, 215, 260, 295, 330];
  const chipColor = (name: string): string => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return `hsl(${CHIP_HUES[h % CHIP_HUES.length]}, 65%, 55%)`;
  };
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
    const commit = (): void => {
      onDone(options.filter((o) => chosen.has(o.id)));
      close();
    };
    for (const o of options) {
      const item = el('button', { class: 's-pop-item s-opt' });
      const mark = el('span', { class: 's-opt-mark', text: chosen.has(o.id) ? '✓' : '' });
      const chip = el('span', { class: 's-chip', text: o.name });
      chip.style.background = `${chipColor(o.name)}22`;
      chip.style.borderColor = `${chipColor(o.name)}66`;
      item.append(mark, chip);
      item.addEventListener('click', () => {
        if (prop.type === 'select') { chosen.clear(); chosen.add(o.id); commit(); return; }
        if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
        mark.textContent = chosen.has(o.id) ? '✓' : '';
      });
      pop.append(item);
    }
    if (prop.type === 'multi_select') {
      const done = el('button', { class: 's-pop-item s-opt-done', text: '決定' });
      done.addEventListener('click', commit);
      pop.append(done);
    }
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
          const chip = el('span', { class: 's-chip', text: c.name });
          chip.style.background = `${chipColor(c.name)}22`;
          chip.style.borderColor = `${chipColor(c.name)}66`;
          box.append(chip);
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
      // 件数ではなく、相手のページを開けるようにする。
      const refs = Array.isArray(raw) ? (raw as Array<{ id: string; title: string }>) : [];
      const box = el('div', { class: 's-cell s-chips' });
      if (!refs.length) { box.append(el('span', { class: 's-chip-empty', text: '—' })); return box; }
      for (const r of refs) {
        const link = el('a', { class: 's-ref', text: r.title || '（無題）', href: '#' });
        link.addEventListener('click', (e) => { e.preventDefault(); opts.onOpenPage(r.id); });
        box.append(link);
      }
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
      const ti = el('input', { class: 's-row-ti', placeholder: '無題' }) as HTMLInputElement;
      ti.value = row.title;
      ti.addEventListener('change', () => {
        void guard(async () => {
          await api.patchBlock(row.id, { text: ti.value });
          opts.onChanged();
        });
      });
      const open = el('button', { class: 's-open-btn', text: '開く' });
      open.addEventListener('click', () => opts.onOpenPage(row.id));
      td.append(ti, open);
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
