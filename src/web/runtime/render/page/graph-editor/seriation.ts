import { fetchGraphExport } from './api';

// グラフ解析（クライアント計算・派生／再計算可能、原始概念は足さない）。
// - 関連度 W: node×relation の共起（一モード射影）。k参加の関係は各ペアに 1/(k−1)。
// - 重要度: 関係数(relCount) と 固有ベクトル中心性(evc = W の第1固有ベクトル)。
// - 近さの並び: 連結成分ごとのフィードラー(第2固有ベクトル)による1次元整列(seriation)。
// - ドメイン: Louvain(モジュラリティ極大化)でコミュニティ自動検出＋小コミュニティ併合。
// - ノード並び: ドメイン別に「重要度で種→関連度で整列」、ドメインは重要度合計順。

type Analysis = {
  n: number;
  ids: string[];
  W: Map<number, Map<number, number>>;
  deg: Float64Array;
  maxDeg: number;
  relCount: Float64Array;
  evc: Float64Array;
};

const analysisCache = new Map<string, Promise<Analysis>>();
function getAnalysis(graphId: string): Promise<Analysis> {
  let p = analysisCache.get(graphId);
  if (!p) { p = buildAnalysis(graphId).catch(() => emptyAnalysis()); analysisCache.set(graphId, p); }
  return p;
}
const emptyAnalysis = (): Analysis => ({ n: 0, ids: [], W: new Map(), deg: new Float64Array(0), maxDeg: 0, relCount: new Float64Array(0), evc: new Float64Array(0) });

async function buildAnalysis(graphId: string): Promise<Analysis> {
  const data = await fetchGraphExport(graphId);
  const nodes = data.nodes ?? [];
  const n = nodes.length;
  if (n === 0) return emptyAnalysis();
  const idx = new Map(nodes.map((nd, i) => [nd.id, i] as const));
  const ids = nodes.map((nd) => nd.id);
  const W = new Map<number, Map<number, number>>();
  const add = (a: number, b: number, w: number) => { let m = W.get(a); if (!m) { m = new Map(); W.set(a, m); } m.set(b, (m.get(b) ?? 0) + w); };
  const relCount = new Float64Array(n);
  for (const r of data.relations ?? []) {
    const ps = [...new Set((r.participants ?? []).map((p) => idx.get(p.id)).filter((v): v is number => v != null))];
    for (const p of ps) relCount[p]++;
    const k = ps.length; if (k < 2) continue; const w = 1 / (k - 1);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { add(ps[i], ps[j], w); add(ps[j], ps[i], w); }
  }
  const deg = new Float64Array(n); let maxDeg = 0;
  for (let i = 0; i < n; i++) { let d = 0; for (const w of (W.get(i)?.values() ?? [])) d += w; deg[i] = d; if (d > maxDeg) maxDeg = d; }
  // 固有ベクトル中心性: W の第1固有ベクトル（冪乗法・全正）。
  let x = new Float64Array(n).fill(1);
  const norm = (v: Float64Array) => { let s = 0; for (const t of v) s += t * t; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; };
  for (let it = 0; it < 200; it++) { const y = new Float64Array(n); for (let i = 0; i < n; i++) for (const [j, w] of (W.get(i) ?? [])) y[i] += w * x[j]; norm(y); x = y; }
  return { n, ids, W, deg, maxDeg, relCount, evc: x };
}

// ── 連結成分 & フィードラー（近さ整列） ─────────────────────────────────────────
function components(a: Analysis): number[][] {
  const comp = new Int32Array(a.n).fill(-1); const out: number[][] = [];
  for (let s = 0; s < a.n; s++) {
    if (comp[s] !== -1) continue;
    const st = [s]; comp[s] = out.length; const mem: number[] = [];
    while (st.length) { const u = st.pop()!; mem.push(u); for (const v of (a.W.get(u)?.keys() ?? [])) if (comp[v] === -1) { comp[v] = out.length; st.push(v); } }
    out.push(mem);
  }
  return out.sort((x, y) => y.length - x.length);
}

