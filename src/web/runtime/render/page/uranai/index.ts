// ウラナイ画面のルート描画とフォーム類。定数・型・ヘルパは ./parts、ホイール描画は ./wheel に分割。
import {
  SIGN_ORDER, SIGN_GLYPH, SIGN_NAME, SIGN_ELEMENT, SIGN_QUALITY, ELEMENT_CHAR, QUALITY_CHAR, PLANET_GLYPH, PLANET_ORDER, PLANET_NAME_LINES, ASPECT_INFO, ASPECT_ORDER, PATTERN_INFO, PATTERN_ORDER, SHAPE_INFO, SHAPE_ORDER, Person, Prefill, Settings, SETTING_FIELDS, Chart, Derived, Cycles, optionsOf, nameOf, ownOf, setOwn, usesPart, partsOn, allParts, setParts, isImplemented, loadMeanings, meaningOf, roleOf, clearMeanings, UranaiView, api, lonOf, fmtDeg, Birth, HOUSE_SYSTEM_JA, IANA_ZONES, FALLBACK_ZONES, CC_ZONE, offsetFromZone, el, selectEl, loadSettings,
} from "./parts";
import { drawWheelPro } from "./wheel";

// renderUranai が再実行されても popstate リスナが多重登録されないよう、現行ハンドラを保持。
let uranaiPopHandler: ((e: PopStateEvent) => void) | null = null;

// ───────────────────────── 出生フォーム ─────────────────────────
function birthForm(personId: string, onDone: (chart: Chart) => void, prefill?: Prefill): HTMLElement {
  const wrap = el("div", { className: "u-form" });
  const label = el("input", { type: "text", placeholder: "表示名（例: 自分）", value: prefill?.label ?? "" });
  const date = el("input", { type: "date", value: prefill?.date ?? "" });
  const time = el("input", { type: "time", value: prefill?.time ?? "" });
  const placeInput = el("input", { type: "text", placeholder: "出生地を検索（例: 松本市）", value: prefill?.place ?? "" });
  const results = el("div", { className: "u-geo-results" });
  const geoWrap = el("div", { className: "u-geo-wrap" }, [placeInput, results]);
  const tz = el("input", { type: "text", placeholder: "UTCオフセット（例: +09:00）", value: prefill?.tz ?? "+09:00" });
  const picked = el("div", { className: "u-picked" });
  let lat: number | null = prefill?.lat ?? null, lng: number | null = prefill?.lng ?? null, placeName = prefill?.place ?? "";
  if (lat !== null && lng !== null) picked.textContent = `📍 ${placeName}（${lat.toFixed(3)}, ${lng.toFixed(3)}）`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  placeInput.addEventListener("input", () => {
    clearTimeout(timer);
    const q = placeInput.value.trim();
    if (q.length < 2) { results.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      try {
        const { results: rs } = await api<{ results: Array<{ name: string; place?: string; addr?: string; lat: number; lng: number }> }>(`/api/v1/uranai/geocode?q=${encodeURIComponent(q)}`);
        results.innerHTML = "";
        for (const r of rs) {
          // 地名（POI）があれば地名＋住所（住所は薄く）、無ければ住所のみ。
          const item = r.place
            ? el("div", { className: "u-geo-item" }, [el("span", { className: "u-geo-name", textContent: r.place }), el("span", { className: "u-geo-addr", textContent: r.addr ?? "" })])
            : el("div", { className: "u-geo-item" }, [el("span", { className: "u-geo-addr", textContent: r.addr ?? r.name })]);
          item.addEventListener("click", () => {
            lat = r.lat; lng = r.lng; placeName = r.name;
            picked.textContent = `📍 ${r.name}（${r.lat.toFixed(3)}, ${r.lng.toFixed(3)}）`;
            results.innerHTML = ""; placeInput.value = r.name;
          });
          results.append(item);
        }
      } catch { /* ignore */ }
    }, 400);
  });

  const status = el("div", { className: "u-status" });
  const submit = el("button", { className: "u-btn", textContent: prefill?.date ? "更新して再計算" : "チャートを計算" });
  submit.addEventListener("click", async () => {
    if (!date.value || !time.value) { status.textContent = "生年月日と時刻を入力してください"; return; }
    if (lat === null || lng === null) { status.textContent = "出生地を検索して選んでください"; return; }
    status.textContent = "計算中…";
    try {
      if (label.value.trim()) await api(`/api/v1/uranai/person/${personId}`, { method: "PATCH", body: JSON.stringify({ label: label.value.trim() }) }).catch(() => {});
      const born_at = `${date.value}T${time.value}:00${tz.value.trim() || "+00:00"}`;
      await api(`/api/v1/uranai/person/${personId}/birth`, { method: "PUT", body: JSON.stringify({ born_at, lat: String(lat), lng: String(lng), place: placeName, timezone: tz.value.trim() }) });
      await loadMeanings();
      const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" });
      status.textContent = "";
      onDone(chart);
    } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
  });

  wrap.append(
    el("div", { className: "u-row" }, [el("label", { textContent: "表示名" }), label]),
    el("div", { className: "u-row" }, [el("label", { textContent: "生年月日" }), date, time]),
    el("div", { className: "u-row" }, [el("label", { textContent: "出生地" }), geoWrap]),
    picked,
    el("div", { className: "u-row" }, [el("label", { textContent: "UTC offset" }), tz]),
    submit, status,
  );
  return wrap;
}

// ───────────────────────── 設定画面（ユーザーごとの方式デフォルト） ─────────────────────────
function settingsView(settings: Settings, onSaved: () => void | Promise<void>): HTMLElement {
  const wrap = el("div", { className: "u-form" });
  const sels: Partial<Record<keyof Settings, HTMLSelectElement>> = {};
  const grid = el("div", { className: "u-set-grid" });
  // 流派（ruleset）。ハウス・使用天体・アスペクト・意味・描画規約をまとめて決めるので先頭に置く。
  // 保存先は計算方式(p_user_setting)ではなく占う人の設定(p_reading_preference)。
  const rsSel = el("select", { className: "u-set-sel" });
  let rsInitial = "default";
  grid.append(el("div", { className: "u-set-row" }, [el("label", { textContent: "流派" }), rsSel]));
  void (async () => {
    try {
      const [ref, pref] = await Promise.all([
        api<{ rulesets?: Array<{ id: string; name: string | null }> }>(`/api/v1/uranai/astrology/reference`),
        api<{ ruleset_id?: string }>(`/api/v1/uranai/astrology/preference`),
      ]);
      for (const r of ref.rulesets ?? []) rsSel.append(el("option", { value: r.id, textContent: r.name ?? r.id }));
      rsInitial = pref.ruleset_id ?? "default";
      rsSel.value = rsInitial;
    } catch { /* 参照が取れない時は流派を触らせない */ }
  })();
  for (const f of SETTING_FIELDS) {
    const sel = selectEl(f.options, settings[f.key]);
    sels[f.key] = sel;
    // ハウスは流派が決める（空間の分割方式は教義そのもの）。実効値を見せるが編集はさせない。
    const derived = f.key === "house_system_id";
    if (derived) sel.disabled = true;
    grid.append(el("div", { className: "u-set-row" }, [
      el("label", { textContent: derived ? `${f.label}（流派で決まる）` : f.label }), sel,
    ]));
  }
  // 部品の採用。流派を切り替えると既定が読み込まれ、そこから自分用に変えられる。
  const partsBox = el("div", { className: "u-parts" });
  const renderParts = () => {
    partsBox.innerHTML = "";
    if (!allParts().length) return;
    partsBox.append(el("div", { className: "u-set-title", textContent: "使う部品" }));
    const on = new Set(partsOn());
    const grid = el("div", { className: "u-parts-grid" });
    for (const id of allParts()) {
      const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = on.has(id);
      cb.addEventListener("change", () => {
        const next = allParts().filter((x) => x === id ? cb.checked : on.has(x));
        void api<{ parts: string[] }>(`/api/v1/uranai/astrology/parts`,
          { method: "PUT", body: JSON.stringify({ ruleset: rsSel.value || undefined, parts: next }) })
          .then((r) => { setParts(r.parts ?? next); renderParts(); })
          .catch((e) => { status.textContent = `エラー: ${(e as Error).message}`; cb.checked = on.has(id); });
      });
      const impl = isImplemented(id);
      const lb = el("label", { className: "u-tg-chip" + (impl ? "" : " u-part-todo") },
        [cb, el("span", { textContent: nameOf("part", id) + (impl ? "" : "（未実装）") })]);
      lb.title = meaningOf("part", id);
      grid.append(lb);
    }
    partsBox.append(grid);
  };

  const status = el("div", { className: "u-status" });
  // 既定の流派をそのまま書き換えないよう、自分用に複製してから変える。
  const copyBtn = el("button", { className: "u-btn-sm u-btn-ghost", textContent: "この流派を自分用に複製" });
  copyBtn.addEventListener("click", () => {
    status.textContent = "複製中…";
    void api<{ ruleset: string }>(`/api/v1/uranai/astrology/ruleset-copy`,
      { method: "POST", body: JSON.stringify({ from: rsSel.value, to: "custom", name: "自分用" }) })
      .then(async (r) => {
        await api(`/api/v1/uranai/astrology/preference`, { method: "PUT", body: JSON.stringify({ ruleset_id: r.ruleset }) });
        clearMeanings(); status.textContent = ""; await onSaved();
      })
      .catch((e) => { status.textContent = `エラー: ${(e as Error).message}`; });
  });
  const save = el("button", { className: "u-btn", textContent: "保存して全チャート再計算" });
  save.addEventListener("click", async () => {
    status.textContent = "保存中…";
    try {
      const payload: Record<string, string> = {};
      // 流派由来の項目は送らない。送るとユーザー設定として保存され、流派を切り替えても残ってしまう。
      for (const f of SETTING_FIELDS) {
        if (f.key === "house_system_id") continue;
        const v = sels[f.key]?.value;
        if (v) { payload[f.key as string] = v; (settings as Record<string, string>)[f.key as string] = v; }
      }
      await api(`/api/v1/uranai/astrology/settings`, { method: "PUT", body: JSON.stringify(payload) });
      if (rsSel.value && rsSel.value !== rsInitial) {
        const saved = await api<{ ruleset_id?: string }>(`/api/v1/uranai/astrology/preference`, { method: "PUT", body: JSON.stringify({ ruleset_id: rsSel.value }) });
        if (saved.ruleset_id !== rsSel.value) throw new Error(`流派の保存に失敗しました（要求 ${rsSel.value} / 保存 ${saved.ruleset_id ?? "なし"}）`);
        rsInitial = rsSel.value;
      }
      // 設定は全人物のチャートに影響するため、保存済みの全チャートを再計算して反映。
      const { persons } = await api<{ persons: Person[] }>(`/api/v1/uranai/person`);
      let done = 0;
      // 再計算の失敗は握り潰さない。サーバ側の例外で一部のファクトだけが欠けた状態になり得るため、
      // 静かに成功したように見せるとデータの欠損に気づけない。
      const failed: string[] = [];
      const skipped: string[] = [];
      for (const p of persons) {
        status.textContent = `再計算中… (${++done}/${persons.length})`;
        try {
          await api(`/api/v1/uranai/astrology/person/${p.id}/compute`, { method: "POST", body: "{}" });
        } catch (e) {
          const msg = (e as Error).message;
          // 400 は出生データ未入力など、その人物を計算できないという意味。設定保存の失敗ではない。
          if (/^400\b/.test(msg)) skipped.push(p.label ?? p.id);
          else failed.push(`${p.label ?? p.id}: ${msg}`);
        }
      }
      clearMeanings(); // 流派が変わると意味も変わる
      if (failed.length) throw new Error(`再計算に失敗しました（${failed.length}/${persons.length}件）: ${failed.join(" / ")}`);
      status.textContent = skipped.length ? `${skipped.length}件を対象外にしました（出生データ未入力）: ${skipped.join(", ")}` : "";
      await onSaved();
    } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
  });
  renderParts();
  wrap.append(
    el("div", { className: "u-settings-note", textContent: "この設定はあなた（ユーザー）の既定として保存され、全チャートに適用されます。" }),
    el("div", { className: "u-set-title", textContent: "計算方式" }), grid, copyBtn, partsBox, save, status,
  );
  return wrap;
}

