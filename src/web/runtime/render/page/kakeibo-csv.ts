// ゴールドポイントカード+ の明細 CSV をファイルから読み込む。
//
// 確定済みの月は CSV 直リンク（downloadKey=2）が空を返すため、ブックマークレット経由では
// 取れない。画面の「CSVファイルのダウンロード」で落としたファイルを取り込むための経路。
//
// CSV の実測仕様: ヘッダ行なし・13列固定・Windows-31J
//   1 利用日 2026/7/31（ゼロ埋めなし） / 2 店名 / 3 カード / 4 支払区分 / 5 分割回数
//   6 支払予定月 '26/08（Excel の日付変換除けで先頭にアポストロフィ）
//   7 ご利用金額 / 8 お支払い総額（外貨行は空） / 9 内手数料
//   10-13 現地通貨額・通貨・換算レート・換算日（外貨行のみ）

export type ParsedRow = {
  usedOn: string;
  shop: string;
  shopKey: string;
  card: string;
  cardKey: string;
  payType: string;
  installments: string;
  payMonth: string;
  amountJpy: number;
  paymentTotal: number | null;
  feeJpy: number | null;
  isForeign: boolean;
  foreignAmount: string;
  currency: string;
  fxRate: string;
  fxDate: string;
  dupIndex: number;
};

export type ParsedCsv = {
  fileName: string;
  billingMonth: string;
  rowCount: number;
  rowsTotal: number;
  rows: ParsedRow[];
  errors: string[];
};

const zero = (s: string | number): string => String(s).padStart(2, '0');

const toDate = (s: string): string => {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s.trim());
  return m ? `${m[1]}-${zero(m[2])}-${zero(m[3])}` : '';
};

const toMonth = (s: string): string => {
  const m = /^'?(\d{2})\/(\d{1,2})$/.exec(s.trim());
  return m ? `20${m[1]}-${zero(m[2])}` : '';
};

const toInt = (s: string | undefined): number | null => {
  const t = String(s ?? '').replace(/[',]/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const norm = (s: string): string => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();

export function parseGoldpointCsv(text: string, fileName: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  if (!lines.length) {
    return { fileName, billingMonth: '', rowCount: 0, rowsTotal: 0, rows: [], errors: ['中身が空です'] };
  }
  if (/^\s*(<!DOCTYPE|<html)/i.test(text)) {
    return { fileName, billingMonth: '', rowCount: 0, rowsTotal: 0, rows: [], errors: ['CSV ではなく HTML です'] };
  }

  lines.forEach((line, i) => {
    const c = line.split(',');
    // 実データは店名の読点が全角なので split(',') が通るが、ASCII カンマが来ると
    // 静かに列がずれる。列数を検証して、ずれたら取り込ませない。
    if (c.length !== 13) {
      errors.push(`${i + 1}行目: 列数 ${c.length}（13のはず）: ${line.slice(0, 80)}`);
      return;
    }
    const usedOn = toDate(c[0]);
    const amount = toInt(c[6]);
    if (!usedOn) { errors.push(`${i + 1}行目: 利用日が不正 ${c[0]}`); return; }
    if (amount === null) { errors.push(`${i + 1}行目: 金額が不正 ${c[6]}`); return; }
    const fa = (c[9] ?? '').trim();
    const isForeign = fa !== '' || (c[10] ?? '').trim() !== '';
    rows.push({
      usedOn,
      shop: c[1].trim(), shopKey: norm(c[1]),
      card: c[2].trim(), cardKey: norm(c[2]),
      payType: c[3].trim(), installments: c[4].trim(), payMonth: toMonth(c[5]),
      amountJpy: amount, paymentTotal: toInt(c[7]), feeJpy: toInt(c[8]),
      isForeign,
      foreignAmount: isForeign ? fa : '',
      currency: isForeign ? (c[10] ?? '').trim() : '',
      fxRate: isForeign ? (c[11] ?? '').trim() : '',
      fxDate: isForeign ? (c[12] ?? '').trim() : '',
      dupIndex: 0,
    });
  });

  // 同一(利用日+店+カード)内の連番。表は利用日の降順で新しい利用が先頭に挿入されるため、
  // 全体の通し番号だと毎回ずれる。グループ内なら他の日に何件増えても影響しない。
  const counter = new Map<string, number>();
  for (const r of rows) {
    const k = [r.usedOn, r.shopKey, r.cardKey].join('');
    const n = counter.get(k) ?? 0;
    r.dupIndex = n;
    counter.set(k, n + 1);
  }

  // 請求年月は支払予定月の列から決める。ファイル名や画面の表示に依存しない。
  // 全行が同じ月であることが前提なので、混在していたら取り込ませない。
  const months = [...new Set(rows.map((r) => r.payMonth).filter(Boolean))];
  let billingMonth = '';
  if (months.length === 1) {
    billingMonth = months[0];
  } else if (months.length > 1) {
    errors.push(`支払予定月が混在しています: ${months.join(' / ')}`);
  } else {
    // 支払予定月が空なら、ファイル名の先頭6桁（yyyyMM）を保険に使う
    const m = /(\d{4})(\d{2})/.exec(fileName);
    if (m) billingMonth = `${m[1]}-${m[2]}`;
    else errors.push('請求年月を判別できません（支払予定月もファイル名も手がかりなし）');
  }

  return {
    fileName,
    billingMonth,
    rowCount: rows.length,
    rowsTotal: rows.reduce((a, r) => a + r.amountJpy, 0),
    rows,
    errors,
  };
}

/** Shift_JIS のファイルを読んで解析する */
export async function readGoldpointCsvFile(file: File): Promise<ParsedCsv> {
  const buf = await file.arrayBuffer();
  const text = new TextDecoder('shift_jis').decode(buf);
  return parseGoldpointCsv(text, file.name);
}
