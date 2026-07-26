// ウラナイ（占い）プロダクトのカスタム画面。TS で DOM を直接構築する SPA。
// 人物の登録（複数人）→ 出生データ入力（地名検索でジオコーディング）→ compute → ホイール図表示。
// API は front worker 経由で backend /api/v1/uranai/* に proxy される。

const SIGN_ORDER = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"] as const;
const SIGN_GLYPH: Record<string, string> = { aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋", leo: "♌", virgo: "♍", libra: "♎", scorpio: "♏", sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓" };
const SIGN_ELEMENT: Record<string, string> = { aries: "fire", leo: "fire", sagittarius: "fire", taurus: "earth", virgo: "earth", capricorn: "earth", gemini: "air", libra: "air", aquarius: "air", cancer: "water", scorpio: "water", pisces: "water" };
const ELEMENT_COLOR: Record<string, string> = { fire: "#E8663050", earth: "#7C9A4550", air: "#E0B84550", water: "#4A90C250" };
const PLANET_GLYPH: Record<string, string> = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇", chiron: "⚷", ceres: "⚳", pallas: "⚴", juno: "⚵", vesta: "⚶", pholus: "⯛", lilith: "⚸", dragon_head: "☊", dragon_tail: "☋", fortune: "⊗", asc: "Asc", mc: "MC", dsc: "Dsc", ic: "IC" };
// フルネーム表記（複数行）。長い名前は改行して枠に収める。
const PLANET_NAME_LINES: Record<string, string[]> = {
  sun: ["太陽"], moon: ["月"], mercury: ["水星"], venus: ["金星"], mars: ["火星"],
  jupiter: ["木星"], saturn: ["土星"], uranus: ["天王星"], neptune: ["海王星"], pluto: ["冥王星"],
  chiron: ["キロン"], ceres: ["ケレス"], pallas: ["パラス"], juno: ["ジュノー"], vesta: ["ベスタ"],
  pholus: ["フォルス"], lilith: ["リリス"], dragon_head: ["ヘッド"], dragon_tail: ["テイル"],
  fortune: ["POF"],
};
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
type Settings = { zodiac: string; house_system_id: string; ephemeris: string; ayanamsha: string };
// ユーザーごとの方式デフォルト（設定画面）の選択肢。[key, ラベル, 選択肢[[値,表示]]]。
const SETTING_FIELDS: Array<{ key: keyof Settings; label: string; options: Array<[string, string]> }> = [
  { key: "house_system_id", label: "ハウス", options: [["whole_sign", "ホールサイン"], ["placidus", "プラシダス"]] },
  { key: "zodiac", label: "黄道帯", options: [["tropical", "トロピカル（回帰）"], ["sidereal", "サイデリアル（恒星）"]] },
  { key: "ephemeris", label: "天体暦", options: [["vsop87", "VSOP87（高精度）"], ["standard", "簡易（Standard）"]] },
  { key: "ayanamsha", label: "アヤナムシャ", options: [["lahiri", "ラヒリ"], ["fagan_bradley", "フェイガン/ブラッドレー"]] },
];
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

// ウラナイ内部の画面状態。history.state に載せてブラウザバックで内部遷移を復元する。
type UranaiView =
  | { kind: "base" }
  | { kind: "chart"; personId: string; label: string | null }
  | { kind: "form"; personId: string; prefill: Prefill | null }
  | { kind: "settings" };
