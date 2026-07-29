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
  const norm = (x: number): number => ((x % 360) + 360) % 360;
  const storedCusps = (chart.cusps ?? []).filter((c) => c.system === (chart.house_system ?? "whole_sign")).sort((a, b) => a.index - b.index);
  const cuspLons = storedCusps.length === 12 ? storedCusps.map((c) => c.longitude) : Array.from({ length: 12 }, (_, i) => ((Math.floor(asc / 30) * 30) + i * 30) % 360);

  // 黄経 → 画面角。描画規約は流派の属性としてバックエンドが返す。
  //   sign_fixed: 黄経に比例して配置する（従来）。Asc は左だが MC は真上に来ない。
  //   mandala   : 各ハウスを画面上の30度に均等割り付け。結果として地平線(Asc-Dsc)と
  //               子午線(MC-IC)が直交し、個人を中心に据えたマンダラになる。サイン帯の
  //               幅は不揃いになるが、それが空間分割を正しく写した姿。
  const mandala = chart.wheel_layout === "mandala";
  const scr = mandala
    ? (lon: number): number => {
        const L = norm(lon);
        for (let i = 0; i < 12; i++) {
          const span = norm(cuspLons[(i + 1) % 12] - cuspLons[i]);
          const off = norm(L - cuspLons[i]);
          if (span > 0 && off < span) return 180 + i * 30 + (off / span) * 30;
        }
        return 180 + (L - asc);
      }
    : (lon: number): number => 180 + (lon - asc);
  const pt = (lon: number, r: number): [number, number] => { const t = scr(lon) * Math.PI / 180; return [cx + r * Math.cos(t), cy - r * Math.sin(t)]; };
  const placeByPlanet = new Map(chart.placements.map((p) => [p.planet, p]));

  // サイン帯（薄い元素色 + グリフ）
  for (let i = 0; i < 12; i++) {
    const a0 = i * 30;
    // mandala では 1サインの画面上の幅が不揃いになるので、large-arc フラグを掃引量から決める。
    // scr は黄経に対して増加するため、掃引量は必ず (終点 - 始点) の向きで取る。
    // 逆向きに取ると常に 330 度となり large-arc が立ちっぱなしになり、帯が円の外へはみ出す。
    const sweep = norm(scr(a0 + 30) - scr(a0));
    const large = sweep > 180 ? 1 : 0;
    const [x0o, y0o] = pt(a0, R), [x1o, y1o] = pt(a0 + 30, R);
    const [x0i, y0i] = pt(a0, rSignIn), [x1i, y1i] = pt(a0 + 30, rSignIn);
    // インターセプト（どのカスプにも現れず1つのハウスに丸ごと収まるサイン）は、記号を別に
    // 足すとサイン帯の記号と二重になるので、その帯自体を縁取って示す。ルディアは挟み込まれた
    // サインを正確に記すことを求めており、記録としてはこれで足りる。
    const isIcpt = (chart.interceptions ?? []).some((x) => x.sign === SIGN_ORDER[i]);
    s.append(svg("path", {
      d: `M${x0o},${y0o} A${R},${R} 0 ${large} 0 ${x1o},${y1o} L${x1i},${y1i} A${rSignIn},${rSignIn} 0 ${large} 1 ${x0i},${y0i} Z`,
      fill: signFill(SIGN_ORDER[i]),
      stroke: isIcpt ? "#7b3fa0" : "none", "stroke-width": isIcpt ? 1.6 : 0,
      "data-tip": `sign:${SIGN_ORDER[i]}`, class: "u-hit",
    }));
    // 画面上の中点。mandala では黄経の中点と画面の中点がずれるため、画面角で取る。
    const midScr = scr(a0) + sweep / 2;
    const rMid = (R + rSignIn) / 2;
    const gx = cx + rMid * Math.cos(midScr * Math.PI / 180), gy = cy - rMid * Math.sin(midScr * Math.PI / 180);
    if (name) {
      let rot = Math.atan2(gy - cy, gx - cx) * 180 / Math.PI + 90;
      if (rot > 90 && rot < 270) rot -= 180;
      const t = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: isIcpt ? "#7b3fa0" : "#333", transform: `rotate(${rot.toFixed(1)} ${gx.toFixed(1)} ${gy.toFixed(1)})` });
      t.textContent = SIGN_NAME[SIGN_ORDER[i]];
      s.append(t);
    } else {
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 16, fill: isIcpt ? "#7b3fa0" : "#333" });
      g.textContent = SIGN_GLYPH[SIGN_ORDER[i]] + "︎";
      s.append(g);
    }
  }
  // 度目盛（1°小 / 5°中 / 10°大）。
  // 曼荼羅では描かない。ルディアは目盛りリングを指示しておらず、カスプと天体の度数を数字で
  // 記す方式で、図は精密な測定器ではなく全体のバランスを掴むための象徴的な絵という位置づけ。
  // 従来表示(sign_fixed)は変えないので、目盛りが必要なら流派を切り替えれば戻る。
  if (!mandala) for (let d = 0; d < 360; d++) {
    const len = d % 10 === 0 ? 7 : d % 5 === 0 ? 4.5 : 2.5;
    const [x0, y0] = pt(d, rSignIn), [x1, y1] = pt(d, rSignIn - len);
    s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0007", "stroke-width": d % 10 === 0 ? 0.7 : 0.4 }));
  }
  for (let a = 0; a < 360; a += 30) { const [x0, y0] = pt(a, rSignIn), [x1, y1] = pt(a, R); s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#0005", "stroke-width": 0.7 })); }

  // ハウス（カスプ）
  for (let i = 0; i < 12; i++) {
    const lon = cuspLons[i];
    const angular = i % 3 === 0;
    const [x1, y1] = pt(lon, rAsp), [x2, y2] = pt(lon, rSignIn);
    s.append(svg("line", { x1, y1, x2, y2, stroke: angular ? "#333" : "#0007", "stroke-width": angular ? 1.4 : 0.7 }));
    const span = ((cuspLons[(i + 1) % 12] - lon) % 360 + 360) % 360;
    const [nx, ny] = pt(lon + span / 2, (rSignIn + rHouseIn) / 2);
    const t = svg("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: "#555", "font-weight": "700", "data-tip": `house:${i + 1}`, class: "u-hit" });
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
      const t = svg("text", { x: px, y: py - 8, "text-anchor": anchor, "dominant-baseline": "central", "font-size": 11, fill: col, "font-weight": "bold", "data-tip": `axis:${key}`, class: "u-hit" }); t.textContent = txt; s.append(t);
      if (degStr) { const dd = svg("text", { x: px, y: py + 7, "text-anchor": anchor, "dominant-baseline": "central", "font-size": 8, fill: col }); dd.textContent = degStr; s.append(dd); }
    } else {
      const [lx, ly] = pt(lon, R + 12); const t = svg("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, fill: col, "font-weight": "bold", "data-tip": `axis:${key}`, class: "u-hit" }); t.textContent = txt; s.append(t);
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
    // 天体一式を <g data-tip> にまとめてホバー/長押しの対象にする。
    const pg = svg("g", { "data-tip": `planet:${o.p.planet}`, class: "u-hit" });
    if (name) {
      pg.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: "#fff", stroke: "none" }));
      pg.append(svg("rect", { x: gx - w / 2, y: gy - h / 2, width: w, height: h, rx: 2, fill: signFill(o.p.sign), stroke: "#222", "stroke-width": 0.8 }));
      (labelLines[i]).forEach((line, k) => { const ty = gy - h / 2 + NAME_PADY + NAME_LH * (k + 0.5); const tx = svg("text", { x: gx, y: ty, "text-anchor": "middle", "dominant-baseline": "central", "font-size": NAME_FS, fill: "#111" }); tx.textContent = line; pg.append(tx); });
    } else {
      pg.append(svg("circle", { cx: gx, cy: gy, r: 12, fill: "#fff", stroke: "none" }));
      pg.append(svg("circle", { cx: gx, cy: gy, r: 12, fill: signFill(o.p.sign), stroke: "none" }));
      const g = svg("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "#111" });
      g.textContent = (PLANET_GLYPH[o.p.planet] ?? "?") + "︎";
      pg.append(g);
    }
    // 度数は枠の上角（天体と同じ左右）。
    const leftCorner = gx < cx;
    const dgx = leftCorner ? gx - w / 2 : gx + w / 2;
    const dgy = gy - h / 2 - 5;
    const d = svg("text", { x: dgx, y: dgy, "text-anchor": leftCorner ? "start" : "end", "dominant-baseline": "central", "font-size": 8, fill: "#222" });
    d.textContent = `${fmtDeg(o.p.degree)}${o.p.retrograde ? "℞" : ""}`;
    pg.append(d);
    s.append(pg);
  });

  // 円: 最外周 / サイン帯内縁 / ハウス帯内縁 / アスペクトハブ。
  for (const r of [R, rSignIn, rHouseIn, rAsp]) s.append(svg("circle", { cx, cy, r, fill: "none", stroke: "#333", "stroke-width": 0.8 }));

  return s;
}