// ───────────────────────── チャート表示（タブ: チャート/表/基本情報） ─────────────────────────
function chartView(chart: Chart, birth: Birth | null | undefined, personId: string, label: string | null, onSaved: (newLabel: string | null) => void | Promise<void>, reportHost?: HTMLElement): HTMLElement {
  const wrap = el("div", { className: "u-chart" });
  // データ準備
  const storedCusps = (chart.cusps ?? []).filter((c) => c.system === (chart.house_system ?? "whole_sign")).sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12 ? storedCusps.map((c) => c.longitude) : Array.from({ length: 12 }, (_, i) => ((Math.floor(chart.ascendant / 30) * 30) + i * 30) % 360);
  const houseOf = (lon: number): number => { for (let i = 0; i < 12; i++) { const a = cuspLons[i], b = cuspLons[(i + 1) % 12]; const span = ((b - a) % 360 + 360) % 360; const off = ((lon - a) % 360 + 360) % 360; if (off < span) return i + 1; } return 12; };
  const place = new Map(chart.placements.map((p) => [p.planet, p]));
  const bodyLabel = (k: string): string => { const nm = PLANET_NAME_LINES[k]?.[0]; return nm ? `${PLANET_GLYPH[k] ?? ""} ${nm}`.trim() : (PLANET_GLYPH[k] ?? k); };
  // wrap: 折り返して左寄せにする列の番号。意味など長文の列は1行に収まらないので省略せず折り返す。
  // ルネーションのクォーター。原典が骨組みとして明示する合・上弦のスクエア・衝・下弦の
  // スクエアで区切る。8局面の名称は原典に無いので設けない。
  const LUN_Q: Record<number, string> = {
    1: "第1クォーター（合〜上弦のスクエア）", 2: "第2クォーター（上弦のスクエア〜衝）",
    3: "第3クォーター（衝〜下弦のスクエア）", 4: "第4クォーター（下弦のスクエア〜合）",
  };
  const QUAD_JA: Record<string, string> = { quadrant_1: "第1象限", quadrant_2: "第2象限", quadrant_3: "第3象限", quadrant_4: "第4象限" };
  const ROLE_JA: Record<string, string> = { light: "二光体", organic: "有機的生活", transcendent: "超越的活動" };
  // セルは文字列、または { t: 表示, tip: "kind:id" }。tip を付けるとホバーで意味と関連データが出る。
  type Cell = string | { t: string; tip: string };
  const mkTable = (headers: string[], rows: Cell[][], wrap?: number[]): HTMLElement => {
    const w = new Set(wrap ?? []);
    const tbl = el("table", { className: "u-tbl" + (w.size ? " u-tbl-auto" : "") });
    const htr = el("tr", {});
    headers.forEach((h, i) => htr.append(el("th", { textContent: h, className: w.has(i) ? "u-mean" : "" })));
    tbl.append(htr);
    for (const r of rows) {
      const tr = el("tr", {});
      r.forEach((c, i) => {
        const cls = w.has(i) ? "u-mean" : "";
        if (typeof c === "string") { tr.append(el("td", { textContent: c, className: cls })); return; }
        const td = el("td", { className: `${cls} u-hit`.trim(), textContent: c.t });
        td.setAttribute("data-tip", c.tip);
        tr.append(td);
      });
      tbl.append(tr);
    }
    return tbl;
  };

  // チャート（本格表示のみ）。アスペクトは常に全表示。天体名トグルのみ。
  const present = ASPECT_ORDER.filter((t) => chart.aspects.some((a) => a.type === t));
  const enabled = new Set<string>(present);
  let nameMode = false;
  const host = el("div", { className: "u-wheel" });
  const drawChart = () => { host.innerHTML = ""; host.append(drawWheelPro(chart, enabled, nameMode)); };
  host.addEventListener("u-redraw", drawChart); // テーマ切替時にホイールを描き直す
  const nameCb = el("input", { type: "checkbox", checked: false });
  nameCb.addEventListener("change", () => { nameMode = nameCb.checked; drawChart(); });

  // ツールチップ: 天体/ASC等/サイン/ハウスにホバー（PC）・長押し（モバイル）で着目情報。
  const ELEM_JA: Record<string, string> = { fire: "火", earth: "地", air: "風", water: "水" };
  const QUAL_JA: Record<string, string> = { cardinal: "活動", fixed: "不動", mutable: "柔軟" };
  const aspOf = (k: string): string => chart.aspects.filter((a) => a.a === k || a.b === k).sort((x, y) => x.orb - y.orb)
    .map((a) => `<div class="u-tip-a">${ASPECT_INFO[a.type]?.label ?? a.type}　${bodyLabel(a.a === k ? a.b : a.a)}　${a.orb.toFixed(2)}°</div>`).join("");
  // 流派の意味（ルディア等）。参照APIから取得済みのものを引く。無ければ何も出さない。
  const mean = (kind: string, id: string): string => {
    const v = meaningOf(kind, id);
    return v ? `<div class="u-tip-s">意味</div><div>${v}</div>` : "";
  };
  const DIGNITY_JA: Record<string, string> = { domicile: "ドミサイル", exaltation: "イグザルテーション", detriment: "デトリメント", fall: "フォール", peregrine: "ペレグリン" };
  // ツールチップ。自分の意味 → 原典の意味 → 関連データ の順に出す。
  // 自分の解釈はここには出さず、右ペインの一覧に出す（クリックでその概念に絞る）。
  const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const meaningBlock = (kind: string, id: string): string => {
    const own = ownOf(kind, id), src = meaningOf(kind, id);
    return (own ? `<div class="u-tip-s">自分の意味</div><div>${esc(own)}</div>` : "")
      + (src ? `<div class="u-tip-s">原典</div><div>${esc(src)}</div>` : "")
      + (!own && !src ? `<div class="u-tip-a">意味は未記入</div>` : "");
  };
  const tipHTML = (kind: string, id: string): string => {
    const K = kind === "axis" ? "planet" : kind;
    const head = (t: string) => `<div class="u-tip-h">${esc(t)}</div>`;
    if (K === "planet") {
      const p = place.get(id);
      const asp = aspOf(id);
      const rel = p
        ? `<div class="u-tip-s">関連</div><div>${SIGN_NAME[p.sign] ?? p.sign} ${fmtDeg(p.degree)}${p.retrograde ? " ℞" : ""}`
          + `${["asc", "mc", "dsc", "ic"].includes(id) ? "" : ` / ${houseOf(lonOf(p))}室`}`
          + `${ROLE_JA[roleOf(id)] ? ` / ${ROLE_JA[roleOf(id)]}` : ""}`
          + `${(chart.dignities ?? []).find((d) => d.planet === id) ? ` / ${DIGNITY_JA[(chart.dignities ?? []).find((d) => d.planet === id)!.dignity] ?? ""}` : ""}</div>`
        : "";
      return head(kind === "axis" ? (PLANET_GLYPH[id] ?? id) : bodyLabel(id)) + meaningBlock("planet", id) + rel
        + (asp ? `<div class="u-tip-s">アスペクト</div>${asp}` : "");
    }
    if (K === "sign") {
      const inSign = chart.placements.filter((pp) => pp.sign === id && !["asc", "mc", "dsc", "ic"].includes(pp.planet)).map((pp) => bodyLabel(pp.planet)).join("、");
      const icpt = (chart.interceptions ?? []).find((x) => x.sign === id);
      return head(`${SIGN_GLYPH[id] ?? ""}︎ ${SIGN_NAME[id] ?? id}`) + meaningBlock("sign", id)
        + `<div class="u-tip-s">関連</div><div>在住: ${inSign || "なし"}${icpt ? ` / ${icpt.house.replace("house_", "")}室にインターセプト` : ""}</div>`;
    }
    if (K === "house") {
      const n = Number(id.replace("house_", ""));
      const rl = (chart.house_rulers ?? []).find((r) => r.house === id);
      const inH = inHouse(id).map((k) => bodyLabel(k)).join("、");
      return head(`${n}室`) + meaningBlock("house", id)
        + `<div class="u-tip-s">関連</div><div>在住: ${inH || "なし"}`
        + `${rl ? ` / カスプ ${SIGN_NAME[rl.cusp_sign] ?? rl.cusp_sign}` : ""}`
        + `${rl?.ruler ? ` / 支配星 ${bodyLabel(rl.ruler)}${rl.ruler_house ? `（${rl.ruler_house.replace("house_", "")}室）` : ""}` : ""}</div>`;
    }
    if (K === "shape" || K === "quadrant" || K === "aspect_type" || K === "reading_step" || K === "dignity" || K === "phase") {
      const label = K === "aspect_type" ? (ASPECT_INFO[id]?.label ?? id) : nameOf(K, id);
      return head(label) + meaningBlock(K, id);
    }
    if (K === "concentration") {
      return head("集中度") + `<div>0 = 全周に均等、1 = 一点に集中。対向する2群は打ち消して 0 に近づく。</div>`
        + meaningBlock("concentration", "value");
    }
    return "";
  };
  // ツールチップは材料・表・右ペインのどこでも効かせる。
  const tip = el("div", { className: "u-tip" });
  document.body.append(tip);
  const hideTip = () => { tip.style.display = "none"; };
  const showTip = (elm: Element, clientX: number, clientY: number) => {
    const data = elm.getAttribute("data-tip"); if (!data) return hideTip();
    const [kind, id] = data.split(":");
    const html = tipHTML(kind, id); if (!html) return hideTip();
    tip.innerHTML = html; tip.style.display = "block";
    const r = tip.getBoundingClientRect(), pad = 14;
    let x = clientX + pad, y = clientY + pad;
    if (x + r.width > window.innerWidth - 6) x = clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 6) y = clientY - r.height - pad;
    tip.style.left = `${Math.max(6, x)}px`; tip.style.top = `${Math.max(6, y)}px`;
  };
  const hitOf = (e: Event): Element | null => (e.target as Element).closest?.("[data-tip]") ?? null;
  document.addEventListener("mouseover", (e) => { const t = hitOf(e); if (t) showTip(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY); });
  document.addEventListener("mousemove", (e) => { const t = hitOf(e); if (t) showTip(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY); else hideTip(); });
  document.addEventListener("mouseleave", hideTip);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener("touchstart", (e) => {
    const t = hitOf(e); if (!t) { hideTip(); return; }
    const touch = (e as TouchEvent).touches[0];
    pressTimer = setTimeout(() => showTip(t, touch.clientX, touch.clientY), 450);
  }, { passive: true });
  const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); };
  host.addEventListener("touchend", cancelPress);
  host.addEventListener("touchmove", () => { cancelPress(); hideTip(); }, { passive: true });

  const chartNode = el("div", {}, [
    el("div", { className: "u-glyph-toggle" }, [el("label", { className: "u-tg-chip" }, [nameCb, el("span", { textContent: "天体を名前（フルネーム）で表示" })])]),
    host, tip,
  ]);
  drawChart();
  hideTip();
  if (chart.range_warnings?.length) chartNode.append(el("div", { className: "u-warn", textContent: `⚠️ 有効範囲外の天体: ${chart.range_warnings.join(", ")}` }));

  // 天体（アングルも同じ表に。逆行・室はアングルでは空欄）
  const planetRows = PLANET_ORDER.filter((k) => place.has(k)).map((k) => { const p = place.get(k)!; return [
    { t: bodyLabel(k), tip: `planet:${k}` }, { t: SIGN_NAME[p.sign] ?? p.sign, tip: `sign:${p.sign}` },
    fmtDeg(p.degree), p.retrograde ? "℞" : "", { t: String(houseOf(lonOf(p))), tip: `house:house_${houseOf(lonOf(p))}` }]; });
  const angleRows = ["asc", "mc", "dsc", "ic"].filter((k) => place.has(k)).map((k) => { const p = place.get(k)!; return [PLANET_GLYPH[k] ?? k, SIGN_NAME[p.sign] ?? p.sign, fmtDeg(p.degree), "", ""]; });
  const planetTbl = mkTable(["天体", "サイン", "度数", "逆行", "室", "階層", "意味"],
    [...planetRows.map((r, i) => { const k = PLANET_ORDER.filter((x) => place.has(x))[i]; return [...r, ROLE_JA[roleOf(k)] ?? "", meaningOf("planet", k)]; }),
     ...angleRows.map((r) => [...r, "", ""])], [6]);
  const cuspTbl = mkTable(["室", "サイン", "度数", "意味"], cuspLons.map((lon, i) => { const sign = SIGN_ORDER[Math.floor((((lon % 360) + 360) % 360) / 30) % 12]; return [String(i + 1), SIGN_NAME[sign], fmtDeg(((lon % 30) + 30) % 30), meaningOf("house", `house_${i + 1}`)]; }), [3]);
  // サインの意味（流派スコープ）。ルディアはサインを「生命プロセスの12の位相」として定義する。
  const signTbl = mkTable(["サイン", "意味"], SIGN_ORDER.map((k) => [
    { t: `${SIGN_GLYPH[k]}︎ ${SIGN_NAME[k] ?? k}`, tip: `sign:${k}` }, ownOf("sign", k) || meaningOf("sign", k)]), [1]);
  const digTbl = mkTable(["天体", "ディグニティ", "意味"], (chart.dignities ?? []).length
    ? (chart.dignities ?? []).map((d) => [bodyLabel(d.planet), DIGNITY_JA[d.dignity] ?? d.dignity, meaningOf("dignity", d.dignity)])
    : [["なし", "—", ""]], [2]);

  // ハウスの支配関係。ルディアは解釈のステップで支配関係を確認するよう指示している。
  const rulerTbl = mkTable(["室", "カスプのサイン", "支配星", "支配星の在住"], (chart.house_rulers ?? []).length
    ? (chart.house_rulers ?? []).map((r) => [
        `${r.house.replace("house_", "")}室`,
        `${SIGN_GLYPH[r.cusp_sign] ?? ""}︎ ${SIGN_NAME[r.cusp_sign] ?? r.cusp_sign}`,
        r.ruler ? bodyLabel(r.ruler) : "—",
        r.ruler_sign ? `${SIGN_NAME[r.ruler_sign] ?? r.ruler_sign}${r.ruler_house ? ` / ${r.ruler_house.replace("house_", "")}室` : ""}` : "—",
      ])
    : [["—", "—", "—", "—"]]);

  // ディスポジター連鎖。天体が在るサインの支配星を辿る。ルディアの体系には無い部品。
  const dispTbl = mkTable(["天体", "ディスポジター", "連鎖", "最終", "相互受容"],
    (chart.dispositors ?? []).map((d) => [
      { t: bodyLabel(d.planet), tip: `planet:${d.planet}` },
      d.dispositor ? { t: bodyLabel(d.dispositor), tip: `planet:${d.dispositor}` } : "—",
      d.chain.map((k) => bodyLabel(k)).join(" → ") || "—",
      d.final ? "●" : "",
      d.mutual ? bodyLabel(d.mutual) : "",
    ]), [2]);

  // チャートルーラー: アセンダントのサインの支配星。ルディアの体系には無い部品。
  const cr = chart.chart_ruler;
  const crTbl = mkTable(["項目", "値"], cr
    ? [["アセンダントのサイン", `${SIGN_GLYPH[cr.asc_sign] ?? ""}︎ ${SIGN_NAME[cr.asc_sign] ?? cr.asc_sign}`],
       ["チャートルーラー", cr.ruler ? bodyLabel(cr.ruler) : "—"],
       ["ルーラーの在住", cr.ruler_sign ? `${SIGN_NAME[cr.ruler_sign] ?? cr.ruler_sign}${cr.ruler_house ? ` / ${cr.ruler_house.replace("house_", "")}室` : ""}` : "—"]]
    : [["—", "—"]]);

  // セクト: 太陽が地平線の上（7〜12室）なら昼のチャート。昼夜で天体の働きが変わるとする流派の部品。
  const sc = chart.sect;
  const sectTbl = mkTable(["項目", "値"], sc
    ? [["区分", sc.day ? "昼のチャート" : "夜のチャート"],
       ["セクトライト", bodyLabel(sc.light)],
       ["セクト内", sc.in_sect.map((k) => bodyLabel(k)).join("、")],
       ["セクト外", sc.out_of_sect.map((k) => bodyLabel(k)).join("、")]]
    : [["—", "—"]]);

  // 半球の偏り: 数え上げなのでルディアは採らないが、流派によっては読みの起点にする。
  const hm = chart.hemisphere;
  const hemiTbl = mkTable(["軸", "側", "天体数"], hm
    ? [["地平線", "上（7〜12室）", String(hm.above)], ["地平線", "下（1〜6室）", String(hm.below)],
       ["子午線", "東（10〜3室）", String(hm.east)], ["子午線", "西（4〜9室）", String(hm.west)]]
    : [["—", "—", "—"]]);

  // 留: 日運動が平均より極端に小さい天体。順行と逆行の折り返し点にあたる。
  const stTbl = mkTable(["天体", "日運動", "状態"], (chart.stations ?? []).length
    ? (chart.stations ?? []).map((s) => [{ t: bodyLabel(s.planet), tip: `planet:${s.planet}` }, `${s.speed.toFixed(4)}°/日`, "留"])
    : [["—", "—", "留の天体なし"]]);

  const dp = chart.derived_points ?? [];
  const sgLbl = (id: string) => `${SIGN_GLYPH[id] ?? ""}︎ ${SIGN_NAME[id] ?? id}`;
  // デーカン／フェイス: サインを10度ずつ3分した副支配。デーカンは三分区分、フェイスはカルデア順。
  const decanTbl = mkTable(["天体", "デーカン", "デーカン支配星", "フェイス支配星"], dp.length
    ? dp.map((d) => [{ t: bodyLabel(d.planet), tip: `planet:${d.planet}` }, sgLbl(d.decan.sign),
        d.decan.ruler ? bodyLabel(d.decan.ruler) : "—", bodyLabel(d.face)])
    : [["—", "—", "—", "—"]]);
  // アンティシア: 至点の軸に対する鏡像。同じ日照長を持つ度数どうしを結ぶ。
  const antiTbl = mkTable(["天体", "アンティシア", "コントラアンティシア"], dp.length
    ? dp.map((d) => [{ t: bodyLabel(d.planet), tip: `planet:${d.planet}` },
        `${sgLbl(d.antiscion.sign)} ${fmtDeg(d.antiscion.degree)}`,
        `${sgLbl(d.contra_antiscion.sign)} ${fmtDeg(d.contra_antiscion.degree)}`])
    : [["—", "—", "—"]]);
  // ハーモニクス／ドラコニック: 黄経を n 倍する／ドラゴンヘッドを起点に測り直す。
  const harmN = dp[0]?.harmonic.n ?? 5;
  const harmTbl = mkTable(["天体", `第${harmN}ハーモニクス`, "ドラコニック"], dp.length
    ? dp.map((d) => [{ t: bodyLabel(d.planet), tip: `planet:${d.planet}` },
        `${sgLbl(d.harmonic.sign)} ${fmtDeg(d.harmonic.degree)}`,
        d.draconic ? `${sgLbl(d.draconic.sign)} ${fmtDeg(d.draconic.degree)}` : "—"])
    : [["—", "—", "—"]]);

  // 象限。地平線と子午線が作る4つのクォーター。ルディアはハウスをこの単位でも読む。
  const quadTbl = mkTable(["象限", "ハウス", "意味"], (chart.quadrants ?? []).map((q) => [
    QUAD_JA[q.id] ?? q.id,
    `${q.houses[0].replace("house_", "")}〜${q.houses[q.houses.length - 1].replace("house_", "")}室`,
    meaningOf("quadrant", q.id),
  ]), [2]);
  // ルネーション: 太陽から測った月の離角。PoF の地平線上下がこれで決まる。
  const lun = chart.lunation;
  const lunTbl = mkTable(["項目", "値"], lun
    ? [["太陽から測った月の離角", `${lun.elongation.toFixed(1)}°`],
       ["位相", lun.phase === "waxing" ? "上弦（合から衝へ向かう）" : "下弦（衝から合へ戻る）"],
       ["クォーター", LUN_Q[lun.quarter] ?? String(lun.quarter)]]
    : [["算出できません", "—"]], [1]);
  // インターセプト（どのカスプにも現れないサイン）。ホイールには描かず表で示す。
  const icptTbl = mkTable(["サイン", "収まるハウス"], (chart.interceptions ?? []).length
    ? (chart.interceptions ?? []).map((x) => [`${SIGN_GLYPH[x.sign] ?? ""}︎ ${SIGN_NAME[x.sign] ?? x.sign}`, `${x.house.replace("house_", "")}室`])
    : [["なし", "—"]]);

  // アスペクト（種類ごとにグループ化）
  const aspectNode = el("div", {});
  // 位相の意味は上弦/下弦で共通なので、表ごとに繰り返さず先頭に凡例として置く。
  if (meaningOf("phase", "waxing")) {
    aspectNode.append(el("div", { className: "u-tbl-title", textContent: "位相" }));
    aspectNode.append(mkTable(["位相", "意味"], [
      ["上弦", meaningOf("phase", "waxing")], ["下弦", meaningOf("phase", "waning")],
    ], [1]));
  }
  for (const t of ASPECT_ORDER) {
    const rows = chart.aspects.filter((a) => a.type === t).sort((a, b) => a.orb - b.orb);
    if (!rows.length) continue;
    aspectNode.append(el("div", { className: "u-tbl-title", textContent: `${ASPECT_INFO[t]?.label ?? t}（${rows.length}）` }));
    // アスペクト種別の意味（流派スコープ）。ルディアは角度に固定の意味を置かず位相から読むので、
    // 原典が個別に定義していない種別にはその旨が入る。
    const am = meaningOf("aspect_type", t);
    if (am) aspectNode.append(el("div", { className: "u-pat-comp", textContent: am }));
    // 位相（上弦/下弦）はルディアの中核。同じ90度でも上弦と下弦で意味が違う。
    aspectNode.append(mkTable(["天体", "天体", "オーブ", "位相"], rows.map((a) =>
      [bodyLabel(a.a), bodyLabel(a.b), `${a.orb.toFixed(2)}°`, a.phase === "waxing" ? "上弦" : a.phase === "waning" ? "下弦" : "—"])));
  }

  // アスペクトパターン（配置図形）。既定は非内包の主要図形、詳細トグルで小配置・内包も表示。
  // 意味は表示せず、名称・別名・構成アスペクト・関与天体（＋頂点/出口）の事実のみ。
  const patterns = chart.patterns ?? [];
  const isMinor = (p: { pattern: string }): boolean => PATTERN_INFO[p.pattern]?.minor ?? false;
  const majorCount = patterns.filter((p) => !p.subsumed && !isMinor(p)).length;
  const FOCUS_LABEL: Record<string, string> = { kite: "出口", t_square: "頂点", yod: "頂点", wedge: "頂点", mini_trine: "頂点" };
  const patternNode = el("div", {});
  const patList = el("div", { className: "u-pat-list" });
  const detailCb = el("input", { type: "checkbox" }) as HTMLInputElement;
  const renderPatterns = () => {
    patList.innerHTML = "";
    const show = patterns.filter((p) => detailCb.checked || (!p.subsumed && !isMinor(p)));
    show.sort((a, b) => (PATTERN_ORDER.indexOf(a.pattern) - PATTERN_ORDER.indexOf(b.pattern)) || (Number(a.subsumed ?? false) - Number(b.subsumed ?? false)));
    if (!show.length) { patList.append(el("div", { className: "u-pat-empty", textContent: "該当する配置はありません" })); return; }
    for (const p of show) {
      const info = PATTERN_INFO[p.pattern];
      const card = el("div", { className: "u-pat" + (p.subsumed ? " u-pat-sub" : "") });
      const head = el("div", { className: "u-pat-h" }, [el("b", { textContent: info?.name ?? p.pattern })]);
      if (info?.aka) head.append(el("span", { className: "u-pat-aka", textContent: info.aka }));
      if (p.tight) head.append(el("span", { className: "u-pat-badge", textContent: "密集≤10°" }));
      if (p.subsumed) head.append(el("span", { className: "u-pat-badge u-pat-in", textContent: "内包" }));
      card.append(head, el("div", { className: "u-pat-comp", textContent: info?.comp ?? "" }));
      card.append(el("div", { className: "u-pat-bodies", textContent: p.bodies.map((k) => bodyLabel(k)).join("　") }));
      if (p.focus) card.append(el("div", { className: "u-pat-focus", textContent: `${FOCUS_LABEL[p.pattern] ?? "頂点"}: ${bodyLabel(p.focus)}` }));
      if (p.pattern === "stellium") {
        const s0 = place.get(p.bodies[0])?.sign;
        const sc = p.scope === "house" ? "同一ハウス" : `同一サイン${s0 ? `: ${SIGN_GLYPH[s0]} ${SIGN_NAME[s0] ?? s0}` : ""}`;
        card.append(el("div", { className: "u-pat-focus", textContent: sc }));
      }
      patList.append(card);
    }
  };
  if (patterns.some((p) => p.subsumed || isMinor(p))) {
    detailCb.addEventListener("change", renderPatterns);
    patternNode.append(el("div", { className: "u-pat-toggle" }, [el("label", { className: "u-tg-chip" }, [detailCb, el("span", { textContent: "小配置・内包も表示" })])]));
  }
  patternNode.append(patList);
  renderPatterns();

  // チャート全体の形（ゲシュタルト）。ルディアは個々のアスペクトを見る前に、まず全体の形と
  // 重みのバランスを捉えよと説く。ここも意味は書かず事実のみ。
  const shapeNode = el("div", {});
  const sh = chart.shape;
  if (!sh) {
    shapeNode.append(el("div", { className: "u-pat-empty", textContent: "全体の形は算出されていません（対象は10天体）" }));
  } else {
    // 7パターンを常に全部並べ、該当するものだけ印を付ける。該当しないものも「—」で残すことで、
    // 何が判定されなかったのかが読み取れるようにする。
    shapeNode.append(el("div", { className: "u-tbl-title", textContent: "惑星配置型（判定対象は10天体。キロン・小惑星・ノード・感受点は含めない）" }));
    // 形ごとの固有要素（バケットの取っ手、ロコモーティブの先頭）は同じ行に入れる。
    // その形にしか無い概念なので、別表に切り出すと「なし」ばかりの表になる。
    const extra = (k: string): string => {
      if (k === "bucket") return sh.handle?.length ? `取っ手: ${sh.handle.map((x) => bodyLabel(x)).join("　")}` : "";
      if (k === "locomotive") return sh.leadingBody ? `先頭: ${bodyLabel(sh.leadingBody)}` : "";
      return "";
    };
    shapeNode.append(mkTable(["形", "判定", ""], SHAPE_ORDER.map((k) => [
      { t: SHAPE_INFO[k]?.name ?? k, tip: `shape:${k}` }, k === sh.shape ? "● 該当" : "—", k === sh.shape ? extra(k) : "",
    ])));

    // 重心。ルディアは個々の天体を見る前に「重みのバランス」と「重心」を掴めと説く。
    // 集中度は 0（全周に均等）〜1（一点に集中）。対向する2群は打ち消して 0 に近づく。
    if (sh.center) {
      const cl = sh.center.longitude;
      const cs = SIGN_ORDER[Math.floor((((cl % 360) + 360) % 360) / 30) % 12];
      shapeNode.append(el("div", { className: "u-tbl-title", textContent: "重心（重みのバランス）" }));
      shapeNode.append(mkTable(["黄経", "ハウス", "集中度"], [[
        { t: `${SIGN_GLYPH[cs] ?? ""}︎ ${SIGN_NAME[cs] ?? cs} ${fmtDeg(((cl % 30) + 30) % 30)}`, tip: `sign:${cs}` },
        { t: `${houseOf(cl)}室`, tip: `house:house_${houseOf(cl)}` },
        { t: `${sh.center.concentration.toFixed(3)}`, tip: "concentration:value" },
      ]]));
    }

    // シングルトンは7パターンとは別の概念（分布の形ではなく孤立というアクセント）なので別に出す。
    const AXIS_JA: Record<string, string> = { horizon: "地平線", meridian: "子午線" };
    const same = sh.singleton && sh.handle?.length === 1 && sh.handle[0] === sh.singleton.planet;
    shapeNode.append(el("div", { className: "u-tbl-title", textContent: "シングルトン" }));
    shapeNode.append(mkTable(["天体"], sh.singleton
      ? [[{ t: `${bodyLabel(sh.singleton.planet)}（${AXIS_JA[sh.singleton.axis] ?? sh.singleton.axis}で分けた半球にただ1つ${same ? "。取っ手と同一" : ""}）`, tip: `planet:${sh.singleton.planet}` }]]
      : [["なし"]]));
  }

  // 進行・経過。派生値なので取得は遅延（タブを開いたときに読む）。
  const derivedNode = (kind: "progressed" | "transit"): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Derived>(`/api/v1/uranai/astrology/person/${personId}/${kind}?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: kind === "progressed"
          ? `1日 = 1年。天体位置は ${d.at.slice(0, 16).replace("T", " ")} UTC の瞬間。ハウスは出生図の枠。`
          : `天体位置は ${d.at.slice(0, 16).replace("T", " ")} UTC。ハウスは出生図の枠。` }));
        if (d.lunation) {
          out.append(el("div", { className: "u-tbl-title", textContent: kind === "progressed"
            ? "進行のルネーション（約30年で一巡。パーソナリティ発達の基本スケジュール）" : "ルネーション" }));
          out.append(mkTable(["離角", "位相", "クォーター"], [[`${d.lunation.elongation.toFixed(1)}°`,
            d.lunation.phase === "waxing" ? "上弦" : "下弦", LUN_Q[d.lunation.quarter] ?? ""]], [2]));
        }
        out.append(el("div", { className: "u-tbl-title", textContent: "天体" }));
        out.append(mkTable(["天体", "サイン", "度数", "逆行", "室"], d.placements.map((p) =>
          [bodyLabel(p.planet), SIGN_NAME[p.sign] ?? p.sign, fmtDeg(p.degree), p.retrograde ? "℞" : "", p.house.replace("house_", "") + "室"])));
        out.append(el("div", { className: "u-tbl-title", textContent: `出生図とのアスペクト（${d.aspects.length}）` }));
        out.append(d.aspects.length
          ? mkTable([kind === "progressed" ? "進行" : "経過", "出生", "種別", "オーブ", "位相"],
              [...d.aspects].sort((x, y) => x.orb - y.orb).map((a) => [bodyLabel(a.a), bodyLabel(a.b),
                ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`, a.phase === "waxing" ? "上弦" : "下弦"]))
          : el("div", { className: "u-pat-empty", textContent: "該当するアスペクトはありません" }));
        if (kind === "progressed") {
          out.append(el("div", { className: "u-tbl-title", textContent: `進行天体どうし（${d.internal.length}）` }));
          out.append(d.internal.length
            ? mkTable(["進行", "進行", "種別", "オーブ", "位相"],
                [...d.internal].sort((x, y) => x.orb - y.orb).map((a) => [bodyLabel(a.a), bodyLabel(a.b),
                  ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`, a.phase === "waxing" ? "上弦" : "下弦"]))
            : el("div", { className: "u-pat-empty", textContent: "該当するアスペクトはありません" }));
        }
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    const btn = el("button", { className: "u-btn u-btn-sm", textContent: "算出" });
    btn.addEventListener("click", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "対象日" }), dateIn, btn]), out);
    void load();
    return box;
  };

  // 時間軸のサイクル。リターン図・進行のルネーションの節目・食。
  const cyclesNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const fmt = (iso: string | null) => iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "算出できません";
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const c = await api<Cycles>(`/api/v1/uranai/astrology/person/${personId}/cycles?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-tbl-title", textContent: "リターン（対象日の直前）" }));
        out.append(mkTable(["種別", "瞬間"], [
          ["太陽回帰", fmt(c.returns.sun)], ["月回帰", fmt(c.returns.moon)],
        ], [1]));
        out.append(el("div", { className: "u-tbl-title", textContent: "進行のルネーションの節目（約30年で一巡）" }));
        out.append(c.progressed_lunation.length
          ? mkTable(["節目", "暦日"], c.progressed_lunation.map((e) => [e.kind === "new" ? "進行新月（合）" : "進行満月（衝）", e.at.slice(0, 10)]))
          : el("div", { className: "u-pat-empty", textContent: "範囲内に節目はありません" }));
        out.append(el("div", { className: "u-tbl-title", textContent: "食（対象日の前後400日）" }));
        out.append(c.eclipses.length
          ? mkTable(["種別", "日時", "出生図のハウス", "月の黄緯"], c.eclipses.map((e) =>
              [e.kind === "solar" ? "日食" : "月食", e.at.slice(0, 16).replace("T", " "),
               `${e.house.replace("house_", "")}室`, `${e.moonLatitude.toFixed(3)}°`]))
          : el("div", { className: "u-pat-empty", textContent: "範囲内に食はありません" }));
        out.append(el("div", { className: "u-pat-comp", textContent:
          "食は朔望の瞬間の月の黄緯で判定する（日食 |β|≦1.58度、月食 |β|≦1.05度）。等級・継続時間・食の種別は求めない。" }));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    const btn = el("button", { className: "u-btn u-btn-sm", textContent: "算出" });
    btn.addEventListener("click", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "対象日" }), dateIn, btn]), out);
    void load();
    return box;
  };

  // ───── 解釈の部品 ─────
  // 読みの手順はシステムで定義しない（プロセス自体に特別なものがないという判断）。
  // 個々の部品を並べ、材料の隣に自分の解釈を出すことだけをする。
  const P10 = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
  const inHouse = (h: string): string[] => chart.placements
    .filter((p) => !["asc", "mc", "dsc", "ic"].includes(p.planet) && `house_${houseOf(lonOf(p))}` === h)
    .map((p) => p.planet);
  const quadOf = (n: number): string => `quadrant_${Math.floor((n - 1) / 3) + 1}`;

  // 材料に紐づく解釈。プロパティのいずれかが一致するものを拾い、押すと右ペインでページが開く。
  const notesFor = (rays: Ray[], heading = "この材料に紐づく解釈"): HTMLElement => {
    const box = el("div", {});
    const hit = notes.filter((n) => !hasRay(n, "note_type", "question")
      && rays.some((r) => hasRay(n, r.concept_kind, r.concept_id)));
    if (!hit.length) return box;
    box.append(el("div", { className: "u-tbl-title", textContent: `${heading}（${hit.length}）` }));
    for (const n of hit) {
      const btn = el("button", { className: "u-row-btn" });
      btn.append(el("div", { textContent: `▤ ${titleOf(n)}` }));
      if (n.value) btn.append(el("div", { className: "u-row-sub", textContent: n.value.slice(0, 90) }));
      if (n.rays.length) btn.append(el("div", { className: "u-row-sub", textContent: n.rays.map(rayLabel).join("　") }));
      btn.addEventListener("click", () => { openNote = n.note_id; renderNotes(); });
      box.append(btn);
    }
    return box;
  };

  // ハウス詳細。12室を順に、その室で読む材料を1つの表に束ねる。手順から独立した部品として残す。
  const houseDetail = (): HTMLElement => {
    const box = el("div", {});
    for (let i = 1; i <= 12; i++) {
      const hid = `house_${i}`;
      const rl = (chart.house_rulers ?? []).find((r) => r.house === hid);
      const bodies = inHouse(hid);
      box.append(el("div", { className: "u-tbl-title", textContent: `第${i}室` }));
      box.append(mkTable(["項目", "内容"], [
        ["経験のカテゴリー", ownOf("house", hid) || meaningOf("house", hid) || "—"],
        ["象限", ownOf("quadrant", quadOf(i)) || meaningOf("quadrant", quadOf(i)) || "—"],
        ["在住天体", bodies.length ? bodies.map((k) => bodyLabel(k)).join("　") : "なし"],
        ["カスプのサイン", rl ? SIGN_NAME[rl.cusp_sign] ?? rl.cusp_sign : "—"],
        ["支配星とその在住", rl?.ruler ? `${bodyLabel(rl.ruler)} → ${rl.ruler_sign ? SIGN_NAME[rl.ruler_sign] ?? rl.ruler_sign : "—"}${rl.ruler_house ? ` / ${rl.ruler_house.replace("house_", "")}室` : ""}` : "—"],
        ["インターセプト", (chart.interceptions ?? []).filter((x) => x.house === hid).map((x) => SIGN_NAME[x.sign] ?? x.sign).join("、") || "なし"],
      ], [1]));
      const pick = el("button", { className: "u-pick" + (houseFilter === hid ? " on" : ""), textContent: `第${i}室を選択` });
      pick.addEventListener("click", () => {
        houseFilter = houseFilter === hid ? null : hid;
        openNote = null;
        matHost.innerHTML = ""; matHost.append(houseDetail());
        renderNotes();
      });
      box.append(pick);
      box.append(notesFor([{ concept_kind: "house", concept_id: hid }], `第${i}室の解釈`));
    }
    return box;
  };

  const rayLabel = (r: Ray): string => {
    if (r.concept_kind === "planet") return bodyLabel(r.concept_id);
    if (r.concept_kind === "sign") return SIGN_NAME[r.concept_id] ?? r.concept_id;
    if (r.concept_kind === "house") return `${r.concept_id.replace("house_", "")}室`;
    if (r.concept_kind === "quadrant") return QUAD_JA[r.concept_id] ?? r.concept_id;
    if (r.concept_kind === "aspect_type") return ASPECT_INFO[r.concept_id]?.label ?? r.concept_id;
    if (r.concept_kind === "shape") return nameOf("shape", r.concept_id);
    if (r.concept_kind === "note_type") return nameOf("note_type", r.concept_id);
    return `${r.concept_kind}:${r.concept_id}`;
  };
  // メモはグラフのリレーションと同じ形。本文＋n項の参加者。
  type Ray = { concept_kind: string; concept_id: string };
  type Note = { note_id: string; idx: number; at: string | null; title: string; value: string; rays: Ray[]; links: string[] };
  const hasRay = (n: Note, kind: string, id: string) => n.rays.some((r) => r.concept_kind === kind && r.concept_id === id);
  let notes: Note[] = [];
  const matHost = el("div", {});
  // 解釈はデータベース。1行が1ページ。列は概念の種類で分けず、プロパティとして付ける。
  // ページはタイトル・プロパティ・本文の構成。ページ間のリンクも張れる。
  const PROP_KINDS: Array<{ kind: string; label: string }> = [
    { kind: "house", label: "ハウス" }, { kind: "planet", label: "天体" }, { kind: "sign", label: "サイン" },
    { kind: "aspect_type", label: "アスペクト" }, { kind: "quadrant", label: "象限" },
    { kind: "shape", label: "配置型" },
    { kind: "note_type", label: "種別" },
  ];
  const titleOf = (n: Note): string => n.title || n.value.split("\n")[0] || "無題";
  let openNote: string | null = null;
  let houseFilter: string | null = null;

  // いま見ている材料から決まるプロパティ。手順に加えて、その手順で焦点になっている対象を付ける。
  // 判定結果そのもの（バケット、その取っ手の月）なので、我々の判断は入っていない。
  const contextRays = (): Ray[] => {
    const out: Ray[] = [];
    if (houseFilter) {
      out.push({ concept_kind: "house", concept_id: houseFilter });
      const rl = (chart.house_rulers ?? []).find((r) => r.house === houseFilter);
      if (rl) out.push({ concept_kind: "sign", concept_id: rl.cusp_sign });
      if (rl?.ruler) out.push({ concept_kind: "planet", concept_id: rl.ruler });
      for (const k of inHouse(houseFilter)) out.push({ concept_kind: "planet", concept_id: k });
      out.push({ concept_kind: "quadrant", concept_id: quadOf(Number(houseFilter.replace("house_", ""))) });
      return out;
    }
    // 重複を落とす。
    const seen = new Set<string>();
    return out.filter((r) => { const k = `${r.concept_kind}|${r.concept_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };

  const patch = (n: Note, body: Record<string, unknown>, after: () => void) => {
    void api<{ rays: Ray[]; links: string[] }>(`/api/v1/uranai/astrology/note/${n.note_id}`,
      { method: "PUT", body: JSON.stringify(body) })
      .then((res) => { if (res.rays) n.rays = res.rays; if (res.links) n.links = res.links; after(); });
  };

  // プロパティは1行にまとめる。種類の区別は「＋」を押した後の選択肢（種類ごとのグループ）に出す。
  const propRow = (n: Note, after: () => void): HTMLElement => {
    const vals = el("div", { className: "u-ray-chips" });
    for (const r of n.rays) {
      const c = el("button", { className: "u-ray on", textContent: rayLabel(r) });
      c.title = PROP_KINDS.find((k) => k.kind === r.concept_kind)?.label ?? r.concept_kind;
      c.addEventListener("click", () => patch(n, { rays: n.rays.filter((x) => !(x.concept_kind === r.concept_kind && x.concept_id === r.concept_id)) }, after));
      vals.append(c);
    }
    const addBtn = el("button", { className: "u-ray", textContent: "＋" });
    const sel = el("select", { className: "u-prop-sel" }) as HTMLSelectElement;
    sel.style.display = "none";
    sel.append(el("option", { value: "", textContent: "選択" }));
    for (const k of PROP_KINDS) {
      const g = el("optgroup") as HTMLOptGroupElement;
      g.label = k.label;
      let any = false;
      for (const o of optionsOf(k.kind)) {
        if (n.rays.some((x) => x.concept_kind === k.kind && x.concept_id === o.id)) continue;
        g.append(el("option", { value: `${k.kind}|${o.id}`, textContent: o.label }));
        any = true;
      }
      if (any) sel.append(g);
    }
    addBtn.addEventListener("click", () => { addBtn.style.display = "none"; sel.style.display = ""; sel.focus(); });
    sel.addEventListener("change", () => {
      const [kind, id] = sel.value.split("|");
      if (kind && id) patch(n, { rays: [...n.rays, { concept_kind: kind, concept_id: id }] }, after);
    });
    vals.append(addBtn, sel);
    return el("div", { className: "u-prop" }, [el("div", { className: "u-prop-k", textContent: "プロパティ" }), vals]);
  };

  // ページ: タイトル・プロパティ・本文。
  const pageView = (n: Note, after: () => void): HTMLElement => {
    const box = el("div", { className: "u-page" });
    const back = el("button", { className: "u-btn-sm u-btn-ghost", textContent: "← 一覧" });
    back.addEventListener("click", () => { openNote = null; after(); });
    box.append(back);
    const ti = el("input", { className: "u-page-title", value: titleOf(n) === "無題" ? "" : n.title }) as HTMLInputElement;
    ti.placeholder = "無題";
    ti.addEventListener("blur", () => { n.title = ti.value; patch(n, { title: ti.value }, after); });
    box.append(ti);
    box.append(propRow(n, after));
    const at = el("input", { type: "date", className: "u-prop-sel", value: (n.at ?? "").slice(0, 10) }) as HTMLInputElement;
    at.addEventListener("change", () => {
      n.at = at.value ? `${at.value}T12:00:00Z` : null;
      patch(n, { at: at.value ? `${at.value}T12:00:00Z` : "" }, () => { /* 一覧の再描画は不要 */ });
    });
    box.append(el("div", { className: "u-prop" }, [el("div", { className: "u-prop-k", textContent: "日時" }), at]));
    // ページ間のリンク。
    const links = el("div", { className: "u-ray-chips" });
    for (const t of n.links) {
      const target = notes.find((x) => x.note_id === t);
      const c = el("button", { className: "u-ray on", textContent: target ? titleOf(target) : t.slice(0, 8) });
      c.addEventListener("click", () => patch(n, { links: n.links.filter((x) => x !== t) }, after));
      links.append(c);
    }
    const lsel = el("select", { className: "u-prop-sel" }) as HTMLSelectElement;
    lsel.append(el("option", { value: "", textContent: "＋" }));
    for (const o of notes.filter((x) => x.note_id !== n.note_id && !n.links.includes(x.note_id))) {
      lsel.append(el("option", { value: o.note_id, textContent: titleOf(o) }));
    }
    lsel.addEventListener("change", () => { if (lsel.value) patch(n, { links: [...n.links, lsel.value] }, after); });
    links.append(lsel);
    box.append(el("div", { className: "u-prop" }, [el("div", { className: "u-prop-k", textContent: "リンク" }), links]));
    const ta = el("textarea", { className: "u-note" }) as HTMLTextAreaElement;
    ta.value = n.value;
    ta.addEventListener("blur", () => {
      void api(`/api/v1/uranai/astrology/note/${n.note_id}`, { method: "PUT", body: JSON.stringify({ value: ta.value }) })
        .then(() => { n.value = ta.value; });
    });
    box.append(ta);
    const del = el("button", { className: "u-btn-sm u-btn-ghost", textContent: "削除" });
    del.addEventListener("click", () => {
      void api(`/api/v1/uranai/astrology/note/${n.note_id}`, { method: "DELETE" }).then(() => {
        notes = notes.filter((x) => x.note_id !== n.note_id); openNote = null; after();
      });
    });
    box.append(del);
    return box;
  };

  // 右ペイン: 一覧（1行=1ページ）またはページ。手順を選んでいる間はその手順で絞る。
  const renderNotes = () => {
    if (!reportHost) return;
    reportHost.innerHTML = "";
    const open = openNote ? notes.find((x) => x.note_id === openNote) : null;
    if (open) { reportHost.append(pageView(open, renderNotes)); return; }
    const shown = houseFilter ? notes.filter((n) => hasRay(n, "house", houseFilter as string)) : notes;
    // 何で絞っているかと、新規作成時に入るプロパティを先に見せる。
    const ctx = contextRays();
    if (ctx.length) {
      const scope = el("div", { className: "u-scope" });
      for (const r of ctx) scope.append(el("span", { className: "u-ray on", textContent: rayLabel(r) }));
      reportHost.append(scope);
    }
    const head = el("tr", {});
    for (const h of ["タイトル", "プロパティ", "日時"]) head.append(el("th", { textContent: h }));
    const tbl = el("table", { className: "u-tbl u-tbl-auto" }, [head]);
    for (const n of shown) {
      const tr = el("tr", { className: "u-hit" });
      tr.append(el("td", { className: "u-mean", textContent: `▤ ${titleOf(n)}` }));
      tr.append(el("td", { className: "u-mean", textContent: n.rays.map(rayLabel).join("　") }));
      tr.append(el("td", { textContent: (n.at ?? "").slice(0, 10) }));
      tr.addEventListener("click", () => { openNote = n.note_id; renderNotes(); });
      tbl.append(tr);
    }
    reportHost.append(tbl);
    const add = el("button", { className: "u-btn u-btn-sm", textContent: "＋" });
    add.addEventListener("click", () => {
      const rays = contextRays();
      const nowIso = new Date().toISOString(); // 日時は既定で現在時刻
      void api<{ note_id: string; idx: number; rays: Ray[]; links: string[] }>(`/api/v1/uranai/astrology/person/${personId}/notes`,
        { method: "POST", body: JSON.stringify({ value: "", title: "", rays, at: nowIso }) })
        .then((r) => {
          notes.push({ note_id: r.note_id, idx: r.idx, at: nowIso, title: "", value: "", rays: r.rays ?? rays, links: r.links ?? [] });
          openNote = r.note_id; renderNotes();
        });
    });
    reportHost.append(add);
  };

  void api<{ notes: Note[] }>(`/api/v1/uranai/astrology/person/${personId}/notes`)
    .then((r) => { notes = r.notes ?? []; matHost.innerHTML = ""; matHost.append(houseDetail()); renderNotes(); })
    .catch(() => { /* メモが取れなくても材料は見せる */ });

  // 概念。自分の意味を書く場所。原典由来の意味と並べて出し、上書きではなく別に持つ。
  const conceptNode = el("div", {});
  const CONCEPT_TABS: Array<{ kind: string; label: string }> = [
    { kind: "planet", label: "天体" }, { kind: "sign", label: "サイン" }, { kind: "house", label: "ハウス" },
    { kind: "aspect_type", label: "アスペクト" }, { kind: "quadrant", label: "象限" },
    { kind: "shape", label: "配置型" }, { kind: "dignity", label: "ディグニティ" }, { kind: "phase", label: "位相" },
  ];
  let conceptKind = "planet";
  const renderConcepts = () => {
    conceptNode.innerHTML = "";
    const bar2 = el("div", { className: "u-tabs" });
    for (const c of CONCEPT_TABS) {
      const b2 = el("button", { className: "u-tab-btn" + (c.kind === conceptKind ? " on" : ""), type: "button", textContent: c.label });
      b2.addEventListener("click", () => { conceptKind = c.kind; renderConcepts(); });
      bar2.append(b2);
    }
    conceptNode.append(bar2);
    const head = el("tr", {});
    for (const h of ["概念", "自分の意味", "原典"]) head.append(el("th", { textContent: h, className: h === "概念" ? "" : "u-mean" }));
    const tbl = el("table", { className: "u-tbl u-tbl-auto" }, [head]);
    for (const o of optionsOf(conceptKind)) {
      const tr = el("tr", {});
      const nameTd = el("td", { className: "u-hit", textContent: o.label });
      nameTd.setAttribute("data-tip", `${conceptKind}:${o.id}`);
      tr.append(nameTd);
      const ta = el("textarea", { className: "u-note u-note-sm" }) as HTMLTextAreaElement;
      ta.value = ownOf(conceptKind, o.id);
      ta.addEventListener("blur", () => {
        void api(`/api/v1/uranai/astrology/concept-note`, { method: "PUT", body: JSON.stringify({ concept_kind: conceptKind, concept_id: o.id, value: ta.value }) })
          .then(() => setOwn(conceptKind, o.id, ta.value));
      });
      tr.append(el("td", { className: "u-mean" }, [ta]));
      tr.append(el("td", { className: "u-mean", textContent: meaningOf(conceptKind, o.id) }));
      tbl.append(tr);
    }
    conceptNode.append(tbl);
  };

  // 基本情報: 通常は表。各編集項目に編集アイコン、押すとその項目だけ編集モード（他はグレーアウト）、
  // 再計算(保存)またはキャンセル。
  const bm = (birth?.born_at ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const zones = IANA_ZONES.length ? IANA_ZONES : FALLBACK_ZONES;
  const initZone = (birth?.timezone && birth.timezone.includes("/")) ? birth.timezone : "Asia/Tokyo";
  const st = {
    name: label ?? "", date: bm?.[1] ?? "", time: bm?.[2] ?? "", place: birth?.place ?? "",
    lat: (birth?.lat ? Number(birth.lat) : null) as number | null,
    lng: (birth?.lng ? Number(birth.lng) : null) as number | null,
    tz: zones.includes(initZone) ? initZone : "Asia/Tokyo",
  };
  const orig = { ...st };
  const houseName = HOUSE_SYSTEM_JA[chart.house_system ?? ""] ?? chart.house_system ?? "-";
  const ICON: Record<string, string> = { name: "✎", date: "📅", time: "🕐", place: "📍", tz: "🌐" };
  const basicNode = el("div", { className: "u-basic" });
  let editing: string | null = null;
  const doSave = async (statusEl: HTMLElement) => {
    if (!st.date || !st.time) { statusEl.textContent = "生年月日と時刻を入力してください"; return; }
    if (st.lat === null || st.lng === null) { statusEl.textContent = "出生地を選んでください"; return; }
    statusEl.textContent = "再計算中…";
    try {
      const nm = st.name.trim();
      if (nm && nm !== (label ?? "")) await api(`/api/v1/uranai/person/${personId}`, { method: "PATCH", body: JSON.stringify({ label: nm }) }).catch(() => {});
      const off = offsetFromZone(st.tz, new Date(`${st.date}T${st.time}:00`));
      const born_at = `${st.date}T${st.time}:00${off}`;
      await api(`/api/v1/uranai/person/${personId}/birth`, { method: "PUT", body: JSON.stringify({ born_at, lat: String(st.lat), lng: String(st.lng), place: st.place, timezone: st.tz }) });
      await api(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" });
      await onSaved(nm || label);
    } catch (e) { statusEl.textContent = `エラー: ${(e as Error).message}`; }
  };
  const renderBasic = () => {
    basicNode.innerHTML = "";
    const editMode = editing !== null;
    const disp: Record<string, string> = {
      name: st.name || "-", date: st.date || "-", time: st.time || "-", place: st.place || "-",
      lat: st.lat !== null ? st.lat.toFixed(4) : "-", lng: st.lng !== null ? st.lng.toFixed(4) : "-",
      tz: st.tz, house: houseName, node: "平均",
    };
    // 編集中の項目のコントロールを生成。
    let ctrl: HTMLElement | undefined;
    if (editing === "name") { const i = el("input", { type: "text", className: "u-fi", value: st.name }); i.addEventListener("input", () => { st.name = i.value; }); ctrl = i; }
    else if (editing === "date") { const i = el("input", { type: "date", className: "u-fi", value: st.date }); i.addEventListener("input", () => { st.date = i.value; }); ctrl = i; }
    else if (editing === "time") { const i = el("input", { type: "time", className: "u-fi", value: st.time }); i.addEventListener("input", () => { st.time = i.value; }); ctrl = i; }
    else if (editing === "tz") { const sel = el("select", { className: "u-fi" }); for (const z of zones) sel.append(el("option", { value: z, textContent: z })); sel.value = st.tz; sel.addEventListener("change", () => { st.tz = sel.value; }); ctrl = sel; }
    else if (editing === "place") {
      const i = el("input", { type: "text", className: "u-fi", value: st.place, placeholder: "出生地を検索" });
      const gr = el("div", { className: "u-geo-results" });
      let gt: ReturnType<typeof setTimeout> | undefined;
      i.addEventListener("input", () => {
        st.place = i.value; clearTimeout(gt); const q = i.value.trim();
        if (q.length < 2) { gr.innerHTML = ""; return; }
        gt = setTimeout(async () => {
          try {
            const { results: rs } = await api<{ results: Array<{ name: string; lat: number; lng: number; cc?: string }> }>(`/api/v1/uranai/geocode?q=${encodeURIComponent(q)}`);
            gr.innerHTML = "";
            for (const r of rs) {
              const it = el("div", { className: "u-geo-item" }, [el("span", { className: "u-geo-addr", textContent: r.name })]);
              it.addEventListener("click", () => { st.lat = r.lat; st.lng = r.lng; st.place = r.name; i.value = r.name; gr.innerHTML = ""; const z = r.cc ? CC_ZONE[r.cc] : undefined; if (z && zones.includes(z)) st.tz = z; });
              gr.append(it);
            }
          } catch { /* ignore */ }
        }, 400);
      });
      ctrl = el("div", { className: "u-geo-wrap" }, [i, gr]);
    }
    const tbl = el("table", { className: "u-basic-tbl" });
    const addRow = (key: string, lbl: string, editable: boolean) => {
      const tr = el("tr", { className: editMode && editing !== key ? "u-dim" : "" });
      tr.append(el("td", { className: "u-basic-k", textContent: lbl }));
      const vtd = el("td", { className: "u-basic-v" });
      if (editing === key && ctrl) vtd.append(ctrl); else vtd.textContent = disp[key];
      tr.append(vtd);
      const itd = el("td", { className: "u-basic-ic" });
      if (editable && !editMode) { const b = el("button", { className: "u-edit-ic", type: "button", title: "編集", textContent: ICON[key] ?? "✎" }); b.addEventListener("click", () => { editing = key; renderBasic(); }); itd.append(b); }
      tr.append(itd);
      tbl.append(tr);
    };
    addRow("name", "表示名", true);
    addRow("date", "生年月日", true);
    addRow("time", "時刻", true);
    addRow("place", "出生地", true);
    addRow("lat", "緯度", false);
    addRow("lng", "経度", false);
    addRow("tz", "TZ", true);
    addRow("house", "ハウス", false);
    addRow("node", "ノード/リリス", false);
    basicNode.append(tbl);
    if (editMode) {
      const status = el("div", { className: "u-status" });
      const rc = el("button", { className: "u-btn u-btn-sm", textContent: "再計算" });
      rc.addEventListener("click", () => void doSave(status));
      const cancel = el("button", { className: "u-btn u-btn-sm u-btn-ghost", textContent: "キャンセル" });
      cancel.addEventListener("click", () => { Object.assign(st, orig); editing = null; renderBasic(); });
      basicNode.append(el("div", { className: "u-basic-actions" }, [rc, cancel, status]));
    }
  };
  renderBasic();
  // 元素・クオリティ（それぞれ独立タブ）。
  const ec = Object.fromEntries(chart.elements.map((e) => [e.element, e.count]));
  const qc = Object.fromEntries(chart.qualities.map((q) => [q.quality, q.count]));
  const elemNode = mkTable(["火", "地", "風", "水"], [[String(ec.fire ?? 0), String(ec.earth ?? 0), String(ec.air ?? 0), String(ec.water ?? 0)]]);
  const qualNode = mkTable(["活動", "不動", "柔軟"], [[String(qc.cardinal ?? 0), String(qc.fixed ?? 0), String(qc.mutable ?? 0)]]);

  // タブ（可視切替）＋全表示
  // 大分類 → タブ の2段階。上段で大分類を選び、下段でその中のタブを選ぶ。
  // 「読み」の大分類では下段が手順になり、選んだ手順の材料だけを出す。
  const dataSections: Array<{ label: string; node: HTMLElement }> = [
    { label: "基本情報", node: basicNode },
    { label: "チャート", node: chartNode },
    { label: "概念", node: conceptNode },
    ...(usesPart("shape") || usesPart("singleton") || usesPart("center") ? [{ label: "全体の形", node: shapeNode }] : []),
    ...(chart.tally === false || !usesPart("tally") ? [] : [{ label: "元素", node: elemNode }, { label: "クオリティ", node: qualNode }]),
    { label: "天体", node: planetTbl },
    { label: "カスプ", node: cuspTbl },
    { label: "ハウス詳細", node: matHost },
    { label: "サイン", node: signTbl },
    ...(usesPart("interception") ? [{ label: "インターセプト", node: icptTbl }] : []),
    ...(usesPart("dignity") ? [{ label: "ディグニティ", node: digTbl }] : []),
    ...(usesPart("rulership") ? [{ label: "支配関係", node: rulerTbl }] : []),
    ...(usesPart("dispositor") ? [{ label: "ディスポジター", node: dispTbl }] : []),
    ...(usesPart("chart_ruler") ? [{ label: "チャートルーラー", node: crTbl }] : []),
    ...(usesPart("sect") ? [{ label: "セクト", node: sectTbl }] : []),
    ...(usesPart("hemisphere") ? [{ label: "半球", node: hemiTbl }] : []),
    ...(usesPart("station") ? [{ label: "留", node: stTbl }] : []),
    ...(usesPart("decan") || usesPart("face") ? [{ label: "デーカン/フェイス", node: decanTbl }] : []),
    ...(usesPart("antiscia") ? [{ label: "アンティシア", node: antiTbl }] : []),
    ...(usesPart("harmonic") || usesPart("draconic") ? [{ label: "ハーモニクス", node: harmTbl }] : []),
    ...(usesPart("quadrant") ? [{ label: "象限", node: quadTbl }] : []),
    ...(usesPart("lunation") ? [{ label: "ルネーション", node: lunTbl }] : []),
    { label: `アスペクト(${chart.aspects.length})`, node: aspectNode },
    ...(chart.aspect_figure === false || !usesPart("aspect_figure") ? [] : [{ label: `配置(${majorCount})`, node: patternNode }]),
    ...(usesPart("progression") ? [{ label: "進行", node: derivedNode("progressed") }] : []),
    ...(usesPart("transit") ? [{ label: "経過", node: derivedNode("transit") }] : []),
    ...(usesPart("cycles") ? [{ label: "サイクル", node: cyclesNode() }] : []),
  ];

  const content = el("div", { className: "u-tab-content" });
  const dataWraps = dataSections.map((sec) => el("div", { className: "u-section" }, [sec.node]));
  for (const w of dataWraps) content.append(w);

  const tabBar = el("div", { className: "u-tabs" });
  let dataIdx = 0;
  const paint = () => {
    tabBar.innerHTML = "";
    dataSections.forEach((sec, i) => {
      const btn = el("button", { className: "u-tab-btn" + (i === dataIdx ? " on" : ""), type: "button", textContent: sec.label });
      btn.addEventListener("click", () => { dataIdx = i; paint(); });
      tabBar.append(btn);
    });
    dataWraps.forEach((w, i) => { w.style.display = i === dataIdx ? "" : "none"; });
  };
  const bar = el("div", {}, [tabBar]);
  paint();
  wrap.append(bar, content);
  renderConcepts();
  return wrap;
}


// ───────────────────────── ルート描画 ─────────────────────────
export async function renderUranai(container: HTMLElement): Promise<void> {
  container.innerHTML = `<style>
    /* PC: サイド/メイン/レポートを独立スクロール（画面高に収める）。 */
    .u-wrap{display:flex;gap:16px;padding:16px;font-family:system-ui;color:#222;height:calc(100dvh - 36px);box-sizing:border-box}
    .u-side{width:220px;flex:none;border-right:1px solid #0001;padding-right:12px;overflow-y:auto}
    .u-main{flex:1;min-width:0;overflow-y:auto}
    .u-report{flex:1;min-width:0;overflow-y:auto;border-left:1px solid #0001;padding-left:14px}
    .u-report-head{font-weight:700;font-size:15px;margin-bottom:8px;color:#333;border-bottom:2px solid #4A90C2;padding-bottom:4px}
    .u-report-body{color:#888;font-size:13px}
    .u-person{position:relative;display:flex;align-items:center;gap:4px;padding:6px 8px;border-radius:6px}.u-person:hover{background:#0000000a}.u-person.sel{background:#4A90C222;font-weight:600}
    .u-person-name{flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .u-person-menu{flex:none;border:0;background:transparent;color:#888;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:4px}
    .u-person-menu:hover{background:#0000000f;color:#333}
    .u-person-pop{display:none;position:absolute;right:6px;top:100%;z-index:30;background:#fff;border:1px solid #0002;border-radius:6px;box-shadow:0 6px 16px #0003;padding:4px;min-width:96px}
    .u-person-pop.open{display:block}
    .u-pop-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#c0392b;cursor:pointer;font-size:13px;padding:6px 10px;border-radius:4px;white-space:nowrap}
    .u-pop-item:hover{background:#c0392b14}
    .u-btn{background:#4A90C2;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;margin-top:8px}
    .u-row{display:flex;align-items:center;gap:8px;margin:6px 0}.u-row label{width:80px;flex:none;color:#666;font-size:13px}
    .u-row input{flex:1;padding:6px;border:1px solid #0002;border-radius:5px}
    .u-geo-wrap{flex:1;min-width:0;position:relative}
    .u-geo-wrap input{width:100%;box-sizing:border-box}
    .u-geo-results{position:absolute;left:0;right:0;top:100%;z-index:10;background:#fff;border:1px solid #0002;border-top:0;border-radius:0 0 5px 5px;box-shadow:0 6px 14px #0002;max-height:200px;overflow:auto}
    .u-geo-results:empty{display:none}
    .u-geo-item{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-bottom:1px solid #0001;cursor:pointer;line-height:1.35}.u-geo-item:hover{background:#4A90C214}
    .u-geo-name{font-size:13px;color:#444}.u-geo-addr{font-size:11px;color:#aaa}
    .u-picked{color:#aaa;font-weight:400;font-size:12px;margin:4px 0}.u-status{color:#c0392b;font-size:13px;margin-top:6px}
    .u-glyph-toggle{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 2px;max-width:560px}
    .u-aspect-toggles{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:6px 0 10px;max-width:560px}
    .u-tg-title{font-size:12px;color:#666;margin-right:2px}
    .u-tg-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#444;cursor:pointer;user-select:none}
    .u-tg-chip input{cursor:pointer;margin:0}
    .u-tg-sw{width:14px;height:3px;border-radius:2px;display:inline-block}
    /* アスペクトはボタン風トグル。既定オフ（薄い枠）、オンで塗り。 */
    .u-tg-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#888;cursor:pointer;user-select:none;
      background:#fff;border:1px solid #0002;border-radius:999px;padding:5px 11px;line-height:1;transition:background .12s,border-color .12s,color .12s}
    .u-tg-btn:hover{border-color:#0004}
    .u-tg-btn .u-tg-sw{opacity:.35}
    .u-tg-btn.on{color:#1f2937;background:#4A90C218;border-color:#4A90C2aa;font-weight:600}
    .u-tg-btn.on .u-tg-sw{opacity:1}
    .u-warn{color:#c82;font-size:13px;margin:8px 0}
    /* アスペクトパターン（配置図形）カード */
    .u-pat-toggle{margin:2px 0 10px}
    .u-pat-list{display:flex;flex-direction:column;gap:8px}
    .u-pat{border:1px solid #0002;border-left:3px solid #4A90C2;border-radius:8px;padding:8px 11px;background:#fff}
    .u-pat-sub{border-left-color:#bbb;background:#fafafa;opacity:.85}
    .u-pat-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
    .u-pat-h b{font-size:14px;color:#1f2937}
    .u-pat-aka{font-size:11px;color:#999}
    .u-pat-badge{font-size:10px;color:#2A7;border:1px solid #2A78;border-radius:999px;padding:1px 7px;line-height:1.5}
    .u-pat-in{color:#999;border-color:#bbb}
    .u-pat-comp{font-size:11px;color:#888;margin:2px 0 5px}
    .u-pat-bodies{font-size:13px;color:#333;letter-spacing:.02em}
    .u-pat-focus{font-size:11.5px;color:#4A90C2;margin-top:3px}
    .u-pat-empty{font-size:12.5px;color:#999;padding:4px 2px}
    /* ツールチップ（ホバー/長押しで着目情報） */
    .u-hit{cursor:pointer}
    .u-tip{position:fixed;z-index:1000;pointer-events:none;display:none;max-width:280px;background:#1f2937;color:#e5e7eb;font-size:12px;line-height:1.55;padding:8px 11px;border-radius:8px;box-shadow:0 10px 28px #0006}
    .u-tip-h{font-weight:700;font-size:13px;color:#fff;margin-bottom:2px}
    .u-tip-s{color:#93c5fd;font-weight:600;margin-top:5px}
    .u-tip-a{color:#cbd5e1}
    /* 基本情報（表＋項目別編集） */
    .u-basic-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
    .u-basic-tbl td{padding:6px 8px;border-bottom:1px solid #0001;vertical-align:middle}
    .u-basic-k{color:#999;white-space:nowrap;width:120px}
    .u-basic-v{color:#333}
    .u-basic-v .u-fi{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #4A90C2;border-radius:5px}
    .u-basic-ic{width:40px;text-align:right}
    .u-basic-tbl tr.u-dim{opacity:.32;pointer-events:none}
    .u-edit-ic{border:0;background:transparent;cursor:pointer;font-size:14px;padding:3px 7px;border-radius:5px;color:#888;line-height:1}
    .u-edit-ic:hover{background:#0000000f;color:#333}
    .u-basic-actions{display:flex;gap:8px;align-items:center;margin-top:12px}
    .u-btn-ghost{background:#0000000d;color:#333}.u-btn-ghost:hover{background:#00000014}
    /* 出生データ・計算方式の表（チャート上部） */
    .u-data{display:flex;flex-wrap:wrap;gap:2px 14px;margin:0 0 8px;max-width:600px;font-size:12px}
    .u-data-row{display:inline-flex;gap:5px;align-items:baseline}
    .u-data-k{color:#999}.u-data-v{color:#333;font-weight:600}
    /* タブ（チャート/表/基本情報）＋全表示 */
    .u-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
    .u-tab-btn{font-size:12px;color:#666;cursor:pointer;background:#fff;border:1px solid #0002;border-radius:999px;padding:5px 12px;line-height:1}
    .u-tab-btn:hover{border-color:#0004}
    .u-tab-btn.on{color:#1f2937;background:#4A90C218;border-color:#4A90C2aa;font-weight:600}
    .u-tab-all.on{background:#2A7A;border-color:#2A7;color:#fff}
    .u-section{margin-bottom:16px}
    .u-sec-head{font-size:14px;font-weight:700;color:#333;margin:14px 0 6px;padding-bottom:3px;border-bottom:2px solid #4A90C2}
    /* PC ではチャート・表の幅を 40vw に。モバイルは全幅。 */
    .u-chart{max-width:40vw}
    /* 表: 列を等分・中央ぞろえ */
    .u-tbl{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12.5px;margin-bottom:8px}
    .u-tbl th{color:#999;font-weight:600;text-align:center;padding:5px 4px;border-bottom:1px solid #0002}
    .u-tbl td{color:#333;text-align:center;padding:5px 4px;border-bottom:1px solid #0001;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .u-tbl-title{font-size:12px;font-weight:700;color:#555;margin:10px 0 4px}
    /* 長文の列（意味など）は折り返して左寄せ。列幅は内容に合わせる。 */
    .u-tbl.u-tbl-auto{table-layout:auto}
    .u-tbl td.u-mean{white-space:normal;text-align:left;overflow:visible;text-overflow:clip;line-height:1.5}
    .u-tbl th.u-mean{text-align:left}
    .u-title{font-weight:700;font-size:18px;margin-bottom:8px}
    .u-chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
    .u-chart-head .u-title{margin-bottom:0}
    .u-btn-sm{padding:5px 10px;margin-top:0;font-size:13px;background:#0000000d;color:#333}
    .u-btn-sm:hover{background:#00000014}
    .u-settings{margin:12px 0 4px;padding:10px 12px;border:1px solid #0001;border-radius:8px;background:#0000000a;max-width:520px}
    .u-set-title{font-size:13px;font-weight:600;color:#555;margin-bottom:8px}
    .u-parts{margin:10px 0 4px}
    .u-part-todo{opacity:.5}
    .u-parts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 12px}
    .u-set-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
    .u-set-row{display:flex;align-items:center;gap:8px}
    .u-set-row label{width:88px;flex:none;color:#666;font-size:12px}
    .u-set-sel{flex:1;min-width:0;padding:4px 6px;border:1px solid #0002;border-radius:5px;font-size:12px;background:#fff}
    .u-settings-note{font-size:12px;color:#888;margin-bottom:12px;max-width:520px}
    /* 解釈メモ（右ペイン） */
    .u-note{width:100%;box-sizing:border-box;min-height:110px;padding:7px 8px;border:1px solid #0002;border-radius:6px;font-size:13px;line-height:1.6;font-family:inherit;resize:vertical}
    .u-note-wrap{display:flex;flex-direction:column;gap:4px;align-items:flex-end;margin-bottom:10px}
    .u-ray-chips{display:flex;flex-wrap:wrap;gap:4px;width:100%;align-items:center}
    .u-prop{display:flex;gap:8px;align-items:flex-start;margin:4px 0}
    .u-prop-k{width:74px;flex:none;font-size:11.5px;color:#999;padding-top:3px}
    .u-prop-sel{font-size:11.5px;padding:2px 4px;border:1px solid #0002;border-radius:5px;background:#fff;color:#666}
    [data-theme=dark] .u-prop-sel{background:#1b1f26;border-color:#ffffff26;color:#dfe4ea}
    [data-theme=dark] .u-prop-k{color:#8b95a3}
    .u-page{display:flex;flex-direction:column;gap:2px;align-items:flex-start}
    .u-page-title{width:100%;box-sizing:border-box;border:0;background:transparent;font-size:19px;font-weight:700;color:#1f2937;padding:6px 0;margin-bottom:4px;font-family:inherit}
    .u-page-title:focus{outline:none;border-bottom:1px solid #4A90C2}
    [data-theme=dark] .u-page-title{color:#f3f5f7}
    .u-row-sub{font-size:11px;color:#888;margin-top:2px;white-space:normal;line-height:1.5}
    [data-theme=dark] .u-row-sub{color:#8b95a3}
    .u-row-btn{display:block;width:100%;text-align:left;border:1px solid #0002;background:#fff;color:#333;border-radius:6px;padding:6px 9px;margin-bottom:5px;font-size:12.5px;cursor:pointer}
    [data-theme=dark] .u-row-btn{background:#1b1f26;border-color:#ffffff26;color:#e6e8eb}
    .u-ray{font-size:11px;border:1px solid #0002;background:#fff;color:#666;border-radius:999px;padding:2px 8px;cursor:pointer;line-height:1.5}
    .u-ray.on{background:#4A90C218;border-color:#4A90C2aa;color:#1f2937}
    [data-theme=dark] .u-ray{background:#1b1f26;border-color:#ffffff26;color:#b3bcc7}
    [data-theme=dark] .u-ray.on{background:#4A90C233;border-color:#4A90C2aa;color:#e6e8eb}
    [data-theme=dark] .u-note{background:#1b1f26;border-color:#ffffff26;color:#e6e8eb}
    /* 選択中であることを枠で示す */
    .u-pick{font-size:11.5px;border:1px solid #0002;background:transparent;color:#888;border-radius:6px;padding:3px 9px;cursor:pointer;margin:2px 0 8px}
    .u-pick.on{border-color:#4A90C2;color:#4A90C2;box-shadow:0 0 0 2px #4A90C233}
    [data-theme=dark] .u-pick{border-color:#ffffff26;color:#8b95a3}
    /* 新規作成時に入るプロパティの予告 */
    .u-scope{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
    .u-note-sm{min-height:44px;font-size:12.5px}
    /* テーマ切替ボタン */
    .u-theme-btn{position:fixed;right:14px;bottom:14px;z-index:900;border:1px solid #0002;background:#fff;color:#666;
      border-radius:999px;width:36px;height:36px;font-size:16px;line-height:1;cursor:pointer;box-shadow:0 4px 12px #0002}
    /* ── ダーク（既定）。ライトの規則は触らず、data-theme=dark のときだけ上書きする ── */
    .u-wrap[data-theme=dark]{color:#e6e8eb;background:#14161a}
    [data-theme=dark] .u-side{border-right-color:#ffffff1f}
    [data-theme=dark] .u-report{border-left-color:#ffffff1f}
    [data-theme=dark] .u-report-head,[data-theme=dark] .u-sec-head,[data-theme=dark] .u-basic-v,
    [data-theme=dark] .u-data-v,[data-theme=dark] .u-pat-bodies,[data-theme=dark] .u-tbl td{color:#e6e8eb}
    [data-theme=dark] .u-pat-h b,[data-theme=dark] .u-tg-btn.on,[data-theme=dark] .u-tab-btn.on{color:#f3f5f7}
    [data-theme=dark] .u-report-body,[data-theme=dark] .u-person-menu,[data-theme=dark] .u-pat-comp,
    [data-theme=dark] .u-settings-note,[data-theme=dark] .u-pat-empty,[data-theme=dark] .u-pat-aka,
    [data-theme=dark] .u-basic-k,[data-theme=dark] .u-tbl th,[data-theme=dark] .u-data-k,
    [data-theme=dark] .u-geo-addr,[data-theme=dark] .u-picked,[data-theme=dark] .u-tg-title,
    [data-theme=dark] .u-set-title,[data-theme=dark] .u-tbl-title{color:#8b95a3}
    [data-theme=dark] .u-tg-chip,[data-theme=dark] .u-geo-name,[data-theme=dark] .u-row label,
    [data-theme=dark] .u-set-row label,[data-theme=dark] .u-tab-btn,[data-theme=dark] .u-tg-btn{color:#b3bcc7}
    [data-theme=dark] .u-person:hover{background:#ffffff0f}
    [data-theme=dark] .u-person-menu:hover,[data-theme=dark] .u-edit-ic:hover{background:#ffffff14;color:#e6e8eb}
    [data-theme=dark] .u-person-pop,[data-theme=dark] .u-geo-results,[data-theme=dark] .u-pat,
    [data-theme=dark] .u-tab-btn,[data-theme=dark] .u-tg-btn,[data-theme=dark] .u-set-sel,
    [data-theme=dark] .u-row input,[data-theme=dark] .u-theme-btn{background:#1b1f26;border-color:#ffffff26;color:#dfe4ea}
    [data-theme=dark] .u-pat-sub{background:#171a20;border-left-color:#4b5563}
    [data-theme=dark] .u-tab-btn:hover,[data-theme=dark] .u-tg-btn:hover{border-color:#ffffff44}
    [data-theme=dark] .u-tbl td,[data-theme=dark] .u-basic-tbl td,[data-theme=dark] .u-geo-item{border-bottom-color:#ffffff14}
    [data-theme=dark] .u-tbl th{border-bottom-color:#ffffff26}
    [data-theme=dark] .u-geo-item:hover{background:#4A90C233}
    [data-theme=dark] .u-btn-ghost,[data-theme=dark] .u-btn-sm{background:#ffffff14;color:#e6e8eb}
    [data-theme=dark] .u-btn-ghost:hover,[data-theme=dark] .u-btn-sm:hover{background:#ffffff22}
    [data-theme=dark] .u-settings{background:#ffffff0a;border-color:#ffffff1f}
    [data-theme=dark] .u-edit-ic{color:#8b95a3}
    [data-theme=dark] .u-tip{background:#0b0d11;box-shadow:0 10px 28px #000a}
    .u-set-btn{margin-top:6px}
    /* モバイル: 縦積み＋人物リストを横スクロールのチップ化 */
    /* モバイルの固定フッター。3ペインの切り替え。 */
    .u-foot{display:none}
    @media (max-width: 640px){
      .u-foot{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:950;border-top:1px solid #0002;background:#fff}
      .u-foot-btn{flex:1;border:0;background:transparent;color:#888;font-size:13px;padding:11px 0;cursor:pointer}
      .u-foot-btn.on{color:#1f2937;font-weight:700;box-shadow:inset 0 -2px 0 #4A90C2}
      [data-theme=dark] .u-foot{background:#14161a;border-top-color:#ffffff26}
      [data-theme=dark] .u-foot-btn{color:#8b95a3}
      [data-theme=dark] .u-foot-btn.on{color:#f3f5f7}
      /* 選んだペインだけ出す。人物一覧は縦積みに戻す（横スクロールのチップをやめる）。 */
      /* 固定フッターに隠れないよう、表示中のペインの下に余白を取る。 */
      .u-side,.u-main,.u-report{padding-bottom:76px}
      .u-wrap[data-pane=report] .u-report{overflow-y:visible}
      /* タブは折り返さず横スクロール。 */
      .u-tabs{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}
      .u-tabs .u-tab-btn{flex:none;white-space:nowrap}
      .u-wrap[data-pane=side] .u-main,.u-wrap[data-pane=side] .u-report{display:none}
      .u-wrap[data-pane=main] .u-side,.u-wrap[data-pane=main] .u-report{display:none}
      .u-wrap[data-pane=report] .u-side,.u-wrap[data-pane=report] .u-main{display:none}
      .u-wrap[data-pane=report] .u-report{display:block;border-left:0;padding-left:0}
      .u-wrap[data-pane=side] .u-side{display:block;border-bottom:0;overflow-x:visible}
      .u-wrap[data-pane=side] .u-person{white-space:normal}
      .u-theme-btn{bottom:60px}
    }
    @media (max-width: 640px){
      /* モバイル: 縦積み・自然高（body スクロール=pull-to-refresh 有効）。空のレポートは隠す。 */
      .u-wrap{flex-direction:column;gap:10px;padding:10px;height:auto}
      .u-side{width:auto;flex:none;border-right:0;border-bottom:1px solid #0001;padding:0 0 8px 0;display:flex;gap:6px;overflow-x:auto;overflow-y:visible;align-items:center;-webkit-overflow-scrolling:touch}
      .u-main{overflow-y:visible}
      .u-report{display:none}
      .u-side>.u-title{font-size:14px;margin:0 4px 0 0;flex:none}
      .u-person{flex:none;white-space:nowrap;padding:6px 10px;border:1px solid #0001}
      .u-side>.u-btn{flex:none;margin-top:0;white-space:nowrap;padding:6px 10px}
      .u-main{width:100%}
      .u-set-grid{grid-template-columns:1fr}
      .u-set-row label{width:84px}
      .u-row label{width:64px;font-size:12px}
      .u-settings,.u-glyph-toggle,.u-aspect-toggles{max-width:100%}
      .u-chart{max-width:100%}
      .u-chart-head{flex-wrap:wrap;gap:6px}
      .u-title{font-size:16px}
    }
  </style>`;
  const wrap = el("div", { className: "u-wrap" });
  // テーマ。既定はダーク。SVG 側は currentTheme() が documentElement を見るので両方に付ける。
  const applyTheme = (t: "dark" | "light") => {
    wrap.dataset.theme = t;
    document.documentElement.dataset.uTheme = t;
    themeBtn.textContent = t === "dark" ? "☀" : "☾";
    themeBtn.title = t === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え";
  };
  const themeBtn = el("button", { className: "u-theme-btn", type: "button" }) as HTMLButtonElement;
  let theme: "dark" | "light" = localStorage.getItem("u-theme") === "light" ? "light" : "dark";
  themeBtn.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem("u-theme", theme);
    applyTheme(theme);
    // ホイールは SVG の属性に色を焼き込んでいるので描き直す。
    for (const h of Array.from(document.querySelectorAll<HTMLElement>(".u-wheel"))) h.dispatchEvent(new CustomEvent("u-redraw"));
  });
  applyTheme(theme);
  const side = el("div", { className: "u-side" });
  const main = el("div", { className: "u-main" });
  // 右側: 鑑定レポート枠（今は空。独立スクロール）。
  // 右ペインは解釈のデータベース。見出しは置かない（ナビゲーションテキストは極力なし）。
  const report = el("div", { className: "u-report" }, [el("div", { className: "u-report-body" })]);
  // モバイル用の固定フッター。3つのペインを切り替える。PCでは出さない。
  const PANES = [{ id: "side", label: "人物" }, { id: "main", label: "情報" }, { id: "report", label: "解釈" }] as const;
  const foot = el("div", { className: "u-foot" });
  const setPane = (id: string) => {
    wrap.dataset.pane = id;
    for (const b of Array.from(foot.children) as HTMLElement[]) b.classList.toggle("on", b.dataset.pane === id);
  };
  for (const pn of PANES) {
    const b = el("button", { className: "u-foot-btn", type: "button", textContent: pn.label });
    b.dataset.pane = pn.id;
    b.addEventListener("click", () => setPane(pn.id));
    foot.append(b);
  }
  setPane("main");
  wrap.append(side, main, report, themeBtn, foot); container.append(wrap);

  // 流派設定（マスタ）。編集フォームで表示・変更する。全人物のチャートに適用。
  const settings = await loadSettings();

  // 内部遷移を履歴に積む（push=true）。popstate からの復元時は push=false で再描画のみ。
  const showForm = (personId: string, prefill?: Prefill, push = true) => {
    if (push) history.pushState({ uranai: { kind: "form", personId, prefill: prefill ?? null } as UranaiView }, "");
    main.innerHTML = "";
    main.append(
      el("div", { className: "u-title", textContent: prefill?.date ? "出生データを編集" : "出生データを登録" }),
      birthForm(personId, async () => { await refreshList(personId); void showChart(personId, prefill?.label ?? null); }, prefill),
    );
  };
  const showSettings = (push = true) => {
    if (push) history.pushState({ uranai: { kind: "settings" } as UranaiView }, "");
    main.innerHTML = "";
    main.append(
      el("div", { className: "u-title", textContent: "設定（計算方式）" }),
      settingsView(settings, async () => { await refreshList(); main.append(el("div", { className: "u-picked", textContent: "設定を保存し、全チャートを再計算しました。" })); }),
    );
  };
  // 既存人物の出生データを取得して編集フォームを事前入力で開く。
  const showChart = async (personId: string, label?: string | null, push = true) => {
    main.innerHTML = ""; main.append(el("div", { textContent: "読み込み中…" }));
    await loadMeanings();
    const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    const birth = await api<Birth>(`/api/v1/uranai/person/${personId}/birth`).catch(() => null);
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }, push); return; }
    if (push) history.pushState({ uranai: { kind: "chart", personId, label: label ?? null } as UranaiView }, "");
    // 保存後は一覧のラベル更新＋再描画（画面遷移せず反映）。
    const onSaved = async (newLabel: string | null) => { await refreshList(personId); void showChart(personId, newLabel ?? label, false); };
    main.append(el("div", { className: "u-chart-head" }, [el("div", { className: "u-title", textContent: label ?? "" })]), chartView(chart, birth, personId, label ?? null, onSaved, report.querySelector(".u-report-body") as HTMLElement));
    // モバイルで人物を選んだら情報へ移る（フッターの選択も追従させる）。
    if (window.matchMedia("(max-width: 640px)").matches) setPane("main");
  };

  // 人物リスト（サイド）を再構築し selectId をハイライトするだけ。画面遷移はしない。
  const refreshList = async (selectId?: string) => {
    side.innerHTML = "";
    side.append(el("div", { className: "u-title", textContent: "人物" }));
    const { persons } = await api<{ persons: Person[] }>(`/api/v1/uranai/person`);
    for (const p of persons) {
      const nameSpan = el("span", { className: "u-person-name", textContent: p.label ?? "(名称未設定)" });
      nameSpan.addEventListener("click", () => { void refreshList(p.id); void showChart(p.id, p.label); });
      const del = el("button", { className: "u-pop-item", type: "button", textContent: "🗑 削除" });
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`「${p.label ?? "この人物"}」を削除しますか？（元に戻せません）`)) return;
        await api(`/api/v1/uranai/person/${p.id}`, { method: "DELETE" }).catch(() => {});
        main.innerHTML = ""; await refreshList();
      });
      const pop = el("div", { className: "u-person-pop" }, [del]);
      const menuBtn = el("button", { className: "u-person-menu", type: "button", textContent: "⋮", title: "メニュー" });
      menuBtn.addEventListener("click", (e) => { e.stopPropagation(); const open = pop.classList.contains("open"); side.querySelectorAll(".u-person-pop.open").forEach((n) => n.classList.remove("open")); if (!open) pop.classList.add("open"); });
      const item = el("div", { className: "u-person" + (p.id === selectId ? " sel" : "") }, [nameSpan, menuBtn, pop]);
      side.append(item);
    }
    const add = el("button", { className: "u-btn", textContent: "＋ 人物を追加" });
    add.addEventListener("click", async () => { const { id } = await api<{ id: string }>(`/api/v1/uranai/person`, { method: "POST", body: JSON.stringify({ label: "新しい人物" }) }); await refreshList(id); showForm(id, { label: "新しい人物" }); });
    side.append(add);
    const setBtn = el("button", { className: "u-btn u-btn-sm u-set-btn", textContent: "⚙ 設定" });
    setBtn.addEventListener("click", () => showSettings());
    side.append(setBtn);
    if (!selectId && persons.length === 0) main.append(el("div", { textContent: "「人物を追加」から始めてください。" }));
  };

  // ブラウザバック対応。base を土台に据え（replace）、以降の内部遷移は pushState で積む。
  // 内部状態を持つ popstate はここで復元し、状態を持たない（uranai 外の）バックは
  // client.ts のグローバル popstate に委ねてアプリを離脱させる。
  history.replaceState({ uranai: { kind: "base" } as UranaiView }, "");
  if (uranaiPopHandler) window.removeEventListener("popstate", uranaiPopHandler);
  uranaiPopHandler = (e: PopStateEvent) => {
    const v = (e.state as { uranai?: UranaiView } | null)?.uranai;
    if (!v) return; // uranai 外へ戻る → グローバル側が担当
    if (v.kind === "chart") { void refreshList(v.personId); void showChart(v.personId, v.label, false); }
    else if (v.kind === "form") { void refreshList(v.personId); showForm(v.personId, v.prefill ?? undefined, false); }
    else if (v.kind === "settings") { void refreshList(); showSettings(false); }
    else { void refreshList(); main.innerHTML = ""; }
  };
  window.addEventListener("popstate", uranaiPopHandler);

  await refreshList();
}
