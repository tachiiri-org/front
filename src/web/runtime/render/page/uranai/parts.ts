// ウラナイ（占い）プロダクトのカスタム画面。TS で DOM を直接構築する SPA。
// 人物の登録（複数人）→ 出生データ入力（地名検索でジオコーディング）→ compute → ホイール図表示。
// API は front worker 経由で backend /api/v1/uranai/* に proxy される。

export const SIGN_ORDER = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"] as const;
export const SIGN_GLYPH: Record<string, string> = { aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋", leo: "♌", virgo: "♍", libra: "♎", scorpio: "♏", sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓" };
// 文字表示モードでのサインの正式名（円に沿って表示）。
export const SIGN_NAME: Record<string, string> = { aries: "牡羊座", taurus: "牡牛座", gemini: "双子座", cancer: "蟹座", leo: "獅子座", virgo: "乙女座", libra: "天秤座", scorpio: "蠍座", sagittarius: "射手座", capricorn: "山羊座", aquarius: "水瓶座", pisces: "魚座" };
// サインの元素（色相）とクオリティ（トーン=不透明度）。
export const SIGN_ELEMENT: Record<string, string> = { aries: "fire", leo: "fire", sagittarius: "fire", taurus: "earth", virgo: "earth", capricorn: "earth", gemini: "air", libra: "air", aquarius: "air", cancer: "water", scorpio: "water", pisces: "water" };
export const SIGN_QUALITY: Record<string, string> = { aries: "cardinal", cancer: "cardinal", libra: "cardinal", capricorn: "cardinal", taurus: "fixed", leo: "fixed", scorpio: "fixed", aquarius: "fixed", gemini: "mutable", virgo: "mutable", sagittarius: "mutable", pisces: "mutable" };
// 元素・クオリティの1文字表記（中心の元素輪・クオリティ輪に表示）。
export const ELEMENT_CHAR: Record<string, string> = { fire: "火", earth: "地", air: "風", water: "水" };
export const QUALITY_CHAR: Record<string, string> = { cardinal: "活", fixed: "不", mutable: "柔" };
export const ELEMENT_HUE: Record<string, number> = { fire: 12, earth: 95, air: 50, water: 205 };
export const ELEMENT_SAT: Record<string, number> = { fire: 75, earth: 45, air: 75, water: 55 };
export const QUALITY_ALPHA: Record<string, number> = { cardinal: 0.24, fixed: 0.15, mutable: 0.08 };
// 元素=色相/彩度・クオリティ=不透明度（トーン）で薄めに塗る。
export const signFill = (id: string): string => `hsla(${ELEMENT_HUE[SIGN_ELEMENT[id]]}, ${ELEMENT_SAT[SIGN_ELEMENT[id]]}%, 52%, ${QUALITY_ALPHA[SIGN_QUALITY[id]]})`;
export const PLANET_GLYPH: Record<string, string> = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇", chiron: "⚷", ceres: "⚳", pallas: "⚴", juno: "⚵", vesta: "⚶", pholus: "⯛", lilith: "⚸", dragon_head: "☊", dragon_tail: "☋", fortune: "⊗", asc: "Asc", mc: "MC", dsc: "Dsc", ic: "IC" };
// データ表での天体の並び順。
export const PLANET_ORDER = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "chiron", "ceres", "pallas", "juno", "vesta", "pholus", "lilith", "dragon_head", "dragon_tail", "fortune"];
// フルネーム表記（複数行）。長い名前は改行して枠に収める。
export const PLANET_NAME_LINES: Record<string, string[]> = {
  sun: ["太陽"], moon: ["月"], mercury: ["水星"], venus: ["金星"], mars: ["火星"],
  jupiter: ["木星"], saturn: ["土星"], uranus: ["天王星"], neptune: ["海王星"], pluto: ["冥王星"],
  chiron: ["キロン"], ceres: ["ケレス"], pallas: ["パラス"], juno: ["ジュノー"], vesta: ["ベスタ"],
  pholus: ["フォルス"], lilith: ["リリス"], dragon_head: ["ヘッド"], dragon_tail: ["テイル"],
  fortune: ["POF"],
};
export const ASPECT_COLOR: Record<string, string> = { conjunction: "#888", opposition: "#D33", trine: "#2A7", square: "#D33", sextile: "#2A7", semisextile: "#AAA", quincunx: "#C82" };
// アスペクトの日本語名と角度。トグル表示順（主要角→マイナー角）。
export const ASPECT_INFO: Record<string, { label: string; angle: number }> = {
  conjunction: { label: "コンジャンクション", angle: 0 },
  sextile: { label: "セクスタイル", angle: 60 },
  square: { label: "スクエア", angle: 90 },
  trine: { label: "トライン", angle: 120 },
  opposition: { label: "オポジション", angle: 180 },
  quincunx: { label: "クインカンクス", angle: 150 },
  semisextile: { label: "セミセクスタイル", angle: 30 },
};
export const ASPECT_ORDER = ["conjunction", "sextile", "square", "trine", "opposition", "quincunx", "semisextile"];
export const NS = "http://www.w3.org/2000/svg";

