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
  /** カード会社。取り込みの差し替え単位（同じ請求年月に複数社が並ぶ） */
  issuer: string;
  billingMonth: string;
  /** CSV 末尾の合計行に書かれた金額。無ければ null */
  declaredTotal: number | null;
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

/**
 * 引用符を尊重して1行を分割する。ビューカードは千区切りのために "1,000" と囲ってくる。
 * ゴールドポイント側は引用符を使わないので、そちらに通しても結果は変わらない。
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

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

/**
 * ビューカードの明細 CSV。
 *
 * 実測仕様: 先頭に4行のヘッダ（会員番号/対象カード/お支払日/今回お支払金額）、
 * 続いて列見出し1行、以降は明細。明細の途中に「****-****-****-9526 伊藤　駿」という
 * 1列の名義行が挟まり、そこから次の名義行までがその人の利用。
 *
 * 列は11。金額は「今回ご請求額」（8列目）を使う。分割払いだと「ご利用額」と食い違い、
 * 実際に引き落ちるのは今回ご請求額のほうだから。ヘッダの「今回お支払金額」と一致する。
 */
function parseViewCard(lines: string[], fileName: string): ParsedCsv | null {
  const head = new Map<string, string>();
  for (const l of lines.slice(0, 8)) {
    const c = splitCsvLine(l);
    if (c.length >= 2) head.set(c[0].trim(), c.slice(1).join(',').trim());
  }
  if (!head.has('会員番号') && !head.has('対象カード')) return null;

  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  // 請求年月は「お支払日」から取る。利用日は前々月から前月に散らばるので使えない。
  const pay = /(\d{4})年\s*(\d{1,2})月/.exec(head.get('お支払日') ?? '');
  const billingMonth = pay ? `${pay[1]}-${zero(pay[2])}` : '';
  if (!billingMonth) errors.push('お支払日から請求年月を読み取れませんでした');
  const declaredTotal = toInt(head.get('今回お支払金額'));

  let holder = 'ご本人';
  lines.forEach((line, i) => {
    const raw = splitCsvLine(line);
    const first = (raw[0] ?? '').trim();
    if (raw.length <= 2 && /^(会員番号|対象カード|お支払日|今回お支払金額)$/.test(first)) return;
    if (first.startsWith('ご利用年月日')) return;
    // 名義行。以降の明細はこの人のもの。
    if (raw.length <= 2 && /\*{2,}/.test(first)) {
      const m = /\*[-*\d]*\s+(.+)$/.exec(first);
      holder = m ? norm(m[1]) : first;
      return;
    }
    const c = fitColumns(raw, 11, 9);
    if (!c) {
      errors.push(`${i + 1}行目: 列数 ${raw.length}（11のはず）: ${line.slice(0, 80)}`);
      return;
    }
    const usedOn = toDate(c[0]);
    if (!usedOn) { errors.push(`${i + 1}行目: 利用日が不正 ${c[0]}`); return; }
    const amount = toInt(c[7]);
    if (amount === null) { errors.push(`${i + 1}行目: 今回ご請求額が不正 ${c[7]}`); return; }
    const fa = (c[8] ?? '').trim();
    const isForeign = fa !== '' || (c[9] ?? '').trim() !== '';
    rows.push({
      usedOn,
      shop: c[1].trim(), shopKey: norm(c[1]),
      card: holder, cardKey: norm(holder),
      payType: norm(c[5]), installments: norm(c[6]),
      payMonth: billingMonth,
      amountJpy: amount,
      paymentTotal: toInt(c[4]), feeJpy: null,
      isForeign,
      foreignAmount: isForeign ? fa : '',
      currency: isForeign ? (c[9] ?? '').trim() : '',
      fxRate: isForeign ? (c[10] ?? '').trim() : '',
      fxDate: '',
      remark: '',
      dupIndex: 0,
    });
  });

  numberDuplicates(rows);
  const rowsTotal = rows.reduce((a, r) => a + r.amountJpy, 0);
  if (declaredTotal !== null && declaredTotal !== rowsTotal) {
    errors.push(`合計が一致しません（今回お支払金額 ${declaredTotal} / 明細合計 ${rowsTotal}）`);
  }
  return {
    fileName, issuer: 'ビューカード', billingMonth, declaredTotal,
    rowCount: rows.length, rowsTotal, rows, errors,
  };
}