// renderUranai が再実行されても popstate リスナが多重登録されないよう、現行ハンドラを保持。
let uranaiPopHandler: ((e: PopStateEvent) => void) | null = null;

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
const selectEl = (options: Array<[string, string]>, value: string): HTMLSelectElement => {
  const sel = el("select", { className: "u-set-sel" });
  for (const [v, lbl] of options) sel.append(el("option", { value: v, textContent: lbl }));
  sel.value = value;
  return sel;
};
async function loadSettings(): Promise<Settings> {
  const d: Settings = { zodiac: "tropical", house_system_id: "whole_sign", ephemeris: "vsop87", ayanamsha: "lahiri" };
  try {
    const s = await api<Partial<Settings>>(`/api/v1/uranai/astrology/settings`);
    return { zodiac: s.zodiac ?? d.zodiac, house_system_id: s.house_system_id ?? d.house_system_id, ephemeris: s.ephemeris ?? d.ephemeris, ayanamsha: s.ayanamsha ?? d.ayanamsha };
  } catch { return d; }
}

// ───────────────────────── ホイール図 ─────────────────────────
function drawWheel(chart: Chart, enabledAspects: Set<string>, name: boolean): SVGSVGElement {
  const size = 680, cx = size / 2, cy = size / 2, R = 310;
  const rZodiacIn = R - 34, rHouse = R - 54, rPlanet = R - 80;
  const rHouseNum = (rZodiacIn + rHouse) / 2; // ハウス番号は外円(黄道内縁)と内円(rHouse)の径方向中央に
  const s = document.createElementNS(NS, "svg") as SVGSVGElement;
  s.setAttribute("viewBox", `0 0 ${size} ${size}`);
  s.setAttribute("width", "100%"); s.style.maxWidth = "680px";
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
    // U+FE0E（テキスト表示セレクタ）を付けて絵文字化（紫の四角）を防ぎ、記号として描画。
    const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "#333" }); g.textContent = SIGN_GLYPH[signId] + "\uFE0E";
    s.append(g);
  }
  // 30°ごとの区切り＋度目盛（内側）
  for (let a = 0; a < 360; a += 30) { const [x0, y0] = pt(a, rZodiacIn), [x1, y1] = pt(a, R); s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0003", "stroke-width": 0.5 })); }

  // ハウス円（内側＝番号帯の内縁）
  s.append(svg("circle", { cx, cy, r: rHouse, fill: "none", stroke: "#0003" }));

  // ハウス境界（12分割線）＋ハウス番号。カスプ保存があれば流派のハウスシステム、
  // 無ければ whole-sign 等分（ASC のサイン先頭から 30°刻み）でフォールバックし必ず描く。
  const storedCusps = (chart.cusps ?? [])
    .filter((c) => c.system === (chart.house_system ?? "whole_sign"))
    .sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12
    ? storedCusps.map((c) => c.longitude)
    : Array.from({ length: 12 }, (_, i) => ((Math.floor(asc / 30) * 30) + i * 30) % 360);
  const rCuspIn = 0; // 中心まで伸ばして 12 分割線が中心で交わるように
  for (let i = 0; i < 12; i++) {
    const lon = cuspLons[i];
    const [x1, y1] = pt(lon, rCuspIn), [x2, y2] = pt(lon, rZodiacIn);
    // アングル（1・4・7・10室）は濃く実線、他ハウスは細い実線。
    const angular = i % 3 === 0;
    s.append(svg("line", { x1, y1, x2, y2, stroke: angular ? "#0006" : "#0003", "stroke-width": angular ? 1 : 0.7 }));
    // ハウス番号: このカスプと次のカスプの中点角、番号帯の中央に配置。
    const span = ((cuspLons[(i + 1) % 12] - lon) % 360 + 360) % 360;
    const [nx, ny] = pt(lon + span / 2, rHouseNum);
    const t = svg("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "#555", "font-weight": "700" });
    t.textContent = String(i + 1);
    s.append(t);
  }

  // ASC/MC 軸（太線＋ラベル）
  for (const [lon, label, color] of [[asc, "Asc", "#c0392b"], [chart.midheaven, "MC", "#2c3e50"]] as [number, string, string][]) {
    const [x1, y1] = pt(lon, rZodiacIn), [x2, y2] = pt(lon + 180, rZodiacIn);
    s.append(svg("line", { x1: x2, y1: y2, x2: x1, y2: y1, stroke: color, "stroke-width": 1.5 }));
    const [lx, ly] = pt(lon, rZodiacIn + 12); const t = svg("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: color, "font-weight": "bold" }); t.textContent = label; s.append(t);
  }

  // 天体の表示角を先に確定する（密集時は扇状に広げて重なり回避）。アスペクト線も
  // この表示角＝「天体と中心を結ぶ半径」上で各天体につなぐので、接点は天体ごとに1つ。
  // アングルは軸で描くのでグリフからは除外。名前モードは枠が大きいので間隔も広げる。
  const bodies = chart.placements.filter((p) => !["asc", "mc", "dsc", "ic"].includes(p.planet));
  const order = bodies.map((p) => ({ p, lon: lonOf(p) })).sort((a, b) => a.lon - b.lon);
  const disp = order.map((o) => o.lon);
  const n = disp.length;
  const minGap = name ? 22 : 11; // 度。名前枠は幅があるので広め（度数は枠外に出すので枠は小さい）。文字/記号拡大に合わせ間隔も拡大。
  if (n > 1 && n * minGap < 360) {
    // 円環上で隣接ペアを対称に押し広げる緩和を反復（真位置の重心を保ちつつ分離）。
    for (let iter = 0; iter < 80; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const gap = ((disp[j] - disp[i]) % 360 + 360) % 360;
        if (gap < minGap - 1e-6) {
          const push = (minGap - gap) / 2;
          disp[i] = ((disp[i] - push) % 360 + 360) % 360;
          disp[j] = (disp[j] + push) % 360;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  // 天体→接続角。天体は表示角（扇の後の角度）、アングル(asc/mc)は真黄経を使う。
  const angleOf = new Map<string, number>();
  order.forEach((o, i) => angleOf.set(o.p.planet, disp[i]));
  const lonMap = new Map(chart.placements.map((p) => [p.planet, lonOf(p)]));

  // アスペクト線。カテゴリ・トグルで有効な種別のみ。各天体の接点は表示角×半径(rPlanet-9)＝
  // その天体と中心を結ぶ半径上の1点。これで密集天体でも接点が1つに揃う。
  const rAspect = rPlanet - 9;
  for (const asp of chart.aspects) {
    if (!enabledAspects.has(asp.type)) continue;
    const aa = angleOf.get(asp.a) ?? lonMap.get(asp.a);
    const ab = angleOf.get(asp.b) ?? lonMap.get(asp.b);
    if (aa === undefined || ab === undefined) continue;
    const [ax, ay] = pt(aa, rAspect), [bx, by] = pt(ab, rAspect);
    s.append(svg("line", { x1: ax, y1: ay, x2: bx, y2: by, stroke: ASPECT_COLOR[asp.type] ?? "#999", "stroke-width": 0.8, opacity: 0.6 }));
  }

  // 名前モードの枠寸法を先に算出。度数ぶんの高さも予約して重なり判定に使う。
  // 度数は枠の上角に小さく載せるだけで枠外へほぼはみ出さないため、重なり判定に度数ぶんの
  // 予約高さは足さない（DEG_RESERVE=0）。足すと近接天体を不要に内側へ寄せてしまう。
  const NAME_FS = 11, NAME_LH = 13.5, NAME_PADX = 3.5, NAME_PADY = 3, DEG_RESERVE = 0;
  const labelLines = order.map((o) => PLANET_NAME_LINES[o.p.planet] ?? [PLANET_GLYPH[o.p.planet] ?? "?"]);
  const boxDim = labelLines.map((lines) => {
    const maxLen = Math.max(...lines.map((t) => [...t].length));
    return { w: maxLen * NAME_FS + NAME_PADX * 2, h: lines.length * NAME_LH + NAME_PADY * 2 };
  });
  // 各天体の描画半径。名前モードは、扇状に広げてなお枠が重なる天体を、中心と天体を結ぶ
  // 線（＝表示角の半径）上で中心側へずらして必ず見えるようにする（度数枠込みの 2D 重なり
  // 判定で貪欲割当）。文字拡大に合わせ段差(levelStep)も拡大。
  const rOf = new Array<number>(n).fill(rPlanet);
  if (name) {
    const levelStep = 26;
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (let i = 0; i < n; i++) {
      const w = boxDim[i].w, h = boxDim[i].h + DEG_RESERVE;
      let x = 0, y = 0;
      for (let lane = 0; lane < 8; lane++) {
        const r = rPlanet - lane * levelStep;
        [x, y] = pt(disp[i], r);
        rOf[i] = r;
        const hit = placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2);
        if (!hit) break;
      }
      placed.push({ x, y, w, h });
    }
  }
  order.forEach((o, i) => {
    const a = disp[i];
    const r = rOf[i];
    const [gx, gy] = pt(a, r);
    if (name) {
      // フルネームを四角枠に。長い名前は改行。度数は枠外（記号モードと同様）。
      const lines = labelLines[i];
      const { w, h } = boxDim[i];
      const grp = svg("g", {});
      grp.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: "#fff", stroke: "#bbb", "stroke-width": 0.7, opacity: 0.95 }));
      lines.forEach((line, k) => {
        const ty = gy - h / 2 + NAME_PADY + NAME_LH * (k + 0.5);
        const tx = svg("text", { x: gx, y: ty, "text-anchor": "middle", "dominant-baseline": "central", "font-size": NAME_FS, fill: "#111" });
        tx.textContent = line;
        grp.append(tx);
      });
      s.append(grp);
    } else {
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 22, fill: "#111" });
      g.textContent = PLANET_GLYPH[o.p.planet] ?? "?";
      s.append(g);
    }
    const degText = `${Math.floor(o.p.degree)}°${o.p.retrograde ? "℞" : ""}`;
    if (name) {
      // 度数は枠の「上側」の角に置く（下側だと下段の枠と干渉。上なら隙間なく2段並べられる）。
      // 左右は天体と同じ側: 中心より左の天体は左上、右の天体は右上。
      const { w, h } = boxDim[i];
      const leftCorner = gx < cx;
      const dgx = leftCorner ? gx - w / 2 : gx + w / 2;
      const dgy = gy - h / 2 - 5;
      const d = svg("text", { x: dgx, y: dgy, "text-anchor": leftCorner ? "start" : "end", "dominant-baseline": "central", "font-size": 8, fill: "#666" });
      d.textContent = degText;
      s.append(d);
    } else {
      // 記号モードは従来どおり記号の外側（リング寄り）に。
      const [dx, dy] = pt(a, r + 15);
      const d = svg("text", { x: dx, y: dy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 8, fill: "#666" });
      d.textContent = degText;
      s.append(d);
    }
  });
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

