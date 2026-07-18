import { fetchGraphExport } from './api';

// 概念の近さ（＝共起：同じリレーションに出るほど近い）から、ノードの1次元「並び順（位置）」をクライアントで
// 計算する。node×relation 二部ハイパーグラフの一モード射影 → ラプラシアンのフィードラーベクトルで整列
// （spectral seriation）。原始概念は足さない＝グラフから毎回導出できる派生ビュー。返りは id→位置(index)。
//
// 1次元に落とすので lossy（複数領域に触れる概念/関係は境界に来る）。塊の厳密化は将来 2次元/クラスタで補う。

const cache = new Map<string, Promise<Map<string, number>>>();

// (graphId ごとに) ノード id → 位置(index) を返す。初回だけ export を取って計算し、以降はキャッシュ。
export function getSeriationPositions(graphId: string): Promise<Map<string, number>> {
  let p = cache.get(graphId);
  if (!p) { p = compute(graphId).catch(() => new Map<string, number>()); cache.set(graphId, p); }
  return p;
}

// グラフ変更後に並びを取り直したいとき用（再計算を促す）。
export function invalidateSeriation(graphId: string): void { cache.delete(graphId); }

async function compute(graphId: string): Promise<Map<string, number>> {
  const data = await fetchGraphExport(graphId);
  const nodes = data.nodes ?? [];
  const n = nodes.length;
  if (n === 0) return new Map();
  const idx = new Map<string, number>();
  nodes.forEach((nd, i) => idx.set(nd.id, i));

  // 共起 W（隣接）: k 参加のリレーションは各ペアに 1/(k-1)（大きい関係が過剰に効かないよう正規化）。
  const W = new Map<number, Map<number, number>>();
  const add = (a: number, b: number, w: number) => { let m = W.get(a); if (!m) { m = new Map(); W.set(a, m); } m.set(b, (m.get(b) ?? 0) + w); };
  for (const r of data.relations ?? []) {
    const ps = [...new Set((r.participants ?? []).map((p) => idx.get(p.id)).filter((v): v is number => v != null))];
    const k = ps.length;
    if (k < 2) continue;
    const w = 1 / (k - 1);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { add(ps[i], ps[j], w); add(ps[j], ps[i], w); }
  }
  const deg = new Float64Array(n);
  let maxDeg = 0;
  for (let i = 0; i < n; i++) { let d = 0; for (const w of (W.get(i)?.values() ?? [])) d += w; deg[i] = d; if (d > maxDeg) maxDeg = d; }

  // 連結成分ごとに整列（成分をまたぐ整列は無意味なので）。大きい成分から並べ、各成分内をフィードラーで seriate。
  const comp = new Int32Array(n).fill(-1);
  const comps: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const st = [s]; comp[s] = comps.length; const mem: number[] = [];
    while (st.length) { const u = st.pop()!; mem.push(u); for (const v of (W.get(u)?.keys() ?? [])) if (comp[v] === -1) { comp[v] = comps.length; st.push(v); } }
    comps.push(mem);
  }
  comps.sort((a, b) => b.length - a.length);

  const order: number[] = [];
  for (const mem of comps) {
    if (mem.length < 3) { order.push(...mem); continue; }
    order.push(...fiedler(mem, W, deg, maxDeg));
  }
  const pos = new Map<string, number>();
  order.forEach((g, i) => pos.set(nodes[g].id, i));
  return pos;
}

// M = cI − L の第2固有ベクトル（= L のフィードラーベクトル）を、全1ベクトルを毎回射影で外しつつ冪乗法で。
function fiedler(members: number[], W: Map<number, Map<number, number>>, deg: Float64Array, maxDeg: number): number[] {
  const m = members.length;
  const c = 2 * maxDeg + 1;
  const local = new Map(members.map((g, li) => [g, li] as const));
  let x = new Float64Array(m);
  for (let i = 0; i < m; i++) x[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1; // 決定的な擬似乱数（初期ベクトル）
  const meanSub = (v: Float64Array) => { let s = 0; for (const t of v) s += t; const mu = s / v.length; for (let i = 0; i < v.length; i++) v[i] -= mu; };
  const norm = (v: Float64Array) => { let s = 0; for (const t of v) s += t * t; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; };
  const matvec = (v: Float64Array) => {
    const y = new Float64Array(m);
    for (let li = 0; li < m; li++) {
      const g = members[li];
      y[li] = (c - deg[g]) * v[li];
      for (const [j, w] of (W.get(g) ?? [])) { const lj = local.get(j); if (lj != null) y[li] += w * v[lj]; }
    }
    return y;
  };
  meanSub(x); norm(x);
  for (let it = 0; it < 600; it++) { x = matvec(x); meanSub(x); norm(x); }
  return members.map((g, li) => ({ g, f: x[li] })).sort((a, b) => a.f - b.f).map((o) => o.g);
}
