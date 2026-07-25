// ウラナイ（占い）プロダクトのカスタム画面。TS で DOM を直接構築する SPA。
// 人物の登録（複数人）→ 出生データ入力（地名検索でジオコーディング）→ compute → ホイール図表示。
// API は front worker 経由で backend /api/v1/uranai/* に proxy される。

const SIGN_ORDER = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"] as const;
const SIGN_GLYPH: Record<string, string> = { aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋", leo: "♌", virgo: "♍", libra: "♎", scorpio: "♏", sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓" };
const SIGN_ELEMENT: Record<string, string> = { aries: "fire", leo: "fire", sagittarius: "fire", taurus: "earth", virgo: "earth", capricorn: "earth", gemini: "air", libra: "air", aquarius: "air", cancer: "water", scorpio: "water", pisces: "water" };
const ELEMENT_COLOR: Record<string, string> = { fire: "#E8663050", earth: "#7C9A4550", air: "#E0B84550", water: "#4A90C250" };
const PLANET_GLYPH: Record<string, string> = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇", chiron: "⚷", ceres: "⚳", pallas: "⚴", juno: "⚵", vesta: "⚶", pholus: "⯛", lilith: "⚸", dragon_head: "☊", dragon_tail: "☋", fortune: "⊗", asc: "Asc", mc: "MC", dsc: "Dsc", ic: "IC" };
const ASPECT_COLOR: Record<string, string> = { conjunction: "#888", opposition: "#D33", trine: "#2A7", square: "#D33", sextile: "#2A7", semisextile: "#AAA", quincunx: "#C82" };
// アスペクトの日本語名と角度。トグル表示順（主要角→マイナー角）。
const ASPECT_INFO: Record<string, { label: string; angle: number }> = {
  conjunction: { label: "コンジャンクション", angle: 0 },
  sextile: { label: "セクスタイル", angle: 60 },
  square: { label: "スクエア", angle: 90 },
  trine: { label: "トライン", angle: 120 },
  opposition: { label: "オポジション", angle: 180 },
  quincunx: { label: "クインカンクス", angle: 150 },
  semisextile: { label: "セミセクスタイル", angle: 30 },
};
const ASPECT_ORDER = ["conjunction", "sextile", "square", "trine", "opposition", "quincunx", "semisextile"];
const NS = "http://www.w3.org/2000/svg";

type Person = { id: string; label: string | null };
type Prefill = { label?: string | null; date?: string; time?: string; place?: string; lat?: number; lng?: number; tz?: string };
type Placement = { planet: string; sign: string; degree: number; retrograde?: boolean };
type Aspect = { a: string; b: string; type: string; orb: number };
type Cusp = { system: string; index: number; longitude: number };
type Chart = {
  ascendant: number; midheaven: number;
  house_system?: string; cusps?: Cusp[];
  placements: Placement[]; aspects: Aspect[];
  dignities: Array<{ planet: string; dignity: string }>;
  elements: Array<{ element: string; count: number }>;
  qualities: Array<{ quality: string; count: number }>;
  range_warnings?: string[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}
const lonOf = (p: Placement): number => SIGN_ORDER.indexOf(p.sign as typeof SIGN_ORDER[number]) * 30 + p.degree;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
};
const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

