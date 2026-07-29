// ウラナイ画面のルート描画とフォーム類。定数・型・ヘルパは ./parts、ホイール描画は ./wheel に分割。
import {
  SIGN_ORDER, SIGN_GLYPH, SIGN_NAME, SIGN_ELEMENT, SIGN_QUALITY, ELEMENT_CHAR, QUALITY_CHAR, PLANET_GLYPH, PLANET_ORDER, PLANET_NAME_LINES, ASPECT_INFO, ASPECT_ORDER, PATTERN_INFO, PATTERN_ORDER, Person, Prefill, Settings, SETTING_FIELDS, Chart, UranaiView, api, lonOf, fmtDeg, Birth, HOUSE_SYSTEM_JA, IANA_ZONES, FALLBACK_ZONES, CC_ZONE, offsetFromZone, el, selectEl, loadSettings,
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
    grid.append(el("div", { className: "u-set-row" }, [el("label", { textContent: f.label }), sel]));
  }
  const status = el("div", { className: "u-status" });
  const save = el("button", { className: "u-btn", textContent: "保存して全チャート再計算" });
  save.addEventListener("click", async () => {
    status.textContent = "保存中…";
    try {
      const payload: Record<string, string> = {};
      for (const f of SETTING_FIELDS) { const v = sels[f.key]?.value; if (v) { payload[f.key as string] = v; (settings as Record<string, string>)[f.key as string] = v; } }
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
      for (const p of persons) {
        status.textContent = `再計算中… (${++done}/${persons.length})`;
        try {
          await api(`/api/v1/uranai/astrology/person/${p.id}/compute`, { method: "POST", body: "{}" });
        } catch (e) {
          failed.push(`${p.label ?? p.id}: ${(e as Error).message}`);
        }
      }
      if (failed.length) throw new Error(`再計算に失敗しました（${failed.length}/${persons.length}件）: ${failed.join(" / ")}`);
      status.textContent = "";
      await onSaved();
    } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
  });
  wrap.append(
    el("div", { className: "u-settings-note", textContent: "この設定はあなた（ユーザー）の既定として保存され、全チャートに適用されます。" }),
    el("div", { className: "u-set-title", textContent: "計算方式" }), grid, save, status,
  );
  return wrap;
}