function fiedler(members: number[], a: Analysis): number[] {
  const m = members.length; if (m < 3) return members.slice();
  const c = 2 * a.maxDeg + 1;
  const local = new Map(members.map((g, li) => [g, li] as const));
  let x = new Float64Array(m);
  for (let i = 0; i < m; i++) x[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const meanSub = (v: Float64Array) => { let s = 0; for (const t of v) s += t; const mu = s / v.length; for (let i = 0; i < v.length; i++) v[i] -= mu; };
  const norm = (v: Float64Array) => { let s = 0; for (const t of v) s += t * t; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; };
  const matvec = (v: Float64Array) => { const y = new Float64Array(m); for (let li = 0; li < m; li++) { const g = members[li]; y[li] = (c - a.deg[g]) * v[li]; for (const [j, w] of (a.W.get(g) ?? [])) { const lj = local.get(j); if (lj != null) y[li] += w * v[lj]; } } return y; };
  meanSub(x); norm(x);
  for (let it = 0; it < 600; it++) { x = matvec(x); meanSub(x); norm(x); }
  return members.map((g, li) => ({ g, f: x[li] })).sort((p, q) => p.f - q.f).map((o) => o.g);
}

const posCache = new Map<string, Promise<Map<string, number>>>();
// 関係パネル用: 近さ（成分ごとフィードラー）の1次元位置。id→index。
export function getSeriationPositions(graphId: string): Promise<Map<string, number>> {
  let p = posCache.get(graphId);
  if (!p) { p = computePositions(graphId).catch(() => new Map<string, number>()); posCache.set(graphId, p); }
  return p;
}
async function computePositions(graphId: string): Promise<Map<string, number>> {
  const a = await getAnalysis(graphId);
  const order: number[] = [];
  for (const mem of components(a)) order.push(...fiedler(mem, a));
  const pos = new Map<string, number>();
  order.forEach((g, i) => pos.set(a.ids[g], i));
  return pos;
}

// ── ドメイン検出（Louvain 局所移動＋小コミュニティ併合） ───────────────────────
const domainCache = new Map<string, Promise<number[][]>>();
function getDomains(graphId: string): Promise<number[][]> {
  let p = domainCache.get(graphId);
  if (!p) { p = computeDomains(graphId).catch(() => []); domainCache.set(graphId, p); }
  return p;
}
async function computeDomains(graphId: string): Promise<number[][]> {
  const a = await getAnalysis(graphId);
  if (a.n === 0) return [];
  const comm = louvain(a);
  // group + 小コミュニティ(<5)を最も繋がる大コミュニティへ併合
  const minSize = 5;
  const relabel = () => { const map = new Map<number, number[]>(); comm.forEach((c, i) => { if (!map.has(c)) map.set(c, []); map.get(c)!.push(i); }); return map; };
  for (let pass = 0; pass < 10; pass++) {
    const groups = relabel();
    const small = [...groups.entries()].filter(([, mem]) => mem.length < minSize);
    if (small.length === 0) break;
    let moved = false;
    for (const [c, mem] of small) {
      // このコミュニティが最も繋がる別コミュニティ
      const link = new Map<number, number>();
      for (const i of mem) for (const [j, w] of (a.W.get(i) ?? [])) { const cj = comm[j]; if (cj !== c) link.set(cj, (link.get(cj) ?? 0) + w); }
      let bestC = -1, bestW = 0;
      for (const [cc, w] of link) if (w > bestW) { bestW = w; bestC = cc; }
      if (bestC >= 0) { for (const i of mem) comm[i] = bestC; moved = true; }
    }
    if (!moved) break;
  }
  return [...relabel().values()];
}
function louvain(a: Analysis): Int32Array {
  const n = a.n, W = a.W, deg = a.deg;
  let m2 = 0; for (let i = 0; i < n; i++) m2 += deg[i]; if (m2 === 0) m2 = 1;
  const comm = new Int32Array(n); for (let i = 0; i < n; i++) comm[i] = i;
  const sigmaTot = new Float64Array(n); for (let i = 0; i < n; i++) sigmaTot[i] = deg[i];
  for (let round = 0; round < 20; round++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      const ci = comm[i], ki = deg[i];
      sigmaTot[ci] -= ki;
      const neigh = new Map<number, number>(); neigh.set(ci, 0);
      for (const [j, w] of (W.get(i) ?? [])) { const cj = comm[j]; neigh.set(cj, (neigh.get(cj) ?? 0) + w); }
      let bestC = ci, bestGain = (neigh.get(ci) ?? 0) - sigmaTot[ci] * ki / m2;
      for (const [c, kin] of neigh) { const g = kin - sigmaTot[c] * ki / m2; if (g > bestGain) { bestGain = g; bestC = c; } }
      comm[i] = bestC; sigmaTot[bestC] += ki;
      if (bestC !== ci) improved = true;
    }
    if (!improved) break;
  }
  return comm;
}

// ── ノード並び: ドメイン別に重要度シード＋関連度整列、ドメインは重要度合計順 ───────
export type OrderMode = { importance: 'count' | 'evc'; intra: 'flow' | 'fiedler' };
const orderCache = new Map<string, Promise<Map<string, number>>>();
export function getNodeOrder(graphId: string, mode: OrderMode): Promise<Map<string, number>> {
  const key = `${graphId}|${mode.importance}|${mode.intra}`;
  let p = orderCache.get(key);
  if (!p) { p = computeOrder(graphId, mode).catch(() => new Map<string, number>()); orderCache.set(key, p); }
  return p;
}
async function computeOrder(graphId: string, mode: OrderMode): Promise<Map<string, number>> {
  const a = await getAnalysis(graphId);
  if (a.n === 0) return new Map();
  const domains = await getDomains(graphId);
  const imp = mode.importance === 'evc' ? a.evc : a.relCount;
  const posMap = mode.intra === 'fiedler' ? await getSeriationPositions(graphId) : null;
  const posOf = (g: number) => posMap?.get(a.ids[g]) ?? 0;

  const intraOrder = (D: number[]): number[] => {
    if (mode.intra === 'fiedler') return D.slice().sort((x, y) => posOf(x) - posOf(y));
    // flow: 重要度最大を種に、既配置集合への関連度(ΣW)最大を貪欲に追加（Prim風）
    const inD = new Set(D); const placed = new Set<number>(); const aff = new Map<number, number>();
    let cur = D.reduce((b, g) => (imp[g] > imp[b] ? g : b), D[0]);
    const out: number[] = [];
    for (let s = 0; s < D.length; s++) {
      placed.add(cur); out.push(cur);
      for (const [j, w] of (a.W.get(cur) ?? [])) if (inD.has(j) && !placed.has(j)) aff.set(j, (aff.get(j) ?? 0) + w);
      let best = -1, bestA = -Infinity;
      for (const g of D) if (!placed.has(g)) { const av = (aff.get(g) ?? 0) + imp[g] * 1e-9; if (av > bestA) { bestA = av; best = g; } }
      if (best === -1) break; cur = best;
    }
    return out;
  };

  const scored = domains.map((D) => ({ D, s: D.reduce((t, g) => t + imp[g], 0) })).sort((x, y) => y.s - x.s);
  const order: number[] = [];
  for (const { D } of scored) order.push(...intraOrder(D));
  const rank = new Map<string, number>();
  order.forEach((g, r) => rank.set(a.ids[g], r));
  return rank;
}