// ───────────────────────── ホイール図 ─────────────────────────
function drawWheel(chart: Chart, enabledAspects: Set<string>): SVGSVGElement {
  const size = 560, cx = size / 2, cy = size / 2, R = 250;
  const rZodiacIn = R - 34, rHouse = R - 70, rPlanet = R - 100;
  const rHouseNum = rZodiacIn - 10; // ハウス番号は黄道リング内縁に寄せて帯を細く
  const s = document.createElementNS(NS, "svg") as SVGSVGElement;
  s.setAttribute("viewBox", `0 0 ${size} ${size}`);
  s.setAttribute("width", "100%"); s.style.maxWidth = "560px";
  const asc = chart.ascendant;
  // 黄経 → 画面角(度, CCW, ASC=左=180°)
  const scr = (lon: number): number => 180 + (lon - asc);
  const pt = (lon: number, r: number): [number, number] => {
    const t = scr(lon) * Math.PI / 180;
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };

  // 黄道リング（12サイン、エレメント色、グリフ）
  for (let i = 0; i < 12; i++) {
    const signId = SIGN_ORDER[i];
    const a0 = i * 30, a1 = a0 + 30;
    const [x0o, y0o] = pt(a0, R), [x1o, y1o] = pt(a1, R);
    const [x0i, y0i] = pt(a0, rZodiacIn), [x1i, y1i] = pt(a1, rZodiacIn);
    const large = 0;
    const path = svg("path", { d: `M${x0o},${y0o} A${R},${R} 0 ${large} 0 ${x1o},${y1o} L${x1i},${y1i} A${rZodiacIn},${rZodiacIn} 0 ${large} 1 ${x0i},${y0i} Z`, fill: ELEMENT_COLOR[SIGN_ELEMENT[signId]], stroke: "#0002", "stroke-width": 0.5 });
    s.append(path);
    const [gx, gy] = pt(a0 + 15, (R + rZodiacIn) / 2);
    const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "#333" }); g.textContent = SIGN_GLYPH[signId];
    s.append(g);
  }
  // 30°ごとの区切り＋度目盛（内側）
  for (let a = 0; a < 360; a += 30) { const [x0, y0] = pt(a, rZodiacIn), [x1, y1] = pt(a, R); s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0003", "stroke-width": 0.5 })); }

  // ハウス円（内側）
  s.append(svg("circle", { cx, cy, r: rHouse, fill: "none", stroke: "#0003" }));
  s.append(svg("circle", { cx, cy, r: rPlanet + 14, fill: "none", stroke: "#0001" }));

  // ハウスのカスプ線（12本）＋ハウス番号。流派のハウスシステムのカスプを使う。
  const cusps = (chart.cusps ?? [])
    .filter((c) => c.system === (chart.house_system ?? "whole_sign"))
    .sort((a, b) => a.index - b.index);
  if (cusps.length === 12) {
    const rCuspIn = 34;
    for (let i = 0; i < 12; i++) {
      const lon = cusps[i].longitude;
      const [x1, y1] = pt(lon, rCuspIn), [x2, y2] = pt(lon, rZodiacIn);
      // アングル（1・4・7・10室）は少し濃く。他は薄い破線。
      const angular = i % 3 === 0;
      s.append(svg("line", { x1, y1, x2, y2, stroke: angular ? "#0004" : "#0002", "stroke-width": angular ? 0.9 : 0.6, "stroke-dasharray": angular ? "0" : "3 3" }));
      // ハウス番号: このカスプと次のカスプの中点角、黄道リング内縁の細い帯に配置。
      const span = ((cusps[(i + 1) % 12].longitude - lon) % 360 + 360) % 360;
      const [nx, ny] = pt(lon + span / 2, rHouseNum);
      const t = svg("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 9, fill: "#aaa" });
      t.textContent = String(i + 1);
      s.append(t);
    }
  }

  // ASC/MC 軸（太線＋ラベル）
  for (const [lon, label, color] of [[asc, "Asc", "#c0392b"], [chart.midheaven, "MC", "#2c3e50"]] as [number, string, string][]) {
    const [x1, y1] = pt(lon, rZodiacIn), [x2, y2] = pt(lon + 180, rZodiacIn);
    s.append(svg("line", { x1: x2, y1: y2, x2: x1, y2: y1, stroke: color, "stroke-width": 1.5 }));
    const [lx, ly] = pt(lon, rZodiacIn + 12); const t = svg("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: color, "font-weight": "bold" }); t.textContent = label; s.append(t);
  }

  // アスペクト線（中心寄り）。カテゴリ・トグルで有効な種別のみ描画。
  const lonMap = new Map(chart.placements.map((p) => [p.planet, lonOf(p)]));
  for (const asp of chart.aspects) {
    if (!enabledAspects.has(asp.type)) continue;
    const la = lonMap.get(asp.a), lb = lonMap.get(asp.b);
    if (la === undefined || lb === undefined) continue;
    const [ax, ay] = pt(la, rPlanet - 18), [bx, by] = pt(lb, rPlanet - 18);
    s.append(svg("line", { x1: ax, y1: ay, x2: bx, y2: by, stroke: ASPECT_COLOR[asp.type] ?? "#999", "stroke-width": 0.8, opacity: 0.6 }));
  }

  // 天体グリフ（内側にグリフ、度数は外側＝リング寄りでアスペクト線と重ねない）。
  // アングルは軸で描くのでグリフからは除外。位置の目盛線は視認性のため省略。
  const bodies = chart.placements.filter((p) => !["asc", "mc", "dsc", "ic"].includes(p.planet));
  for (const p of bodies) {
    const lon = lonOf(p);
    const [gx, gy] = pt(lon, rPlanet);
    const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 16, fill: "#111" });
    g.textContent = PLANET_GLYPH[p.planet] ?? "?";
    s.append(g);
    // 度数はグリフの外側（リング側）に。アスペクト線は中心寄りなので重ならない。
    const [dx, dy] = pt(lon, rPlanet + 15);
    const d = svg("text", { x: dx, y: dy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 8, fill: "#666" });
    d.textContent = `${Math.floor(p.degree)}°${p.retrograde ? "℞" : ""}`;
    s.append(d);
  }
  return s;
}

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

