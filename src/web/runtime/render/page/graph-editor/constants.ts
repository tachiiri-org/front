import type { ExplorerNode } from './types';

export const BG = '#1e1e1e';
export const BORDER = '#333';
export const TEXT_HIGH = '#e0e0e0';
export const TEXT_MID = '#aaa';
export const TEXT_DIM = '#555';
export const SELECT_STRONG = '#3a6ea8';

// Reserved id for the synthetic "リンクなし" entry. Used by the relation panel to distinguish the
// orphan-relations view (参加ノードを持たない関係) from a real node target.
export const ORPHAN_ID = '__orphan__';
export const ORPHAN_LABEL = 'リンクなし';

// 画面下部に短時間表示する通知トースト（コピー完了・保存失敗など）。ノードパネル/関係パネル共通。
export function showToast(msg: string) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(30,30,40,0.95)', 'color:#fff',
    'border:1px solid rgba(255,255,255,0.15)',
    'padding:6px 14px', 'border-radius:6px', 'font-size:12px',
    'z-index:9999', 'white-space:nowrap', 'pointer-events:none',
    'opacity:1', 'transition:opacity 0.4s ease',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1400);
  setTimeout(() => el.remove(), 1800);
}

export const PRESET_COLORS: Array<string | null> = [
  'rgba(255,190,60,0.90)',
  'rgba(200,120,255,0.90)',
  'rgba(60,220,120,0.90)',
  'rgba(80,160,255,0.90)',
  'rgba(255,100,100,0.90)',
  'rgba(60,220,220,0.90)',
  null,
];

export function primaryLabel(node: ExplorerNode, lang: 'en' | 'ja'): string | null {
  return lang === 'en' ? (node.en ?? null) : (node.ja ?? null);
}

export function fallbackLabel(node: ExplorerNode, lang: 'en' | 'ja'): string {
  const other = lang === 'en' ? node.ja : node.en;
  return other ?? '';
}
