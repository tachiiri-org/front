// ショサイの画面スタイル。ウラナイの「ノートDB（Notion風）」の見た目を土台にし、
// 全体構成はグラフエディタの多ペイン（左=一覧 / 中=データベース / 右=エディタ）に合わせる。
// テーマは既存プロダクトと同じ [data-theme=dark|light] で切り替える。

export const SHOSAI_CSS = `
  .s-wrap{display:flex;height:calc(100dvh - 36px);box-sizing:border-box;font-family:system-ui,sans-serif;color:#222;font-size:13px;line-height:1.55;overflow:hidden}
  .s-wrap *{box-sizing:border-box}

  /* ── 左: データベース／ページ一覧 ── */
  .s-side{width:236px;flex:none;border-right:1px solid #0001;display:flex;flex-direction:column;min-height:0}
  .s-side-head{display:flex;align-items:center;gap:6px;padding:10px 12px 6px;font-size:11px;font-weight:700;color:#999;letter-spacing:.04em}
  .s-side-head-sp{flex:1}
  .s-side-list{overflow-y:auto;padding:0 6px 10px;min-height:0}
  .s-side-sec{margin-top:6px}
  .s-item{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden}
  .s-item:hover{background:#0000000a}
  .s-item.on{background:#4A90C222;font-weight:600}
  .s-item-ic{opacity:.5;flex:none;font-size:11px}
  .s-item-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .s-item-ct{flex:none;font-size:10px;color:#aaa;font-variant-numeric:tabular-nums}
  .s-empty{padding:10px 10px;color:#aaa;font-size:12px}

  /* ── 中央: データベース（テーブルビュー） ── */
  .s-main{flex:1.35;min-width:0;display:flex;flex-direction:column;overflow:hidden}
  .s-main-head{display:flex;align-items:center;gap:8px;padding:12px 16px 6px}
  .s-title{font-size:17px;font-weight:700;flex:1;min-width:0;border:1px solid transparent;border-radius:5px;padding:3px 6px;background:transparent;color:inherit;font-family:inherit}
  .s-title:hover,.s-title:focus{border-color:#4A90C2;background:#00000008;outline:none}
  .s-main-body{flex:1;min-height:0;overflow:auto;padding:0 16px 24px}

  .s-db-tabs{display:flex;gap:2px;align-items:center;border-bottom:1px solid #0001;margin:0 0 8px;flex-wrap:nowrap}
  .s-db-tab{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:#888;cursor:pointer;font-size:13px;padding:6px 10px;border-bottom:2px solid transparent;white-space:nowrap;margin-bottom:-1px}
  .s-db-tab:hover{color:#333;background:#00000006}
  .s-db-tab.on{color:#333;font-weight:600;border-bottom-color:#333}

  .s-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .s-tbl th{text-align:left;padding:4px 6px;border-bottom:1px solid #0002;white-space:nowrap;font-weight:700;font-size:11px;color:#888}
  .s-tbl td{padding:0;border-bottom:1px solid #0001;vertical-align:middle}
  .s-tbl tr:hover td{background:#00000005}
  .s-col-kind{font-size:10px;opacity:.6;font-weight:400;margin-left:4px}
  .s-col-add{width:36px}
  .s-col-add-btn{border:1px dashed #0003;background:transparent;color:#888;cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px}
  .s-col-add-btn:hover{color:#333;border-color:#4A90C2}
  .s-td-title{position:relative;min-width:150px}
  .s-row-ti{width:100%;padding:6px 62px 6px 8px;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;font-size:13px;font-family:inherit}
  .s-row-ti:hover,.s-row-ti:focus{border-color:#4A90C2;background:#00000008;outline:none}
  .s-open-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);opacity:0;font-size:11px;padding:1px 9px;border:1px solid #0002;border-radius:4px;background:#fff;color:#555;cursor:pointer;line-height:1.6}
  .s-td-title:hover .s-open-btn,.s-open-btn:focus{opacity:1}
  .s-cell{width:100%;padding:5px 6px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;font-size:12px;font-family:inherit;color-scheme:dark}
  .s-cell:hover,.s-cell:focus{border-color:#4A90C2;background:#00000008;outline:none}
  .s-cell-cb{margin:5px 7px}
  .s-add-row{margin-top:6px;border:0;background:transparent;color:#888;cursor:pointer;font-size:12.5px;padding:6px 8px;border-radius:5px;text-align:left;width:100%}
  .s-add-row:hover{background:#0000000a;color:#333}

  /* 選択肢のチップ・リレーションのリンク（Notion に寄せる） */
  .s-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:26px;padding:3px 6px;cursor:pointer;
           border:1px solid transparent;border-radius:4px}
  .s-chips:hover{border-color:#4A90C2;background:#00000008}
  /* 選択肢は色分けしない。値の意味と色が結びつかないので、かえって読みにくい。 */
  .s-chip{display:inline-block;padding:1px 7px;border-radius:3px;font-size:11.5px;line-height:1.6;
          border:1px solid #0002;background:#00000008;white-space:nowrap;color:#333}
  [data-theme=dark] .s-chip{color:#e6e6e6;border-color:#ffffff2b;background:#ffffff12}
  .s-chip-empty{color:#bbb;font-size:12px}
  .s-ref-add{color:#bbb;font-size:10px;padding:0 2px;cursor:pointer}
  .s-chips:hover .s-ref-add{color:#4A90C2}
  /* リレーションは四角で囲わず下線。選択肢（チップ）と役割が違うことを形で分ける。 */
  .s-ref{display:inline-block;font-size:11.5px;line-height:1.6;color:#2a6a9c;white-space:nowrap;
         text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px;
         max-width:180px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
  .s-ref:hover{color:#1b5480;text-decoration-thickness:2px}
  .s-ref + .s-ref{margin-left:8px}
  .s-opt{display:flex;align-items:center;gap:6px}
  .s-opt-mark{width:12px;flex:none;color:#4A90C2;font-size:11px}
  .s-opt-done{text-align:center;color:#4A90C2;font-weight:600;border-top:1px solid #0001;margin-top:2px}
  [data-theme=dark] .s-chips:hover{background:#ffffff0d}
  [data-theme=dark] .s-ref{color:#8fc4ea}
  [data-theme=dark] .s-opt-done{border-top-color:#ffffff22}

  /* ── 右: ブロックエディタ ── */
  .s-editor{flex:1;min-width:0;display:flex;flex-direction:column;border-left:1px solid #0001;overflow:hidden}
  .s-editor-head{display:flex;align-items:center;gap:8px;padding:12px 16px 6px}
  .s-editor-body{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 40vh}
  .s-blk{display:flex;align-items:flex-start;gap:4px;border-radius:5px}
  .s-blk:hover{background:#00000005}
  .s-grip{flex:none;width:16px;cursor:grab;color:transparent;font-size:12px;user-select:none;text-align:center;padding-top:5px;line-height:1.6}
  .s-blk:hover .s-grip{color:#bbb}
  .s-grip:active{cursor:grabbing}
  .s-blk-in{flex:1;min-width:0;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;font-family:inherit;font-size:13.5px;line-height:1.7;padding:3px 6px;resize:none;overflow:hidden}
  .s-blk-in:hover{border-color:#0001}
  .s-blk-in:focus{border-color:#4A90C2;background:#00000008;outline:none}
  .s-blk-in.h{font-size:17px;font-weight:700;line-height:1.5}
  .s-blk-in.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#00000008;border-color:#0001}
  .s-blk-in.quote{border-left:3px solid #4A90C2;border-radius:0 5px 5px 0;padding-left:10px;color:#666}
  .s-blk-mk{flex:none;color:#aaa;font-size:13px;padding-top:5px;user-select:none;min-width:14px;text-align:right}
  .s-blk-cb{flex:none;margin-top:7px}
  .s-hr{flex:1;height:1px;background:#0002;margin:12px 4px}
  .s-img-wrap{flex:1;min-width:0;padding:4px 6px}
  .s-img{max-width:100%;height:auto;border-radius:6px;display:block}
  .s-img-cap{margin-top:4px;color:#888;font-size:11.5px;line-height:1.5}
  .s-img-miss{padding:12px;border:1px dashed #0002;border-radius:6px;color:#aaa;font-size:12px;text-align:center}
  [data-theme=dark] .s-img-miss{border-color:#ffffff2b}
  .s-drop{box-shadow:0 -2px 0 #4A90C2}

  /* ── Notion 連携 ── */
  .s-notion-connect{text-decoration:none;color:inherit}
  .s-notion-dialog{position:fixed;top:12vh;left:50%;transform:translateX(-50%);width:min(560px,92vw);max-height:70vh;overflow:auto;padding:0;gap:0}
  .s-notion-head{padding:12px 16px;border-bottom:1px solid #0001;font-weight:700;font-size:14px}
  .s-notion-body{padding:10px 16px 16px}
  .s-notion-opt{display:flex;align-items:center;gap:7px;margin:2px 0 12px;font-size:12.5px;color:#666;cursor:pointer}
  .s-notion-list{display:flex;flex-direction:column;gap:2px}
  .s-notion-src{display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer}
  .s-notion-start{display:block;width:100%;margin-top:10px;padding:8px}
  .s-notion-start:disabled{opacity:.5;cursor:default}
  .s-notion-src:hover{background:#00000008}
  .s-notion-src-tx{flex:1;min-width:0}
  .s-notion-src-t{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .s-notion-src-m{font-size:11px;color:#aaa}
  .s-notion-progress{padding:8px 10px;margin:4px 6px 0;border-radius:6px;background:#4A90C214;font-size:12px}
  .s-notion-prog-line{color:#4A90C2}
  .s-notion-prog-done{color:#2A7;font-weight:600}
  .s-notion-prog-err{color:#c0392b;font-weight:600}
  .s-notion-drop{margin-top:4px;color:#888;font-size:11.5px;line-height:1.5}
  .s-notion-warn{margin-top:4px;color:#c26a00;font-size:11.5px;line-height:1.5}
  .s-notion-fail{margin-top:2px;padding-left:8px;color:#c0392b;font-size:11px;line-height:1.45;
                 word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  [data-theme=dark] .s-notion-head{border-color:#ffffff22}
  [data-theme=dark] .s-notion-src:hover{background:#ffffff0f}
  [data-theme=dark] .s-notion-progress{background:#4A90C222}

  /* ── 共通 ── */
  .s-btn{border:1px solid #0002;background:#fff;color:#555;cursor:pointer;border-radius:5px;padding:4px 10px;font-size:12px;font-family:inherit}
  .s-btn:hover{border-color:#4A90C2;color:#333}
  .s-search{width:100%;padding:5px 8px;border:1px solid #0002;border-radius:5px;background:transparent;color:inherit;font-size:12px;font-family:inherit}
  .s-search:focus{border-color:#4A90C2;outline:none}
  .s-pop{position:absolute;z-index:40;background:#fff;border:1px solid #0002;border-radius:6px;box-shadow:0 4px 16px #0003;padding:4px;min-width:150px;display:flex;flex-direction:column;gap:1px}
  .s-pop-item{text-align:left;border:0;background:transparent;color:#333;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:4px;white-space:nowrap;font-family:inherit}
  .s-pop-item:hover{background:#00000010}
  .s-pop-del{color:#c0392b}
  .s-overlay{position:fixed;inset:0;z-index:30}
  .s-note{color:#aaa;font-size:12px;padding:10px 2px}
  .s-err{margin:8px 16px;padding:8px 12px;border-radius:6px;background:#5a1e1e;color:#ffdede;font-size:12.5px}

  /* ── ダークテーマ ── */
  [data-theme=dark] .s-wrap{color:#e0e0e0}
  [data-theme=dark] .s-side,[data-theme=dark] .s-editor{border-color:#ffffff14}
  [data-theme=dark] .s-db-tabs,[data-theme=dark] .s-tbl th{border-color:#ffffff22}
  [data-theme=dark] .s-tbl td{border-color:#ffffff12}
  [data-theme=dark] .s-tbl tr:hover td{background:#ffffff08}
  [data-theme=dark] .s-item:hover{background:#ffffff0f}
  [data-theme=dark] .s-item.on{background:#4A90C233}
  [data-theme=dark] .s-db-tab{color:#ffffff8a}
  [data-theme=dark] .s-db-tab:hover{color:#fff;background:#ffffff0f}
  [data-theme=dark] .s-db-tab.on{color:#fff;border-bottom-color:#fff}
  [data-theme=dark] .s-blk:hover{background:#ffffff08}
  [data-theme=dark] .s-blk-in:hover{border-color:#ffffff14}
  [data-theme=dark] .s-blk-in:focus,[data-theme=dark] .s-cell:focus,[data-theme=dark] .s-row-ti:focus{background:#ffffff0d}
  [data-theme=dark] .s-blk-in.code{background:#ffffff0d;border-color:#ffffff1a}
  [data-theme=dark] .s-hr{background:#ffffff22}
  [data-theme=dark] .s-btn,[data-theme=dark] .s-open-btn{background:#2a2b2e;color:#ddd;border-color:#ffffff2b}
  [data-theme=dark] .s-col-add-btn{border-color:#ffffff2b;color:#ffffff8a}
  [data-theme=dark] .s-pop{background:#26282c;border-color:#ffffff22;box-shadow:0 4px 16px #0007}
  [data-theme=dark] .s-pop-item{color:#ddd}
  [data-theme=dark] .s-pop-item:hover{background:#ffffff14}
  [data-theme=light] .s-cell{color-scheme:light}

  /* ── モバイル: 固定フッターで3ペインを切り替える（ウラナイと同型）── */
  .s-foot{display:none}
  @media (max-width: 640px){
    /* 自然高にして document をスクロールさせる。これでブラウザ標準の引き下げ更新が効く。 */
    .s-wrap{flex-direction:column;height:auto;overflow:visible}
    .s-side,.s-main,.s-editor{width:auto;flex:none;min-width:0;border:0;padding-bottom:64px;
                              overflow:visible;min-height:60vh}
    .s-side-list,.s-main-body,.s-editor-body{overflow:visible;min-height:0}
    .s-side{border-bottom:0}
    .s-editor{border-left:0}
    .s-wrap[data-pane=side] .s-main,.s-wrap[data-pane=side] .s-editor{display:none}
    .s-wrap[data-pane=main] .s-side,.s-wrap[data-pane=main] .s-editor{display:none}
    .s-wrap[data-pane=editor] .s-side,.s-wrap[data-pane=editor] .s-main{display:none}
    .s-foot{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:950;border-top:1px solid #0002;background:#fff}
    .s-foot-btn{flex:1;border:0;background:transparent;color:#888;font-size:13px;padding:11px 0;cursor:pointer;font-family:inherit}
    .s-foot-btn.on{color:#1f2937;font-weight:700;box-shadow:inset 0 -2px 0 #4A90C2}
    [data-theme=dark] .s-foot{background:#14161a;border-top-color:#ffffff26}
    [data-theme=dark] .s-foot-btn{color:#8b95a3}
    [data-theme=dark] .s-foot-btn.on{color:#f3f5f7}
    .s-notion-dialog{top:8vh;width:94vw;max-height:78vh}
    .s-tbl{font-size:12px}
    /* タッチ端末にホバーは無い。「開く」を常時出し、右パディングもその分だけにする。
       62px のままだと幅 72px の列で文字を描く余地が 2px しか残らない。 */
    .s-open-btn{opacity:1;right:3px;padding:1px 5px;font-size:10px}
    .s-row-ti{padding-right:38px}
    .s-td-title{min-width:170px}
  }

  .s-wrap ::-webkit-scrollbar{width:6px;height:6px}
  .s-wrap ::-webkit-scrollbar-track{background:transparent}
  .s-wrap ::-webkit-scrollbar-thumb{background:#8884;border-radius:3px}
  .s-wrap *{scrollbar-width:thin;scrollbar-color:#8884 transparent}
`;

/** テーブル用の小さなヘルパ。DOM を直接組むので JSX 相当の糖衣だけ用意する。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}
