// 中央ペイン: データベースのテーブルビュー。
//
// 列（プロパティ）はユーザーが実行時に定義でき、値は型ごとに列固定の p_cell_* に入る。
// 画面側は p_property_type を見て入力要素を選ぶだけで、EAV の型分岐は持たない。

import * as api from './api';
import type { DatabaseDetail, OptionDef, PropertyType } from './api';
import { applyView, byRecent } from './view-filter';
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
  /** 設定も同じ場所に、同じ表の形で出す。別の見た目の画面を増やさない。 */
  openSettings: () => Promise<void>;
  reload: () => Promise<void>;
}

/** よく使うタイムゾーンだけ並べる。ここに無いものは、いま入っている値として残す。 */
const ZONES = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];

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
  // 設定を出しているか。データベースと同じ場所・同じ表の形で見せる。
  let showSettings = false;
  let settings: Record<string, string> = {};

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

  /**
   * 小さな選択肢の吹き出し。列やビューの「直す・消す」をここに集める。
   * 入れ子は、その項目の横に開く（元の項目が見えたまま選べる）。
   */
  interface MenuItem { label: string; run?: () => void; sub?: MenuItem[]; row?: MenuItem[] }
  const openMenu = (anchor: HTMLElement, items: MenuItem[], extra?: HTMLElement): void => {
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop' });
    const r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.min(r.left, window.innerWidth - 230)}px`;
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 260)}px`;
    let flyout: HTMLElement | null = null;
    const close = (): void => { overlay.remove(); pop.remove(); flyout?.remove(); };
    if (extra) pop.append(extra);
    for (const it of items) {
      // 横並びの組（昇順・降順など）。上下に並べると、対になっていることが伝わらない。
      if (it.row) {
        const row = el('div', { class: 's-pop-row' });
        for (const sub of it.row) {
          const b = el('button', { class: 's-pop-item s-pop-half', text: sub.label });
          b.addEventListener('click', () => { close(); sub.run?.(); });
          row.append(b);
        }
        pop.append(row);
        continue;
      }
      const b = el('button', { class: `s-pop-item${it.sub ? ' s-pop-more' : ''}`, text: it.label });
      if (it.sub) {
        const openFly = (): void => {
          flyout?.remove();
          const fly = el('div', { class: 's-pop s-pop-fly' });
          const br = b.getBoundingClientRect();
          fly.style.position = 'fixed';
          // 右に出す。画面の端に当たるなら左へ回す。
          const w = 150;
          fly.style.left = `${br.right + w > window.innerWidth ? br.left - w : br.right + 2}px`;
          fly.style.top = `${Math.min(br.top, window.innerHeight - 240)}px`;
          fly.style.width = `${w}px`;
          for (const sub of it.sub!) {
            const sb = el('button', { class: 's-pop-item', text: sub.label });
            sb.addEventListener('click', () => { close(); sub.run?.(); });
            fly.append(sb);
          }
          document.body.append(fly);
          flyout = fly;
        };
        b.addEventListener('mouseenter', openFly);
        b.addEventListener('focus', openFly);
        b.addEventListener('click', openFly);   // 触る画面には hover が無い
      } else {
        b.addEventListener('mouseenter', () => { flyout?.remove(); flyout = null; });
        b.addEventListener('click', () => { close(); it.run?.(); });
      }
      pop.append(b);
    }
    overlay.addEventListener('click', close);
    document.body.append(overlay, pop);
    (extra?.querySelector('input') ?? extra)?.focus?.();
  };

  /**
   * 列の見出しを押したときの menu。
   * 名前は入力欄でその場で直せるので、項目としては出さない。
   * タイトル列は行そのものが持つので、種類の変更も削除もできない。
   */
  const openColumnMenu = (
    anchor: HTMLElement,
    prop: { id: string; name: string; type: PropertyType },
    isTitle = false,
  ): void => {
    const name = el('input', { class: 's-search', value: prop.name }) as HTMLInputElement;
    name.value = prop.name;
    const rename = (): void => {
      const next = name.value.trim();
      if (!next || next === prop.name) return;
      void guard(async () => {
        if (isTitle) await api.updateDatabase(databaseId!, { titleName: next });
        else await api.updateProperty(prop.id, { name: next });
        await reload();
      });
    };
    name.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') {
        ev.preventDefault();
        document.querySelectorAll('.s-overlay,.s-pop').forEach((n) => n.remove());
        rename();
      }
    });
    name.addEventListener('blur', rename);

    // 並べ替えはこの表を見ている間だけのもの。ビューには保存しない。
    const sortBy = (direction: SortRule['direction']): void => {
      const rest = localSorts.filter((r) => r.property !== prop.id);
      const cur = localSorts.find((r) => r.property === prop.id);
      // 同じ向きをもう一度選んだら外す。掛けたものを外す道が無いと戻れない。
      localSorts = cur && cur.direction === direction ? rest : [{ property: prop.id, direction }, ...rest];
      paint();
    };
    const cur = localSorts.find((r) => r.property === prop.id);
    const sortRow: MenuItem = {
      label: '',
      row: [
        { label: cur?.direction === 'ascending' ? '▲ 昇順' : '昇順', run: () => sortBy('ascending') },
        { label: cur?.direction === 'descending' ? '▼ 降順' : '降順', run: () => sortBy('descending') },
      ],
    };

    if (isTitle) { openMenu(anchor, [sortRow], name); return; }

    const types: MenuItem[] = TYPE_ORDER.filter((t) => t !== prop.type).map((t) => ({
      label: TYPE_LABEL[t],
      run: () => {
        void guard(async () => {
          const r = await api.updateProperty(prop.id, { type: t });
          if (r.converted?.dropped) {
            opts.onError(`${r.converted.dropped} 件の値は「${TYPE_LABEL[t]}」にできなかったので消えました`);
          }
          await reload();
        });
      },
    }));
    openMenu(anchor, [
      sortRow,
      { label: `種類（${TYPE_LABEL[prop.type]}）`, sub: types },
      {
        label: `「${prop.name}」を削除`,
        run: () => {
          if (!window.confirm(`列「${prop.name}」を消します。この列の値も消えます。`)) return;
          void guard(async () => { await api.deleteProperty(prop.id); await reload(); });
        },
      },
    ], name);
  };

  /**
   * ビューに保存しない、その場限りの絞り込みと並べ替え。
   * ビューの条件（Notion と同じ形で保存する）とは別物なので、掛け合わせて使う。
   */
  const openLocalEditor = (anchor: HTMLElement, preselect?: string, only?: 'filter' | 'sort'): void => {
    openFilterEditor({
      anchor,
      only,
      // タイトルは列ではなく行そのものが持つが、並べ替えの相手としては列と同じ。
      // ここだけ列のふりをさせる（評価器は 'title' を特別に扱う）。
      properties: [{ id: 'title', name: 'タイトル', type: 'text', rank: null }, ...(detail?.properties ?? [])],
      current: localFilters,
      sorts: localSorts,
      withSort: true,
      keyBy: 'id',
      preselect,
      title: only === 'sort' ? '並び替え（この表だけ）' : 'フィルタ（この表だけ）',
      onSave: (f, srt) => {
        localFilters = (f ?? {}) as Record<string, Record<string, unknown>>;
        localSorts = srt ?? [];
        paint();
      },
    });
  };

  /**
   * ビューに保存するフィルタと並び替え。Notion と同じ形（プロパティ ID を鍵にした式）で
   * 持つので、取り込み直しても壊れず、MCP から触ったものとも行き来できる。
   */
  const openViewEditor = (
    anchor: HTMLElement,
    view: { id: string; quickFilters?: string | null; sorts?: string | null },
    only: 'filter' | 'sort',
  ): void => {
    let sorts: SortRule[] = [];
    try { sorts = view.sorts ? (JSON.parse(view.sorts) as SortRule[]) : []; } catch { sorts = []; }
    openFilterEditor({
      anchor,
      only,
      withSort: true,
      properties: detail!.properties,
      current: view.quickFilters ? (JSON.parse(view.quickFilters) as Record<string, Record<string, unknown>>) : {},
      sorts,
      title: only === 'sort' ? '並び替え' : 'フィルタ',
      onSave: (quickFilters, srt) => {
        void guard(async () => {
          // 開いていない側を消さないよう、触った側だけ送る。
          await api.updateView(view.id, only === 'sort'
            ? { sorts: srt ?? null }
            : { quickFilters: quickFilters ?? null });
          await reload();
        });
      },
    });
  };

  /** ビューのタブを押したときの menu。フィルタ・並び替えと、名前・削除。 */
  const openViewMenu = (
    anchor: HTMLElement,
    view: { id: string; name: string; quickFilters?: string | null; sorts?: string | null },
  ): void => {
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
    name.addEventListener('blur', rename);
    const q = view.quickFilters ? Object.keys(JSON.parse(view.quickFilters) as object).length : 0;
    openMenu(anchor, [
      { label: q ? `フィルタ（${q}）` : 'フィルタ', run: () => openViewEditor(anchor, view, 'filter') },
      { label: '並び替え', run: () => openViewEditor(anchor, view, 'sort') },
      { label: '名前の変更', run: rename },
      {
        label: `「${view.name}」を削除`,
        run: () => {
          if (!window.confirm(`ビュー「${view.name}」を消します。行は消えません。`)) return;
          void guard(async () => {
            await api.deleteView(view.id);
            if (activeViewId === view.id) activeViewId = null;
            await reload();
          });
        },
      },
    ], name);
  };

  /** 設定。行が設定の名前、値が入力。表の形にすると、他の画面と読み方が同じになる。 */
  const paintSettings = (): void => {
    body.innerHTML = '';
    headTools.innerHTML = '';
    titleEl.textContent = '設定';
    titleEl.title = '';
    const table = el('table', { class: 's-tbl' });
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', { text: '設定' }), el('th', { text: '値' }), el('th', { class: 's-col-add' }));
    thead.append(hr);
    const tbody = el('tbody');

    const tr = el('tr');
    const td = el('td', { class: 's-td-title' });
    td.append(el('span', { class: 's-row-link', text: 'タイムゾーン' }));
    tr.append(td);
    const vtd = el('td');
    const sel = el('select', { class: 's-cell' }) as HTMLSelectElement;
    const current = settings.timezone || 'Asia/Tokyo';
    const zones = ZONES.includes(current) ? ZONES : [current, ...ZONES];
    for (const z of zones) sel.append(el('option', { value: z, text: z }));
    sel.value = current;
    sel.addEventListener('change', () => {
      void guard(async () => {
        await api.saveSettings({ timezone: sel.value });
        settings.timezone = sel.value;
        timeZone = sel.value;
      });
    });
    vtd.append(sel);
    tr.append(vtd, el('td'));
    tbody.append(tr);
    table.append(thead, tbody);
    const scroller = el('div', { class: 's-tbl-scroll' });
    scroller.append(table);
    body.append(scroller);
    body.append(el('div', {
      class: 's-note',
      text: 'ビューの「今週」「過去1か月」などを、どこの時刻で解くかに使います。',
    }));
  };

  const paint = (): void => {
    if (showSettings) { paintSettings(); return; }
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
    const find = el('input', { class: 's-search s-head-search', placeholder: '検索' }) as HTMLInputElement;
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
        title: allOn ? 'もう一度押すとフィルタ・並び替え' : 'ビューのフィルタを外して全部を見る',
      });
      all.addEventListener('click', () => {
        if (allOn) {
          openMenu(all, [
            { label: 'フィルタ', run: () => openLocalEditor(all, undefined, 'filter') },
            { label: '並び替え', run: () => openLocalEditor(all, undefined, 'sort') },
          ]);
          return;
        }
        activeViewId = null;
        void guard(reload);
      });
      tabs.append(all);
      for (const v of detail.views) {
        const on = activeViewId ? v.id === activeViewId : false;
        const t = el('button', { class: `s-db-tab${on ? ' on' : ''}`, text: v.name || v.type });
        t.title = on ? 'もう一度押すとフィルタ・並び替え・名前の変更・削除' : (v.quickFilters ? 'フィルタが効いています' : '');
        t.addEventListener('click', () => {
          // 選んでいるタブをもう一度押したら menu。別のタブなら切り替える。
          if (on && !detail!.systemKind) {
            openViewMenu(t, { id: v.id, name: v.name || v.type, quickFilters: v.quickFilters, sorts: v.sorts });
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
    // 仕組みが持つデータベース（取り込みログ）は列が決まっている。触らせない。
    const managed = !!detail.systemKind;

    /** 列の見出し。名前を押すと menu（並び替え・種類・削除）。 */
    const headCell = (name: string, kind: string | null, onMenu: ((a: HTMLElement) => void) | null): HTMLElement => {
      const th = el('th', { class: 's-col-head' });
      const nm = el('span', { class: onMenu ? 's-col-name' : '', text: name });
      if (onMenu) nm.addEventListener('click', () => onMenu(nm));
      th.append(nm);
      if (kind) th.append(el('span', { class: 's-col-kind', text: kind }));

      return th;
    };

    hr.append(headCell(detail.titleName || 'タイトル', null, managed ? null : (a) =>
      openColumnMenu(a, { id: 'title', name: detail!.titleName || 'タイトル', type: 'text' }, true)));
    for (const p of detail.properties) {
      if (managed) {
        const th = el('th');
        th.append(document.createTextNode(p.name));
        th.append(el('span', { class: 's-col-kind', text: TYPE_LABEL[p.type] ?? p.type }));
        hr.append(th);
        continue;
      }
      hr.append(headCell(p.name, TYPE_LABEL[p.type] ?? p.type, (a) =>
        openColumnMenu(a, { id: p.id, name: p.name, type: p.type })));
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
    // ビューも並べ替えも指定していなければ、更新の新しい順にする。
    const base = !activeView && !localSorts.length ? byRecent(applied.rows) : applied.rows;
    const local = applyView(base, detail.properties, {
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
      showSettings = false;
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
    openSettings: async () => {
      showSettings = true;
      databaseId = null;
      detail = null;
      await guard(async () => {
        const st = await api.readSettings();
        settings = st.settings;
        if (settings.timezone) timeZone = settings.timezone;
      });
      paint();
    },
    reload: () => guard(reload),
  };
}