export type Person = { id: string; label: string | null };
export type Prefill = { label?: string | null; date?: string; time?: string; place?: string; lat?: number; lng?: number; tz?: string };
export type Settings = { zodiac: string; house_system_id: string; ephemeris: string; ayanamsha: string };
// ユーザーごとの方式デフォルト（設定画面）の選択肢。[key, ラベル, 選択肢[[値,表示]]]。
export const SETTING_FIELDS: Array<{ key: keyof Settings; label: string; options: Array<[string, string]> }> = [
  { key: "house_system_id", label: "ハウス", options: [["whole_sign", "ホールサイン"], ["placidus", "プラシダス"], ["campanus", "カンパヌス"]] },
  { key: "zodiac", label: "黄道帯", options: [["tropical", "トロピカル（回帰）"], ["sidereal", "サイデリアル（恒星）"]] },
  { key: "ephemeris", label: "天体暦", options: [["vsop87", "VSOP87（高精度）"], ["standard", "簡易（Standard）"]] },
  { key: "ayanamsha", label: "アヤナムシャ", options: [["lahiri", "ラヒリ"], ["fagan_bradley", "フェイガン/ブラッドレー"]] },
];
export type Placement = { planet: string; sign: string; degree: number; retrograde?: boolean };
export type Aspect = { a: string; b: string; type: string; orb: number };
export type Cusp = { system: string; index: number; longitude: number };
// アスペクトパターン（バックエンド detectPatterns の出力）。bodies は構成天体。
export type Pattern = { pattern: string; bodies: string[]; focus?: string; scope?: string; tight?: boolean; subsumed?: boolean };
// 図形の表示メタ（名称・別名・構成・小配置か）。現代西洋/Tierney 準拠。
export const PATTERN_INFO: Record<string, { name: string; aka?: string; comp: string; minor?: boolean }> = {
  grand_sextile:     { name: "グランドセクスタイル", aka: "六芒星", comp: "セクスタイル×6（グランドトライン×2）" },
  grand_cross:       { name: "グランドクロス", aka: "大十字", comp: "オポジション×2＋スクエア×4" },
  kite:              { name: "カイト", aka: "凧", comp: "グランドトライン＋オポジション＋セクスタイル×2" },
  mystic_rectangle:  { name: "ミスティックレクタングル", comp: "オポジション×2＋トライン×2＋セクスタイル×2" },
  grand_trine:       { name: "グランドトライン", aka: "大三角", comp: "トライン×3" },
  t_square:          { name: "Tスクエア", comp: "オポジション＋スクエア×2" },
  yod:               { name: "ヨッド", aka: "神の指", comp: "セクスタイル＋インコンジャンクト×2" },
  cradle:            { name: "クレイドル", aka: "ゆりかご", comp: "オポジション＋セクスタイル×3", minor: true },
  wedge:             { name: "ウェッジ", aka: "調停", comp: "オポジション＋トライン＋セクスタイル", minor: true },
  mini_trine:        { name: "ミニトライン", aka: "小三角", comp: "トライン＋セクスタイル×2", minor: true },
  stellium:          { name: "ステリウム", comp: "同一サイン/ハウスに3天体以上" },
};
export const PATTERN_ORDER = ["grand_sextile", "grand_cross", "kite", "mystic_rectangle", "grand_trine", "t_square", "yod", "stellium", "cradle", "wedge", "mini_trine"];
export type Chart = {
  ascendant: number; midheaven: number;
  house_system?: string; cusps?: Cusp[];
  wheel_layout?: "sign_fixed" | "mandala"; // 流派が指定する描画規約（バックエンドが返す）
  interceptions?: Array<{ house: string; sign: string }>; // どのカスプにも現れないサイン
  shape?: { shape: string; span: number; largestGap: number; handle?: string[]; leadingBody?: string;
            singleton?: { planet: string; axis: "horizon" | "meridian" } };
  placements: Placement[]; aspects: Aspect[];
  patterns?: Pattern[];
  dignities: Array<{ planet: string; dignity: string }>;
  elements: Array<{ element: string; count: number }>;
  qualities: Array<{ quality: string; count: number }>;
  range_warnings?: string[];
};

