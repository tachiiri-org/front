import type { TextEditorComponent } from '../../../schema/component/kind/text-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

type NodeFocusDetail = { outlinerFrameId: string; nodeId: string; nodeText: string };
type NodeTextChangeDetail = { outlinerFrameId: string; nodeId: string; nodeText: string };

const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = c[propKey];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[propKey] = v;
  }
};

export const renderTextEditor = (id: string, component: TextEditorComponent): HTMLElement => {
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.style.display = 'flex';
  outer.style.flexDirection = 'column';
  outer.style.overflow = 'hidden';
  outer.style.boxSizing = 'border-box';
  outer.style.padding = '8px 12px';
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  const docHeader = document.createElement('div');
  Object.assign(docHeader.style, {
    fontSize: '11px',
    color: 'rgba(0,0,0,0.4)',
    marginBottom: '4px',
    userSelect: 'none',
    flexShrink: '0',
  });

  const docTextarea = document.createElement('textarea');
  docTextarea.placeholder = 'テキストを入力...';
  Object.assign(docTextarea.style, {
    flex: '1',
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    resize: 'none',
    boxSizing: 'border-box',
    color: 'inherit',
    padding: '0',
  });

  outer.appendChild(docHeader);
  outer.appendChild(docTextarea);

  let focusedNodeId: string | null = null;
  let docSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleDocSave = (nodeId: string, content: string): void => {
    if (docSaveTimer) clearTimeout(docSaveTimer);
    docSaveTimer = setTimeout(() => {
      void fetch(`/api/docs/${encodeURIComponent(nodeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    }, 500);
  };

  docTextarea.addEventListener('input', () => {
    if (focusedNodeId) scheduleDocSave(focusedNodeId, docTextarea.value);
  });

  document.addEventListener('outliner:node-focus', (e: Event) => {
    const detail = (e as CustomEvent<NodeFocusDetail>).detail;
    if (component.sourceComponentId && detail.outlinerFrameId !== component.sourceComponentId) return;
    focusedNodeId = detail.nodeId;
    docHeader.textContent = detail.nodeText || '(no title)';
    docTextarea.value = '';
    void fetch(`/api/docs/${encodeURIComponent(detail.nodeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (focusedNodeId !== detail.nodeId) return;
        const content = (data as Record<string, unknown> | null)?.content;
        docTextarea.value = typeof content === 'string' ? content : '';
      })
      .catch(() => undefined);
  });

  document.addEventListener('outliner:node-text-change', (e: Event) => {
    const detail = (e as CustomEvent<NodeTextChangeDetail>).detail;
    if (component.sourceComponentId && detail.outlinerFrameId !== component.sourceComponentId) return;
    if (detail.nodeId === focusedNodeId) {
      docHeader.textContent = detail.nodeText || '(no title)';
    }
  });

  return outer;
};
