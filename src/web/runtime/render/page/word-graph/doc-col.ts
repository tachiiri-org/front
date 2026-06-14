import type { WordGraphDocColComponent } from '../../../../schema/component/kind/word-graph-col';
import { applyCssProps, graphFetch } from './ops';
import { getOrCreateGraphState } from './store';
import type { GraphDocument } from '../../../../schema/component/kind/word-graph';
import { theme } from '../theme';

const supportsFieldSizing = CSS.supports('field-sizing', 'content');

export const renderWordGraphDocCol = (
  id: string,
  component: WordGraphDocColComponent,
): HTMLElement => {
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.dataset.graphId = component.graphId;
  outer.style.overflow = 'hidden';
  outer.style.display = 'flex';
  outer.style.flexDirection = 'column';
  outer.style.boxSizing = 'border-box';
  outer.style.fontSize = '13px';
  outer.style.lineHeight = '1.5';
  outer.style.background = theme.bg;
  outer.style.color = theme.textHigh;
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  const graphId = component.graphId;
  const shared = getOrCreateGraphState(graphId);

  let loadedForTextId: string | null = null;
  let pendingDocFocus: { docId: string; cursorPos?: number } | null = null;

  const notify = (): void => {
    shared.subscribers.forEach((fn) => fn());
  };

  const createDocumentAt = (content: string, textId: string, insertAfterIndex: number): void => {
    const lang = shared.lang === 'ja' ? 'ja' : 'en';
    void graphFetch(`/api/graph/${encodeURIComponent(graphId)}/document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [lang]: content, textIds: [textId] }),
    })
      .then((r) => r.ok ? r.json() as Promise<unknown> : null)
      .then((data) => {
        if (!data) return;
        const d = data as { id: string; en?: string; ja?: string };
        const newDoc = { id: d.id, ...(d.en ? { en: d.en } : {}), ...(d.ja ? { ja: d.ja } : {}) };
        shared.documents.splice(insertAfterIndex + 1, 0, newDoc);
        pendingDocFocus = { docId: d.id, cursorPos: 0 };
        notify();
      });
  };

  const saveDocument = (docId: string, content: string): void => {
    const lang = shared.lang === 'ja' ? 'ja' : 'en';
    void graphFetch(`/api/graph/${encodeURIComponent(graphId)}/document/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [lang]: content }),
    });
  };

  const deleteDocument = (docId: string): void => {
    void graphFetch(`/api/graph/${encodeURIComponent(graphId)}/document/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
    shared.documents = shared.documents.filter((d) => d.id !== docId);
    notify();
  };

  const buildContent = (selectedTextId: string | null): HTMLElement => {
    const col = document.createElement('div');
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.flex = '1';
    col.style.minHeight = '0';
    col.style.overflowY = 'auto';
    col.style.padding = '4px 0';

    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px 2px 12px',
      flexShrink: '0',
      gap: '6px',
    });

    const typeLabel = document.createElement('div');
    Object.assign(typeLabel.style, {
      fontSize: '10px',
      color: theme.textFaint,
      userSelect: 'none',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      flex: '1',
    });
    typeLabel.textContent = 'documents';
    headerRow.appendChild(typeLabel);
    col.appendChild(headerRow);

    if (!selectedTextId) {
      return col;
    }

    // Draft input (new document)
    const draftRow = document.createElement('div');
    draftRow.style.display = 'flex';
    draftRow.style.alignItems = 'flex-start';
    draftRow.style.gap = '4px';
    draftRow.style.padding = '1px 8px 1px 12px';
    draftRow.style.flexShrink = '0';

    const draftMarker = document.createElement('span');
    Object.assign(draftMarker.style, {
      width: '6px',
      height: '6px',
      flexShrink: '0',
      alignSelf: 'center',
      borderRadius: '1px',
      boxSizing: 'border-box',
      background: 'transparent',
      border: `1.5px solid ${theme.borderStrong}`,
    });

    const draftInput = document.createElement('textarea');
    draftInput.rows = 1;
    Object.assign(draftInput.style, {
      display: 'block',
      width: '100%',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      padding: '2px 4px',
      boxSizing: 'border-box',
      background: 'transparent',
      color: theme.textDim,
    });
    (draftInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';

    draftInput.addEventListener('input', () => {
      if (!supportsFieldSizing) {
        draftInput.style.height = 'auto';
        draftInput.style.height = `${draftInput.scrollHeight}px`;
      }
    });

    draftInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = draftInput.value.trim();
        if (!text) return;
        createDocumentAt(text, selectedTextId, shared.documents.length - 1);
        draftInput.value = '';
        if (!supportsFieldSizing) draftInput.style.height = 'auto';
      }
    });

    draftRow.appendChild(draftMarker);
    draftRow.appendChild(draftInput);
    col.appendChild(draftRow);

    // Document items
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    for (const doc of shared.documents) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'flex-start';
      row.style.gap = '4px';
      row.style.padding = '4px 8px 4px 12px';
      row.style.flexShrink = '0';

      const marker = document.createElement('span');
      Object.assign(marker.style, {
        width: '6px',
        height: '6px',
        flexShrink: '0',
        alignSelf: 'flex-start',
        marginTop: '6px',
        borderRadius: '1px',
        boxSizing: 'border-box',
        background: 'transparent',
        border: `1.5px solid ${theme.markerDefault}`,
      });

      const content = shared.lang === 'ja' ? (doc.ja ?? doc.en ?? '') : (doc.en ?? doc.ja ?? '');
      const docInput = document.createElement('textarea');
      docInput.rows = 4;
      docInput.value = content;
      docInput.dataset.docId = doc.id;
      Object.assign(docInput.style, {
        display: 'block',
        width: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        padding: '2px 4px',
        boxSizing: 'border-box',
        background: 'transparent',
        color: 'inherit',
        minHeight: '5em',
      });
      (docInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';

      const originalContent = content;

      docInput.addEventListener('input', () => {
        if (!supportsFieldSizing) {
          docInput.style.height = 'auto';
          docInput.style.height = `${docInput.scrollHeight}px`;
        }
        const existing = saveTimers.get(doc.id);
        if (existing) clearTimeout(existing);
        saveTimers.set(doc.id, setTimeout(() => {
          saveTimers.delete(doc.id);
          saveDocument(doc.id, docInput.value);
        }, 500));
      });

      docInput.addEventListener('blur', () => {
        if (docInput.value !== originalContent) {
          const existing = saveTimers.get(doc.id);
          if (existing) { clearTimeout(existing); saveTimers.delete(doc.id); }
          saveDocument(doc.id, docInput.value);
        }
      });

      docInput.addEventListener('keydown', (e: KeyboardEvent) => {
        // Shift+Alt+Up: reorder doc up
        if (e.key === 'ArrowUp' && e.shiftKey && e.altKey) {
          e.preventDefault();
          const idx = shared.documents.findIndex((d) => d.id === doc.id);
          if (idx > 0) {
            [shared.documents[idx - 1], shared.documents[idx]] = [shared.documents[idx], shared.documents[idx - 1]];
            pendingDocFocus = { docId: doc.id };
            notify();
          }
          return;
        }
        // Shift+Alt+Down: reorder doc down
        if (e.key === 'ArrowDown' && e.shiftKey && e.altKey) {
          e.preventDefault();
          const idx = shared.documents.findIndex((d) => d.id === doc.id);
          if (idx < shared.documents.length - 1) {
            [shared.documents[idx], shared.documents[idx + 1]] = [shared.documents[idx + 1], shared.documents[idx]];
            pendingDocFocus = { docId: doc.id };
            notify();
          }
          return;
        }
        // Ctrl+Shift+Backspace: delete doc
        if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          const idx = shared.documents.findIndex((d) => d.id === doc.id);
          const focusDoc = idx > 0 ? shared.documents[idx - 1] : shared.documents[idx + 1];
          deleteDocument(doc.id);
          if (focusDoc) pendingDocFocus = { docId: focusDoc.id };
          return;
        }
        // Enter: create new doc after current (split at cursor)
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          const cursorPos = docInput.selectionStart ?? docInput.value.length;
          const before = docInput.value.slice(0, cursorPos);
          const after = docInput.value.slice(cursorPos);
          const langKey = shared.lang === 'ja' ? 'ja' : 'en';
          (doc as Record<string, string | undefined>)[langKey] = before;
          docInput.value = before;
          const existing = saveTimers.get(doc.id);
          if (existing) { clearTimeout(existing); saveTimers.delete(doc.id); }
          saveDocument(doc.id, before);
          if (selectedTextId) {
            const idx = shared.documents.findIndex((d) => d.id === doc.id);
            createDocumentAt(after, selectedTextId, idx);
          }
          return;
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      Object.assign(deleteBtn.style, {
        flexShrink: '0',
        border: 'none',
        background: 'transparent',
        color: theme.textFaint,
        cursor: 'pointer',
        fontSize: '14px',
        padding: '0 2px',
        lineHeight: '1.5',
        alignSelf: 'flex-start',
      });
      deleteBtn.addEventListener('click', () => deleteDocument(doc.id));

      row.appendChild(marker);
      row.appendChild(docInput);
      row.appendChild(deleteBtn);
      col.appendChild(row);
    }

    return col;
  };

  const render = (): void => {
    const selectedTextId = (shared.path[2] as string | undefined) ?? null;

    if (selectedTextId !== loadedForTextId) {
      loadedForTextId = selectedTextId;
      shared.documents = [];
      if (selectedTextId) {
        void graphFetch(`/api/graph/${encodeURIComponent(graphId)}/documents?text_id=${encodeURIComponent(selectedTextId)}`)
          .then((r) => r.ok ? r.json() as Promise<unknown> : { documents: [] })
          .then((data) => {
            const d = data as Record<string, unknown>;
            shared.documents = Array.isArray(d.documents) ? (d.documents as GraphDocument[]) : [];
            notify();
          })
          .catch(() => {});
      }
    }

    const prevCol = outer.firstElementChild as HTMLElement | null;
    const scrollTop = prevCol ? prevCol.scrollTop : 0;

    outer.replaceChildren(buildContent(selectedTextId));

    if (!supportsFieldSizing) {
      const tas = Array.from(outer.querySelectorAll<HTMLTextAreaElement>('textarea'));
      for (const ta of tas) ta.style.height = 'auto';
      const heights = tas.map(ta => ta.scrollHeight);
      for (let i = 0; i < tas.length; i++) tas[i].style.height = `${heights[i]}px`;
    }

    const newCol = outer.firstElementChild as HTMLElement | null;
    if (newCol) newCol.scrollTop = scrollTop;

    if (pendingDocFocus) {
      const { docId, cursorPos } = pendingDocFocus;
      pendingDocFocus = null;
      requestAnimationFrame(() => {
        const target = outer.querySelector<HTMLTextAreaElement>(`[data-doc-id="${CSS.escape(docId)}"]`);
        if (target) {
          target.focus({ preventScroll: true });
          if (cursorPos !== undefined) target.setSelectionRange(cursorPos, cursorPos);
        }
      });
    }
  };

  shared.subscribers.add(render);

  window.matchMedia('(max-width: 768px)').addEventListener('change', () => notify());

  render();
  return outer;
};
