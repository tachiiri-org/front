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
  remark: string;
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

/**
 * 店名に ASCII カンマが含まれる行を復元する。
 *
 * 例: 2026/02/10,GITHUB, INC. (GITHUB.COM ),707,１,１,707,4.40　USD　160.708　02 11
 * 値は引用符で囲われていないので一般的な CSV パーサでは解決しない。ただし列数は固定で、
 * カンマが混ざるのは店名だけなので、先頭1列と末尾 tailCount 列を固定して間を店名に畳めば戻せる。
 */
function fitColumns(cols: string[], expected: number, tailCount: number): string[] | null {
  if (cols.length === expected) return cols;
  if (cols.length < expected) return null;
  const shopEnd = cols.length - tailCount;
  if (shopEnd < 1) return null;
  return [cols[0], cols.slice(1, shopEnd).join(','), ...cols.slice(shopEnd)];
}

/**
 * 7列形式では、外貨取引の換算情報が備考欄に全角スペース区切りで入る。
 * 例: "4.40　USD　160.708　02 11" → 4.40 USD / レート 160.708 / 換算日 02 11
 */
function parseForeignRemark(remark: string): { amount: string; currency: string; rate: string; date: string } | null {
  const m = /^\s*([\d.,]+)[\s　]+([A-Z]{3})[\s　]+([\d.,]+)[\s　]+(.+?)\s*$/.exec(remark);
  return m ? { amount: m[1], currency: m[2], rate: m[3], date: m[4] } : null;
}

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

  // CSV は2種類ある。
  //  A) 確定前（支払予定分）: 13列・ヘッダ無し・支払予定月の列あり
  //  B) 確定済み: 7列・先頭に3列のヘッダ行（氏名/カード番号/カード名称）・支払予定月の列なし
  // B は請求年月を中身から決められないので、ファイル名 yyyyMM.csv（支払月）を使う。
  const widths = lines.map((l) => l.split(',').length);
  const isConfirmed = widths.filter((w) => w === 7).length > widths.filter((w) => w === 13).length;
  const expected = isConfirmed ? 7 : 13;

  // 店名より後ろの列数。ここを固定値として末尾から数え、間を店名に畳んで復元する。
  const tailCount = isConfirmed ? 5 : 11;

  lines.forEach((line, i) => {
    const raw = line.split(',');
    // 確定済み版の先頭行は氏名・カード番号・カード名称のヘッダ。データではないので飛ばす。
    if (isConfirmed && i === 0 && raw.length === 3) return;
    // 店名に ASCII カンマが入ると列がずれる。末尾から数えて復元を試み、駄目なら取り込ませない。
    const c = fitColumns(raw, expected, tailCount);
    if (!c) {
      errors.push(`${i + 1}行目: 列数 ${raw.length}（${expected}のはず）: ${line.slice(0, 80)}`);
      return;
    }
    const usedOn = toDate(c[0]);
    if (!usedOn) { errors.push(`${i + 1}行目: 利用日が不正 ${c[0]}`); return; }

    if (isConfirmed) {
      // 7列: 利用日 / 店名 / ご利用金額 / 支払区分 / 回数 / お支払い金額 / 備考
      const amount = toInt(c[2]);
      if (amount === null) { errors.push(`${i + 1}行目: 金額が不正 ${c[2]}`); return; }
      const kubun = norm(c[3]);
      const remarkRaw = (c[6] ?? '').trim();
      // 7列形式には外貨用の列が無く、換算情報が備考欄に入る。
      // 備考として素通りさせると外貨取引だと分からなくなるので、ここで取り出す。
      const fx = parseForeignRemark(remarkRaw);
      rows.push({
        usedOn,
        shop: c[1].trim(), shopKey: norm(c[1]),
        // 確定済み版に名義の列は無い。家族カードは無い前提で「ご本人」に寄せ、
        // 確定前版と同じ店・同じカードとして突き合わせられるようにする。
        card: 'ご本人', cardKey: 'ご本人',
        payType: kubun === '1' ? '1回払い' : kubun,
        installments: norm(c[4]),
        payMonth: '', // 呼び出し側がファイル名から決めた請求年月で埋める
        amountJpy: amount,
        paymentTotal: toInt(c[5]), feeJpy: null,
        isForeign: fx !== null,
        foreignAmount: fx ? fx.amount : '',
        currency: fx ? fx.currency : '',
        fxRate: fx ? fx.rate : '',
        fxDate: fx ? fx.date : '',
        remark: fx ? '' : remarkRaw,
        dupIndex: 0,
      });
      return;
    }

    // 13列
    const amount = toInt(c[6]);
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
      remark: '',
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

  // 請求年月の決め方。
  //  A) 13列版: 支払予定月の列がある。全行が同じ月である前提なので、混在は弾く
  //  B) 7列版: 列が無いのでファイル名 yyyyMM.csv（支払月）から取る。
  //     利用日から「翌月が請求月」と推測する手もあるが、推測でずれても気づけないので採らない
  const fileMonth = /(\d{4})(\d{2})/.exec(fileName);
  let billingMonth = '';
  if (isConfirmed) {
    if (fileMonth) {
      billingMonth = `${fileMonth[1]}-${fileMonth[2]}`;
      // 支払予定月の列が無い形式なので、請求年月をそのまま支払予定月として埋める
      for (const r of rows) r.payMonth = billingMonth;
    } else {
      errors.push(`請求年月を判別できません。ファイル名を yyyyMM.csv 形式にしてください（現在: ${fileName}）`);
    }
  } else {
    const months = [...new Set(rows.map((r) => r.payMonth).filter(Boolean))];
    if (months.length === 1) {
      billingMonth = months[0];
    } else if (months.length > 1) {
      errors.push(`支払予定月が混在しています: ${months.join(' / ')}`);
    } else if (fileMonth) {
      billingMonth = `${fileMonth[1]}-${fileMonth[2]}`;
    } else {
      errors.push('請求年月を判別できません');
    }
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
