// カード明細ページで動かすブックマークレットの本体。
//
// この関数はページ内では実行されない。toString() で直列化して javascript: URL にし、
// 利用者がブックマークとして登録する。よって外部の import やモジュールスコープの値を
// 参照してはならない（自己完結していること）。送信先は登録時のオリジンを埋め込むので、
// dev / stage / 本番で同じコードが使える。
//
// 明細ページ側から外部オリジンへ直接 fetch はしない。CSV は同一オリジンで取得し、
// 家計簿アプリのタブへ postMessage で渡す。相手サイトの CSP に左右されない。
export function goldpointBookmarklet(TARGET: string): void {
  const toast = (msg: string, isError?: boolean): HTMLElement => {
    const d = (document.getElementById('__gp_toast') as HTMLElement) || document.createElement('div');
    d.id = '__gp_toast';
    d.style.cssText =
      'position:fixed;z-index:2147483647;left:50%;top:20px;transform:translateX(-50%);' +
      'padding:12px 18px;border-radius:6px;font:14px/1.6 sans-serif;color:#fff;max-width:80vw;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.3);background:' + (isError ? '#c0392b' : '#2c3e50');
    d.textContent = msg;
    document.body.appendChild(d);
    return d;
  };

  const body = document.body.innerText.replace(/\s+/g, ' ');
  const pick = (re: RegExp): string => {
    const m = re.exec(body);
    return m ? m[1] : '';
  };

  // 請求年月は「◯年◯月◯日お支払い分」の見出しから取る。
  // 月の切り替えはプルダウン＋照会ボタンで行われ URL の p01 は変わらないため、
  // p01 を信じると画面の月を変えても常に同じ月を取り込んでしまう。p01 は保険。
  const pay = /(\d{4})年(\d{1,2})月\d{1,2}日お支払い分/.exec(body);
  const p01m = /[?&]p01=(\d{6})/.exec(location.href);
  const seikyuym = pay ? pay[1] + String(pay[2]).padStart(2, '0') : p01m ? p01m[1] : '';
  if (!seikyuym) {
    toast('請求年月を判別できませんでした。ご利用明細照会のページで実行してください', true);
    return;
  }
  const billingMonth = seikyuym.slice(0, 4) + '-' + seikyuym.slice(4);

  const shownTotalRaw = pick(/ご利用明細合計\s*([\d,]+)\s*円/).replace(/,/g, '');
  const shownTotal = shownTotalRaw ? Number(shownTotalRaw) : null;
  // 合計が読めないと取りこぼしを検出できない。検証できない取り込みは通さない。
  if (shownTotal === null) {
    toast('画面の合計金額を読み取れませんでした。取りこぼしを検出できないため中止します', true);
    return;
  }
  const asOf = pick(/(\d{4}年\d{1,2}月\d{1,2}日)\s*現在判明分/);

  toast(seikyuym.slice(0, 4) + '年' + Number(seikyuym.slice(4)) + '月請求分の CSV を取得しています…');

  const url =
    location.origin + '/memapi/jaxrs/dl/meisai/meisai_csv_dl/v1?downloadKey=2&seikyuym=' + seikyuym;

  fetch(url, { credentials: 'include' })
    .then((r) => {
      if (!r.ok) throw new Error('CSV 取得に失敗しました (HTTP ' + r.status + ')');
      return r.arrayBuffer();
    })
    .then((buf) => {
      const text = new TextDecoder('shift_jis').decode(buf);

      // セッションが切れていると、CSV ではなくログイン画面の HTML が 200 で返る。
      // そのまま列数エラーにすると原因が分からないので、ここで明示的に切り分ける。
      const headText = text.slice(0, 400).replace(/\s+/g, ' ');
      if (/^\s*(<!DOCTYPE|<html|<\?xml)/i.test(text) || /ログイン|会員ID/.test(headText)) {
        toast('CSV ではなく HTML が返りました。カード側のログインが切れている可能性があります。' +
              '明細ページを再読み込みしてログインし直してから、もう一度実行してください。', true);
        return;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (!lines.length) { toast('CSV が空でした。ログイン状態を確認してください。', true); return; }
      const rows: Record<string, unknown>[] = [];
      const errors: string[] = [];

      const zero = (s: string | number): string => String(s).padStart(2, '0');
      const toDate = (s: string): string => {
        const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s.trim());
        return m ? m[1] + '-' + zero(m[2]) + '-' + zero(m[3]) : '';
      };
      const toMonth = (s: string): string => {
        // "'26/08" — Excel の日付自動変換除けで先頭にアポストロフィが付く
        const m = /^'?(\d{2})\/(\d{1,2})$/.exec(s.trim());
        return m ? '20' + m[1] + '-' + zero(m[2]) : '';
      };
      const toInt = (s: string): number | null => {
        const t = String(s == null ? '' : s).replace(/[',]/g, '').trim();
        if (t === '') return null;
        const n = Number(t);
        return isFinite(n) ? Math.round(n) : null;
      };
      const norm = (s: string): string => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();

      lines.forEach((line, i) => {
        const c = line.split(',');
        // 実データは店名の読点が全角なので split(',') が通るが、ASCII カンマが来ると
        // 静かに列がずれる。列数を検証して、ずれたら取り込ませない。
        if (c.length !== 13) {
          // 原因を追えるように、実際に返ってきた行の中身も添える
          errors.push(i + 1 + '行目: 列数 ' + c.length + '（13のはず）: ' + line.slice(0, 120));
          return;
        }
        const usedOn = toDate(c[0]);
        const amount = toInt(c[6]);
        if (!usedOn) { errors.push(i + 1 + '行目: 利用日が不正 ' + c[0]); return; }
        if (amount === null) { errors.push(i + 1 + '行目: 金額が不正 ' + c[6]); return; }
        const fa = (c[9] || '').trim();
        const isForeign = fa !== '' || (c[10] || '').trim() !== '';
        rows.push({
          usedOn: usedOn, shop: c[1].trim(), shopKey: norm(c[1]),
          card: c[2].trim(), cardKey: norm(c[2]),
          payType: c[3].trim(), installments: c[4].trim(), payMonth: toMonth(c[5]),
          amountJpy: amount,
          // 外貨行は「お支払い総額」が空になる
          paymentTotal: toInt(c[7]), feeJpy: toInt(c[8]),
          isForeign: isForeign, foreignAmount: isForeign ? fa : '',
          currency: isForeign ? (c[10] || '').trim() : '',
          fxRate: isForeign ? (c[11] || '').trim() : '',
          fxDate: isForeign ? (c[12] || '').trim() : '',
        });
      });

      if (errors.length) { toast('CSV の解析に失敗: ' + errors[0], true); return; }

      // 同一(利用日+店+カード)内の連番。表は利用日の降順で新しい利用が先頭に挿入されるため、
      // 全体の通し番号だと毎回ずれる。グループ内なら他の日に何件増えても影響しない。
      const counter: Record<string, number> = {};
      rows.forEach((r) => {
        const k = [r.usedOn, r.shopKey, r.cardKey].join('');
        r.dupIndex = counter[k] || 0;
        counter[k] = (r.dupIndex as number) + 1;
      });

      // 取得した CSV が本当に表示中の月かを、支払予定月で独立に検算する。
      // 画面の月とリクエストした月がずれていたら、ここで気づける。
      const wrongMonth = rows.filter((r) => r.payMonth && r.payMonth !== billingMonth);
      if (wrongMonth.length) {
        toast('取得した明細の支払予定月が画面と一致しません（画面 ' + billingMonth +
              ' / CSV ' + String(wrongMonth[0].payMonth) + '）。取り込みを中止しました', true);
        return;
      }

      const rowsTotal = rows.reduce((a, r) => a + (r.amountJpy as number), 0);
      // 画面の合計との一致は必須。ページングに気づかず3割の行を落としかけた実績があるので、
      // 一致しない限り送信しない。
      if (shownTotal !== null && shownTotal !== rowsTotal) {
        toast('合計が一致しません（画面 ' + shownTotal + ' 円 / 明細 ' + rowsTotal +
              ' 円）。取り込みを中止しました', true);
        return;
      }

      const payload = {
        source: 'goldpoint',
        billingMonth: billingMonth,
        asOf: asOf,
        capturedAt: new Date().toISOString(),
        rowCount: rows.length,
        rowsTotal: rowsTotal,
        shownTotal: shownTotal,
        rows: rows,
      };

      const t = toast('取り込み先を開いています…');
      const w = window.open(TARGET + '/import', 'gp_import');
      if (!w) { toast('ポップアップがブロックされました。許可してから再実行してください', true); return; }

      // 受け手が未ログインだと認証を挟むため、準備完了は cross-origin では検知できない。
      // ack が返るまで送り続ける。ログイン操作を挟んでも間に合うよう 3 分待つ。
      let done = false;
      const onMsg = (ev: MessageEvent): void => {
        if (ev.origin !== TARGET) return;
        const d = ev.data as { type?: string } | null;
        if (d && d.type === 'gp-import-ack') {
          done = true;
          window.removeEventListener('message', onMsg);
          t.textContent = '送信しました（' + rows.length + '件 / ' + rowsTotal + '円）';
          setTimeout(() => { t.remove(); }, 4000);
        }
      };
      window.addEventListener('message', onMsg);

      let tries = 0;
      const timer = setInterval(() => {
        if (done || tries++ > 360) {
          clearInterval(timer);
          if (!done) toast('取り込み先から応答がありません', true);
          return;
        }
        try { w.postMessage({ type: 'gp-import', payload: payload }, TARGET); } catch (e) { /* 未遷移中は無視 */ }
      }, 500);
    })
    .catch((e: unknown) => { toast(String(e instanceof Error ? e.message : e), true); });
}

/** 現在のオリジンを送信先として埋め込んだ javascript: URL を組み立てる */
export function buildBookmarkletUrl(origin: string): string {
  const src = `(${goldpointBookmarklet.toString()})(${JSON.stringify(origin)})`;
  return 'javascript:' + encodeURIComponent(src);
}
