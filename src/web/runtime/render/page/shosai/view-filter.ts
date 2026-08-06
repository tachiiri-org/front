// Notion のビューの式を手元で解く。
//
// 実測でわかったこと:
//  - filter は null で来る。絞り込みは quick_filters に入る
//  - 鍵は Notion のプロパティ ID（"J<N\\" のような短い文字列）
//  - 値は文書化されたフィルタ式と同じ形（{"select":{"equals":"日記"}} など）
//  - sorts も Notion のプロパティ ID で参照する
//
// 取り込んでいないもの（formula / rollup / people / files）を参照する条件は
// 評価できない。黙って全件出すと「絞り込めているつもり」になるので、
// 評価できなかったことを呼び出し側へ返す。

import type { PropertyDef, ViewDef } from './api';

export interface RowLike {
  id: string; title: string; cells: Record<string, unknown>;
  notionCreatedAt?: number | null; notionEditedAt?: number | null;
  updatedAt?: number | null;
}

/**
 * 既定の並び。ビューも並べ替えも指定していないときに使う。
 * 更新の新しい順。取り込んだままの順（作成順）だと、直したものが下に埋もれる。
 * Notion 側の更新日時があればそれを優先する（取り込み日時は全行ほぼ同じ値になる）。
 */
export function byRecent<T extends RowLike>(rows: T[]): T[] {
  const at = (r: RowLike): number => r.notionEditedAt ?? r.updatedAt ?? r.notionCreatedAt ?? 0;
  return [...rows].sort((a, b) => at(b) - at(a));
}

export interface Applied {
  rows: RowLike[];
  /** 評価できなかった条件のプロパティ名。画面で断っておくために返す。 */
  unsupported: string[];
}

/** タイムゾーンつきで「その日の 0 時」を求める。相対日付（今週・先月）の起点。 */
function startOfDay(at: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = f.format(new Date(at)).split('-').map(Number);
  // その地域の 0 時が UTC で何時かは、同じ時刻の表示差から求める。
  const guess = Date.UTC(y, m - 1, d);
  const shown = new Date(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(guess)).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6Z')).getTime();
  return guess + (guess - shown);
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object'
      ? String((x as { name?: string; title?: string }).name ?? (x as { title?: string }).title ?? '')
      : String(x))).join(' ');
  }
  return '';
}

function isEmpty(v: unknown): boolean {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 1つの条件を解く。解けなければ null（＝この条件は無いものとして扱う）。 */
function testCondition(cond: Record<string, unknown>, value: unknown, now: number, tz: string): boolean | null {
  const [kind, rawBody] = Object.entries(cond)[0] ?? [];
  if (!kind || rawBody == null || typeof rawBody !== 'object') return null;
  const body = rawBody as Record<string, unknown>;
  const [op, operand] = Object.entries(body)[0] ?? [];
  if (!op) return null;

  // 空かどうかは型によらず同じ。
  if (op === 'is_empty') return isEmpty(value) === (operand === true);
  if (op === 'is_not_empty') return (!isEmpty(value)) === (operand === true);

  switch (kind) {
    case 'title':
    case 'rich_text':
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number': {
      const s = cellText(value);
      const t = String(operand ?? '');
      if (op === 'equals') return s === t;
      if (op === 'does_not_equal') return s !== t;
      if (op === 'contains') return s.includes(t);
      if (op === 'does_not_contain') return !s.includes(t);
      if (op === 'starts_with') return s.startsWith(t);
      if (op === 'ends_with') return s.endsWith(t);
      return null;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(cellText(value));
      const t = Number(operand);
      if (Number.isNaN(n) || Number.isNaN(t)) return null;
      if (op === 'equals') return n === t;
      if (op === 'does_not_equal') return n !== t;
      if (op === 'greater_than') return n > t;
      if (op === 'less_than') return n < t;
      if (op === 'greater_than_or_equal_to') return n >= t;
      if (op === 'less_than_or_equal_to') return n <= t;
      return null;
    }
    case 'checkbox':
      if (op === 'equals') return (value === true) === (operand === true);
      if (op === 'does_not_equal') return (value === true) !== (operand === true);
      return null;
    case 'select':
    case 'status': {
      const names = Array.isArray(value)
        ? (value as Array<{ name?: string }>).map((o) => o?.name ?? '')
        : [cellText(value)];
      const t = String(operand ?? '');
      if (op === 'equals') return names.includes(t);
      if (op === 'does_not_equal') return !names.includes(t);
      return null;
    }
    case 'multi_select': {
      const names = Array.isArray(value) ? (value as Array<{ name?: string }>).map((o) => o?.name ?? '') : [];
      const t = String(operand ?? '');
      if (op === 'contains') return names.includes(t);
      if (op === 'does_not_contain') return !names.includes(t);
      return null;
    }
    case 'relation': {
      const ids = Array.isArray(value) ? (value as Array<{ id?: string }>).map((r) => r?.id ?? '') : [];
      const t = String(operand ?? '');
      if (op === 'contains') return ids.includes(t);
      if (op === 'does_not_contain') return !ids.includes(t);
      return null;
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const at = typeof value === 'number' ? value : Date.parse(cellText(value));
      if (Number.isNaN(at)) return op === 'is_empty';
      const today = startOfDay(now, tz);
      const day = 86400000;
      if (op === 'equals') return startOfDay(at, tz) === startOfDay(Date.parse(String(operand)), tz);
      if (op === 'before') return at < Date.parse(String(operand));
      if (op === 'after') return at > Date.parse(String(operand));
      if (op === 'on_or_before') return at <= Date.parse(String(operand)) + day - 1;
      if (op === 'on_or_after') return at >= Date.parse(String(operand));
      // 相対日付。起点はタイムゾーンつきの「その日の 0 時」。
      if (op === 'past_week') return at >= today - 7 * day && at <= now;
      if (op === 'past_month') return at >= today - 30 * day && at <= now;
      if (op === 'past_year') return at >= today - 365 * day && at <= now;
      if (op === 'this_week') return at >= today - ((new Date(today).getUTCDay() + 6) % 7) * day && at < today + day;
      if (op === 'next_week') return at > now && at <= today + 7 * day;
      if (op === 'next_month') return at > now && at <= today + 30 * day;
      if (op === 'next_year') return at > now && at <= today + 365 * day;
      return null;
    }
    default:
      // formula / rollup / people / files など、取り込んでいないもの。
      return null;
  }
}

