// 中央ペイン: データベースのテーブルビュー。
//
// 列（プロパティ）はユーザーが実行時に定義でき、値は型ごとに列固定の p_cell_* に入る。
// 画面側は p_property_type を見て入力要素を選ぶだけで、EAV の型分岐は持たない。

import * as api from './api';
import type { DatabaseDetail, OptionDef, PropertyType } from './api';
import { applyView } from './view-filter';
import { openFilterEditor, type SortRule } from './filter-editor';
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
  let activeViewId: string | null = null;
  let filterText = '';
  // 虫眼鏡は畳んでおく。開いているかを覚えていないと、描き直しで閉じてしまう。
  let findOpen = false;
  // ビューの絞り込みとは別に、その場で掛ける絞り込みと並べ替え。
  // ビューに保存しない（他の人の見え方を変えずに、いま見たい形にするため）。
  let localFilters: Record<string, Record<string, unknown>> = {};
  let localSorts: SortRule[] = [];
  // 相対日付（今週・先月）の起点。設定で変えられる。
  let timeZone = 'Asia/Tokyo';
  // 描き直しで横スクロールが左端に戻るのを防ぐ。取り込み中は数秒ごとに描き直すので、
  // 位置を覚えていないと表を横に見ていられない。
  let scrollLeft = 0;

  const root = el('div', { class: 's-main' });
  const head = el('div', { class: 's-main-head' });
  const titleEl = el('div', { class: 's-title' });
  const headTools = el('div', { class: 's-head-tools' });
  head.append(titleEl, headTools);
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

  /** 小さな選択肢の吹き出し。列やビューの「直す・消す」をここに集める。 */
  const openMenu = (anchor: HTMLElement, items: Array<[string, () => void]>, extra?: HTMLElement): void => {
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop' });
    const r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`;
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 240)}px`;
    pop.style.maxHeight = '260px';
    pop.style.overflowY = 'auto';
    const close = (): void => { overlay.remove(); pop.remove(); };
    if (extra) pop.append(extra);
    for (const [label, run] of items) {
      const b = el('button', { class: 's-pop-item', text: label });
      b.addEventListener('click', () => { close(); run(); });
      pop.append(b);
    }
    overlay.addEventListener('click', close);
    document.body.append(overlay, pop);
    return void (extra?.querySelector('input') as HTMLInputElement | null)?.focus();
  };

  /** 列の見出しを押したときの menu。名前・種類・削除。 */
  const openColumnMenu = (anchor: HTMLElement, prop: { id: string; name: string; type: PropertyType }): void => {
    const name = el('input', { class: 's-search', value: prop.name }) as HTMLInputElement;
    name.value = prop.name;
    const rename = (): void => {
      const next = name.value.trim();
      if (!next || next === prop.name) return;
      void guard(async () => { await api.updateProperty(prop.id, { name: next }); await reload(); });
    };
    name.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') {
        ev.preventDefault();
        document.querySelectorAll('.s-overlay,.s-pop').forEach((n) => n.remove());
        rename();
      }
    });
    const sortBy = (direction: SortRule['direction']): void => {
      // 同じ列を選び直したら差し替える。段を増やしたいときは menu の「絞り込み・並べ替え」から。
      localSorts = [{ property: prop.id, direction }, ...localSorts.filter((r) => r.property !== prop.id)];
      paint();
    };
    const items: Array<[string, () => void]> = [
      ['名前を変える', rename],
      ['この列で絞り込む', () => openLocalEditor(anchor, prop.id)],
      ['昇順で並べ替え', () => sortBy('ascending')],
      ['降順で並べ替え', () => sortBy('descending')],
    ];
    for (const t of TYPE_ORDER) {
      if (t === prop.type) continue;
      items.push([`種類を「${TYPE_LABEL[t]}」に変える`, () => {
        void guard(async () => {
          const r = await api.updateProperty(prop.id, { type: t });
          if (r.converted?.dropped) {
            opts.onError(`${r.converted.dropped} 件の値は「${TYPE_LABEL[t]}」にできなかったので消えました`);
          }
          await reload();
        });
      }]);
    }
    items.push([`「${prop.name}」を削除`, () => {
      if (!window.confirm(`列「${prop.name}」を消します。この列の値も消えます。`)) return;
      void guard(async () => { await api.deleteProperty(prop.id); await reload(); });
    }]);
    openMenu(anchor, items, name);
  };

  /**
   * ビューに保存しない、その場限りの絞り込みと並べ替え。
   * ビューの条件（Notion と同じ形で保存する）とは別物なので、掛け合わせて使う。
   */
  const openLocalEditor = (anchor: HTMLElement, preselect?: string): void => {
    openFilterEditor({
      anchor,
      // タイトルは列ではなく行そのものが持つが、並べ替えの相手としては列と同じ。
      // ここだけ列のふりをさせる（評価器は 'title' を特別に扱う）。
      properties: [{ id: 'title', name: 'タイトル', type: 'text', rank: null }, ...(detail?.properties ?? [])],
      current: localFilters,
      sorts: localSorts,
      withSort: true,
      keyBy: 'id',
      preselect,
      title: 'この表だけの絞り込み（保存しません）',
      onSave: (f, srt) => {
        localFilters = (f ?? {}) as Record<string, Record<string, unknown>>;
        localSorts = srt ?? [];
        paint();
      },
    });
  };

  /** ビューに保存する絞り込み。Notion と同じ形で持つので、取り込み直しても残る。 */
  const openViewFilter = (anchor: HTMLElement, view: { id: string; quickFilters?: string | null }): void => {
    openFilterEditor({
      anchor,
      properties: detail!.properties,
      current: view.quickFilters ? (JSON.parse(view.quickFilters) as Record<string, Record<string, unknown>>) : {},
      onSave: (quickFilters) => {
        void guard(async () => {
          await api.updateView(view.id, { quickFilters: quickFilters ?? null });
          await reload();
        });
      },
    });
  };

  /** ビューのタブを押したときの menu。絞り込みと、名前・削除。 */
  const openViewMenu = (anchor: HTMLElement, view: { id: string; name: string; quickFilters?: string | null }): void => {
    const name = el('input', { class: 's-search', value: view.name }) as HTMLInputElement;
    name.value = view.name;
    const rename = (): void => {
      const next = name.value.trim();
      if (!next || next === view.name) return;
      void guard(async () => { await api.updateView(view.id, { name: next }); await reload(); });
    };
    name.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') {
        ev.preventDefault();
        document.querySelectorAll('.s-overlay,.s-pop').forEach((n) => n.remove());
        rename();
      }
    });
    const q = view.quickFilters ? Object.keys(JSON.parse(view.quickFilters) as object).length : 0;
    openMenu(anchor, [
      [q ? `ビューの絞り込み（${q}）` : 'ビューの絞り込み', () => openViewFilter(anchor, view)],
      ['この表だけの絞り込み・並べ替え', () => openLocalEditor(anchor)],
      ['名前を変える', rename],
      [`「${view.name}」を削除`, () => {
        if (!window.confirm(`ビュー「${view.name}」を消します。行は消えません。`)) return;
        void guard(async () => {
          await api.deleteView(view.id);
          if (activeViewId === view.id) activeViewId = null;
          await reload();
        });
      }],
    ], name);
  };

  const paint = (): void => {
    body.innerHTML = '';
    titleEl.textContent = dbTitle || 'データベース';
    if (detail?.systemKind) {
      titleEl.textContent = `${dbTitle || 'データベース'}`;
      titleEl.title = '仕組みが管理しているデータベースです';
    }
    headTools.innerHTML = '';
    if (!detail) {
      body.append(el('div', { class: 's-note', text: '左からデータベースを選んでください。' }));
      return;
    }

    // 検索は右上に出しっぱなしにする。畳むと、探せることに気づけない。
    const find = el('input', { class: 's-search s-head-search', placeholder: 'この表の中を探す' }) as HTMLInputElement;
    find.value = filterText;
    find.addEventListener('input', () => {
      filterText = find.value;
      paintRows();
      const again = head.querySelector('.s-head-search') as HTMLInputElement | null;
      if (again && again !== find) { again.value = filterText; again.focus(); }
    });
    headTools.append(find);

    {
      const tabs = el('div', { class: 's-db-tabs' });
      // 一番左はデータベースそのもの（＝ビューの絞り込みなし）。押すたびに menu を出すと
      // 表が見られないので、選んでいるときだけ menu を開く。
      const allOn = !activeViewId;
      const all = el('button', {
        class: `s-db-tab s-db-tab-all${allOn ? ' on' : ''}`, text: '▦',
        title: allOn ? 'もう一度押すと、この表だけの絞り込み・並べ替え' : 'ビューの絞り込みを外して全部を見る',
      });
      all.addEventListener('click', () => {
        if (allOn) { openLocalEditor(all); return; }
        activeViewId = null;
        void guard(reload);
      });
      tabs.append(all);
      for (const v of detail.views) {
        const on = activeViewId ? v.id === activeViewId : false;
        const t = el('button', { class: `s-db-tab${on ? ' on' : ''}`, text: v.name || v.type });
        t.title = on ? 'もう一度押すと絞り込み・名前の変更・削除' : (v.quickFilters ? '絞り込みが効いています' : '');
        t.addEventListener('click', () => {
          // 選んでいるタブをもう一度押したら menu。別のタブなら切り替える。
          if (on && !detail!.systemKind) {
            openViewMenu(t, { id: v.id, name: v.name || v.type, quickFilters: v.quickFilters });
            return;
          }
          activeViewId = v.id;
          void guard(reload);
        });
        tabs.append(t);
      }
      body.append(tabs);
    }

    const table = el('table', { class: 's-tbl' });
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', { text: 'タイトル' }));
    // 仕組みが持つデータベース（取り込みログ）は列が決まっている。触らせない。
    const managed = !!detail.systemKind;
    for (const p of detail.properties) {
      const th = el('th', { class: managed ? '' : 's-col-head' });
      th.append(document.createTextNode(p.name));
      th.append(el('span', { class: 's-col-kind', text: TYPE_LABEL[p.type] ?? p.type }));
      if (!managed) {
        th.title = '押すと名前・種類の変更、削除';
        th.addEventListener('click', () => openColumnMenu(th, { id: p.id, name: p.name, type: p.type }));
      }
      hr.append(th);
    }
    const addTh = el('th', { class: 's-col-add' });
    if (!managed) {
      const addBtn = el('button', { class: 's-col-add-btn', text: '＋', title: '列を追加' });
      addBtn.addEventListener('click', () => openAddColumn(addBtn));
      addTh.append(addBtn);
    }
    hr.append(addTh);
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    // ビューの式（絞り込みと並び）を手元で解く。取り込んでいない列を参照する条件は
    // 効かせず、そのことを画面に断る。
    const activeView = activeViewId ? detail.views.find((v) => v.id === activeViewId) ?? null : null;
    const applied = applyView(detail.rows, detail.properties, activeView, timeZone);
    // その場限りの条件はビューの結果にさらに掛ける。ビューの式と同じ形なので、
    // 同じ評価器をもう一度通せばよい。
    const local = applyView(applied.rows, detail.properties, {
      id: 'local', type: 'table', name: '',
      quickFilters: Object.keys(localFilters).length ? JSON.stringify(localFilters) : null,
      sorts: localSorts.length ? JSON.stringify(localSorts) : null,
    }, timeZone);
    const q = filterText.trim();
    const visible = q
      ? local.rows.filter((r) => {
          if ((r.title || '').includes(q)) return true;
          // セルの中身も見る。担当や状態で絞りたいことが多い。
          return Object.values(r.cells).some((v) => JSON.stringify(v ?? '').includes(q));
        })
      : local.rows;
    for (const row of visible) {
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
    // 表は自分の箱の中で横スクロールさせる。ページごとはみ出すと、モバイルの
    // ブラウザが全体を縮小表示してしまい、固定フッターまで画面外へ行く。
    const scroller = el('div', { class: 's-tbl-scroll' });
    scroller.append(table);
    scroller.addEventListener('scroll', () => { scrollLeft = scroller.scrollLeft; });
    body.append(scroller);
    if (scrollLeft) requestAnimationFrame(() => { scroller.scrollLeft = scrollLeft; });
    if (q && !visible.length) {
      body.append(el('div', { class: 's-note', text: `「${q}」に当てはまる行はありません` }));
    }
    const unsupported = [...new Set([...applied.unsupported, ...local.unsupported])];
    if (unsupported.length) {
      // 黙って全件出すと「絞り込めているつもり」になる。
      body.append(el('div', {
        class: 's-notion-warn',
        text: `この列の条件は効かせられません（取り込んでいないため）: ${unsupported.join(' / ')}`,
      }));
    }

    if (!managed) {
      const addRow = el('button', { class: 's-add-row', text: '＋ 行を追加' });
      addRow.addEventListener('click', () => {
        void guard(async () => {
          await api.addRow(databaseId!, { title: '' });
          opts.onChanged();
          await reload();
        });
      });
      body.append(addRow);
    }

    if (!detail.properties.length) {
      body.append(el('div', {
        class: 's-note',
        text: '列がまだありません。右上の ＋ から、テキスト・数値・日付などの列を足せます。',
      }));
    }
  };

  const paintRows = (): void => paint();

  const reload = async (): Promise<void> => {
    if (!databaseId) return;
    detail = await api.readDatabase(databaseId);
    paint();
  };

  return {
    el: root,
    open: async (id: string) => {
      databaseId = id;
      activeViewId = null;
      filterText = '';
      findOpen = false;
      localFilters = {};
      localSorts = [];
      scrollLeft = 0;
      try {
        const st = await api.readSettings();
        if (st.settings.timezone) timeZone = st.settings.timezone;
      } catch { /* 既定のまま */ }
      const list = await api.listDatabases().catch(() => null);
      dbTitle = list?.databases.find((d) => d.databaseId === id)?.title ?? '';
      await guard(reload);
    },
    reload: () => guard(reload),
  };
}
