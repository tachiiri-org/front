// 本格表示（標準チャート）のホイール描画。定数・型・ヘルパは ./parts。
import {
  SIGN_ORDER, SIGN_GLYPH, SIGN_NAME, signFill, PLANET_GLYPH, PLANET_NAME_LINES, ASPECT_COLOR, NS, Chart, lonOf, fmtDeg, svg,
} from "./parts";

// ───────────────────────── ホイール図（本格表示・標準チャート） ─────────────────────────
// 外周: サイン帯(グリフ+度目盛) → ハウス帯(番号+カスプ度数) → 天体 → 中央: アスペクト線。
// 天体はハウス(角度)を保持し、混雑時は半径方向へずらす。内円には入れず、度数も含めて重なり判定。
export function drawWheelPro(chart: Chart, enabledAspects: Set<string>, name: boolean): SVGSVGElement {
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

  return s;
}