/** 同一(利用日+店+カード)内の連番 */
function numberDuplicates(rows: ParsedRow[]): void {
  const counter = new Map<string, number>();
  for (const r of rows) {
    const k = [r.usedOn, r.shopKey, r.cardKey].join('\u0001');
    const n = counter.get(k) ?? 0;
    r.dupIndex = n;
    counter.set(k, n + 1);
  }
}

export function parseGoldpointCsv(text: string, fileName: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  if (!lines.length) {
    return { fileName, issuer: 'ヨドバシカード', billingMonth: '', declaredTotal: null, rowCount: 0, rowsTotal: 0, rows: [], errors: ['中身が空です'] };
  }
  if (/^\s*(<!DOCTYPE|<html)/i.test(text)) {
    return { fileName, issuer: 'ヨドバシカード', billingMonth: '', declaredTotal: null, rowCount: 0, rowsTotal: 0, rows: [], errors: ['CSV ではなく HTML です'] };
  }

  // ビューカードは別会社の別形式。ヘッダの「会員番号／対象カード」で見分ける。
  const view = parseViewCard(lines, fileName);
  if (view) return view;

  // ゴールドポイントカード+ の CSV は2種類ある。
  //  A) 確定前（支払予定分）: 13列・ヘッダ無し・支払予定月の列あり
  //  B) 確定済み: 7列・先頭に3列のヘッダ行（氏名/カード番号/カード名称）・支払予定月の列なし
  // B は請求年月を中身から決められないので、ファイル名 yyyyMM.csv（支払月）を使う。
  const widths = lines
    .map((l) => l.split(','))
    .filter((c) => !(c.length === 3 && /\*{2,}/.test(c[1] ?? '')))
    .map((c) => c.length);
  const isConfirmed = widths.filter((w) => w === 7).length > widths.filter((w) => w === 13).length;
  const expected = isConfirmed ? 7 : 13;

  // 店名より後ろの列数。ここを固定値として末尾から数え、間を店名に畳んで復元する。
  const tailCount = isConfirmed ? 5 : 11;
  // CSV 末尾に「,,,,,278249,」のような合計行が入る。取りこぼしを検出できる唯一の手がかりなので
  // 読み捨てずに拾い、明細合計との一致を必須条件にする。
  let declaredTotal: number | null = null;

  lines.forEach((line, i) => {
    const raw = line.split(',');
    // 氏名・カード番号・カード名称のヘッダ行。1ファイルに複数枚のカードが入ることがあり、
    // 枚数ぶん途中にも現れる（先頭だけ飛ばす実装では2枚目で列数エラーになっていた）。
    if (isConfirmed && raw.length === 3 && /\*{2,}/.test(raw[1] ?? '')) return;
    // 店名に ASCII カンマが入ると列がずれる。末尾から数えて復元を試み、駄目なら取り込ませない。
    const c = fitColumns(raw, expected, tailCount);
    if (!c) {
      errors.push(`${i + 1}行目: 列数 ${raw.length}（${expected}のはず）: ${line.slice(0, 80)}`);
      return;
    }
    // 合計行は利用日も店名も空で、金額欄だけ埋まっている
    if (c[0].trim() === '' && c[1].trim() === '') {
      const t = toInt(c[isConfirmed ? 5 : 6]);
      if (t !== null) { declaredTotal = t; return; }
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

  const rowsTotal = rows.reduce((a, r) => a + r.amountJpy, 0);
  // 合計行があるなら一致を必須にする。ページングで3割の行を落としかけた実績があるので、
  // 検証できる手段がある場合はそれを使い切る。
  if (declaredTotal !== null && declaredTotal !== rowsTotal) {
    errors.push(`合計が一致しません（ファイルの合計行 ${declaredTotal} / 明細合計 ${rowsTotal}）`);
  }

  return {
    fileName,
    issuer: 'ヨドバシカード',
    billingMonth,
    declaredTotal,
    rowCount: rows.length,
    rowsTotal,
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