/** ビューの式を適用する。解けない条件は無いものとして扱い、その旨を返す。 */
export function applyView(
  rows: RowLike[], props: PropertyDef[], view: ViewDef | null, timeZone: string, now = Date.now(),
): Applied {
  if (!view) return { rows, unsupported: [] };
  // 鍵は Notion のプロパティ ID。ただし画面で組んだ条件は自前の列 ID で来る
  // （Notion 由来でない列にも条件を付けられるようにするため）。どちらも引けるようにする。
  const byNotionId = new Map<string, PropertyDef>();
  for (const p of props) {
    if (p.notionId) byNotionId.set(p.notionId, p);
    byNotionId.set(p.id, p);
  }
  const unsupported = new Set<string>();

  const valueOf = (row: RowLike, notionId: string): { value: unknown; known: boolean } => {
    // title と、Notion 側の作成・更新日時は列ではなく行そのものが持つ。
    if (notionId === 'title') return { value: row.title, known: true };
    const p = byNotionId.get(notionId);
    if (!p) return { value: null, known: false };
    return { value: row.cells[p.id], known: true };
  };

  let out = rows;
  const quick = safeParse(view.quickFilters);
  if (quick && typeof quick === 'object') {
    for (const [notionId, cond] of Object.entries(quick as Record<string, Record<string, unknown>>)) {
      const p = byNotionId.get(notionId);
      out = out.filter((row) => {
        const { value, known } = valueOf(row, notionId);
        if (!known) return true;   // 取り込んでいない列は条件を効かせない
        const r = testCondition(cond, value, now, timeZone);
        if (r === null) { unsupported.add(p?.name ?? notionId); return true; }
        return r;
      });
      if (!p && notionId !== 'title') unsupported.add(notionId);
    }
  }

  const sorts = safeParse(view.sorts);
  if (Array.isArray(sorts) && sorts.length) {
    const rules = sorts as Array<{ property?: string; timestamp?: string; direction?: string }>;
    out = [...out].sort((a, b) => {
      for (const s of rules) {
        const dir = s.direction === 'descending' ? -1 : 1;
        let av: unknown; let bv: unknown;
        if (s.timestamp === 'created_time' || s.property === 'created_time') {
          av = a.notionCreatedAt; bv = b.notionCreatedAt;
        } else if (s.timestamp === 'last_edited_time' || s.property === 'last_edited_time') {
          av = a.notionEditedAt; bv = b.notionEditedAt;
        } else if (s.property) {
          av = valueOf(a, s.property).value; bv = valueOf(b, s.property).value;
        }
        const c = compare(av, bv);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
  }
  return { rows: out, unsupported: [...unsupported] };
}

function compare(a: unknown, b: unknown): number {
  const ea = isEmpty(a); const eb = isEmpty(b);
  if (ea && eb) return 0;
  if (ea) return 1;   // 空は後ろ
  if (eb) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return cellText(a).localeCompare(cellText(b), 'ja');
}

function safeParse(s: string | null | undefined): unknown {
  if (!s) return null;
  try { return JSON.parse(s) as unknown; } catch { return null; }
}
