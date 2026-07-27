// ウラナイ（占い）プロダクトのカスタム画面。TS で DOM を直接構築する SPA。
// 人物の登録（複数人）→ 出生データ入力（地名検索でジオコーディング）→ compute → ホイール図表示。
// API は front worker 経由で backend /api/v1/uranai/* に proxy される。

const SIGN_ORDER = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"] as const;
const SIGN_GLYPH: Record<string, string> = { aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋", leo: "♌", virgo: "♍", libra: "♎", scorpio: "♏", sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓" };
// 文字表示モードでのサインの正式名（円に沿って表示）。
const SIGN_NAME: Record<string, string> = { aries: "牡羊座", taurus: "牡牛座", gemini: "双子座", cancer: "蟹座", leo: "獅子座", virgo: "乙女座", libra: "天秤座", scorpio: "蠍座", sagittarius: "射手座", capricorn: "山羊座", aquarius: "水瓶座", pisces: "魚座" };
// サインの元素（色相）とクオリティ（トーン=不透明度）。
const SIGN_ELEMENT: Record<string, string> = { aries: "fire", leo: "fire", sagittarius: "fire", taurus: "earth", virgo: "earth", capricorn: "earth", gemini: "air", libra: "air", aquarius: "air", cancer: "water", scorpio: "water", pisces: "water" };
const SIGN_QUALITY: Record<string, string> = { aries: "cardinal", cancer: "cardinal", libra: "cardinal", capricorn: "cardinal", taurus: "fixed", leo: "fixed", scorpio: "fixed", aquarius: "fixed", gemini: "mutable", virgo: "mutable", sagittarius: "mutable", pisces: "mutable" };
// 元素・クオリティの1文字表記（中心の元素輪・クオリティ輪に表示）。
const ELEMENT_CHAR: Record<string, string> = { fire: "火", earth: "地", air: "風", water: "水" };
const QUALITY_CHAR: Record<string, string> = { cardinal: "活", fixed: "不", mutable: "柔" };
const ELEMENT_HUE: Record<string, number> = { fire: 12, earth: 95, air: 50, water: 205 };
const ELEMENT_SAT: Record<string, number> = { fire: 75, earth: 45, air: 75, water: 55 };
const QUALITY_ALPHA: Record<string, number> = { cardinal: 0.24, fixed: 0.15, mutable: 0.08 };
// 元素=色相/彩度・クオリティ=不透明度（トーン）で薄めに塗る。
const signFill = (id: string): string => `hsla(${ELEMENT_HUE[SIGN_ELEMENT[id]]}, ${ELEMENT_SAT[SIGN_ELEMENT[id]]}%, 52%, ${QUALITY_ALPHA[SIGN_QUALITY[id]]})`;
const PLANET_GLYPH: Record<string, string> = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇", chiron: "⚷", ceres: "⚳", pallas: "⚴", juno: "⚵", vesta: "⚶", pholus: "⯛", lilith: "⚸", dragon_head: "☊", dragon_tail: "☋", fortune: "⊗", asc: "Asc", mc: "MC", dsc: "Dsc", ic: "IC" };
// データ表での天体の並び順。
const PLANET_ORDER = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "chiron", "ceres", "pallas", "juno", "vesta", "pholus", "lilith", "dragon_head", "dragon_tail", "fortune"];
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
// サイン内度数を「度°分′」に整形。
const fmtDeg = (d: number): string => {
  let deg = Math.floor(d), min = Math.round((d - deg) * 60);
  if (min >= 60) { min -= 60; deg += 1; }
  return `${deg}°${String(min).padStart(2, "0")}′`;
};
type Birth = { born_at: string | null; lat: string | null; lng: string | null; place: string | null; timezone: string | null };
const HOUSE_SYSTEM_JA: Record<string, string> = { placidus: "プラシダス", whole_sign: "ホールサイン", koch: "コッホ", equal: "イコール", campanus: "カンパヌス", regiomontanus: "レギオモンタヌス" };
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
  // 外→内: ハウス番号帯 → 天体 → 中心のサイン円。
  const rHouseIn = R - 34;                // 276: ハウス番号帯の内縁
  const rHouseBand = (R + rHouseIn) / 2;  // 293: ハウス番号の配置半径
  const rSignCircle = 96;                 // 中心の同心リング群の外縁（＝サイン輪の外縁）
  const rElemCircle = 74;                 // サイン輪 / 元素輪 の境界
  const rQualCircle = 52;                 // 元素輪 / クオリティ輪 の境界
  const rHole = 30;                       // クオリティ輪の内縁（中心の空円）
  const rSignLabel = (rSignCircle + rElemCircle) / 2; // サイン記号/文字
  const rElemLabel = (rElemCircle + rQualCircle) / 2; // 元素
  const rQualLabel = (rQualCircle + rHole) / 2;       // クオリティ
  const rPlanet = 200;                    // 天体（ハウス番号帯内縁〜サイン円 の中間帯）
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

  // 背景: ハウス番号帯(rHouseIn〜R)はグレー、天体リングは白。
  s.append(svg("circle", { cx, cy, r: R, fill: "hsl(40, 12%, 90%)", stroke: "none" }));
  s.append(svg("circle", { cx, cy, r: rHouseIn, fill: "#fff", stroke: "none" }));
  // 中心の空円(rHole)〜天体リング外縁(rHouseIn)を、各サインの色（元素=色相/クオリティ=トーン）で塗る。
  // これで中心のサイン輪も天体リングもサインの色になる（ハウス番号帯は塗らない）。
  for (let i = 0; i < 12; i++) {
    const a0 = i * 30, a1 = a0 + 30;
    const [xoo, yoo] = pt(a0, rHouseIn), [xo1, yo1] = pt(a1, rHouseIn);
    const [xio, yio] = pt(a0, rHole), [xi1, yi1] = pt(a1, rHole);
    s.append(svg("path", { d: `M${xoo},${yoo} A${rHouseIn},${rHouseIn} 0 0 0 ${xo1},${yo1} L${xi1},${yi1} A${rHole},${rHole} 0 0 1 ${xio},${yio} Z`, fill: signFill(SIGN_ORDER[i]), stroke: "none" }));
  }

  // サイン記号・ハウス番号は、線・円を描いた後（最下部）に白い下地付きで重ねて描く
  // （先に描くと後続の線が上に乗ってしまうため）。
  // サインの区切り線（各サイン境界＝絶対黄経の30°刻み）を白で、中心の空円(rHole)〜天体表示領域外縁(rHouseIn)まで。
  for (let a = 0; a < 360; a += 30) { const [x0, y0] = pt(a, rHole), [x1, y1] = pt(a, rHouseIn); s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#fff", "stroke-width": 3 })); }

  // ハウス境界（12分割線）＋ハウス番号。カスプ保存があれば流派のハウスシステム、
  // 無ければ whole-sign 等分（ASC のサイン先頭から 30°刻み）でフォールバックし必ず描く。
  const storedCusps = (chart.cusps ?? [])
    .filter((c) => c.system === (chart.house_system ?? "whole_sign"))
    .sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12
    ? storedCusps.map((c) => c.longitude)
    : Array.from({ length: 12 }, (_, i) => ((Math.floor(asc / 30) * 30) + i * 30) % 360);
  const rCuspIn = rSignCircle; // ハウス線は中心のサイン円の外から最外周まで（中心円には入れない）
  for (let i = 0; i < 12; i++) {
    const lon = cuspLons[i];
    const [x1, y1] = pt(lon, rCuspIn), [x2, y2] = pt(lon, R);
    // ハウス区切り線は黒。ASC/MC 軸とも区別しない。（番号は後で重ねる）
    s.append(svg("line", { x1, y1, x2, y2, stroke: "#222", "stroke-width": 1 }));
  }

  // ASC/MC/DSC/IC 軸。ハウス区切り線と区別せず黒で、サイン円の外〜最外周に。
  // ラベル（円の外側）とその外にサイン記号＋度分を表示。
  const placeByPlanet = new Map(chart.placements.map((p) => [p.planet, p]));
  const axes: [number, string, string][] = [
    [asc, "Asc", "asc"], [asc + 180, "Dsc", "dsc"],
    [chart.midheaven, "MC", "mc"], [chart.midheaven + 180, "IC", "ic"],
  ];
  for (const [lon, txt, key] of axes) {
    const [ax, ay] = pt(lon, rSignCircle), [bx, by] = pt(lon, R);
    s.append(svg("line", { x1: ax, y1: ay, x2: bx, y2: by, stroke: "#222", "stroke-width": 1 }));
    const th = scr(lon) * Math.PI / 180;
    const horizontal = Math.abs(Math.cos(th)) > Math.abs(Math.sin(th));
    const pl = placeByPlanet.get(key);
    const degStr = pl ? `${SIGN_GLYPH[pl.sign]}︎${fmtDeg(pl.degree)}` : "";
    if (horizontal) {
      // ASC/DSC: ラベル(上)と度数(下)を上下に分けて重なり回避。
      const [px, py] = pt(lon, R + 7);
      const t = svg("text", { x: px, y: py - 8, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#222", "font-weight": "bold" }); t.textContent = txt; s.append(t);
      if (degStr) { const d = svg("text", { x: px, y: py + 7, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 8, fill: "#555" }); d.textContent = degStr; s.append(d); }
    } else {
      const [lx, ly] = pt(lon, R + 11); const t = svg("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#222", "font-weight": "bold" }); t.textContent = txt; s.append(t);
      if (degStr) { const [dx, dy] = pt(lon, R + 23); const d = svg("text", { x: dx, y: dy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 8, fill: "#555" }); d.textContent = degStr; s.append(d); }
    }
  }

  // 円: 最外周(R)、ハウス番号帯の内縁(rHouseIn)、中心の同心リング境界(サイン/元素/クオリティ)、中心の空円(rHole)。
  s.append(svg("circle", { cx, cy, r: R, fill: "none", stroke: "#222", "stroke-width": 1 }));
  s.append(svg("circle", { cx, cy, r: rHouseIn, fill: "none", stroke: "#222", "stroke-width": 1 }));
  s.append(svg("circle", { cx, cy, r: rSignCircle, fill: "none", stroke: "#222", "stroke-width": 1 }));
  s.append(svg("circle", { cx, cy, r: rElemCircle, fill: "none", stroke: "#222", "stroke-width": 1 }));
  s.append(svg("circle", { cx, cy, r: rQualCircle, fill: "none", stroke: "#222", "stroke-width": 1 }));
  s.append(svg("circle", { cx, cy, r: rHole, fill: "none", stroke: "#222", "stroke-width": 1 }));

  // サイン記号／文字を線・円の上に重ねて描く。線が透けないよう白い下地（円）を敷く。
  // 文字表示モード(name)はサイン正式名を円に沿って（接線方向に回転）小フォントで、
  // 記号モードは占星術グリフを白い下地の上に。
  for (let i = 0; i < 12; i++) {
    const [gx, gy] = pt(i * 30 + 15, rSignLabel);
    if (name) {
      // 接線方向へ回転。下半分は上下反転して常に正立させる。白ハローで色地でも読める。
      let rot = Math.atan2(gy - cy, gx - cx) * 180 / Math.PI + 90;
      if (rot > 90 && rot < 270) rot -= 180;
      const t = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "#333", transform: `rotate(${rot.toFixed(1)} ${gx.toFixed(1)} ${gy.toFixed(1)})` });
      t.textContent = SIGN_NAME[SIGN_ORDER[i]];
      s.append(t);
    } else {
      // \u8A18\u53F7\u306F\u767D\u3044\u4E0B\u5730\u306A\u3057\u3067\u3001\u8272\u4ED8\u304D\u30B5\u30A4\u30F3\u8F2A\u306E\u4E0A\u306B\u76F4\u63A5\u63CF\u304F\u3002
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "#333" });
      g.textContent = SIGN_GLYPH[SIGN_ORDER[i]] + "\uFE0E";
      s.append(g);
    }
  }
  // 元素輪・クオリティ輪: 各サインの元素(火地風水)・クオリティ(活不柔)を、サインと同じ角で1文字表示。
  for (let i = 0; i < 12; i++) {
    const sign = SIGN_ORDER[i];
    const [ex, ey] = pt(i * 30 + 15, rElemLabel);
    const et = svg("text", { x: ex, y: ey, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#333" });
    et.textContent = ELEMENT_CHAR[SIGN_ELEMENT[sign]];
    s.append(et);
    const [qx, qy] = pt(i * 30 + 15, rQualLabel);
    const qt = svg("text", { x: qx, y: qy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "#333" });
    qt.textContent = QUALITY_CHAR[SIGN_QUALITY[sign]];
    s.append(qt);
  }
  // ハウス番号を線・円の上に重ねて描く（白いハローで下地確保）。
  for (let i = 0; i < 12; i++) {
    const lon = cuspLons[i];
    const span = ((cuspLons[(i + 1) % 12] - lon) % 360 + 360) % 360;
    const [nx, ny] = pt(lon + span / 2, rHouseBand);
    const t = svg("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 12, fill: "#555", "font-weight": "700" });
    t.textContent = String(i + 1);
    s.append(t);
  }

  // 天体の表示角を先に確定する（密集時は扇状に広げて重なり回避）。アスペクト線も
  // この表示角＝「天体と中心を結ぶ半径」上で各天体につなぐので、接点は天体ごとに1つ。
  // アングルは軸で描くのでグリフからは除外。名前モードは枠が大きいので間隔も広げる。
  const bodies = chart.placements.filter((p) => !["asc", "mc", "dsc", "ic"].includes(p.planet));
  const order = bodies.map((p) => ({ p, lon: lonOf(p) })).sort((a, b) => a.lon - b.lon);
  const disp = order.map((o) => o.lon);
  const n = disp.length;
  // 名前・記号で共通。密集時は角度分散(fan)より半径方向（中心線上）のずらしを優先させる。
  const minGap = 22;
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
  // 重なり判定用の寸法。名前モードは枠寸法、記号モードはグリフのおおよその寸法。
  const boxDim = name
    ? labelLines.map((lines) => {
        const maxLen = Math.max(...lines.map((t) => [...t].length));
        return { w: maxLen * NAME_FS + NAME_PADX * 2, h: lines.length * NAME_LH + NAME_PADY * 2 };
      })
    : order.map(() => ({ w: 22, h: 22 }));
  // 各天体の描画半径。名前・記号どちらも、扇状に広げてなお重なる天体を、中心と天体を結ぶ
  // 線（＝表示角の半径）上で中心側へずらして必ず見えるようにする（2D 重なり判定で貪欲割当）。
  const rOf = new Array<number>(n).fill(rPlanet);
  {
    const levelStep = name ? 26 : 22;
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
      // 背景は「白マスク＋サイン色」の二枚重ねで、色付きリングと同色（＝透明に見える）にしつつ
      // 下の線を隠す。枠線は残す。
      grp.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: "#fff", stroke: "none" }));
      grp.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: signFill(o.p.sign), stroke: "#222", "stroke-width": 0.8 }));
      lines.forEach((line, k) => {
        const ty = gy - h / 2 + NAME_PADY + NAME_LH * (k + 0.5);
        const tx = svg("text", { x: gx, y: ty, "text-anchor": "middle", "dominant-baseline": "central", "font-size": NAME_FS, fill: "#111" });
        tx.textContent = line;
        grp.append(tx);
      });
      s.append(grp);
    } else {
      // 線と被らないよう、記号の下にサイン色と同色の下地（白マスク＋サイン色）を敷いて線を隠す。
      // リングと同色なので背景は目立たず、記号だけが浮く。
      s.append(svg("circle", { cx: gx, cy: gy, r: 13, fill: "#fff", stroke: "none" }));
      s.append(svg("circle", { cx: gx, cy: gy, r: 13, fill: signFill(o.p.sign), stroke: "none" }));
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 26, fill: "#111" });
      g.textContent = PLANET_GLYPH[o.p.planet] ?? "?";
      s.append(g);
    }
    const degText = `${fmtDeg(o.p.degree)}${o.p.retrograde ? "℞" : ""}`;
    // 度数は名前・記号どちらも枠（記号は擬似枠 boxDim）の「上側」の角に置く。
    // 左右は天体と同じ側: 中心より左の天体は左上、右の天体は右上。
    {
      const { w, h } = boxDim[i];
      const leftCorner = gx < cx;
      const dgx = leftCorner ? gx - w / 2 : gx + w / 2;
      const dgy = gy - h / 2 - 5;
      const d = svg("text", { x: dgx, y: dgy, "text-anchor": leftCorner ? "start" : "end", "dominant-baseline": "central", "font-size": 10, fill: "#222" });
      d.textContent = degText;
      s.append(d);
    }
  });
  return s;
}