// ───────────────────────── チャート表示 ─────────────────────────
function chartView(chart: Chart): HTMLElement {
  const wrap = el("div", { className: "u-chart" });

  // アスペクトのカテゴリ・トグル（チャートに存在する種別のみ、既定は全オン）。
  const present = ASPECT_ORDER.filter((t) => chart.aspects.some((a) => a.type === t));
  const enabled = new Set(present);
  const host = el("div", { className: "u-wheel" });
  const redraw = () => { host.innerHTML = ""; host.append(drawWheel(chart, enabled)); };

  const toggles = el("div", { className: "u-aspect-toggles" });
  if (present.length) {
    toggles.append(el("span", { className: "u-tg-title", textContent: "アスペクト:" }));
    for (const t of present) {
      const cb = el("input", { type: "checkbox", checked: true });
      cb.addEventListener("change", () => { if (cb.checked) enabled.add(t); else enabled.delete(t); redraw(); });
      const sw = el("span", { className: "u-tg-sw" }); sw.style.background = ASPECT_COLOR[t] ?? "#999";
      toggles.append(el("label", { className: "u-tg-chip" }, [cb, sw, el("span", { textContent: `${ASPECT_INFO[t].label} ${ASPECT_INFO[t].angle}°` })]));
    }
  }

  redraw();
  wrap.append(host, toggles);
  if (chart.range_warnings?.length) {
    wrap.append(el("div", { className: "u-warn", textContent: `⚠️ 有効範囲外の天体: ${chart.range_warnings.join(", ")}` }));
  }
  // 集計
  const ecount = Object.fromEntries(chart.elements.map((e) => [e.element, e.count]));
  const qcount = Object.fromEntries(chart.qualities.map((q) => [q.quality, q.count]));
  wrap.append(el("div", { className: "u-counts", textContent:
    `エレメント 火${ecount.fire ?? 0}地${ecount.earth ?? 0}風${ecount.air ?? 0}水${ecount.water ?? 0}　クオリティ 活動${qcount.cardinal ?? 0}不動${qcount.fixed ?? 0}柔軟${qcount.mutable ?? 0}` }));
  return wrap;
}