// ウラナイ内部の画面状態。history.state に載せてブラウザバックで内部遷移を復元する。
export type UranaiView =
  | { kind: "base" }
  | { kind: "chart"; personId: string; label: string | null }
  | { kind: "form"; personId: string; prefill: Prefill | null }
  | { kind: "settings" };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}
export const lonOf = (p: Placement): number => SIGN_ORDER.indexOf(p.sign as typeof SIGN_ORDER[number]) * 30 + p.degree;
// サイン内度数を「度°分′」に整形。
export const fmtDeg = (d: number): string => {
  let deg = Math.floor(d), min = Math.round((d - deg) * 60);
  if (min >= 60) { min -= 60; deg += 1; }
  return `${deg}°${String(min).padStart(2, "0")}′`;
};
export type Birth = { born_at: string | null; lat: string | null; lng: string | null; place: string | null; timezone: string | null };
// チャート全体の形（ジョーンズの惑星配置型）。名称と成立条件の事実のみ。閾値は標準的な定義。
export const SHAPE_INFO: Record<string, { name: string; cond: string }> = {
  bundle: { name: "バンドル", cond: "全天体が120度以内に集中" },
  bowl: { name: "ボウル", cond: "全天体が180度以内（半球）に収まる" },
  bucket: { name: "バケット", cond: "ボウルの反対側に取っ手となる天体がある" },
  locomotive: { name: "ロコモーティブ", cond: "120度以上の空白が1本、残り240度に連なる" },
  seesaw: { name: "シーソー", cond: "60度以上の空白が2本、2群が対向する" },
  splash: { name: "スプラッシュ", cond: "最大の空白が60度未満、全周に散在" },
  splay: { name: "スプレイ", cond: "上記のいずれにも当てはまらない不規則な塊" },
};

export const HOUSE_SYSTEM_JA: Record<string, string> = { placidus: "プラシダス", whole_sign: "ホールサイン", koch: "コッホ", equal: "イコール", campanus: "カンパヌス", regiomontanus: "レギオモンタヌス" };
// タイムゾーン: IANA一覧（Intl組込みの既定データセット。tokyo/osaka等を選べる）と、国コード→既定ゾーン、ゾーン→UTCオフセット。
export const IANA_ZONES: string[] = (() => { try { const v = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone"); return v && v.length ? v : []; } catch { return []; } })();
export const FALLBACK_ZONES = ["Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Taipei", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Bangkok", "Asia/Kolkata", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney", "UTC"];
export const CC_ZONE: Record<string, string> = { jp: "Asia/Tokyo", kr: "Asia/Seoul", cn: "Asia/Shanghai", tw: "Asia/Taipei", hk: "Asia/Hong_Kong", sg: "Asia/Singapore", th: "Asia/Bangkok", in: "Asia/Kolkata", gb: "Europe/London", fr: "Europe/Paris", de: "Europe/Berlin", it: "Europe/Rome", es: "Europe/Madrid", ru: "Europe/Moscow", us: "America/New_York", ca: "America/Toronto", br: "America/Sao_Paulo", au: "Australia/Sydney" };
export const offsetFromZone = (zone: string, date: Date): string => {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /([+-]\d{2}:\d{2})/.exec(s.replace(/GMT|UTC/g, ""));
    return m ? m[1] : "+00:00";
  } catch { return "+00:00"; }
};
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
};
export const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
export const selectEl = (options: Array<[string, string]>, value: string): HTMLSelectElement => {
  const sel = el("select", { className: "u-set-sel" });
  for (const [v, lbl] of options) sel.append(el("option", { value: v, textContent: lbl }));
  sel.value = value;
  return sel;
};
export async function loadSettings(): Promise<Settings> {
  const d: Settings = { zodiac: "tropical", house_system_id: "whole_sign", ephemeris: "vsop87", ayanamsha: "lahiri" };
  try {
    const s = await api<Partial<Settings>>(`/api/v1/uranai/astrology/settings`);
    return { zodiac: s.zodiac ?? d.zodiac, house_system_id: s.house_system_id ?? d.house_system_id, ephemeris: s.ephemeris ?? d.ephemeris, ayanamsha: s.ayanamsha ?? d.ayanamsha };
  } catch { return d; }
}
