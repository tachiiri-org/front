// 右ペイン: ページのブロックエディタ。
//
// 並び順は p_block_rank（fractional index）が持つので、1ブロックの移動は 1 リクエストで済む。
// 画面側は「どのブロックの後ろに置くか」だけを送り、ランクの計算は DO の中で行う。

import * as api from './api';
import type { BlockRow, BlockType, PageDetail } from './api';
import { el } from './style';

const MARKER: Partial<Record<BlockType, string>> = {
  bullet: '•',
  quote: '',
  code: '',
};

const CYCLE: BlockType[] = ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote', 'code'];

export interface EditorView {
  el: HTMLElement;
  open: (pageId: string) => Promise<void>;
  reload: () => Promise<void>;
  currentPageId: () => string | null;
  /** いま開いているページのタイトル。タブの見出しに使う。 */
  currentTitle: () => string;
}

export function createEditorView(opts: {
  onError: (message: string) => void;
  onTitleChange: (pageId: string, title: string) => void;
  /** ページへのリンクを押したとき。 */
  onOpenLink?: (blockId: string) => void;
  /** 閉じるを押したとき。 */
  onClose?: () => void;
}): EditorView {
  let pageId: string | null = null;
  let detail: PageDetail | null = null;
  // Enter で作った直後のブロックへフォーカスを戻すための予約。再描画をまたぐので id で持つ。
  let focusAfterRender: string | null = null;

  const root = el('div', { class: 's-editor' });
  const head = el('div', { class: 's-editor-head' });
  const title = el('input', { class: 's-title', placeholder: '無題' }) as HTMLInputElement;
  // 閉じる口を見出しに置く。モバイルはタブの × があるが、PC にはそれが無い。
  const closeBtn = el('button', { class: 's-editor-close', text: '×', title: '閉じる' });
  closeBtn.addEventListener('click', () => opts.onClose?.());
  head.append(title, closeBtn);
  const body = el('div', { class: 's-editor-body' });

  // 編集の道具はタブのすぐ上に固定する。本文の末尾まで送らないと足せないのは面倒なので。
  const bar = el('div', { class: 's-toolbar' });
  const picker = el('input', { class: 's-file', type: 'file', accept: 'image/*' }) as HTMLInputElement;
  const addImage = el('button', { class: 's-tool', text: '画像', title: '画像を追加' });
  addImage.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file || !pageId) return;
    void guard(async () => {
      addImage.textContent = '送信中…';
      try {
        const created = await api.createBlock({ parentId: pageId!, type: 'image', text: '' });
        await api.uploadFile(created.id, file);
        await reload();
      } finally { addImage.textContent = '画像'; }
    });
  });
  // 足すときに種別を選べるようにする。段落を足してから種別を変えるのは手数が多い。
  const ADD_CHOICES: Array<[api.BlockType, string]> = [
    ['paragraph', '段落'], ['heading', '見出し'], ['bullet', '箇条書き'],
    ['numbered', '番号付き'], ['todo', 'TODO'], ['quote', '引用'], ['code', 'コード'],
  ];
  const addBlock = el('button', { class: 's-tool', text: '＋ 追加' });
  addBlock.addEventListener('click', () => {
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop' });
    const r = addBlock.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.min(r.left, window.innerWidth - 180)}px`;
    pop.style.bottom = `${window.innerHeight - r.top + 6}px`;
    const close = (): void => { overlay.remove(); pop.remove(); };
    for (const [key, label] of ADD_CHOICES) {
      const it = el('button', { class: 's-pop-item', text: label });
      it.addEventListener('click', () => {
        close();
        void guard(async () => {
          if (!pageId) return;
          const created = await api.createBlock({ parentId: pageId, type: key, text: '' });
          focusAfterRender = created.id;
          await reload();
        });
      });
      pop.append(it);
    }
    overlay.addEventListener('click', close);
    document.body.append(overlay, pop);
  });
  // 種別の変更。Ctrl+Enter の巡回だけだと、目当ての種別まで何度も押すことになる。
  const TYPE_CHOICES: Array<[string, string]> = [
    ['paragraph', '段落'], ['heading', '見出し'], ['bullet', '箇条書き'],
    ['numbered', '番号付き'], ['todo', 'TODO'], ['quote', '引用'], ['code', 'コード'],
  ];
  const typeBtn = el('button', { class: 's-tool', text: '種別' });
  typeBtn.addEventListener('click', () => {
    const target = document.activeElement as HTMLTextAreaElement | null;
    const blockId = target?.dataset?.blockId;
    if (!blockId) { opts.onError('種別を変えるブロックを先に選んでください'); return; }
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop' });
    const r = typeBtn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.min(r.left, window.innerWidth - 180)}px`;
    pop.style.bottom = `${window.innerHeight - r.top + 6}px`;
    const close = (): void => { overlay.remove(); pop.remove(); };
    for (const [key, label] of TYPE_CHOICES) {
      const it = el('button', { class: 's-pop-item', text: label });
      it.addEventListener('click', () => {
        close();
        void guard(async () => {
          await api.patchBlock(blockId, { type: key as api.BlockType });
          focusAfterRender = blockId;
          await reload();
        });
      });
      pop.append(it);
    }
    overlay.addEventListener('click', close);
    document.body.append(overlay, pop);
  });

  const addDivider = el('button', { class: 's-tool', text: '区切り' });
  addDivider.addEventListener('click', () => {
    void guard(async () => {
      if (!pageId) return;
      await api.createBlock({ parentId: pageId, type: 'divider', text: '' });
      await reload();
    });
  });
  bar.append(addBlock, typeBtn, addImage, addDivider, picker);

  root.append(head, body, bar);

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) {
      opts.onError(e instanceof Error ? e.message : String(e));
    }
  };

  title.addEventListener('change', () => {
    if (!pageId) return;
    void guard(async () => {
      await api.patchBlock(pageId!, { text: title.value });
      opts.onTitleChange(pageId!, title.value);
    });
  });

  // ── ブロック行 ────────────────────────────────────────────────
  // 親は「直前の、より浅いブロック」。深さは h_block の親子から来るので、画面側は
  // depth を見て親を復元する（Tab/Shift+Tab のときだけ必要になる）。
  const parentOf = (blocks: BlockRow[], index: number): string => {
    const depth = blocks[index].depth;
    for (let i = index - 1; i >= 0; i--) {
      if (blocks[i].depth === depth - 1) return blocks[i].id;
    }
    return pageId!;
  };

  const prevSiblingOf = (blocks: BlockRow[], index: number): string | null => {
    const depth = blocks[index].depth;
    for (let i = index - 1; i >= 0; i--) {
      if (blocks[i].depth < depth) return null;
      if (blocks[i].depth === depth) return blocks[i].id;
    }
    return null;
  };

  const autoGrow = (ta: HTMLTextAreaElement): void => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  let dragId: string | null = null;

  const renderBlock = (blocks: BlockRow[], index: number): HTMLElement => {
    const b = blocks[index];
    const row = el('div', { class: 's-blk' });
    row.style.marginLeft = `${b.depth * 22}px`;
    row.dataset.blockId = b.id;

    const grip = el('span', { class: 's-grip', text: '⠿', title: 'ドラッグで並べ替え' });
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      dragId = b.id;
      (e as DragEvent).dataTransfer?.setData('text/plain', b.id);
    });
    grip.addEventListener('dragend', () => {
      dragId = null;
      body.querySelectorAll('.s-drop').forEach((n) => n.classList.remove('s-drop'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === b.id) return;
      e.preventDefault();
      row.classList.add('s-drop');
    });
    row.addEventListener('dragleave', () => row.classList.remove('s-drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('s-drop');
      const moved = dragId;
      dragId = null;
      if (!moved || moved === b.id) return;
      // 落とした行の「直後」に入れる。親は落とした行と同じにする。
      void guard(async () => {
        await api.moveBlock(moved, { parentId: parentOf(blocks, index), afterId: b.id });
        await reload();
      });
    });
    row.append(grip);

    if (b.type === 'divider') {
      row.append(el('div', { class: 's-hr' }));
      return row;
    }

    // 他のページへのリンク。押すとそのページを開く。
    if (b.type === 'page_link') {
      const a = el('a', { class: 's-blk-link', text: b.linkTargetTitle || b.text || '（無題のページ）', href: '#' });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (b.linkTargetId) opts.onOpenLink?.(b.linkTargetId);
      });
      row.append(a);
      return row;
    }

    // 埋め込み。中身は再現しない。行き先へ出られれば用は足りる。
    if (b.type === 'embed') {
      const href = b.url || (b.fileId ? `/api/v1/shosai/file/${encodeURIComponent(b.fileId)}` : '');
      const wrap = el('div', { class: 's-embed' });
      if (href) {
        const a = el('a', { class: 's-embed-link', href, target: '_blank', rel: 'noopener noreferrer' });
        a.textContent = b.text || b.url || '添付ファイル';
        wrap.append(a);
      } else {
        wrap.append(el('span', { class: 's-note', text: b.text || '埋め込み（行き先が取れませんでした）' }));
      }
      row.append(wrap);
      return row;
    }

    // 画像。実体は R2 にあり /file/:id から読む。外部 URL のものはそのまま参照する。
    if (b.type === 'image') {
      const wrap = el('div', { class: 's-img-wrap' });
      if (b.fileId) {
        const img = el('img', { class: 's-img', loading: 'lazy' }) as HTMLImageElement;
        img.src = b.fileUrl || `/api/v1/shosai/file/${encodeURIComponent(b.fileId)}`;
        img.alt = b.text || '';
        img.addEventListener('error', () => {
          wrap.innerHTML = '';
          wrap.append(el('div', { class: 's-img-miss', text: '画像を表示できません' }));
        });
        wrap.append(img);
      } else {
        wrap.append(el('div', { class: 's-img-miss', text: '画像（実体が取り込まれていません）' }));
      }
      if (b.text) wrap.append(el('div', { class: 's-img-cap', text: b.text }));
      row.append(wrap);
      return row;
    }

    if (b.type === 'todo') {
      const cb = el('input', { class: 's-blk-cb', type: 'checkbox' }) as HTMLInputElement;
      // TODO の済/未済はまだ p_ に持たせていない。見た目だけ先に置き、状態は保存しない。
      cb.disabled = true;
      cb.title = '完了状態の保存は未実装';
      row.append(cb);
    } else if (MARKER[b.type]) {
      row.append(el('span', { class: 's-blk-mk', text: MARKER[b.type]! }));
    } else if (b.type === 'numbered') {
      // 同じ深さで直前まで続く numbered の数を数えて連番にする。
      let n = 1;
      for (let i = index - 1; i >= 0; i--) {
        if (blocks[i].depth < b.depth) break;
        if (blocks[i].depth > b.depth) continue;
        if (blocks[i].type !== 'numbered') break;
        n++;
      }
      row.append(el('span', { class: 's-blk-mk', text: `${n}.` }));
    }

    const cls = ['s-blk-in'];
    if (b.type === 'heading') cls.push('h');
    if (b.type === 'code') cls.push('code');
    if (b.type === 'quote') cls.push('quote');
    const input = el('textarea', { class: cls.join(' '), rows: '1' }) as HTMLTextAreaElement;
    input.value = b.text;
    input.dataset.blockId = b.id;
    requestAnimationFrame(() => autoGrow(input));
    input.addEventListener('input', () => autoGrow(input));

    input.addEventListener('change', () => {
      void guard(async () => { await api.patchBlock(b.id, { text: input.value }); });
    });

    input.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent;

      // Enter はブロック内の改行（textarea の既定のまま）。
      // 段落の途中で改行したいことの方が多く、毎回ブロックが割れると書きにくい。
      // 新しいブロックは Shift+Enter。
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        void guard(async () => {
          if (input.value !== b.text) await api.patchBlock(b.id, { text: input.value });
          const created = await api.createBlock({
            parentId: parentOf(blocks, index),
            afterId: b.id,
            type: b.type === 'heading' ? 'paragraph' : b.type,
            text: '',
          });
          focusAfterRender = created.id;
          await reload();
        });
        return;
      }

      // Backspace: 空のブロックを消して、直前のブロックへ戻る。
      if (e.key === 'Backspace' && input.value === '' && blocks.length > 1) {
        e.preventDefault();
        const prev = blocks[index - 1];
        void guard(async () => {
          await api.deleteBlock(b.id);
          focusAfterRender = prev ? prev.id : null;
          await reload();
        });
        return;
      }

      // Tab / Shift+Tab: 直前の兄弟の子になる／親の兄弟になる。
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          if (b.depth === 0) return;
          const parentId = parentOf(blocks, index);
          const parentIndex = blocks.findIndex((x) => x.id === parentId);
          if (parentIndex < 0) return;
          const grandParent = parentOf(blocks, parentIndex);
          void guard(async () => {
            await api.moveBlock(b.id, { parentId: grandParent, afterId: parentId });
            focusAfterRender = b.id;
            await reload();
          });
        } else {
          const sibling = prevSiblingOf(blocks, index);
          if (!sibling) return;
          void guard(async () => {
            await api.moveBlock(b.id, { parentId: sibling, afterId: null });
            focusAfterRender = b.id;
            await reload();
          });
        }
        return;
      }

      // Ctrl/Cmd + Enter: ブロック種別を順に切り替える。
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const next = CYCLE[(CYCLE.indexOf(b.type) + 1) % CYCLE.length];
        void guard(async () => {
          await api.patchBlock(b.id, { type: next });
          focusAfterRender = b.id;
          await reload();
        });
      }
    });

    row.append(input);
    return row;
  };

  /**
   * 表を組み立てる。ブロックは平坦に並んで来るので、深さで行とセルを拾い直す。
   * 行・セルは編集対象として別々に出さない（表として見せた方が分かる）。
   */
  const renderTable = (blocks: BlockRow[], index: number): { el: HTMLElement; consumed: number } => {
    const base = blocks[index].depth;
    const table = el('table', { class: 's-blk-tbl' });
    let i = index + 1;
    while (i < blocks.length && blocks[i].depth > base) {
      if (blocks[i].type !== 'table_row') { i++; continue; }
      const rowDepth = blocks[i].depth;
      const tr = el('tr');
      i++;
      while (i < blocks.length && blocks[i].depth > rowDepth) {
        if (blocks[i].type === 'table_cell') tr.append(el('td', { text: blocks[i].text }));
        i++;
      }
      table.append(tr);
    }
    const wrap = el('div', { class: 's-blk-tbl-wrap' });
    wrap.append(table);
    return { el: wrap, consumed: i - index };
  };

  const paint = (): void => {
    body.innerHTML = '';
    if (!detail) {
      body.append(el('div', { class: 's-note', text: 'ページを選ぶと、ここで編集できます。' }));
      return;
    }
    title.value = detail.page.title;
    const blocks = detail.blocks;
    if (!blocks.length) {
      const add = el('button', { class: 's-add-row', text: '＋ 最初のブロックを書く' });
      add.addEventListener('click', () => {
        void guard(async () => {
          const created = await api.createBlock({ parentId: pageId!, type: 'paragraph', text: '' });
          focusAfterRender = created.id;
          await reload();
        });
      });
      body.append(add);
      return;
    }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'table') {
        const row = el('div', { class: 's-blk' });
        row.style.marginLeft = `${b.depth * 22}px`;
        row.append(el('span', { class: 's-grip', text: '⠿' }));
        const t = renderTable(blocks, i);
        row.append(t.el);
        body.append(row);
        i += t.consumed - 1;   // 行とセルは表の中で描いたので飛ばす
        continue;
      }
      if (b.type === 'table_row' || b.type === 'table_cell') continue;
      body.append(renderBlock(blocks, i));
    }

    const add = el('button', { class: 's-add-row', text: '＋ ブロックを追加' });
    add.addEventListener('click', () => {
      void guard(async () => {
        const last = blocks[blocks.length - 1];
        const created = await api.createBlock({
          parentId: pageId!,
          afterId: last.depth === 0 ? last.id : null,
          type: 'paragraph',
          text: '',
        });
        focusAfterRender = created.id;
        await reload();
      });
    });
    body.append(add);

    if (focusAfterRender) {
      const target = body.querySelector<HTMLTextAreaElement>(`textarea[data-block-id="${focusAfterRender}"]`);
      focusAfterRender = null;
      if (target) { target.focus(); target.setSelectionRange(target.value.length, target.value.length); }
    }
  };

  const reload = async (): Promise<void> => {
    if (!pageId) return;
    detail = await api.readPage(pageId);
    paint();
  };

  return {
    el: root,
    open: async (id: string) => {
      pageId = id;
      await guard(reload);
    },
    reload: () => guard(reload),
    currentPageId: () => pageId,
    currentTitle: () => detail?.page.title ?? title.value ?? '',
  };
}
