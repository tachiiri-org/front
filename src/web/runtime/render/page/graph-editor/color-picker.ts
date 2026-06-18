import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_DIM, PRESET_COLORS } from './constants';
import { apiUpdateColor } from './api';

export function showColorPicker(
  ctx: GraphEditorContext,
  anchor: HTMLElement,
  node: ExplorerNode,
  colIndex: number,
): void {
  document.querySelector('.ge-color-picker')?.remove();
  const picker = document.createElement('div');
  picker.className = 'ge-color-picker';
  picker.style.cssText = `
    position:fixed;display:flex;align-items:center;gap:6px;
    background:#2a2a2a;border:1px solid ${BORDER};border-radius:6px;
    padding:6px 8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);
  `;
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom + 4}px`;

  for (const c of PRESET_COLORS) {
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width:16px;height:16px;border-radius:3px;cursor:pointer;box-sizing:border-box;
      background:${c ?? 'transparent'};
      border:${c ? 'none' : `1.5px solid ${TEXT_DIM}`};
      display:flex;align-items:center;justify-content:center;
      color:${TEXT_DIM};font-size:11px;
    `;
    if (!c) swatch.textContent = '×';
    swatch.addEventListener('mousedown', (e) => {
      e.preventDefault();
      node.color = c ?? undefined;
      void apiUpdateColor(ctx.gId, node.id, c);
      const colEl = ctx.columnsEl.children[colIndex];
      if (colEl) {
        const row = colEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
        if (row) {
          const markerEl = row.querySelector<HTMLElement>('[data-marker]');
          if (markerEl) {
            markerEl.style.background = node.color ?? 'transparent';
            markerEl.style.border = node.color ? 'none' : `1.5px solid ${TEXT_DIM}`;
            markerEl.dataset.markerColor = node.color ?? '';
          }
        }
      }
      picker.remove();
    });
    picker.appendChild(swatch);
  }

  document.body.appendChild(picker);
  const dismiss = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) {
      picker.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}