// ───────────────────────── ルート描画 ─────────────────────────
export async function renderUranai(container: HTMLElement): Promise<void> {
  container.innerHTML = `<style>
    .u-wrap{display:flex;gap:16px;padding:16px;font-family:system-ui;color:#222}
    .u-side{width:220px;flex:none;border-right:1px solid #0001;padding-right:12px}
    .u-main{flex:1;min-width:0}
    .u-person{padding:8px;border-radius:6px;cursor:pointer}.u-person:hover{background:#0000000a}.u-person.sel{background:#4A90C222;font-weight:600}
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
    .u-aspect-toggles{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:10px 0;max-width:560px}
    .u-tg-title{font-size:12px;color:#666;margin-right:2px}
    .u-tg-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#444;cursor:pointer;user-select:none}
    .u-tg-chip input{cursor:pointer;margin:0}
    .u-tg-sw{width:14px;height:3px;border-radius:2px;display:inline-block}
    .u-warn{color:#c82;font-size:13px;margin:8px 0}.u-counts{margin-top:8px;font-size:13px;color:#444}
    .u-title{font-weight:700;font-size:18px;margin-bottom:8px}
    .u-chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
    .u-chart-head .u-title{margin-bottom:0}
    .u-btn-sm{padding:5px 10px;margin-top:0;font-size:13px;background:#0000000d;color:#333}
    .u-btn-sm:hover{background:#00000014}
  </style>`;
  const wrap = el("div", { className: "u-wrap" });
  const side = el("div", { className: "u-side" });
  const main = el("div", { className: "u-main" });
  wrap.append(side, main); container.append(wrap);

  const showForm = (personId: string, prefill?: Prefill) => {
    main.innerHTML = "";
    main.append(
      el("div", { className: "u-title", textContent: prefill?.date ? "出生データを編集" : "出生データを登録" }),
      birthForm(personId, async () => { await refreshList(personId); }, prefill),
    );
  };
  // 既存人物の出生データを取得して編集フォームを事前入力で開く。
  const openEdit = async (personId: string, label?: string | null) => {
    main.innerHTML = ""; main.append(el("div", { textContent: "読み込み中…" }));
    let prefill: Prefill = { label };
    try {
      const b = await api<{ born_at: string | null; lat: string | null; lng: string | null; place: string | null; timezone: string | null }>(`/api/v1/uranai/person/${personId}/birth`);
      const m = (b.born_at ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?([+-]\d{2}:\d{2})?/);
      prefill = {
        label, date: m?.[1], time: m?.[2],
        tz: b.timezone || m?.[3] || "+09:00",
        place: b.place ?? undefined,
        lat: b.lat != null && b.lat !== "" ? Number(b.lat) : undefined,
        lng: b.lng != null && b.lng !== "" ? Number(b.lng) : undefined,
      };
    } catch { /* 出生データ未登録なら空フォーム */ }
    showForm(personId, prefill);
  };
  const showChart = async (personId: string, label?: string | null) => {
    main.innerHTML = ""; main.append(el("div", { textContent: "読み込み中…" }));
    const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }); return; }
    const editBtn = el("button", { className: "u-btn u-btn-sm", textContent: "✎ 出生データを編集" });
    editBtn.addEventListener("click", () => void openEdit(personId, label));
    main.append(el("div", { className: "u-chart-head" }, [el("div", { className: "u-title", textContent: label ?? "" }), editBtn]), chartView(chart));
  };

  const refreshList = async (selectId?: string) => {
    side.innerHTML = "";
    side.append(el("div", { className: "u-title", textContent: "人物" }));
    const { persons } = await api<{ persons: Person[] }>(`/api/v1/uranai/person`);
    for (const p of persons) {
      const item = el("div", { className: "u-person" + (p.id === selectId ? " sel" : ""), textContent: p.label ?? "(名称未設定)" });
      item.addEventListener("click", () => { void refreshList(p.id); void showChart(p.id, p.label); });
      side.append(item);
    }
    const add = el("button", { className: "u-btn", textContent: "＋ 人物を追加" });
    add.addEventListener("click", async () => { const { id } = await api<{ id: string }>(`/api/v1/uranai/person`, { method: "POST", body: JSON.stringify({ label: "新しい人物" }) }); await refreshList(id); showForm(id, { label: "新しい人物" }); });
    side.append(add);
    if (selectId) { const sel = persons.find((p) => p.id === selectId); if (sel) void showChart(selectId, sel.label); }
    else if (persons.length === 0) main.append(el("div", { textContent: "「人物を追加」から始めてください。" }));
  };
  await refreshList();
}