// ───────────────────────── ホイール図（本格表示・標準チャート） ─────────────────────────
// 外周: サイン帯(グリフ+度目盛) → ハウス帯(番号+カスプ度数) → 天体 → 中央: アスペクト線。
// 天体はハウス(角度)を保持し、混雑時は半径方向へずらす。内円には入れず、度数も含めて重なり判定。
function drawWheelPro(chart: Chart, enabledAspects: Set<string>, name: boolean): SVGSVGElement {
  const size = 720, cx = size / 2, cy = size / 2, R = 310; // 外周に余白(50px)を確保
  const rSignIn = R - 28;            // サイン帯の内縁
  const rHouseIn = rSignIn - 26;     // ハウス帯の内縁
  const rPlanet = rHouseIn - 30;     // 天体の既定半径
  const rAsp = 100;                  // アスペクトのハブ（内円）
  const rMin = rAsp + 22;            // 天体はこれ以上内側に入れない
  const s = document.createElementNS(NS, "svg") as SVGSVGElement;
  s.setAttribute("viewBox", `0 0 ${size} ${size}`);
  s.setAttribute("width", "100%"); s.style.maxWidth = "700px";
  const asc = chart.ascendant;
  const scr = (lon: number): number => 180 + (lon - asc);
  const pt = (lon: number, r: number): [number, number] => { const t = scr(lon) * Math.PI / 180; return [cx + r * Math.cos(t), cy - r * Math.sin(t)]; };
  const placeByPlanet = new Map(chart.placements.map((p) => [p.planet, p]));

  // サイン帯（薄い元素色 + グリフ）
  for (let i = 0; i < 12; i++) {
    const a0 = i * 30;
    const [x0o, y0o] = pt(a0, R), [x1o, y1o] = pt(a0 + 30, R);
    const [x0i, y0i] = pt(a0, rSignIn), [x1i, y1i] = pt(a0 + 30, rSignIn);
    s.append(svg("path", { d: `M${x0o},${y0o} A${R},${R} 0 0 0 ${x1o},${y1o} L${x1i},${y1i} A${rSignIn},${rSignIn} 0 0 1 ${x0i},${y0i} Z`, fill: signFill(SIGN_ORDER[i]), stroke: "none" }));
    const [gx, gy] = pt(a0 + 15, (R + rSignIn) / 2);
    if (name) {
      let rot = Math.atan2(gy - cy, gx - cx) * 180 / Math.PI + 90;
      if (rot > 90 && rot < 270) rot -= 180;
      const t = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#333", transform: `rotate(${rot.toFixed(1)} ${gx.toFixed(1)} ${gy.toFixed(1)})` });
      t.textContent = SIGN_NAME[SIGN_ORDER[i]];
      s.append(t);
    } else {
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 16, fill: "#333" });
      g.textContent = SIGN_GLYPH[SIGN_ORDER[i]] + "︎";
      s.append(g);
    }
  }
  // 度目盛（1°小 / 5°中 / 10°大）
  for (let d = 0; d < 360; d++) {
    const len = d % 10 === 0 ? 7 : d % 5 === 0 ? 4.5 : 2.5;
    const [x0, y0] = pt(d, rSignIn), [x1, y1] = pt(d, rSignIn - len);
    s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0007", "stroke-width": d % 10 === 0 ? 0.7 : 0.4 }));
  }
  for (let a = 0; a < 360; a += 30) { const [x0, y0] = pt(a, rSignIn), [x1, y1] = pt(a, R); s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0005", "stroke-width": 0.7 })); }

  // ハウス（カスプ）
  const storedCusps = (chart.cusps ?? []).filter((c) => c.system === (chart.house_system ?? "whole_sign")).sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12 ? storedCusps.map((c) => c.longitude) : Array.from({ length: 12 }, (_, i) => ((Math.floor(asc / 30) * 30) + i * 30) % 360);
  for (let i = 0; i < 12; i++) {
    const lon = cuspLons[i];
    const angular = i % 3 === 0;
    const [x1, y1] = pt(lon, rAsp), [x2, y2] = pt(lon, rSignIn);
    s.append(svg("line", { x1, y1, x2, y2, stroke: angular ? "#333" : "#0007", "stroke-width": angular ? 1.4 : 0.7 }));
    const span = ((cuspLons[(i + 1) % 12] - lon) % 360 + 360) % 360;
    const [nx, ny] = pt(lon + span / 2, (rSignIn + rHouseIn) / 2);
    const t = svg("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#555", "font-weight": "700" });
    t.textContent = String(i + 1); s.append(t);
    const [cdx, cdy] = pt(lon + 2, rHouseIn + 7);
    const ct = svg("text", { x: cdx, y: cdy, "text-anchor": "start", "dominant-baseline": "central", "font-size": 7, fill: "#999" });
    ct.textContent = fmtDeg(((lon % 30) + 30) % 30); s.append(ct);
  }

  // アスペクト線（真黄経の点をハブ半径で結ぶ）
  for (const aspt of chart.aspects) {
    if (!enabledAspects.has(aspt.type)) continue;
    const pa = placeByPlanet.get(aspt.a), pb = placeByPlanet.get(aspt.b);
    if (!pa || !pb) continue;
    const [axx, ayy] = pt(lonOf(pa), rAsp), [bxx, byy] = pt(lonOf(pb), rAsp);
    s.append(svg("line", { x1: axx, y1: ayy, x2: bxx, y2: byy, stroke: ASPECT_COLOR[aspt.type] ?? "#999", "stroke-width": 0.9, opacity: 0.75 }));
  }

  // 天体（アングル除く）。角度=ハウス保持、混雑は半径方向。度数（枠上角）も含めて重なり判定。
  const bodies = chart.placements.filter((p) => !["asc", "mc", "dsc", "ic"].includes(p.planet));
  const order = bodies.map((p) => ({ p, lon: lonOf(p) })).sort((a, b) => a.lon - b.lon);
  const n = order.length;
  const NAME_FS = 11, NAME_LH = 13.5, NAME_PADX = 3.5, NAME_PADY = 3, DEG_RESERVE = 12;
  const labelLines = order.map((o) => PLANET_NAME_LINES[o.p.planet] ?? [PLANET_GLYPH[o.p.planet] ?? "?"]);
  const boxDim = name
    ? labelLines.map((lines) => { const maxLen = Math.max(...lines.map((t) => [...t].length)); return { w: maxLen * NAME_FS + NAME_PADX * 2, h: lines.length * NAME_LH + NAME_PADY * 2 }; })
    : order.map(() => ({ w: 22, h: 22 }));
  const levelStep = 22;
  const rOf = new Array<number>(n).fill(rPlanet);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < n; i++) {
    const lon = order[i].lon, w = boxDim[i].w, h = boxDim[i].h + DEG_RESERVE;
    let x = 0, y = 0;
    for (let lane = 0; lane < 12; lane++) {
      const r = Math.max(rPlanet - lane * levelStep, rMin);
      [x, y] = pt(lon, r); rOf[i] = r;
      const hit = placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2);
      if (!hit || r <= rMin) break;
    }
    placed.push({ x, y, w, h });
  }
  order.forEach((o, i) => {
    const lon = o.lon, r = rOf[i];
    const [gx, gy] = pt(lon, r);
    // 真位置マーカー（ハウス帯内縁）＋内側にずれた場合のリーダー線。
    const [m0x, m0y] = pt(lon, rHouseIn), [m1x, m1y] = pt(lon, rHouseIn - 5);
    s.append(svg("line", { x1: m0x, y1: m0y, x2: m1x, y2: m1y, stroke: "#0008", "stroke-width": 0.8 }));
    if (r < rPlanet - 1) { const [l1x, l1y] = pt(lon, r + 11); s.append(svg("line", { x1: m1x, y1: m1y, x2: l1x, y2: l1y, stroke: "#0004", "stroke-width": 0.4 })); }
    const { w, h } = boxDim[i];
    if (name) {
      // 名前は四角で囲う（通常表示と同じ。色地と同色でリング色に馴染ませ線を隠す）。
      const grp = svg("g", {});
      grp.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: "#fff", stroke: "none" }));
      grp.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: signFill(o.p.sign), stroke: "#222", "stroke-width": 0.8 }));
      (labelLines[i]).forEach((line, k) => { const ty = gy - h / 2 + NAME_PADY + NAME_LH * (k + 0.5); const tx = svg("text", { x: gx, y: ty, "text-anchor": "middle", "dominant-baseline": "central", "font-size": NAME_FS, fill: "#111" }); tx.textContent = line; grp.append(tx); });
      s.append(grp);
    } else {
      // 記号はサイン色の下地で線を隠して直接描く。
      s.append(svg("circle", { cx: gx, cy: gy, r: 12, fill: "#fff", stroke: "none" }));
      s.append(svg("circle", { cx: gx, cy: gy, r: 12, fill: signFill(o.p.sign), stroke: "none" }));
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "#111" });
      g.textContent = (PLANET_GLYPH[o.p.planet] ?? "?") + "︎";
      s.append(g);
    }
    // 度数は通常表示と同じく枠の上角（天体と同じ左右）。
    const leftCorner = gx < cx;
    const dgx = leftCorner ? gx - w / 2 : gx + w / 2;
    const dgy = gy - h / 2 - 5;
    const d = svg("text", { x: dgx, y: dgy, "text-anchor": leftCorner ? "start" : "end", "dominant-baseline": "central", "font-size": 8, fill: "#222" });
    d.textContent = `${fmtDeg(o.p.degree)}${o.p.retrograde ? "℞" : ""}`;
    s.append(d);
  });

  // 円: 最外周 / サイン帯内縁 / ハウス帯内縁 / アスペクトハブ。
  for (const r of [R, rSignIn, rHouseIn, rAsp]) s.append(svg("circle", { cx, cy, r, fill: "none", stroke: "#333", "stroke-width": 0.8 }));

  // ASC/MC/DSC/IC 軸。水平軸は外向きアンカーで余白側へ、ラベル(上)/度数(下)に分けて円と被らない。
  const axes: [number, string, string, string][] = [
    [asc, "Asc", "asc", "#c0392b"], [asc + 180, "Dsc", "dsc", "#c0392b"],
    [chart.midheaven, "MC", "mc", "#2c3e50"], [chart.midheaven + 180, "IC", "ic", "#2c3e50"],
  ];
  for (const [lon, txt, key, col] of axes) {
    const [x1, y1] = pt(lon, rAsp), [x2, y2] = pt(lon, R);
    s.append(svg("line", { x1, y1, x2, y2, stroke: col, "stroke-width": 1.4 }));
    const th = scr(lon) * Math.PI / 180;
    const horizontal = Math.abs(Math.cos(th)) > Math.abs(Math.sin(th));
    const pl = placeByPlanet.get(key);
    const degStr = pl ? `${SIGN_GLYPH[pl.sign]}︎${fmtDeg(pl.degree)}` : "";
    if (horizontal) {
      const anchor = Math.cos(th) < 0 ? "end" : "start";
      const [px, py] = pt(lon, R + 5);
      const t = svg("text", { x: px, y: py - 8, "text-anchor": anchor, "dominant-baseline": "central", "font-size": 11, fill: col, "font-weight": "bold" }); t.textContent = txt; s.append(t);
      if (degStr) { const dd = svg("text", { x: px, y: py + 7, "text-anchor": anchor, "dominant-baseline": "central", "font-size": 8, fill: col }); dd.textContent = degStr; s.append(dd); }
    } else {
      const [lx, ly] = pt(lon, R + 12); const t = svg("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: col, "font-weight": "bold" }); t.textContent = txt; s.append(t);
      if (degStr) { const [ddx, ddy] = pt(lon, R + 24); const dd = svg("text", { x: ddx, y: ddy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 8, fill: col }); dd.textContent = degStr; s.append(dd); }
    }
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

// ───────────────────────── チャート表示（タブ: チャート/表/基本情報） ─────────────────────────
function chartView(chart: Chart, birth?: Birth | null): HTMLElement {
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
  const chartNode = el("div", {}, [
    el("div", { className: "u-glyph-toggle" }, [el("label", { className: "u-tg-chip" }, [nameCb, el("span", { textContent: "天体を名前（フルネーム）で表示" })])]),
    host,
  ]);
  drawChart();
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

  // 基本情報（出生データ）。UTCオフセットは born_at に含むので項目としては出さない。緯度・経度は別行。
  const m = (birth?.born_at ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const latStr = birth?.lat ? Number(birth.lat).toFixed(4) : "-";
  const lngStr = birth?.lng ? Number(birth.lng).toFixed(4) : "-";
  const basicNode = mkTable(["項目", "値"], [
    ["生年月日", m?.[1] ?? "-"], ["時刻", m?.[2] ?? "-"], ["出生地", birth?.place ?? "-"],
    ["緯度", latStr], ["経度", lngStr],
    ["ハウス", HOUSE_SYSTEM_JA[chart.house_system ?? ""] ?? chart.house_system ?? "-"], ["ノード/リリス", "平均"],
  ]);
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
    .u-wrap{display:flex;gap:16px;padding:16px;font-family:system-ui;color:#222}
    .u-side{width:220px;flex:none;border-right:1px solid #0001;padding-right:12px}
    .u-main{flex:1;min-width:0}
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
      .u-chart{max-width:100%}
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
    const birth = await api<Birth>(`/api/v1/uranai/person/${personId}/birth`).catch(() => null);
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }, push); return; }
    if (push) history.pushState({ uranai: { kind: "chart", personId, label: label ?? null } as UranaiView }, "");
    const editBtn = el("button", { className: "u-btn u-btn-sm", textContent: "✎ 出生データを編集" });
    editBtn.addEventListener("click", () => void openEdit(personId, label));
    main.append(el("div", { className: "u-chart-head" }, [el("div", { className: "u-title", textContent: label ?? "" }), editBtn]), chartView(chart, birth));
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
