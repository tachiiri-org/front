import type { ExplorerNode } from './types';

export const BG = '#1e1e1e';
export const BORDER = '#333';
export const TEXT_HIGH = '#e0e0e0';
export const TEXT_MID = '#aaa';
export const TEXT_DIM = '#555';
export const SELECT_STRONG = '#3a6ea8';

// Reserved id for the synthetic "リンクなし" entry (parentless nodes inbox). Selecting it in the
// node panel makes the relation dock list the orphan nodes (GET /node/__orphan__/children).
export const ORPHAN_ID = '__orphan__';
export const ORPHAN_LABEL = 'リンクなし';

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