// ───────────────────────── 設定画面（ユーザーごとの方式デフォルト） ─────────────────────────
function settingsView(settings: Settings, onSaved: () => void | Promise<void>): HTMLElement {
  const wrap = el("div", { className: "u-form" });
  const sels: Partial<Record<keyof Settings, HTMLSelectElement>> = {};
  const grid = el("div", { className: "u-set-grid" });
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
      // 設定は全人物のチャートに影響するため、保存済みの全チャートを再計算して反映。
      const { persons } = await api<{ persons: Person[] }>(`/api/v1/uranai/person`);
      let done = 0;
      for (const p of persons) {
        status.textContent = `再計算中… (${++done}/${persons.length})`;
        await api(`/api/v1/uranai/astrology/person/${p.id}/compute`, { method: "POST", body: "{}" }).catch(() => {});
      }
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

// ───────────────────────── チャート表示 ─────────────────────────
function chartView(chart: Chart): HTMLElement {
  const wrap = el("div", { className: "u-chart" });

  // アスペクトのオン/オフ（1ボタンで全種まとめて。既定オフ）。
  const present = ASPECT_ORDER.filter((t) => chart.aspects.some((a) => a.type === t));
  const enabled = new Set<string>(); // 空=オフ。オン時に present を全投入。
  let aspectsOn = false;
  let nameMode = false;
  const host = el("div", { className: "u-wheel" });
  const redraw = () => { host.innerHTML = ""; host.append(drawWheel(chart, enabled, nameMode)); };

  // 天体の表記切替（占星術グリフ ⇄ 日本語フルネーム）。
  const nameCb = el("input", { type: "checkbox", checked: false });
  nameCb.addEventListener("change", () => { nameMode = nameCb.checked; redraw(); });
  const glyphToggle = el("div", { className: "u-glyph-toggle" }, [
    el("label", { className: "u-tg-chip" }, [nameCb, el("span", { textContent: "天体を名前（フルネーム）で表示" })]),
  ]);

  const toggles = el("div", { className: "u-aspect-toggles" });
  if (present.length) {
    // アスペクトは1ボタンでまとめて表示切替（既定オフ）。
    const btn = el("button", { className: "u-tg-btn", type: "button", textContent: "アスペクト" });
    const sync = () => btn.classList.toggle("on", aspectsOn);
    btn.addEventListener("click", () => {
      aspectsOn = !aspectsOn;
      enabled.clear();
      if (aspectsOn) present.forEach((t) => enabled.add(t));
      sync(); redraw();
    });
    sync();
    toggles.append(btn);
  }

  redraw();
  wrap.append(host, glyphToggle, toggles);
  if (chart.range_warnings?.length) {
    wrap.append(el("div", { className: "u-warn", textContent: `⚠️ 有効範囲外の天体: ${chart.range_warnings.join(", ")}` }));
  }
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
    .u-glyph-toggle{margin:10px 0 2px;max-width:560px}
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
      .u-wrap{flex-direction:column;gap:10px;padding:10px}
      .u-side{width:auto;border-right:0;border-bottom:1px solid #0001;padding:0 0 8px 0;display:flex;gap:6px;overflow-x:auto;align-items:center;-webkit-overflow-scrolling:touch}
      .u-side>.u-title{font-size:14px;margin:0 4px 0 0;flex:none}
      .u-person{flex:none;white-space:nowrap;padding:6px 10px;border:1px solid #0001}
      .u-side>.u-btn{flex:none;margin-top:0;white-space:nowrap;padding:6px 10px}
      .u-main{width:100%}
      .u-set-grid{grid-template-columns:1fr}
      .u-set-row label{width:84px}
      .u-row label{width:64px;font-size:12px}
      .u-settings,.u-glyph-toggle,.u-aspect-toggles{max-width:100%}
      .u-chart-head{flex-wrap:wrap;gap:6px}
      .u-title{font-size:16px}
    }
  </style>`;
  const wrap = el("div", { className: "u-wrap" });
  const side = el("div", { className: "u-side" });
  const main = el("div", { className: "u-main" });
  wrap.append(side, main); container.append(wrap);

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
  const showChart = async (personId: string, label?: string | null, push = true) => {
    main.innerHTML = ""; main.append(el("div", { textContent: "読み込み中…" }));
    const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }, push); return; }
    if (push) history.pushState({ uranai: { kind: "chart", personId, label: label ?? null } as UranaiView }, "");
    const editBtn = el("button", { className: "u-btn u-btn-sm", textContent: "✎ 出生データを編集" });
    editBtn.addEventListener("click", () => void openEdit(personId, label));
    main.append(el("div", { className: "u-chart-head" }, [el("div", { className: "u-title", textContent: label ?? "" }), editBtn]), chartView(chart));
  };

  // 人物リスト（サイド）を再構築し selectId をハイライトするだけ。画面遷移はしない。
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