// ───────────────────────── チャート表示（タブ: チャート/表/基本情報） ─────────────────────────
function chartView(chart: Chart, birth: Birth | null | undefined, personId: string, label: string | null, onSaved: (newLabel: string | null) => void | Promise<void>): HTMLElement {
  const wrap = el("div", { className: "u-chart" });
  // データ準備
  const storedCusps = (chart.cusps ?? []).filter((c) => c.system === (chart.house_system ?? "whole_sign")).sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12 ? storedCusps.map((c) => c.longitude) : Array.from({ length: 12 }, (_, i) => ((Math.floor(chart.ascendant / 30) * 30) + i * 30) % 360);
  const houseOf = (lon: number): number => { for (let i = 0; i < 12; i++) { const a = cuspLons[i], b = cuspLons[(i + 1) % 12]; const span = ((b - a) % 360 + 360) % 360; const off = ((lon - a) % 360 + 360) % 360; if (off < span) return i + 1; } return 12; };
  const place = new Map(chart.placements.map((p) => [p.planet, p]));
  const bodyLabel = (k: string): string => { const nm = PLANET_NAME_LINES[k]?.[0]; return nm ? `${PLANET_GLYPH[k] ?? ""} ${nm}`.trim() : (PLANET_GLYPH[k] ?? k); };
  const mkTable = (headers: string[], rows: string[][]): HTMLElement => {
    const tbl = el("table", { className: "u-tbl" });
    const htr = el("tr", {}); for (const h of headers) htr.append(el("th", { textContent: h })); tbl.append(htr);
    for (const r of rows) { const tr = el("tr", {}); for (const c of r) tr.append(el("td", { textContent: c })); tbl.append(tr); }
    return tbl;
  };

  // チャート（本格表示のみ）。アスペクトは常に全表示。天体名トグルのみ。
  const present = ASPECT_ORDER.filter((t) => chart.aspects.some((a) => a.type === t));
  const enabled = new Set<string>(present);
  let nameMode = false;
  const host = el("div", { className: "u-wheel" });
  const drawChart = () => { host.innerHTML = ""; host.append(drawWheelPro(chart, enabled, nameMode)); };
  const nameCb = el("input", { type: "checkbox", checked: false });
  nameCb.addEventListener("change", () => { nameMode = nameCb.checked; drawChart(); });

  // ツールチップ: 天体/ASC等/サイン/ハウスにホバー（PC）・長押し（モバイル）で着目情報。
  const ELEM_JA: Record<string, string> = { fire: "火", earth: "地", air: "風", water: "水" };
  const QUAL_JA: Record<string, string> = { cardinal: "活動", fixed: "不動", mutable: "柔軟" };
  const aspOf = (k: string): string => chart.aspects.filter((a) => a.a === k || a.b === k).sort((x, y) => x.orb - y.orb)
    .map((a) => `<div class="u-tip-a">${ASPECT_INFO[a.type]?.label ?? a.type}　${bodyLabel(a.a === k ? a.b : a.a)}　${a.orb.toFixed(2)}°</div>`).join("");
  const tipHTML = (kind: string, id: string): string => {
    if (kind === "planet" || kind === "axis") {
      const p = place.get(id); if (!p) return "";
      const nm = kind === "axis" ? (PLANET_GLYPH[id] ?? id) : bodyLabel(id);
      const asp = aspOf(id);
      return `<div class="u-tip-h">${nm}</div>`
        + `<div>サイン: ${SIGN_NAME[p.sign] ?? p.sign} ${fmtDeg(p.degree)}${p.retrograde ? " ℞" : ""}</div>`
        + (kind === "planet" ? `<div>ハウス: ${houseOf(lonOf(p))}室</div>` : "")
        + (asp ? `<div class="u-tip-s">アスペクト</div>${asp}` : `<div class="u-tip-a">アスペクトなし</div>`);
    }
    if (kind === "sign") {
      const inSign = chart.placements.filter((pp) => pp.sign === id && !["asc", "mc", "dsc", "ic"].includes(pp.planet)).map((pp) => bodyLabel(pp.planet)).join("、") || "なし";
      return `<div class="u-tip-h">${SIGN_GLYPH[id]}︎ ${SIGN_NAME[id] ?? id}</div>`
        + `<div>元素: ${ELEM_JA[SIGN_ELEMENT[id]] ?? ELEMENT_CHAR[SIGN_ELEMENT[id]]}　区分: ${QUAL_JA[SIGN_QUALITY[id]] ?? QUALITY_CHAR[SIGN_QUALITY[id]]}</div>`
        + `<div class="u-tip-s">在住</div><div>${inSign}</div>`;
    }
    if (kind === "house") {
      const n = Number(id); const lon = cuspLons[n - 1];
      const sign = SIGN_ORDER[Math.floor((((lon % 360) + 360) % 360) / 30) % 12];
      const inH = chart.placements.filter((pp) => !["asc", "mc", "dsc", "ic"].includes(pp.planet) && houseOf(lonOf(pp)) === n).map((pp) => bodyLabel(pp.planet)).join("、") || "なし";
      return `<div class="u-tip-h">${n}室</div>`
        + `<div>カスプ: ${SIGN_NAME[sign] ?? sign} ${fmtDeg(((lon % 30) + 30) % 30)}</div>`
        + `<div class="u-tip-s">在住</div><div>${inH}</div>`;
    }
    return "";
  };
  const tip = el("div", { className: "u-tip" });
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
  host.addEventListener("mouseover", (e) => { const t = hitOf(e); if (t) showTip(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY); });
  host.addEventListener("mousemove", (e) => { const t = hitOf(e); if (t) showTip(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY); else hideTip(); });
  host.addEventListener("mouseleave", hideTip);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  host.addEventListener("touchstart", (e) => {
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
  const planetRows = PLANET_ORDER.filter((k) => place.has(k)).map((k) => { const p = place.get(k)!; return [bodyLabel(k), SIGN_NAME[p.sign] ?? p.sign, fmtDeg(p.degree), p.retrograde ? "℞" : "", String(houseOf(lonOf(p)))]; });
  const angleRows = ["asc", "mc", "dsc", "ic"].filter((k) => place.has(k)).map((k) => { const p = place.get(k)!; return [PLANET_GLYPH[k] ?? k, SIGN_NAME[p.sign] ?? p.sign, fmtDeg(p.degree), "", ""]; });
  const planetTbl = mkTable(["天体", "サイン", "度数", "逆行", "室"], [...planetRows, ...angleRows]);
  const cuspTbl = mkTable(["室", "サイン", "度数"], cuspLons.map((lon, i) => { const sign = SIGN_ORDER[Math.floor((((lon % 360) + 360) % 360) / 30) % 12]; return [String(i + 1), SIGN_NAME[sign], fmtDeg(((lon % 30) + 30) % 30)]; }));

  // アスペクト（種類ごとにグループ化）
  const aspectNode = el("div", {});
  for (const t of ASPECT_ORDER) {
    const rows = chart.aspects.filter((a) => a.type === t).sort((a, b) => a.orb - b.orb);
    if (!rows.length) continue;
    aspectNode.append(el("div", { className: "u-tbl-title", textContent: `${ASPECT_INFO[t]?.label ?? t}（${rows.length}）` }));
    aspectNode.append(mkTable(["天体", "天体", "オーブ"], rows.map((a) => [bodyLabel(a.a), bodyLabel(a.b), `${a.orb.toFixed(2)}°`])));
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
  const sections: Array<{ label: string; node: HTMLElement }> = [
    { label: "基本情報", node: basicNode },
    { label: "チャート", node: chartNode },
    { label: "元素", node: elemNode },
    { label: "クオリティ", node: qualNode },
    { label: "天体", node: planetTbl },
    { label: "カスプ", node: cuspTbl },
    { label: `アスペクト(${chart.aspects.length})`, node: aspectNode },
    { label: `配置(${majorCount})`, node: patternNode },
  ];
  const content = el("div", { className: "u-tab-content" });
  const secHeads = sections.map((s) => el("div", { className: "u-sec-head", textContent: s.label }));
  const secWraps = sections.map((s, i) => el("div", { className: "u-section" }, [secHeads[i], s.node]));
  for (const w of secWraps) content.append(w);
  const bar = el("div", { className: "u-tabs" });
  const secBtns = sections.map((s) => el("button", { className: "u-tab-btn", type: "button", textContent: s.label }));
  const allBtn = el("button", { className: "u-tab-btn u-tab-all", type: "button", textContent: "全表示" });
  const select = (idx: number | null) => {
    secWraps.forEach((w, i) => { w.style.display = (idx === null || i === idx) ? "" : "none"; });
    // 見出しは全表示のときだけ表示（単一タブ時はタブ名で分かるので隠す）。
    secHeads.forEach((h) => { h.style.display = idx === null ? "" : "none"; });
    secBtns.forEach((b, j) => b.classList.toggle("on", j === idx));
    allBtn.classList.toggle("on", idx === null);
  };
  secBtns.forEach((b, i) => b.addEventListener("click", () => select(i)));
  allBtn.addEventListener("click", () => select(null));
  for (const b of secBtns) bar.append(b);
  bar.append(allBtn);
  wrap.append(bar, content);
  select(null); // 既定は全表示
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
    .u-title{font-weight:700;font-size:18px;margin-bottom:8px}
    .u-chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
    .u-chart-head .u-title{margin-bottom:0}
    .u-btn-sm{padding:5px 10px;margin-top:0;font-size:13px;background:#0000000d;color:#333}
    .u-btn-sm:hover{background:#00000014}
    .u-settings{margin:12px 0 4px;padding:10px 12px;border:1px solid #0001;border-radius:8px;background:#0000000a;max-width:520px}
    .u-set-title{font-size:13px;font-weight:600;color:#555;margin-bottom:8px}
    .u-set-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
    .u-set-row{display:flex;align-items:center;gap:8px}
    .u-set-row label{width:88px;flex:none;color:#666;font-size:12px}
    .u-set-sel{flex:1;min-width:0;padding:4px 6px;border:1px solid #0002;border-radius:5px;font-size:12px;background:#fff}
    .u-settings-note{font-size:12px;color:#888;margin-bottom:12px;max-width:520px}
    .u-set-btn{margin-top:6px}
    /* モバイル: 縦積み＋人物リストを横スクロールのチップ化 */
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
  const side = el("div", { className: "u-side" });
  const main = el("div", { className: "u-main" });
  // 右側: 鑑定レポート枠（今は空。独立スクロール）。
  const report = el("div", { className: "u-report" }, [
    el("div", { className: "u-report-head", textContent: "鑑定レポート" }),
    el("div", { className: "u-report-body" }),
  ]);
  wrap.append(side, main, report); container.append(wrap);

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
    const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    const birth = await api<Birth>(`/api/v1/uranai/person/${personId}/birth`).catch(() => null);
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }, push); return; }
    if (push) history.pushState({ uranai: { kind: "chart", personId, label: label ?? null } as UranaiView }, "");
    // 保存後は一覧のラベル更新＋再描画（画面遷移せず反映）。
    const onSaved = async (newLabel: string | null) => { await refreshList(personId); void showChart(personId, newLabel ?? label, false); };
    main.append(el("div", { className: "u-chart-head" }, [el("div", { className: "u-title", textContent: label ?? "" })]), chartView(chart, birth, personId, label ?? null, onSaved));
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
