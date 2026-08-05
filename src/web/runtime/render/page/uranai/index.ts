// ウラナイ画面のルート描画とフォーム類。定数・型・ヘルパは ./parts、ホイール描画は ./wheel に分割。
import {
  SIGN_ORDER, SIGN_GLYPH, SIGN_NAME, SIGN_ELEMENT, SIGN_QUALITY, ELEMENT_CHAR, QUALITY_CHAR, PLANET_GLYPH, PLANET_ORDER, PLANET_NAME_LINES, ASPECT_INFO, ASPECT_ORDER, PATTERN_INFO, PATTERN_ORDER, SHAPE_INFO, SHAPE_ORDER, Person, Prefill, Settings, SETTING_FIELDS, Chart, Derived, Cycles, Profection, SolarArc, FixedStars, OutOfBounds, Firdaria, Synastry, Composite, Rectification, PlanetCycle, TransitSearch, PrimaryDirection, TimeLords, Dasha, VargaCharts, Yogas, Jaimini, KpSubs, Muntha, RulingPlanets, CharaDasha, Tajika, LifeEvent, optionsOf, nameOf, ownOf, setOwn, usesPart, partsOn, allParts, setParts, isImplemented, loadMeanings, meaningOf, conventionOf, sabianReady, sabianCountOf, usesTiming, timingPrimaryOf, allTimingShapes, setTiming, rulesetIsEditable, rulesetNoteOf, roleOf, clearMeanings, UranaiView, api, lonOf, fmtDeg, Birth, HOUSE_SYSTEM_JA, IANA_ZONES, FALLBACK_ZONES, CC_ZONE, offsetFromZone, el, selectEl, loadSettings,
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
  // 出生時刻が不確かなときの終端（任意）。入れると期間として扱い、幅で不正確になる要素は弾かれる。
  const dateEnd = el("input", { type: "date", value: prefill?.dateEnd ?? "" });
  const timeEnd = el("input", { type: "time", value: prefill?.timeEnd ?? "" });
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
      const offz = tz.value.trim() || "+00:00";
      const born_at = `${date.value}T${time.value}:00${offz}`;
      // 終端が入っていれば期間。日付未入力なら開始日を流用（時刻だけの幅＝当日内）。
      const born_until = (timeEnd.value || dateEnd.value)
        ? `${dateEnd.value || date.value}T${timeEnd.value || time.value}:00${offz}` : null;
      await api(`/api/v1/uranai/person/${personId}/birth`, { method: "PUT", body: JSON.stringify({ born_at, born_until, lat: String(lat), lng: String(lng), place: placeName, timezone: tz.value.trim() }) });
      const chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" });
      // 参照データはその人物の流派で読む（表示は onDone → showChart 側でも読み直す）。
      await loadMeanings(chart.ruleset);
      status.textContent = "";
      onDone(chart);
    } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
  });

  wrap.append(
    el("div", { className: "u-row" }, [el("label", { textContent: "表示名" }), label]),
    el("div", { className: "u-row" }, [el("label", { textContent: "生年月日" }), date, time]),
    el("div", { className: "u-row" }, [el("label", { textContent: "終わり（時刻が不確かな時・任意）" }), dateEnd, timeEnd]),
    el("div", { className: "u-row" }, [el("label", { textContent: "出生地" }), geoWrap]),
    picked,
    el("div", { className: "u-row" }, [el("label", { textContent: "UTC offset" }), tz]),
    submit, status,
  );
  return wrap;
}

// ───────────────────────── 設定画面（ユーザーごとの方式デフォルト） ─────────────────────────
/**
 * 流派そのものの設定（時期の読み方・使う部品）を編む。
 * 設定画面（既定の流派）と、人物ごとの設定タブの両方から同じものを使う。
 *
 * ここで変えるのは流派の定義なので、同じ流派を使う他の人物にも反映される。
 * 人物ごとに変えたい場合は流派を複製して使う、という切り分けにしてある。
 */
function rulesetControls(getRuleset: () => string | undefined, getStatus: () => HTMLElement): {
  timingBox: HTMLElement; partsBox: HTMLElement; renderTiming: () => void; renderParts: () => void;
} {
  const timingBox = el("div", { className: "u-parts" });
  const partsBox = el("div", { className: "u-parts" });
  const renderTiming = () => {
    timingBox.innerHTML = "";
    if (!allTimingShapes().length) return;
    timingBox.append(el("div", { className: "u-set-title", textContent: "時期の読み方" }));
    const save = (shapes: string[], primary: string) =>
      api<{ shapes: string[]; primary: string }>(`/api/v1/uranai/astrology/timing`,
        { method: "PUT", body: JSON.stringify({ ruleset: getRuleset(), shapes, primary }) })
        .then((r) => { setTiming(r.shapes ?? shapes, r.primary ?? primary); renderTiming(); })
        .catch((e) => { getStatus().textContent = `エラー: ${(e as Error).message}`; renderTiming(); });
    const grid = el("div", { className: "u-parts-grid" });
    for (const id of allTimingShapes()) {
      const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = usesTiming(id);
      cb.disabled = !rulesetIsEditable();
      cb.addEventListener("change", () => {
        const next = allTimingShapes().filter((x) => x === id ? cb.checked : usesTiming(x));
        if (!next.length) { getStatus().textContent = "時期の読み方は1つ以上必要です"; renderTiming(); return; }
        void save(next, next.includes(timingPrimaryOf()) ? timingPrimaryOf() : next[0]);
      });
      const lb = el("label", { className: "u-tg-chip" }, [cb, el("span", { textContent: nameOf("timing_shape", id) })]);
      lb.title = meaningOf("timing_shape", id);
      grid.append(lb);
    }
    timingBox.append(grid);
    // 主軸を選ぶ欄は置かない。タブの並び順を決めるだけの値で、流派の側に既定がある。
    // 使う形から外れた場合はサーバ側が使っている形の先頭へ寄せる。
  };
  const renderParts = () => {
    partsBox.innerHTML = "";
    if (!allParts().length) return;
    partsBox.append(el("div", { className: "u-set-title", textContent: "使う部品" }));
    const on = new Set(partsOn());
    const grid = el("div", { className: "u-parts-grid" });
    for (const id of allParts()) {
      const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = on.has(id);
      cb.disabled = !rulesetIsEditable();
      cb.addEventListener("change", () => {
        const next = allParts().filter((x) => x === id ? cb.checked : on.has(x));
        void api<{ parts: string[] }>(`/api/v1/uranai/astrology/parts`,
          { method: "PUT", body: JSON.stringify({ ruleset: getRuleset(), parts: next }) })
          .then((r) => { setParts(r.parts ?? next); renderParts(); })
          .catch((e) => { getStatus().textContent = `エラー: ${(e as Error).message}`; cb.checked = on.has(id); });
      });
      const impl = isImplemented(id);
      // サビアンは文言が無いと度数しか出ず、部品として成立しない。文言はこちらでは
      // 用意できない（著作物）ので、未登録であることを選択画面でも分かるようにする。
      const noData = id === "sabian" && !sabianReady();
      const lb = el("label", { className: "u-tg-chip" + (impl && !noData ? "" : " u-part-todo") },
        [cb, el("span", { textContent: nameOf("part", id) + (!impl ? "（未実装）" : noData ? "（なし）" : "") })]);
      lb.title = noData ? "サビアンの文言は著作物のため同梱していない。サビアンのタブから手元の版を取り込むまで、度数しか出ない" : meaningOf("part", id);
      grid.append(lb);
    }
    partsBox.append(grid);
  };
  return { timingBox, partsBox, renderTiming, renderParts };
}

function settingsView(settings: Settings, onSaved: () => void | Promise<void>): HTMLElement {
  const wrap = el("div", { className: "u-form" });
  const sels: Partial<Record<keyof Settings, HTMLSelectElement>> = {};
  const grid = el("div", { className: "u-set-grid" });
  // 流派（ruleset）。ハウス・使用天体・アスペクト・意味・描画規約をまとめて決めるので先頭に置く。
  // 保存先は計算方式(p_user_setting)ではなく占う人の設定(p_reading_preference)。
  const rsSel = el("select", { className: "u-set-sel" });
  const NEW_RULESET = "__new__";
  let rsInitial = "default";
  let rsPrev = "default";
  // 自分で作った流派だけ消せる。組込みと出発点のカスタムには出さない。
  const delBtn = el("button", { className: "u-btn-sm u-btn-ghost", type: "button", textContent: "削除" });
  delBtn.style.display = "none";
  delBtn.addEventListener("click", () => {
    const id = rsSel.value, nm = rsSel.options[rsSel.selectedIndex]?.textContent ?? id;
    if (!confirm(`流派「${nm}」を削除しますか？\n\nこの流派で計算した結果と、この流派で書いた解釈も一緒に消えます。元に戻せません。`)) return;
    status.textContent = "削除中…";
    void api(`/api/v1/uranai/astrology/ruleset/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(async () => {
        // 消した流派を選択肢から外し、寄せ先（カスタム）の内容で描き直す。
        rsSel.innerHTML = "";
        await initRuleset();
        status.textContent = "";
        await onSaved();
      })
      .catch((e) => { status.textContent = `エラー: ${(e as Error).message}`; });
  });
  grid.append(el("div", { className: "u-set-row" }, [el("label", { textContent: "既定の流派" }), rsSel, delBtn]));
  // 流派を切り替えたら、その流派の値で画面を組み直す（ロックされた項目の表示も変わる）。
  rsSel.addEventListener("change", () => {
    // 新規作成はいま選んでいる流派を土台にする。設定値をそのまま引き継ぐのが目的。
    if (rsSel.value === NEW_RULESET) {
      const base = rsPrev;
      const name = prompt("新しい流派の名前");
      if (!name) { rsSel.value = base; return; }
      status.textContent = "作成中…";
      void api<{ ruleset: string }>(`/api/v1/uranai/astrology/ruleset-copy`,
        { method: "POST", body: JSON.stringify({ from: base, name }) })
        .then(async (r) => {
          await api(`/api/v1/uranai/astrology/preference`, { method: "PUT", body: JSON.stringify({ ruleset_id: r.ruleset }) });
          // 作った流派は選択肢に無いので、一覧から作り直す。
          rsSel.innerHTML = "";
          await initRuleset();
          status.textContent = "";
          await onSaved();
        })
        .catch((e) => { status.textContent = `エラー: ${(e as Error).message}`; rsSel.value = base; });
      return;
    }
    rsPrev = rsSel.value;
    // 選び直した流派の値を読み直して、部品・時期・ロック項目の表示を合わせる。
    void (async () => {
      try {
        const id = rsSel.value;
        await api(`/api/v1/uranai/astrology/preference`, { method: "PUT", body: JSON.stringify({ ruleset_id: id }) });
        // 全人物の再計算はしない。ここは既定を変えるだけで、人物ごとに流派を持てる。
        // 過去に読んだ人を全体設定の変更で巻き込まないため。
        await applyRuleset(id, rulesetEditableMap.get(id) !== false);
        await onSaved();
      } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
    })();
  });
  /**
   * 流派スコープの表示を、いま選ばれている流派の内容で描き直す。
   * 部品・時期の読み方・ロックされた項目・但し書き・編集の可否は全て流派ごとに違うので、
   * 流派を切り替えたら必ずここを通す。通さないと前の流派の選択が画面に残る。
   */
  const applyRuleset = async (rsId: string, editable: boolean) => {
    clearMeanings();
    await loadMeanings(rsId);
    // 流派が決める項目は、その流派での実効値を出す。
    try {
      const eff = await api<Settings>(`/api/v1/uranai/astrology/settings?ruleset=${encodeURIComponent(rsId)}`);
      for (const f of SETTING_FIELDS) {
        const v = (eff as unknown as Record<string, string>)[f.key as string];
        if (v && sels[f.key]) sels[f.key]!.value = v;
        if (v) (settings as Record<string, string>)[f.key as string] = v;
      }
    } catch { /* 取れなければ前の値のまま出す */ }
    delBtn.style.display = editable && rsId !== "default" ? "" : "none";
    renderTiming();
    renderParts();
  };

  // 参照データを読んでから流派の一覧・ロックの注記・部品・時期の欄を描く。
  // 定義順の都合で、実際の呼び出しは renderParts / renderTiming を組んだ後で行う。
  const initRuleset = async () => {
    try {
      const [ref, pref] = await Promise.all([
        api<{ rulesets?: Array<{ id: string; name: string | null; editable?: boolean; lineage?: string | null }> }>(`/api/v1/uranai/astrology/reference`),
        api<{ ruleset_id?: string }>(`/api/v1/uranai/astrology/preference`),
      ]);
      rsInitial = pref.ruleset_id ?? "default";
      // 系統の名称は参照データから引くので、選択肢を組む前に読んでおく。
      await loadMeanings(rsInitial);
      // 系統ごとにまとめる。流派は層が違うものが混ざる（ヘレニズムは系統、
      // ルディアは現代西洋の中の一潮流）ので、括らずに並べると規模を取り違える。
      const LINEAGE_ORDER = ["traditional", "modern_west", "midpoint", "indian"];
      const groups = new Map<string, HTMLElement>();
      for (const lg of LINEAGE_ORDER) {
        const og = document.createElement("optgroup");
        og.label = nameOf("lineage", lg);
        groups.set(lg, og);
      }
      const own = document.createElement("optgroup");
      own.label = "自分の流派";
      for (const r of ref.rulesets ?? []) {
        const opt = el("option", { value: r.id, textContent: r.name ?? r.id });
        const host = r.editable !== false ? own : groups.get(r.lineage ?? "") ?? own;
        host.append(opt);
      }
      for (const lg of LINEAGE_ORDER) {
        const og = groups.get(lg);
        if (og && og.children.length) rsSel.append(og);
      }
      if (own.children.length) rsSel.append(own);
      rsSel.append(el("option", { value: NEW_RULESET, textContent: "＋ 新しい流派" }));
      rsPrev = rsInitial;
      rsSel.value = rsInitial;
      // 編集の可否はいま取った一覧から決める。意味のキャッシュは設定画面を直接開いた
      // 場合まだ読まれておらず、既定値の「編集できる」が残ってしまう。
      rulesetEditableMap = new Map((ref.rulesets ?? []).map((r) => [r.id, r.editable !== false]));
      await applyRuleset(rsInitial, rulesetEditableMap.get(rsInitial) !== false);
    } catch { /* 参照が取れない時は流派を触らせない */ }
  };
  let rulesetEditableMap = new Map<string, boolean>();

  // 流派が決める項目と、自分で決める項目を分ける。
  // 前者は教義そのものなので個人の好みで上書きさせない。実効値は見せる。
  // 流派が決める項目だけを出す。天体暦は計算精度の選択で、読みの結果を変えるものでは
  // ないので画面には出さない（流派の既定のまま使う）。
  const lockedGrid = el("div", { className: "u-set-grid" });
  const ownGrid = el("div", { className: "u-set-grid" });
  for (const f of SETTING_FIELDS) {
    if (!f.byRuleset) continue;
    const sel = selectEl(f.options, settings[f.key]);
    sels[f.key] = sel;
    sel.disabled = true;
    lockedGrid.append(el("div", { className: "u-set-row u-set-locked" }, [
      el("label", {}, [el("span", { className: "u-lock-ic", textContent: "固定" }), el("span", { textContent: f.label })]), sel,
    ]));
  }
  const { timingBox, partsBox, renderTiming, renderParts } =
    rulesetControls(() => rsSel.value || undefined, () => status);

  const status = el("div", { className: "u-status" });
  // 全人物の再計算。流派を変えると保存済みのファクトが別の流派のものになるので、
  // 切り替えたら必ず走らせる。走らせないとチャートが空のまま出る。
  const recomputeAll = async (): Promise<void> => {
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
    if (failed.length) throw new Error(`再計算に失敗しました（${failed.length}/${persons.length}件）: ${failed.join(" / ")}`);
    status.textContent = skipped.length ? `${skipped.length}件を対象外にしました（出生データ未入力）: ${skipped.join(", ")}` : "";
  };

  const save = el("button", { className: "u-btn", textContent: "全チャートを再計算" });
  save.addEventListener("click", async () => {
    status.textContent = "保存中…";
    try {
      const payload: Record<string, string> = {};
      // 流派由来の項目は送らない。送るとユーザー設定として保存され、流派を切り替えても残ってしまう。
      for (const f of SETTING_FIELDS) {
        if (f.byRuleset) continue;
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
      await recomputeAll();
      clearMeanings(); // 流派が変わると意味も変わる
      await onSaved();
    } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
  });
  void initRuleset();
  wrap.append(
    el("div", { className: "u-set-title", textContent: "既定の流派" }), grid,
    lockedGrid, ownGrid, timingBox, partsBox, save, status,
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
  // 出生時刻の幅で不正確になる要素をグレーアウト（バックエンドの uncertain フラグを消費）。
  // 中央時刻で計算した値は残しつつ、幅でブレる要素（アングル・室・高速天体）を灰色にして弾く。
  {
    const bu = chart.birth_uncertain ?? chart.uncertain;
    if (bu && bu.width_minutes > 0) {
      const orderedKeys = [...PLANET_ORDER.filter((k) => place.has(k)), ...["asc", "mc", "dsc", "ic"].filter((k) => place.has(k))];
      const uset = new Set(bu.points);
      const trs = planetTbl.querySelectorAll("tr");
      orderedKeys.forEach((k, i) => {
        const tr = trs[i + 1] as HTMLElement | undefined;   // +1: ヘッダ行を飛ばす
        if (!tr) return;
        if (uset.has(k)) tr.classList.add("u-uncertain");
        // 室(house)列=index 4。ハウスが不確実なら各天体の室セルを灰色に（アングルは室空欄）。
        if (bu.houses) { const td = tr.children[4] as HTMLElement | undefined; if (td && td.textContent) td.classList.add("u-uncertain"); }
      });
      const cap = el("caption", { className: "u-uncertain-note",
        textContent: `⚠ 出生時刻に約${Math.round(bu.width_minutes)}分の幅があるため、灰色の項目は不確実です（中央時刻で計算）` });
      planetTbl.insertBefore(cap, planetTbl.firstChild);
      // カスプ（室の枠）も時刻依存。ハウスが不確実ならカスプ表全体を灰色に。
      if (bu.houses) cuspTbl.classList.add("u-uncertain");
    }
  }
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

  // ── 伝統的な技法。ルディアの体系には無い ──
  // ターム: サインを不等分した区画とその支配星（エジプト式）。
  const termTbl = mkTable(["天体", "タームの支配星", "区画"], (chart.terms ?? []).length
    ? (chart.terms ?? []).map((t) => [{ t: bodyLabel(t.planet), tip: `planet:${t.planet}` },
        bodyLabel(t.ruler), `${t.from}°〜${t.to}°`])
    : [["—", "—", "—"]]);

  // アルムーテン: 5つの品位の持ち点の合計。同点なら勝者を立てない。
  const DIG_JA: Record<string, string> = { domicile: "ドミサイル", exaltation: "高揚", triplicity: "三分", term: "ターム", face: "フェイス" };
  const almTbl = mkTable(["天体", "アルムーテン", "得点の内訳"], (chart.almutens ?? []).length
    ? (chart.almutens ?? []).map((a) => [{ t: bodyLabel(a.planet), tip: `planet:${a.planet}` },
        a.winner ? bodyLabel(a.winner) : "同点",
        a.scores.map((x) => `${bodyLabel(x.planet)} ${x.score}（${x.from.map((f) => DIG_JA[f] ?? f).join("・")}）`).join(" / ")])
    : [["—", "—", "—"]], [2]);

  // アラビックパーツ: ヘルメス由来の7つのロット。昼夜で式が入れ替わる。
  const lotTbl = mkTable(["ロット", "サイン", "度数"], (chart.arabic_parts ?? []).length
    ? (chart.arabic_parts ?? []).map((l) => [l.name, sgLbl(l.sign), fmtDeg(l.degree)])
    : [["—", "—", "—"]]);

  // サビアン: 度数と、流派ごとに入れた文言。文言は著作物なので同梱しない。
  // 手元の版から貼り込んでもらう。ジョーンズの記録とルディアの言い換えは別物なので、
  // 流派ごとに別々に持てるようにしてある。
  const sabNode = (): HTMLElement => {
    const box = el("div", {});
    const list = chart.sabian ?? [];
    const filled = list.filter((x) => x.text).length;
    if (!sabianReady()) {
      // 文言が1件も無い状態。度数だけを出しても読みには使えないので、まずそう明示する。
      box.append(el("div", { className: "u-part-disabled" }, [
        el("div", { className: "u-part-disabled-h", textContent: "この部品は現在使えません" }),
        el("div", { textContent: "サビアンシンボルの文言は Marc Edmund Jones が記録しルディアが解説した著作物のため、このアプリには同梱していません。文言が無い状態では度数が出るだけで、読みには使えません。" }),
        el("div", { textContent: "手元の版から下の欄に貼り込むと、この流派のサビアンとして保存され、表と進行の太陽に文言が出るようになります。" }),
      ]));
    } else {
      box.append(el("div", { className: "u-pat-comp", textContent:
        `この流派（${chart.ruleset ?? "default"}）に ${sabianCountOf()}/360 件の文言が登録されている。この人物の配置では ${filled}/${list.length} 件に文言がある。` }));
    }
    box.append(mkTable(["天体", "サビアン度数", "通し番号", "文言"], list.length
      ? list.map((x) => [{ t: bodyLabel(x.planet), tip: `planet:${x.planet}` },
          `${SIGN_NAME[x.sign] ?? x.sign} ${x.degree}度`, String(x.index), x.text ?? "（未登録）"])
      : [["—", "—", "—", "—"]], [3]));

    // 取り込み。「通し番号<タブまたはコロン>文言」を1行に1つ。360行まとめて貼れる。
    const det = el("details", {});
    det.append(el("summary", { textContent: "文言を取り込む" }));
    const ta = el("textarea", { className: "u-fi", rows: 6,
      placeholder: "1\t牡羊座の1度の文言\n2\t牡羊座の2度の文言\n…（通し番号1〜360。区切りはタブ・コロン・全角コロンのいずれか）" }) as HTMLTextAreaElement;
    const status = el("div", { className: "u-status" });
    const btn = el("button", { className: "u-btn u-btn-sm", textContent: "取り込む" });
    btn.addEventListener("click", async () => {
      const symbols: Array<{ index: number; text: string }> = [];
      let skipped = 0;
      for (const line of ta.value.split("\n")) {
        const m = line.match(/^\s*(\d{1,3})\s*[\t:：.。、]\s*(.+?)\s*$/);
        if (!m) { if (line.trim()) skipped++; continue; }
        const i = Number(m[1]);
        if (i < 1 || i > 360) { skipped++; continue; }
        symbols.push({ index: i, text: m[2] });
      }
      if (!symbols.length) { status.textContent = "取り込める行がありません（「番号<タブ>文言」の形にしてください）"; return; }
      status.textContent = "保存中…";
      try {
        const r = await api<{ saved: number; total: number }>(`/api/v1/uranai/astrology/sabian?ruleset=${encodeURIComponent(chart.ruleset ?? "default")}`,
          { method: "PUT", body: JSON.stringify({ symbols }) });
        status.textContent = `${r.saved}件を保存しました（この流派の合計 ${r.total}/360）。${skipped ? `${skipped}行は形式が合わず読み飛ばしました。` : ""}表示に反映するには再読み込みしてください。`;
      } catch (e) { status.textContent = `エラー: ${(e as Error).message}`; }
    });
    det.append(ta, el("div", { className: "u-row" }, [btn]), status);
    box.append(det);
    return box;
  };

  // 年運のプロフェクション。出生からの満年齢だけで決まる。
  const profNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const p = await api<Profection>(`/api/v1/uranai/astrology/person/${personId}/profection?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `出生から満 ${p.age} 年。アセンダントのサインを1室として1年に1室ずつ進める。` }));
        out.append(mkTable(["区分", "室", "サイン", "主星"], [
          ["年運", `${p.house}室`, sgLbl(p.sign), bodyLabel(p.lord)],
          ["月運", `${p.month_house}室`, sgLbl(p.month_sign), bodyLabel(p.month_lord)],
        ]));
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

  // ソーラーアーク方向法。進行の太陽の移動量を全天体に一律で加える。
  const arcNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<SolarArc>(`/api/v1/uranai/astrology/person/${personId}/solar_arc?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `アーク ${d.arc.toFixed(4)}°（進行の太陽が出生の太陽から進んだ角度）を全天体に加える。` }));
        out.append(el("div", { className: "u-tbl-title", textContent: "方向後の位置" }));
        out.append(mkTable(["天体", "サイン", "度数"], d.positions.map((p) =>
          [bodyLabel(p.planet), sgLbl(p.sign), fmtDeg(p.degree)])));
        out.append(el("div", { className: "u-tbl-title", textContent: `出生図との接触（オーブ1度以内・${d.contacts.length}）` }));
        out.append(d.contacts.length
          ? mkTable(["方向", "出生", "種別", "オーブ"], d.contacts.map((c) =>
              [bodyLabel(c.directed), bodyLabel(c.natal), ASPECT_INFO[c.type]?.label ?? c.type, `${c.orb.toFixed(2)}°`]))
          : el("div", { className: "u-pat-empty", textContent: "該当する接触はありません" }));
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

  // ミッドポイント: 天体が乗っているものだけ。全組合せを出しても読めない。
  const mpTbl = mkTable(["組", "中点", "乗っている天体"], (chart.midpoints ?? []).length
    ? (chart.midpoints ?? []).map((m) => [`${bodyLabel(m.a)} / ${bodyLabel(m.b)}`,
        `${sgLbl(m.sign)} ${fmtDeg(m.degree)}`,
        m.occupants.map((o) => `${bodyLabel(o.planet)}（${o.orb.toFixed(2)}°）`).join("、")])
    : [["—", "—", "天体が乗っている中点はありません"]], [2]);

  // ── 重い技法 ──
  // 恒星との合。ルディアの体系には無い。
  const starNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<FixedStars>(`/api/v1/uranai/astrology/person/${personId}/fixed_stars`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: "恒星は合だけを見る。オーブは等級で変えている（1.5等以下1.5°／2.5等以下1.0°／それ以外0.5°）。固有運動は入れていない。" }));
        out.append(el("div", { className: "u-tbl-title", textContent: `天体との合（${d.conjunctions.length}）` }));
        out.append(d.conjunctions.length
          ? mkTable(["天体", "恒星", "等級", "オーブ"], d.conjunctions.map((c) =>
              [bodyLabel(c.planet), c.star_name, c.magnitude.toFixed(2), `${c.orb.toFixed(2)}°`]))
          : el("div", { className: "u-pat-empty", textContent: "合はありません" }));
        out.append(el("div", { className: "u-tbl-title", textContent: `恒星の位置（${d.stars.length}）` }));
        out.append(mkTable(["恒星", "サイン", "度数", "黄緯", "等級"], d.stars.map((x) =>
          [x.name, sgLbl(x.sign), fmtDeg(x.degree), `${x.latitude.toFixed(2)}°`, x.magnitude.toFixed(2)])));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // アウトオブバウンズ: 赤緯が黄道傾斜角を超えた天体。
  const oobNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<OutOfBounds>(`/api/v1/uranai/astrology/person/${personId}/out_of_bounds`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `出生時の黄道傾斜角は ${d.obliquity.toFixed(3)}°。これを超えた赤緯を持つ天体が「境界の外」。太陽とノードは定義上あり得ない。` }));
        out.append(mkTable(["天体", "赤緯", "判定", "超過"], d.bodies.map((b) =>
          [bodyLabel(b.planet), `${b.declination.toFixed(3)}°`, b.out ? "境界の外" : "", b.out ? `${b.excess.toFixed(3)}°` : ""])));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // ファルダール: 天体が順に主星となる期間法。75年で一巡する。
  const firNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Firdaria>(`/api/v1/uranai/astrology/person/${personId}/firdaria?date=${dateIn.value}&years=95`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `${d.day ? "昼" : "夜"}生まれなので ${d.day ? "太陽" : "月"} から始まる。七曜で70年、ノードで5年、合わせて75年で一巡する。` }));
        if (d.current.lord) {
          out.append(el("div", { className: "u-tbl-title", textContent: "指定日に効いている期間" }));
          out.append(mkTable(["主星", "副主星", "期間"], [[bodyLabel(d.current.lord),
            d.current.sub_lord ? bodyLabel(d.current.sub_lord) : "—", `${d.current.from} 〜 ${d.current.to}`]]));
        }
        out.append(el("div", { className: "u-tbl-title", textContent: "全期間" }));
        out.append(mkTable(["主星", "期間", "副主星"], d.periods.map((p) => [bodyLabel(p.lord),
          `${p.from} 〜 ${p.to}`,
          p.sub.length ? p.sub.map((x) => `${bodyLabel(x.lord)} ${x.from}`).join(" / ") : "—"]), [2]));
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

  // シナストリー／コンポジット: 相手を選んで2人を並べる。
  const pairNode = (kind: "synastry" | "composite"): HTMLElement => {
    const box = el("div", {});
    const sel = el("select", { className: "u-fi" }) as HTMLSelectElement;
    const out = el("div", {});
    const load = async () => {
      if (!sel.value) { out.innerHTML = ""; out.append(el("div", { className: "u-pat-empty", textContent: "相手を選んでください" })); return; }
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        if (kind === "synastry") {
          const d = await api<Synastry>(`/api/v1/uranai/astrology/person/${personId}/synastry?with=${encodeURIComponent(sel.value)}`);
          out.innerHTML = "";
          out.append(el("div", { className: "u-tbl-title", textContent: `2人の間のアスペクト（${d.aspects.length}）` }));
          out.append(d.aspects.length
            ? mkTable(["この人", "相手", "種別", "オーブ"], d.aspects.map((a) =>
                [bodyLabel(a.a), bodyLabel(a.b), ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`]))
            : el("div", { className: "u-pat-empty", textContent: "該当するアスペクトはありません" }));
        } else {
          const d = await api<Composite>(`/api/v1/uranai/astrology/person/${personId}/composite?with=${encodeURIComponent(sel.value)}`);
          out.innerHTML = "";
          out.append(el("div", { className: "u-pat-comp", textContent: "中点合成図。両方のチャートに在る点だけを、近い側の弧の中点で合成する。この作り方ではアセンダントと MC が直交しないことがある。" }));
          out.append(el("div", { className: "u-tbl-title", textContent: "合成後の位置" }));
          out.append(mkTable(["天体", "サイン", "度数"], d.placements.map((p) =>
            [bodyLabel(p.planet), sgLbl(p.sign), fmtDeg(p.degree)])));
          out.append(el("div", { className: "u-tbl-title", textContent: `合成図の中のアスペクト（${d.aspects.length}）` }));
          out.append(d.aspects.length
            ? mkTable(["天体", "天体", "種別", "オーブ"], d.aspects.map((a) =>
                [bodyLabel(a.a), bodyLabel(a.b), ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`]))
            : el("div", { className: "u-pat-empty", textContent: "該当するアスペクトはありません" }));
        }
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    sel.addEventListener("change", () => void load());
    void (async () => {
      const { persons } = await api<{ persons: Person[] }>(`/api/v1/uranai/person`);
      sel.append(el("option", { value: "", textContent: "相手を選択" }));
      for (const p of persons) if (p.id !== personId) sel.append(el("option", { value: p.id, textContent: p.label ?? "(名称未設定)" }));
    })();
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "相手" }), sel]), out);
    return box;
  };

  // 出生時刻の修正: 時刻を動かして変わるのはアングルとハウスだけなので、
  // 手がかりは出来事に対するアングルへの接触に限られる。候補を並べるだけ。
  const rectNode = (): HTMLElement => {
    const box = el("div", {});
    const ev = el("textarea", { className: "u-fi", rows: 3, placeholder: "出来事の日付を1行に1つ（YYYY-MM-DD）" }) as HTMLTextAreaElement;
    const spanIn = el("input", { type: "number", className: "u-fi u-fi-num", value: "60", min: "1", max: "720" }) as HTMLInputElement;
    const stepIn = el("input", { type: "number", className: "u-fi u-fi-num", value: "4", min: "1", max: "60" }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      const dates = ev.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      if (!dates.length) { out.innerHTML = ""; out.append(el("div", { className: "u-pat-empty", textContent: "出来事の日付を入れてください" })); return; }
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Rectification>(`/api/v1/uranai/astrology/person/${personId}/rectification?span=${spanIn.value}&step=${stepIn.value}&events=${encodeURIComponent(dates.join(","))}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `記録された出生時刻 ${d.recorded.slice(0, 16).replace("T", " ")} UTC の前後 ${d.span_minutes} 分を ${d.step_minutes} 分刻みで見る。時刻で動くのはアングルとハウスだけなので、手がかりはアングルへの接触に限られる。どの候補を採るかは人が決める。` }));
        out.append(mkTable(["ずれ", "Asc", "MC", "接触の合計", "内訳"], d.candidates.slice(0, 30).map((c) => [
          `${c.offset_minutes > 0 ? "+" : ""}${c.offset_minutes}分`,
          `${SIGN_NAME[c.asc_sign] ?? c.asc_sign} ${fmtDeg(c.ascendant % 30)}`,
          `${SIGN_NAME[c.mc_sign] ?? c.mc_sign} ${fmtDeg(c.midheaven % 30)}`,
          `${c.score.toFixed(2)}°`,
          c.hits.map((h) => `${h.date}: ${bodyLabel(h.directed)}→${h.angle.toUpperCase()} ${h.orb.toFixed(2)}°`).join(" / "),
        ]), [4]));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    const btn = el("button", { className: "u-btn u-btn-sm", textContent: "算出" });
    btn.addEventListener("click", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "前後(分)" }), spanIn,
      el("label", { textContent: "刻み(分)" }), stepIn, btn]), ev, out);
    return box;
  };

  // 天体の周期。ルディアが年齢の節目として用いる範囲。
  const cycNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<PlanetCycle>(`/api/v1/uranai/astrology/person/${personId}/planet_cycle?until_age=90`);
        out.innerHTML = "";
        // いまどの区間に居るか。周期の局面を主軸に読む流派はここが本体で、
        // 境目の一覧はその裏付けにすぎない。だから現在地を先に出す。
        const cur = d.current;
        if (cur) {
          out.append(el("div", { className: "u-tbl-title", textContent: `現在地（${cur.at} 時点）` }));
          const posRow = (name: string, p: PlanetCycle["current"] extends null ? never : NonNullable<PlanetCycle["current"]>["saturn_stage"]) => p
            ? [name, p.total ? `${p.index} / ${p.total}` : `第${p.index}期`,
               `${p.from ?? "—"} 〜 ${p.to ?? "以降"}`,
               `${p.elapsed_years.toFixed(1)}年経過` + (p.remaining_years !== null ? ` ／ 残り${p.remaining_years.toFixed(1)}年` : ""),
               p.elapsed_ratio !== null ? `${Math.round(p.elapsed_ratio * 100)}%` : "—"]
            : [name, "—", "—", "—", "—"];
          out.append(mkTable(["周期", "区間", "期間", "経過", "進み"], [
            posRow("土星の段階", cur.saturn_stage),
            posRow("天王星の7年期間", cur.uranus_septenary),
            posRow("土星の象限", cur.saturn_quadrant),
            posRow("木星の周期", cur.jupiter_period),
          ], [2]));
        }
        const tbl = (title: string, note: string, ms: PlanetCycle["saturn_stages"]) => {
          out.append(el("div", { className: "u-tbl-title", textContent: title }));
          if (note) out.append(el("div", { className: "u-pat-comp", textContent: note }));
          out.append(ms.length
            ? mkTable(["年齢", "日付", "内容"], ms.map((m) => [`${m.age.toFixed(1)}歳`, m.at, m.label]), [2])
            : el("div", { className: "u-pat-empty", textContent: "該当なし" }));
        };
        tbl("土星の3段階", "土星の周期（約29.5年）は自己形成の3段階を区切る。第1周期は生物的なレベル、第2周期で個の自我が確立され、第3周期は霊的なレベルに向かう。", d.saturn_stages);
        tbl("土星による象限の移り変わり", "運行の土星がチャートの4象限を渡るたび（平均で約7.4年ごと）、主観的な姿勢と社会との関係が組み直されるとされる。", d.saturn_quadrants);
        tbl("天王星の12等分（7年期間）", "天王星の84年周期を12等分した7年ごとの区切り。黄経では出生の天王星から30度ずつにあたる。これがルディアの言う7年周期で、土星の4分の1ではない。", d.uranus_septenaries);
        tbl("木星回帰", "社会的・経済的な浮き沈みの周期（約11.9年）。", d.jupiter_returns);
        out.append(el("div", { className: "u-tbl-title", textContent: "回帰を持たない天体" }));
        out.append(mkTable(["天体", "周期", "扱い"], d.no_return.map((x) =>
          [bodyLabel(x.planet), `約${x.period_years}年`, x.reason]), [2]));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // 期間の探索。経過が「この日はどうか」なのに対し、こちらは「いつか」を探す。
  const searchNode = (): HTMLElement => {
    const box = el("div", {});
    const y = new Date().getFullYear();
    const fromIn = el("input", { type: "date", value: `${y}-01-01` }) as HTMLInputElement;
    const toIn = el("input", { type: "date", value: `${y + 2}-12-31` }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "探索中…" }));
      try {
        const d = await api<TransitSearch>(`/api/v1/uranai/astrology/person/${personId}/transit_search?from=${fromIn.value}&to=${toIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `${d.from} 〜 ${d.to} のうち、運行の木星・土星・天王星・海王星・冥王星が出生の太陽・月・アセンダント・MC に合／衝／スクエアで正確に当たる日。逆行で同じ角度を3回通ることがある。` }));
        // 実務で使うのは「いつからいつまで」の方なので、窓を先に出して正確日はその中に畳む。
        out.append(el("div", { className: "u-tbl-title", textContent: `オーブに入っている期間（${d.windows.length}）` }));
        out.append(d.windows.length
          ? mkTable(["期間", "運行", "出生", "種別", "正確になる日"], d.windows.map((w) =>
              [`${w.enter} 〜 ${w.leave}${w.clipped ? "（端は4年先まで追っても抜けず）" : ""}`,
               bodyLabel(w.transit), bodyLabel(w.natal),
               ASPECT_INFO[w.type]?.label ?? w.type, w.exact.join(" / ")]), [4])
          : el("div", { className: "u-pat-empty", textContent: "この期間に該当はありません" }));
        if (d.hits.length) {
          out.append(el("div", { className: "u-tbl-title", textContent: `正確になる日だけの一覧（${d.hits.length}）` }));
          out.append(mkTable(["日付", "運行", "出生", "種別"], d.hits.map((h) =>
            [h.at, bodyLabel(h.transit), bodyLabel(h.natal), ASPECT_INFO[h.type]?.label ?? h.type])));
        }
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    const btn = el("button", { className: "u-btn u-btn-sm", textContent: "探索" });
    btn.addEventListener("click", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "開始" }), fromIn,
      el("label", { textContent: "終了" }), toIn, btn]), out);
    void load();
    return box;
  };

  // 一次進行。ルディアの技法ではない（彼は他流派のものとして紹介するにとどまる）。
  const pdNode = (): HTMLElement => {
    const box = el("div", {});
    const sel = el("select", { className: "u-fi" }) as HTMLSelectElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<PrimaryDirection>(`/api/v1/uranai/astrology/person/${personId}/primary_direction?key=${sel.value || "naibod"}&until_age=90`);
        if (!sel.options.length) {
          for (const k of d.keys) sel.append(el("option", { value: k.id, textContent: k.label }));
          sel.value = d.key;
        }
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `天球の日周回転を年に換算する方向法。弧を年に換算する鍵は流儀が分かれ、ここでは${d.key_label}を使っている（赤経1度あたり ${d.years_per_degree.toFixed(6)} 年）。鍵を変えると年齢が数年ずれる。ルディアの体系には無く、彼は他流派の技法として紹介するにとどまっている。` }));
        out.append(el("div", { className: "u-pat-comp", textContent: "MC・IC への弧は赤経の差、アセンダント・ディセンダントへの弧は斜升の差で測る。順方向のみで、逆方向（コンバース）は扱わない。" }));
        out.append(d.directions.length
          ? mkTable(["年齢", "天体", "到達するアングル", "弧"], d.directions.map((x) =>
              [`${x.age.toFixed(1)}歳`, bodyLabel(x.planet), x.angle.toUpperCase(), `${x.arc.toFixed(2)}°`]))
          : el("div", { className: "u-pat-empty", textContent: "該当する方向はありません" }));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    sel.addEventListener("change", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "鍵" }), sel]), out);
    void load();
    return box;
  };

  // 時期支配星。伝統派はこの形を主軸に読む。主星の一覧そのものより、
  // その主星が出生図でどういう状態かが本体なので、条件を横に並べる。
  const lordNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const SECT_JA: Record<string, string> = { in_sect: "セクト内", out_of_sect: "セクト外" };
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<TimeLords>(`/api/v1/uranai/astrology/person/${personId}/time_lords?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `${d.at} 時点で担当している主星。${d.day ? "昼" : "夜"}生まれ。期間は入れ子になっていて、上ほど長い。` }));
        out.append(mkTable(["階層", "主星", "期間", "出生図での状態"], d.stack.map((x) => [
          x.label,
          x.lord ? { t: bodyLabel(x.lord), tip: `planet:${x.lord}` } : "—",
          x.from ? `${x.from} 〜 ${x.to}` : "—",
          x.condition
            ? [`${SIGN_NAME[x.condition.sign] ?? x.condition.sign} ${fmtDeg(x.condition.degree)}`,
               x.condition.house ? `${x.condition.house.replace("house_", "")}室` : "",
               x.condition.retrograde ? "℞" : "",
               x.condition.dignity ? meaningOf("dignity", x.condition.dignity) ? nameOf("dignity", x.condition.dignity) : x.condition.dignity : "",
               x.condition.sect ? SECT_JA[x.condition.sect] ?? "" : ""].filter(Boolean).join(" ／ ")
            : "—",
        ]), [3]));
        // 主星が出生図で結んでいるアスペクト。主星の状態を測る材料。
        for (const x of d.stack) {
          if (!x.lord || !x.condition?.aspects.length) continue;
          out.append(el("div", { className: "u-tbl-title", textContent: `${bodyLabel(x.lord)} が出生図で結ぶアスペクト（${x.condition.aspects.length}）` }));
          out.append(mkTable(["相手", "種別", "オーブ", "位相"], x.condition.aspects.map((a) =>
            [bodyLabel(a.with), ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`,
             a.phase === "waxing" ? "上弦" : "下弦"])));
        }
        // 伝統派はトランジットを主星に来るものだけに絞って見る。
        out.append(el("div", { className: "u-tbl-title", textContent: `主星に来ている運行（前後${Math.round(d.span_days / 2)}日・${d.transits_on_lords.length}）` }));
        out.append(d.transits_on_lords.length
          ? mkTable(["期間", "運行", "主星", "種別", "正確になる日"], d.transits_on_lords.map((w) =>
              [`${w.enter} 〜 ${w.leave}`, bodyLabel(w.transit), bodyLabel(w.natal),
               ASPECT_INFO[w.type]?.label ?? w.type, w.exact.join(" / ")]), [4])
          : el("div", { className: "u-pat-empty", textContent: "この期間に主星へ来ている運行はありません" }));
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

  // ナクシャトラ（黄道の27分割）。インド占星術の基本単位。
  const nakTbl = mkTable(["天体", "ナクシャトラ", "支配星", "パダ", "区画内の度数"], (chart.nakshatra ?? []).length
    ? (chart.nakshatra ?? []).map((n) => [{ t: bodyLabel(n.planet), tip: `planet:${n.planet}` },
        `${n.index}. ${n.name}`, bodyLabel(n.lord), `第${n.pada}`, `${n.degree_in_nakshatra.toFixed(2)}°`])
    : [["—", "—", "—", "—", "—"]], [1]);

  // ヴィムショッタリ・ダシャー。時期支配星の形そのもので、120年を一巡する。
  const dashaNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Dasha>(`/api/v1/uranai/astrology/person/${personId}/dasha?date=${dateIn.value}&levels=2`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `出生時の月は ${d.moon_nakshatra.index}. ${d.moon_nakshatra.name}（第${d.moon_nakshatra.pada}パダ・支配星 ${bodyLabel(d.moon_nakshatra.lord)}）。ここから ${bodyLabel(d.start_lord)} 期の残り ${d.balance_years} 年で始まる。全体で120年を一巡する。` }));
        out.append(el("div", { className: "u-tbl-title", textContent: "指定日に効いている期間" }));
        out.append(d.current.length
          ? mkTable(["階層", "主星", "期間"], d.current.map((c) =>
              [c.level === 1 ? "マハーダシャー" : c.level === 2 ? "アンタルダシャー" : "プラティアンタルダシャー",
               bodyLabel(c.lord), `${c.from} 〜 ${c.to}`]))
          : el("div", { className: "u-pat-empty", textContent: "該当する期間がありません" }));
        out.append(el("div", { className: "u-tbl-title", textContent: "マハーダシャーの全期間" }));
        out.append(mkTable(["主星", "期間", "アンタルダシャー"], d.periods.map((p) => [bodyLabel(p.lord),
          `${p.from} 〜 ${p.to}`,
          p.sub.length ? p.sub.map((x) => `${bodyLabel(x.lord)} ${x.from}`).join(" / ") : "—"]), [2]));
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

  // 分割図（ヴァルガ）。サインをN等分して別のサインへ写した副次的な図。
  const vargaNode = (): HTMLElement => {
    const box = el("div", {});
    const sel = el("select", { className: "u-fi" }) as HTMLSelectElement;
    const out = el("div", {});
    const SIGN_BY_INDEX = sgIdx;
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<VargaCharts>(`/api/v1/uranai/astrology/person/${personId}/varga${sel.value ? `?varga=${sel.value}` : ""}`);
        if (!sel.options.length) {
          for (const v of d.all_vargas) sel.append(el("option", { value: v.id, textContent: `${v.id} ${v.name}` }));
          sel.value = "D9"; // ナヴァームシャは出生図に次いで重く見るので既定にする
        }
        out.innerHTML = "";
        const c = d.charts[0];
        const info = d.all_vargas.find((v) => v.id === c.varga);
        out.append(el("div", { className: "u-pat-comp", textContent: `${info?.id} ${info?.name}（サインを${info?.divisions}等分）— ${info?.meaning}。アヤナムシャは ${d.ayanamsha}。ラグナは ${c.lagna === null ? "—" : SIGN_BY_INDEX(c.lagna)}。` }));
        out.append(mkTable(["天体", "サイン", "室"], c.placements.map((p) =>
          [bodyLabel(p.planet), SIGN_BY_INDEX(p.sign), p.house === null ? "—" : `${p.house}室`])));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    sel.addEventListener("change", () => void load());
    box.append(el("div", { className: "u-row" }, [el("label", { textContent: "分割図" }), sel]), out);
    void load();
    return box;
  };

  // ヨーガ。成立したものを先に出し、条件も併記する（何を判定したのかが分からないと使えない）。
  const yogaNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Yogas>(`/api/v1/uranai/astrology/person/${personId}/yoga`);
        out.innerHTML = "";
        const formed = d.yogas.filter((y) => y.formed), not = d.yogas.filter((y) => !y.formed);
        out.append(el("div", { className: "u-pat-comp", textContent: `古典に載るヨーガは数百あり、成立条件も文献で異なる。ここで判定しているのは条件が一義に定まる ${d.yogas.length} 種のみで、網羅ではない。` }));
        out.append(el("div", { className: "u-tbl-title", textContent: `成立しているもの（${formed.length}）` }));
        out.append(formed.length
          ? mkTable(["ヨーガ", "根拠", "成立条件"], formed.map((y) => [y.name, y.detail, y.condition]), [1, 2])
          : el("div", { className: "u-pat-empty", textContent: "成立しているヨーガはありません" }));
        out.append(el("div", { className: "u-tbl-title", textContent: `成立していないもの（${not.length}）` }));
        out.append(mkTable(["ヨーガ", "理由", "成立条件"], not.map((y) => [y.name, y.detail, y.condition]), [1, 2]));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  const sgIdx = (i: number) => SIGN_NAME[SIGN_ORDER[i]] ?? String(i);

  // ジャイミニ式。天体は度数の高さで役割が決まり、アスペクトはサイン同士で結ぶ。
  const jaiminiNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Jaimini>(`/api/v1/uranai/astrology/person/${personId}/jaimini`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-tbl-title", textContent: "チャラ・カーラカ（サイン内の度数の高い順）" }));
        out.append(mkTable(["役割", "天体", "サイン内の度数"], d.karakas.map((k) =>
          [k.role_name, bodyLabel(k.planet), `${k.degree_in_sign.toFixed(2)}°`]), [0]));
        out.append(el("div", { className: "u-tbl-title", textContent: "アルダ・ラグナ" }));
        out.append(mkTable(["項目", "値"], [
          ["ラグナ", sgIdx(d.arudha.lagna)],
          ["ラグナの支配星", `${bodyLabel(d.arudha.lord)}${d.arudha.lord_sign === null ? "" : `（${sgIdx(d.arudha.lord_sign)}）`}`],
          ["アルダ・ラグナ", d.arudha.arudha === null ? "—" : sgIdx(d.arudha.arudha) + (d.arudha.adjusted ? "（ラグナか第7室に重なるため第10室へ移した）" : "")],
        ], [1]));
        out.append(el("div", { className: "u-tbl-title", textContent: "ラーシ・ドリシュティ（サイン同士のアスペクト）" }));
        out.append(mkTable(["サイン", "見るサイン"], d.drishti.map((x) =>
          [sgIdx(x.sign), x.aspects.map(sgIdx).join("、")]), [1]));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // KP式のサブロード。ナクシャトラをヴィムショッタリの年数の比で9分割した区画。
  const kpNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<KpSubs>(`/api/v1/uranai/astrology/person/${personId}/kp?levels=3`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: "ナクシャトラをヴィムショッタリの年数の比で9分割した区画がサブ。さらに同じ比で割ったものがサブのサブ。" }));
        out.append(el("div", { className: "u-tbl-title", textContent: "天体" }));
        out.append(mkTable(["天体", "ナクシャトラ", "星座主", "サブ", "サブのサブ"], d.bodies.map((b) => [
          bodyLabel(b.planet), `${b.nakshatra.index}. ${b.nakshatra.name}`, bodyLabel(b.nakshatra.lord),
          b.subs[0] ? bodyLabel(b.subs[0].lord) : "—", b.subs[1] ? bodyLabel(b.subs[1].lord) : "—",
        ])));
        out.append(el("div", { className: "u-tbl-title", textContent: "カスプ（KP はここを読みの起点にする）" }));
        out.append(mkTable(["室", "ナクシャトラ", "星座主", "サブ", "サブのサブ"], (d.cusps ?? []).map((c) => [
          `${c.house.replace("house_", "")}室`, `${c.nakshatra.index}. ${c.nakshatra.name}`,
          bodyLabel(c.nakshatra.lord),
          c.subs[0] ? bodyLabel(c.subs[0].lord) : "—", c.subs[1] ? bodyLabel(c.subs[1].lord) : "—",
        ])));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // ムンタ。出生のラグナから1年に1サインずつ進める年運の指示。
  const munthaNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Muntha>(`/api/v1/uranai/astrology/person/${personId}/muntha?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(mkTable(["項目", "値"], [
          ["出生のラグナ", sgIdx(d.lagna)],
          ["満年齢", `${d.age}歳`],
          ["ムンタのサイン", sgIdx(d.sign)],
          ["ムンタの支配星", bodyLabel(d.lord)],
        ], [1]));
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

  // ルーリング・プラネット。判断の瞬間に効いている天体。
  const rpNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<RulingPlanets>(`/api/v1/uranai/astrology/person/${personId}/ruling_planets`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: "曜日はインドの慣習では日の出で切り替わるが、ここでは暦日で数えている。日の出前の出生では1つ手前の曜日になる。" }));
        out.append(mkTable(["起点", "サインの支配星", "星宿の支配星", "サブの支配星"], [
          ["アセンダント", bodyLabel(d.ascendant.sign_lord), bodyLabel(d.ascendant.star_lord), bodyLabel(d.ascendant.sub_lord)],
          ["月", bodyLabel(d.moon.sign_lord), bodyLabel(d.moon.star_lord), bodyLabel(d.moon.sub_lord)],
        ]));
        out.append(mkTable(["項目", "値"], [
          ["曜日の支配星", bodyLabel(d.day_lord)],
          ["ルーリング・プラネット", d.planets.map(bodyLabel).join("、")],
        ], [1]));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // チャラ・ダシャー。サインを単位とする期間法。
  const charaNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<CharaDasha>(`/api/v1/uranai/astrology/person/${personId}/chara_dasha?until_age=100`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-pat-comp", textContent: `ラグナは ${sgIdx(d.lagna)}。${d.direction === "direct" ? "奇数足のサインなので順行" : "偶数足のサインなので逆行"}に進む。各サインの年数は、そのサインから支配星の在るサインまでを足の向きに数えた数。` }));
        out.append(mkTable(["サイン", "支配星", "年数", "期間"], d.periods.map((p) =>
          [sgIdx(p.sign), bodyLabel(p.lord), `${p.years}年`, `${p.from} 〜 ${p.to}`])));
      } catch (e) {
        out.innerHTML = "";
        out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` }));
      }
    };
    box.append(out); void load();
    return box;
  };

  // タージカのアスペクトとムッダ・ダシャー。
  const tajikaNode = (): HTMLElement => {
    const box = el("div", {});
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    const out = el("div", {});
    const load = async () => {
      out.innerHTML = "";
      out.append(el("div", { className: "u-pat-empty", textContent: "算出中…" }));
      try {
        const d = await api<Tajika>(`/api/v1/uranai/astrology/person/${personId}/tajika?date=${dateIn.value}`);
        out.innerHTML = "";
        out.append(el("div", { className: "u-tbl-title", textContent: `出生図のタージカのアスペクト（${d.aspects.length}）` }));
        out.append(d.aspects.length
          ? mkTable(["速い方", "遅い方", "種別", "オーブ", "形"], d.aspects.map((a) =>
              [bodyLabel(a.a), bodyLabel(a.b), ASPECT_INFO[a.type]?.label ?? a.type, `${a.orb.toFixed(2)}°`,
               a.kind === "ithasala" ? "イッタサーラ（近づく）" : "イサラファ（離れる）"]))
          : el("div", { className: "u-pat-empty", textContent: "該当するアスペクトはありません" }));
        out.append(el("div", { className: "u-tbl-title", textContent: `ムッダ・ダシャー（年の図 ${d.solar_return ? d.solar_return.slice(0, 10) : "—"} から1年）` }));
        out.append(d.mudda.length
          ? mkTable(["主星", "期間"], d.mudda.map((m) => [bodyLabel(m.lord), `${m.from} 〜 ${m.to}`]))
          : el("div", { className: "u-pat-empty", textContent: "年の図が求まりません" }));
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

  // 人生の出来事。流派の時期の技法と突き合わせるための事実の記録。
  // 解釈ではないので流派を跨いで同じものを見る。
  const KIND_JA: Record<string, string> = { external: "外的な出来事", internal: "内的な変化",
    quiet_external: "外的に静かだった期間", quiet_internal: "内的に静かだった期間" };
  const eventsNode = (): HTMLElement => {
    const box = el("div", {});
    const out = el("div", {});
    const status = el("div", { className: "u-status" });
    const form = el("div", { className: "u-set-grid" });
    const atIn = el("input", { type: "date" }) as HTMLInputElement;
    const untilIn = el("input", { type: "date" }) as HTMLInputElement;
    const kindSel = selectEl([["external", "外的な出来事"], ["internal", "内的な変化"],
      ["quiet_external", "外的に静かだった期間"], ["quiet_internal", "内的に静かだった期間"]], "external");
    // 大きさは1〜10。粗くすると、大きな節目に小さな出来事が当たっただけで当たりになる。
    const weightSel = selectEl([["", "（未設定）"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])], "");
    const bodyIn = el("input", { type: "text", className: "u-fi", placeholder: "内容（一行）" }) as HTMLInputElement;
    const anchorIn = el("input", { type: "text", className: "u-fi", placeholder: "日付の根拠（内的な変化のとき）" }) as HTMLInputElement;
    const circCb = el("input", { type: "checkbox" }) as HTMLInputElement;
    const addBtn = el("button", { className: "u-btn u-btn-sm", type: "button", textContent: "追加" });
    form.append(
      el("div", { className: "u-set-row" }, [el("label", { textContent: "日付" }), atIn]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "終わり（幅があるとき）" }), untilIn]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "種別" }), kindSel]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "大きさ" }), weightSel]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "内容" }), bodyIn]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "根拠" }), anchorIn]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "占いで決めた" }), el("label", { className: "u-tg-chip" }, [circCb, el("span", { textContent: "集計から外す" })])]),
      el("div", { className: "u-set-row" }, [el("label", { textContent: "" }), addBtn]),
    );
    const load = async () => {
      out.innerHTML = "";
      try {
        const d = await api<{ events: LifeEvent[] }>(`/api/v1/uranai/person/${personId}/event`);
        const rowsOf = d.events.map((e) => [
          e.until ? `${e.at} 〜 ${e.until}` : e.at,
          KIND_JA[e.kind] ?? e.kind,
          e.weight === null ? "—" : String(e.weight),
          (e.body ?? "") + (e.circular ? "（占いで決めた）" : ""),
          e.anchor ?? "",
        ]);
        out.append(el("div", { className: "u-tbl-title", textContent: `記録した出来事（${d.events.length}）` }));
        out.append(d.events.length
          ? mkTable(["日付", "種別", "大きさ", "内容", "根拠"], rowsOf, [3, 4])
          : el("div", { className: "u-pat-empty", textContent: "まだ記録がありません" }));
        // 消せるように、日付と内容のボタンを並べる。
        if (d.events.length) {
          const del = el("div", { className: "u-row" });
          for (const e of d.events) {
            const btn = el("button", { className: "u-btn-sm u-btn-ghost", type: "button", textContent: `🗑 ${e.at}` });
            btn.addEventListener("click", () => {
              if (!confirm(`${e.at}「${e.body ?? ""}」を削除しますか？`)) return;
              void api(`/api/v1/uranai/person/${personId}/event/${e.id}`, { method: "DELETE" })
                .then(() => load()).catch((x) => { status.textContent = `エラー: ${(x as Error).message}`; });
            });
            del.append(btn);
          }
          out.append(el("div", { className: "u-tbl-title", textContent: "削除" }), del);
        }
      } catch (e) { out.append(el("div", { className: "u-status", textContent: `エラー: ${(e as Error).message}` })); }
    };
    addBtn.addEventListener("click", () => {
      if (!atIn.value) { status.textContent = "日付を入れてください"; return; }
      status.textContent = "保存中…";
      void api(`/api/v1/uranai/person/${personId}/event`, { method: "POST", body: JSON.stringify({
        at: atIn.value, until: untilIn.value || null, kind: kindSel.value,
        weight: weightSel.value || null, body: bodyIn.value || null,
        anchor: anchorIn.value || null, circular: circCb.checked,
      }) }).then(async () => {
        status.textContent = ""; atIn.value = ""; untilIn.value = ""; bodyIn.value = ""; anchorIn.value = ""; circCb.checked = false;
        await load();
      }).catch((e) => { status.textContent = `エラー: ${(e as Error).message}`; });
    });
    box.append(form, status, out);
    void load();
    return box;
  };

  // 象限。地平線と子午線が作る4つのクォーター。ルディアはハウスをこの単位でも読む。
  const quadTbl = mkTable(["象限", "ハウス", "意味"], (chart.quadrants ?? []).map((q) => [
    QUAD_JA[q.id] ?? q.id,
    `${q.houses[0].replace("house_", "")}〜${q.houses[q.houses.length - 1].replace("house_", "")}室`,
    meaningOf("quadrant", q.id),
  ]), [2]);
  // ルネーション: 太陽から測った月の離角。PoF の地平線上下がこれで決まる。
  const lun = chart.lunation;
  // 位相の言い回しは原典どおり。上弦＝衝動を受け取る構造を構築する期間、
  // 下弦＝経験から意味を抽出し同化させる期間。8分割は慣用なのでそう明記する。
  const LUN_NODE: Record<string, string> = { new: "新月（目的の種まき）", first_quarter: "上弦（第1クォーター）",
    full: "満月（構築された構造への目的の浸透と結実）", last_quarter: "下弦（最終クォーター）" };
  const lunTbl = mkTable(["項目", "値"], lun
    ? [["太陽から測った月の離角", `${lun.elongation.toFixed(1)}°`],
       ["位相", lun.phase === "waxing" ? "上弦（合から衝へ。衝動を受け取る構造や器官を構築する期間）" : "下弦（衝から合へ。経験から意味を抽出し同化させる期間）"],
       ["節目", lun.node ? LUN_NODE[lun.node] ?? lun.node : "節目にはあたらない（前後6度以内が節目）"],
       ["クォーター", LUN_Q[lun.quarter] ?? String(lun.quarter)],
       ["8分割（慣用）", lun.octant ? `第${lun.octant}区分 ／ ${conventionOf("lunation_octant")}` : "—"]]
    : [["算出できません", "—"]], [1]);
  // インターセプト（どのカスプにも現れないサイン）。ホイールには描かず表で示す。
  const icptTbl = mkTable(["サイン", "収まるハウス"], (chart.interceptions ?? []).length
    ? (chart.interceptions ?? []).map((x) => [`${SIGN_GLYPH[x.sign] ?? ""}︎ ${SIGN_NAME[x.sign] ?? x.sign}`, `${x.house.replace("house_", "")}室`])
    : [["なし", "—"]]);

  // アスペクト（種類ごとにグループ化）
  const aspectNode = el("div", {});
  // オーブは原典に記述が無い。こちらの取り決めであることを表の先頭に出す。
  if (conventionOf("orb")) aspectNode.append(el("div", { className: "u-pat-comp", textContent: `オーブについて: ${conventionOf("orb")}` }));
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
    if (conventionOf("shape_threshold")) shapeNode.append(el("div", { className: "u-pat-comp", textContent: `判定条件について: ${conventionOf("shape_threshold")}` }));
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
        // 進行の太陽のサビアン。ルディアはこの度数のシンボルを重要とする。
        if (kind === "progressed" && d.sun_sabian) {
          out.append(el("div", { className: "u-tbl-title", textContent: "進行の太陽のサビアン" }));
          out.append(mkTable(["度数", "通し番号", "文言"], [[
            `${SIGN_NAME[d.sun_sabian.sign] ?? d.sun_sabian.sign} ${d.sun_sabian.degree}度`,
            String(d.sun_sabian.index),
            d.sun_sabian.text ?? "（未登録。サビアンのタブから手元の版を取り込む）",
          ]], [2]));
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
        // ルディアが「基本スケジュール」と呼ぶ周期。節目の一覧だけでは
        // いまどの局面かに答えられないので、現在地を先に出す。
        const ln = c.progressed_lunation_now;
        if (ln) {
          out.append(el("div", { className: "u-tbl-title", textContent: "進行のルネーションの現在地（基本スケジュール）" }));
          const kindJa = (k?: string) => k === "new" ? "進行新月（合）" : k === "full" ? "進行満月（衝）" : "—";
          out.append(mkTable(["項目", "値"], [
            ["直前の節目", ln.last ? `${kindJa(ln.last.kind)} ${ln.last.at.slice(0, 10)}（${ln.years_since_last?.toFixed(1)}年前）` : "—"],
            ["次の節目", ln.next ? `${kindJa(ln.next.kind)} ${ln.next.at.slice(0, 10)}（${ln.years_to_next?.toFixed(1)}年後）` : "—"],
            ["いまの相", ln.last?.kind === "new" ? "上弦（合から衝へ。衝動を受け取る構造や器官を構築する期間）"
              : ln.last?.kind === "full" ? "下弦（衝から合へ。経験から意味を抽出し同化させる期間）" : "—"],
            ["区間の進み", ln.elapsed_ratio !== null && ln.elapsed_ratio !== undefined ? `${Math.round(ln.elapsed_ratio * 100)}%` : "—"],
          ], [1]));
        }
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
  type Note = { note_id: string; idx: number; at: string | null; until: string | null; title: string; value: string; rays: Ray[]; links: string[]; cells: Record<string, string> };
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

  // 詳細（開く）: タイトル・期間・テキストだけ。プロパティ（概念リンク）は持たない。
  const pageView = (n: Note, after: () => void): HTMLElement => {
    const box = el("div", { className: "u-page" });
    const back = el("button", { className: "u-btn-sm u-btn-ghost", textContent: "← 一覧" });
    back.addEventListener("click", () => { openNote = null; after(); });
    box.append(back);
    const ti = el("input", { className: "u-page-title", value: n.title }) as HTMLInputElement;
    ti.placeholder = "無題";
    ti.addEventListener("blur", () => { if (ti.value !== n.title) { n.title = ti.value; patch(n, { title: ti.value }, after); } });
    box.append(ti);
    const at = el("input", { type: "date", className: "u-prop-sel", value: (n.at ?? "").slice(0, 10) }) as HTMLInputElement;
    const until = el("input", { type: "date", className: "u-prop-sel", value: (n.until ?? "").slice(0, 10) }) as HTMLInputElement;
    const saveSpan = () => {
      n.at = at.value ? `${at.value}T12:00:00Z` : null;
      n.until = until.value ? `${until.value}T12:00:00Z` : null;
      patch(n, { at: n.at ?? "", until: n.until ?? "" }, () => { /* 一覧の再描画は不要 */ });
    };
    at.addEventListener("change", saveSpan);
    until.addEventListener("change", saveSpan);
    box.append(el("div", { className: "u-prop" }, [el("div", { className: "u-prop-k", textContent: "期間" }), at, el("span", { className: "u-row-tilde", textContent: "〜" }), until]));
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

  // 右ペインはノートDB。タブ＝ビュー(note_type)。タブ・列はユーザーが追加/改名/削除できる。
  type Tab = { note_type: string; label: string; idx: number };
  let tabs: Tab[] = [];
  let tabsLoaded = false;
  let noteTab = "event";
  let tabMenuOpen: string | null = null;   // メニュー(ポップオーバー)を開いているタブ
  let colMenuOpen: string | null = null;   // メニューを開いている列
  // 種別の無い既存ノートは「出来事」に置く（プロポーズ等を失わない）。
  const tabOf = (n: Note): string => n.rays.find((r) => r.concept_kind === "note_type")?.concept_id ?? "event";
  const dateVal = (v: string | null): string => (v ?? "").slice(0, 10);
  const isoOf = (d: string): string | null => (d ? `${d}T12:00:00Z` : null);
  // タブごとの汎用カラム（列）。未取得のタブは非同期で読む。
  type Col = { col_id: string; name: string; kind: string; idx: number };
  const colsByTab: Record<string, Col[]> = {};

  // 右ペイン: 種別タブ＋一覧（列＝タイトル・期間、インライン編集）／または詳細ページ。
  const renderNotes = () => {
    if (!reportHost) return;
    reportHost.innerHTML = "";
    const open = openNote ? notes.find((x) => x.note_id === openNote) : null;
    if (open) { reportHost.append(pageView(open, renderNotes)); return; }
    // タブ（ビュー）を読む（未取得なら取得→再描画）。
    if (!tabsLoaded) {
      tabsLoaded = true;
      void api<{ tabs: Tab[] }>(`/api/v1/uranai/astrology/person/${personId}/note-tabs`)
        .then((r) => { tabs = r.tabs ?? []; if (tabs.length && !tabs.some((t) => t.note_type === noteTab)) noteTab = tabs[0].note_type; renderNotes(); }).catch(() => { /* 未取得 */ });
    }
    // Notion風タブ＝アイコン＋ラベル、選択中は下線。⋯で改名/削除、末尾＋で追加。
    const tabbar = el("div", { className: "u-db-tabs" });
    for (const t of tabs) {
      const active = t.note_type === noteTab;
      const b = el("button", { className: "u-db-tab" + (active ? " on" : ""), type: "button" });
      b.append(el("span", { className: "u-db-tab-ic", textContent: "▤" }), el("span", { textContent: t.label }));
      // 非アクティブ＝切替。アクティブを再クリック＝メニュー（Notion風）。
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!active) { tabMenuOpen = null; colMenuOpen = null; noteTab = t.note_type; renderNotes(); return; }
        colMenuOpen = null; tabMenuOpen = tabMenuOpen === t.note_type ? null : t.note_type; renderNotes();
      });
      if (active && tabMenuOpen === t.note_type) {
        const pop = el("div", { className: "u-db-pop" });
        pop.addEventListener("click", (e) => e.stopPropagation());
        const rn = el("button", { className: "u-db-pop-item", type: "button", textContent: "名前を変更" });
        rn.addEventListener("click", () => { tabMenuOpen = null; const nm = prompt("新しいタブ名", t.label); if (nm) void api(`/api/v1/uranai/astrology/person/${personId}/note-tabs/${encodeURIComponent(t.note_type)}`, { method: "PUT", body: JSON.stringify({ label: nm }) }).then(() => { tabsLoaded = false; renderNotes(); }); else renderNotes(); });
        const dl = el("button", { className: "u-db-pop-item u-db-pop-del", type: "button", textContent: "削除" });
        dl.addEventListener("click", () => { tabMenuOpen = null; if (confirm(`タブ「${t.label}」を削除しますか？（このタブの列は消え、行は「出来事」へ移ります）`)) void api(`/api/v1/uranai/astrology/person/${personId}/note-tabs/${encodeURIComponent(t.note_type)}`, { method: "DELETE" }).then(() => { if (noteTab === t.note_type) noteTab = "event"; delete colsByTab[t.note_type]; tabsLoaded = false; renderNotes(); }); else renderNotes(); });
        pop.append(rn, dl);
        b.append(pop);
      }
      tabbar.append(b);
    }
    const addTab = el("button", { className: "u-db-tab u-db-tab-add", type: "button", textContent: "＋", title: "タブを追加" });
    addTab.addEventListener("click", () => {
      const label = prompt("新しいタブ名");
      if (!label) return;
      void api<{ note_type: string }>(`/api/v1/uranai/astrology/person/${personId}/note-tabs`, { method: "POST", body: JSON.stringify({ label }) })
        .then((r) => { noteTab = r.note_type; tabsLoaded = false; renderNotes(); });
    });
    tabbar.append(addTab);
    reportHost.append(tabbar);
    // このタブの汎用カラム。未取得なら空で描いてから非同期取得→再描画。
    if (colsByTab[noteTab] === undefined) {
      colsByTab[noteTab] = [];
      void api<{ columns: Col[] }>(`/api/v1/uranai/astrology/person/${personId}/note-columns?note_type=${noteTab}`)
        .then((r) => { colsByTab[noteTab] = r.columns ?? []; renderNotes(); }).catch(() => { /* 未取得 */ });
    }
    const cols = colsByTab[noteTab] ?? [];
    const shown = notes.filter((n) => tabOf(n) === noteTab);
    const head = el("tr", {});
    for (const h of ["タイトル", "期間"]) head.append(el("th", { textContent: h }));
    for (const col of cols) {
      const th = el("th", { className: "u-col-th" });
      // 見出しクリックでメニュー：改名 / 種別切替(text⇄date) / 削除。
      const nameBtn = el("button", { className: "u-col-name", type: "button" });
      nameBtn.append(el("span", { textContent: col.name || "（無名）" }), el("span", { className: "u-col-kind", textContent: col.kind === "date" ? "📅" : "" }));
      nameBtn.addEventListener("click", (e) => { e.stopPropagation(); tabMenuOpen = null; colMenuOpen = colMenuOpen === col.col_id ? null : col.col_id; renderNotes(); });
      th.append(nameBtn);
      if (colMenuOpen === col.col_id) {
        const after = () => { delete colsByTab[noteTab]; renderNotes(); };
        const pop = el("div", { className: "u-db-pop" });
        pop.addEventListener("click", (e) => e.stopPropagation());
        const rn = el("button", { className: "u-db-pop-item", type: "button", textContent: "名前を変更" });
        rn.addEventListener("click", () => { colMenuOpen = null; const nm = prompt("新しい列名", col.name); if (nm != null) void api(`/api/v1/uranai/astrology/note-column/${col.col_id}`, { method: "PUT", body: JSON.stringify({ name: nm }) }).then(after); else renderNotes(); });
        const kd = el("button", { className: "u-db-pop-item", type: "button", textContent: col.kind === "date" ? "テキストに変更" : "日付に変更" });
        kd.addEventListener("click", () => { colMenuOpen = null; const nk = col.kind === "date" ? "text" : "date"; void api(`/api/v1/uranai/astrology/note-column/${col.col_id}`, { method: "PUT", body: JSON.stringify({ kind: nk }) }).then(after); });
        const dl = el("button", { className: "u-db-pop-item u-db-pop-del", type: "button", textContent: "削除" });
        dl.addEventListener("click", () => { colMenuOpen = null; if (confirm(`列「${col.name || "無名"}」を削除しますか？`)) void api(`/api/v1/uranai/astrology/note-column/${col.col_id}`, { method: "DELETE" }).then(after); else renderNotes(); });
        pop.append(rn, kd, dl);
        th.append(pop);
      }
      head.append(th);
    }
    // 列の追加（Notionの「＋」）
    const addTh = el("th", { className: "u-col-add" });
    const addColBtn = el("button", { className: "u-col-add-btn", type: "button", textContent: "＋", title: "列を追加" });
    addColBtn.addEventListener("click", () => {
      const name = prompt("列名を入力");
      if (!name) return;
      const kind = confirm("日付の列にしますか？（キャンセル＝テキスト）") ? "date" : "text";
      void api(`/api/v1/uranai/astrology/person/${personId}/note-columns`, { method: "POST", body: JSON.stringify({ note_type: noteTab, name, kind }) })
        .then(() => { delete colsByTab[noteTab]; renderNotes(); });
    });
    addTh.append(addColBtn);
    head.append(addTh);
    const tbl = el("table", { className: "u-tbl u-tbl-auto u-db-tbl" }, [head]);
    for (const n of shown) {
      const tr = el("tr", {});
      const ti = el("input", { className: "u-row-ti", value: n.title }) as HTMLInputElement;
      ti.placeholder = "無題";
      ti.addEventListener("blur", () => { if (ti.value !== n.title) { n.title = ti.value; patch(n, { title: ti.value }, () => { /* 局所更新のみ */ }); } });
      // 開くボタンはタイトルセル内。行の高さに収め、ホバー時に出す（Notionの OPEN 風）。
      const openBtn = el("button", { className: "u-open-btn", type: "button", textContent: "開く" });
      openBtn.addEventListener("click", () => { openNote = n.note_id; renderNotes(); });
      const at = el("input", { type: "date", className: "u-row-dt", value: dateVal(n.at) }) as HTMLInputElement;
      const until = el("input", { type: "date", className: "u-row-dt", value: dateVal(n.until) }) as HTMLInputElement;
      const saveSpan = () => {
        n.at = isoOf(at.value); n.until = isoOf(until.value);
        patch(n, { at: n.at ?? "", until: n.until ?? "" }, () => { /* 局所更新のみ */ });
      };
      at.addEventListener("change", saveSpan);
      until.addEventListener("change", saveSpan);
      tr.append(
        el("td", { className: "u-td-title" }, [ti, openBtn]),
        el("td", {}, [at, el("span", { className: "u-row-tilde", textContent: "〜" }), until]),
      );
      // 汎用カラムのセル（種別ごとの入力）
      for (const col of cols) {
        const cur = n.cells?.[col.col_id] ?? "";
        const inp = el("input", { className: "u-cell", type: col.kind === "date" ? "date" : "text", value: col.kind === "date" ? cur.slice(0, 10) : cur }) as HTMLInputElement;
        const saveCell = () => { if (!n.cells) n.cells = {}; n.cells[col.col_id] = inp.value; patch(n, { cells: { [col.col_id]: inp.value } }, () => { /* 局所更新のみ */ }); };
        inp.addEventListener("change", saveCell);
        if (col.kind !== "date") inp.addEventListener("blur", saveCell);
        tr.append(el("td", {}, [inp]));
      }
      tbl.append(tr);
    }
    reportHost.append(tbl);
    const add = el("button", { className: "u-btn u-btn-sm", textContent: "＋" });
    add.addEventListener("click", () => {
      const nowIso = new Date().toISOString();
      const rays: Ray[] = [{ concept_kind: "note_type", concept_id: noteTab }];
      void api<{ note_id: string; idx: number; rays?: Ray[]; links?: string[] }>(`/api/v1/uranai/astrology/person/${personId}/notes`,
        { method: "POST", body: JSON.stringify({ value: "", title: "", rays, at: nowIso }) })
        .then((r) => {
          // 一覧のまま空行を足す（詳細へは行かない）。編集は行内、詳細は「開く」で。
          notes.push({ note_id: r.note_id, idx: r.idx, at: nowIso, until: null, title: "", value: "", rays: r.rays ?? rays, links: r.links ?? [], cells: {} });
          renderNotes();
        });
    });
    reportHost.append(add);
    // メニューを開いている間は、外側クリックで閉じる透明オーバーレイ。
    if (tabMenuOpen || colMenuOpen) {
      const ov = el("div", { className: "u-menu-overlay" });
      ov.addEventListener("click", () => { tabMenuOpen = null; colMenuOpen = null; renderNotes(); });
      reportHost.append(ov);
    }
  };

  void api<{ notes: Note[] }>(`/api/v1/uranai/astrology/person/${personId}/notes`)
    .then((r) => { notes = r.notes ?? []; matHost.innerHTML = ""; matHost.append(houseDetail()); renderNotes(); })
    .catch(() => { /* メモが取れなくても材料は見せる */ });

  // 概念。自分の意味を書く場所。原典由来の意味と並べて出し、上書きではなく別に持つ。
  const conceptNode = el("div", {});
  const CONCEPT_TABS: Array<{ kind: string; label: string }> = [
    { kind: "planet", label: "天体" }, { kind: "sign", label: "サイン" }, { kind: "house", label: "ハウス" },
    { kind: "element", label: "エレメント" }, { kind: "quality", label: "クオリティ" },
    { kind: "aspect_type", label: "アスペクト" }, { kind: "aspect_figure", label: "アスペクトパターン" },
    { kind: "quadrant", label: "象限" },
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
  const bmEnd = (birth?.born_until ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const zones = IANA_ZONES.length ? IANA_ZONES : FALLBACK_ZONES;
  const initZone = (birth?.timezone && birth.timezone.includes("/")) ? birth.timezone : "Asia/Tokyo";
  const st = {
    name: label ?? "", date: bm?.[1] ?? "", time: bm?.[2] ?? "",
    dateEnd: bmEnd?.[1] ?? "", timeEnd: bmEnd?.[2] ?? "", place: birth?.place ?? "",
    lat: (birth?.lat ? Number(birth.lat) : null) as number | null,
    lng: (birth?.lng ? Number(birth.lng) : null) as number | null,
    tz: zones.includes(initZone) ? initZone : "Asia/Tokyo",
  };
  const orig = { ...st };
  const houseName = HOUSE_SYSTEM_JA[chart.house_system ?? ""] ?? chart.house_system ?? "-";
  const ICON: Record<string, string> = { name: "✎", date: "📅", time: "🕐", dateEnd: "📅", timeEnd: "🕐", place: "📍", tz: "🌐" };
  const basicNode = el("div", { className: "u-basic" });
  // 人物ごとの設定（タブ）。全体設定と同じものを、この人物に対して出す。
  // 流派の選択だけが人物ごと。時期の読み方と部品は流派そのものの設定なので、
  // ここで変えると同じ流派を使う他の人物にも反映される。
  const personSettingsNode = el("div", { className: "u-form" });
  {
    const rsStatus = el("div", { className: "u-status" });
    let effectiveRuleset: string | undefined;
    const rsSel = el("select", { className: "u-set-sel" }) as HTMLSelectElement;
    const lockedGrid = el("div", { className: "u-set-grid" });
    const { timingBox, partsBox, renderTiming, renderParts } =
      rulesetControls(() => effectiveRuleset, () => rsStatus);
    const renderLocked = (eff: Settings) => {
      lockedGrid.innerHTML = "";
      for (const f of SETTING_FIELDS) {
        if (!f.byRuleset) continue;
        const sel = selectEl(f.options, (eff as unknown as Record<string, string>)[f.key as string]);
        sel.disabled = true;
        lockedGrid.append(el("div", { className: "u-set-row u-set-locked" }, [
          el("label", {}, [el("span", { className: "u-lock-ic", textContent: "固定" }), el("span", { textContent: f.label })]), sel,
        ]));
      }
    };
    /**
     * 指定の流派の内容を出す。保存前でも、選んだ流派の技法がその場で見えるようにする。
     * ここで編むチェックはその流派の定義なので、保存していなくても変更は流派側に効く。
     */
    const showRuleset = async (rsId: string) => {
      effectiveRuleset = rsId;
      renderLocked(await api<Settings>(`/api/v1/uranai/astrology/settings?ruleset=${encodeURIComponent(rsId)}`));
      clearMeanings();
      await loadMeanings(rsId);
      renderTiming();
      renderParts();
    };
    let defaultRuleset = "default";
    const load = async () => {
      try {
        const [ref, cur] = await Promise.all([
          api<{ rulesets?: Array<{ id: string; name: string | null; editable?: boolean; lineage?: string | null }> }>(`/api/v1/uranai/astrology/reference`),
          api<{ ruleset_id: string | null; effective: string; default: string }>(`/api/v1/uranai/astrology/person/${personId}/ruleset`),
        ]);
        rsSel.innerHTML = "";
        const defName = (ref.rulesets ?? []).find((r) => r.id === cur.default)?.name ?? cur.default;
        rsSel.append(el("option", { value: "", textContent: `全体の既定に従う（${defName}）` }));
        const LINEAGE_ORDER = ["traditional", "modern_west", "midpoint", "indian"];
        const groups = new Map<string, HTMLElement>();
        for (const lg of LINEAGE_ORDER) {
          const og = document.createElement("optgroup");
          og.label = nameOf("lineage", lg);
          groups.set(lg, og);
        }
        const own = document.createElement("optgroup");
        own.label = "自分の流派";
        for (const r of ref.rulesets ?? []) {
          const opt = el("option", { value: r.id, textContent: r.name ?? r.id });
          (r.editable !== false ? own : groups.get(r.lineage ?? "") ?? own).append(opt);
        }
        for (const lg of LINEAGE_ORDER) { const og = groups.get(lg); if (og?.children.length) rsSel.append(og); }
        if (own.children.length) rsSel.append(own);
        rsSel.value = cur.ruleset_id ?? "";
        defaultRuleset = cur.default;
        rsSaved = rsSel.value;
        rsSave.disabled = true;
        await showRuleset(cur.effective);
      } catch (e) { rsStatus.textContent = `エラー: ${(e as Error).message}`; }
    };
    // 流派は選んだ瞬間には切り替えない。計算とタブの入れ替えが走るので、保存で確定させる。
    const rsSave = el("button", { className: "u-btn u-btn-sm", type: "button", textContent: "保存" });
    rsSave.disabled = true;
    let rsSaved = "";
    rsSel.addEventListener("change", () => {
      rsSave.disabled = rsSel.value === rsSaved;
      rsStatus.textContent = "";
      // 選んだ流派の技法をその場で出す。保存するまで人物への適用はしない。
      void showRuleset(rsSel.value || defaultRuleset)
        .catch((e) => { rsStatus.textContent = `エラー: ${(e as Error).message}`; });
    });
    rsSave.addEventListener("click", () => {
      rsSave.disabled = true;
      rsStatus.textContent = "切り替え中…";
      void api(`/api/v1/uranai/astrology/person/${personId}/ruleset`,
        { method: "PUT", body: JSON.stringify({ ruleset_id: rsSel.value || null }) })
        .then(async () => {
          // その流派での計算がまだなら作る。既存の流派の結果は消さない。
          await api(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" }).catch(() => {});
          clearMeanings();
          rsStatus.textContent = "";
          await onSaved(label);
        })
        .catch((e) => { rsStatus.textContent = `エラー: ${(e as Error).message}`; rsSave.disabled = false; });
    });
    personSettingsNode.append(
      el("div", { className: "u-set-title", textContent: "この人物の流派" }),
      el("div", { className: "u-set-grid" }, [el("div", { className: "u-set-row" }, [el("label", { textContent: "流派" }), rsSel, rsSave])]),
      lockedGrid, timingBox, partsBox, rsStatus,
    );
    void load();
  }
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
      // 終端が入っていれば期間として送る。日付未入力なら開始日を流用（時刻だけの幅）。
      const born_until = (st.timeEnd || st.dateEnd)
        ? `${st.dateEnd || st.date}T${st.timeEnd || st.time}:00${offsetFromZone(st.tz, new Date(`${st.dateEnd || st.date}T${st.timeEnd || st.time}:00`))}` : null;
      await api(`/api/v1/uranai/person/${personId}/birth`, { method: "PUT", body: JSON.stringify({ born_at, born_until, lat: String(st.lat), lng: String(st.lng), place: st.place, timezone: st.tz }) });
      await api(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" });
      await onSaved(nm || label);
    } catch (e) { statusEl.textContent = `エラー: ${(e as Error).message}`; }
  };
  const renderBasic = () => {
    basicNode.innerHTML = "";
    const editMode = editing !== null;
    const disp: Record<string, string> = {
      name: st.name || "-", date: st.date || "-", time: st.time || "-",
      dateEnd: st.dateEnd || "-", timeEnd: st.timeEnd || "-", place: st.place || "-",
      lat: st.lat !== null ? st.lat.toFixed(4) : "-", lng: st.lng !== null ? st.lng.toFixed(4) : "-",
      tz: st.tz, house: houseName, node: "平均",
    };
    // 編集中の項目のコントロールを生成。
    let ctrl: HTMLElement | undefined;
    if (editing === "name") { const i = el("input", { type: "text", className: "u-fi", value: st.name }); i.addEventListener("input", () => { st.name = i.value; }); ctrl = i; }
    else if (editing === "date") { const i = el("input", { type: "date", className: "u-fi", value: st.date }); i.addEventListener("input", () => { st.date = i.value; }); ctrl = i; }
    else if (editing === "time") { const i = el("input", { type: "time", className: "u-fi", value: st.time }); i.addEventListener("input", () => { st.time = i.value; }); ctrl = i; }
    else if (editing === "dateEnd") { const i = el("input", { type: "date", className: "u-fi", value: st.dateEnd }); i.addEventListener("input", () => { st.dateEnd = i.value; }); ctrl = i; }
    else if (editing === "timeEnd") { const i = el("input", { type: "time", className: "u-fi", value: st.timeEnd }); i.addEventListener("input", () => { st.timeEnd = i.value; }); ctrl = i; }
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
    addRow("dateEnd", "終了日(幅・任意)", true);
    addRow("timeEnd", "終了時刻(幅・任意)", true);
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
  const ec = Object.fromEntries((chart.elements ?? []).map((e) => [e.element, e.count]));
  const qc = Object.fromEntries((chart.qualities ?? []).map((q) => [q.quality, q.count]));
  const elemNode = mkTable(["火", "地", "風", "水"], [[String(ec.fire ?? 0), String(ec.earth ?? 0), String(ec.air ?? 0), String(ec.water ?? 0)]]);
  const qualNode = mkTable(["活動", "不動", "柔軟"], [[String(qc.cardinal ?? 0), String(qc.fixed ?? 0), String(qc.mutable ?? 0)]]);

  // タブ（可視切替）＋全表示
  // 大分類 → タブ の2段階。上段で大分類を選び、下段でその中のタブを選ぶ。
  // 「読み」の大分類では下段が手順になり、選んだ手順の材料だけを出す。
  const dataSections: Array<{ label: string; node: HTMLElement }> = [
    { label: "基本情報", node: basicNode },
    { label: "設定", node: personSettingsNode },    { label: "チャート", node: chartNode },    ...(usesPart("shape") || usesPart("singleton") || usesPart("center") ? [{ label: "全体の形", node: shapeNode }] : []),
    ...(chart.tally === false || !usesPart("tally") ? [] : [{ label: "元素", node: elemNode }, { label: "クオリティ", node: qualNode }]),
    { label: "天体", node: planetTbl },    { label: "ハウス詳細", node: matHost },    ...(usesPart("interception") ? [{ label: "インターセプト", node: icptTbl }] : []),
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
    ...(usesPart("term") ? [{ label: "ターム", node: termTbl }] : []),
    ...(usesPart("almuten") ? [{ label: "アルムーテン", node: almTbl }] : []),
    ...(usesPart("arabic_part") ? [{ label: "アラビックパーツ", node: lotTbl }] : []),
    ...(usesPart("sabian") ? [{ label: "サビアン", node: sabNode() }] : []),
    ...(usesPart("profection") ? [{ label: "プロフェクション", node: profNode() }] : []),
    ...(usesPart("solar_arc") ? [{ label: "ソーラーアーク", node: arcNode() }] : []),
    ...(usesPart("midpoint") ? [{ label: "ミッドポイント", node: mpTbl }] : []),
    ...(usesPart("fixed_star") ? [{ label: "恒星", node: starNode() }] : []),
    ...(usesPart("out_of_bounds") ? [{ label: "アウトオブバウンズ", node: oobNode() }] : []),
    ...(usesPart("firdaria") ? [{ label: "ファルダール", node: firNode() }] : []),
    ...(usesPart("synastry") ? [{ label: "シナストリー", node: pairNode("synastry") }] : []),
    ...(usesPart("composite") ? [{ label: "コンポジット", node: pairNode("composite") }] : []),
    ...(usesPart("rectification") ? [{ label: "出生時刻の修正", node: rectNode() }] : []),
    ...(usesPart("planet_cycle") ? [{ label: "天体の周期", node: cycNode() }] : []),
    ...(usesPart("transit_search") ? [{ label: "期間の探索", node: searchNode() }] : []),
    ...(usesPart("primary_direction") ? [{ label: "一次進行", node: pdNode() }] : []),
    ...(usesPart("time_lord") ? [{ label: "時期支配星", node: lordNode() }] : []),
    ...(usesPart("nakshatra") ? [{ label: "ナクシャトラ", node: nakTbl }] : []),
    ...(usesPart("dasha") ? [{ label: "ダシャー", node: dashaNode() }] : []),
    ...(usesPart("varga") ? [{ label: "分割図", node: vargaNode() }] : []),
    ...(usesPart("yoga") ? [{ label: "ヨーガ", node: yogaNode() }] : []),
    ...(usesPart("chara_karaka") || usesPart("rashi_drishti") || usesPart("arudha") ? [{ label: "ジャイミニ", node: jaiminiNode() }] : []),
    ...(usesPart("kp_sublord") ? [{ label: "サブロード", node: kpNode() }] : []),
    ...(usesPart("muntha") ? [{ label: "ムンタ", node: munthaNode() }] : []),
    ...(usesPart("ruling_planet") ? [{ label: "ルーリング・プラネット", node: rpNode() }] : []),
    ...(usesPart("chara_dasha") ? [{ label: "チャラ・ダシャー", node: charaNode() }] : []),
    ...(usesPart("tajika_aspect") || usesPart("mudda_dasha") ? [{ label: "タージカ", node: tajikaNode() }] : []),
    ...(usesPart("quadrant") ? [{ label: "象限", node: quadTbl }] : []),
    ...(usesPart("lunation") ? [{ label: "ルネーション", node: lunTbl }] : []),
    { label: `アスペクト(${chart.aspects.length})`, node: aspectNode },
    ...(chart.aspect_figure === false || !usesPart("aspect_figure") ? [] : [{ label: `アスペクトパターン(${majorCount})`, node: patternNode }]),
    ...(usesPart("progression") ? [{ label: "進行", node: derivedNode("progressed") }] : []),
    ...(usesPart("transit") ? [{ label: "経過", node: derivedNode("transit") }] : []),
    ...(usesPart("cycles") ? [{ label: "サイクル", node: cyclesNode() }] : []),
  ];

  // 流派によって時期の読み方の主軸が違う。主軸のタブを時期のタブ群の先頭へ寄せる。
  // 並びを変えるだけで、どのタブを出すかは部品の選択が決める（別々の設定）。
  const TIMING_TABS: Record<string, string[]> = {
    // phase = サイクルの現在地
    phase: ["天体の周期", "サイクル"],
    lord: ["時期支配星", "ダシャー", "チャラ・ダシャー", "タージカ", "ムンタ", "プロフェクション", "ファルダール"],
    contact: ["期間の探索", "経過", "進行", "ソーラーアーク", "一次進行"],
  };
  {
    const primary = timingPrimaryOf();
    const head = TIMING_TABS[primary] ?? [];
    const rank = (label: string): number => {
      const i = head.indexOf(label);
      if (i >= 0) return i;                       // 主軸のタブが先
      for (const [k, v] of Object.entries(TIMING_TABS)) {
        if (k === primary) continue;
        if (v.includes(label)) return 100 + v.indexOf(label); // 他の形は後ろ
      }
      return 50;                                   // 時期に関係ないタブは元の位置のまま
    };
    const timingLabels = new Set(Object.values(TIMING_TABS).flat());
    const idx = dataSections.map((s, i) => i).filter((i) => timingLabels.has(dataSections[i].label));
    if (idx.length > 1) {
      const picked = idx.map((i) => dataSections[i]).sort((a, b) => rank(a.label) - rank(b.label));
      idx.forEach((slot, n) => { dataSections[slot] = picked[n]; });
    }
  }

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
    /* ノートDB（Notion風） */
    .u-db-tabs{display:flex;gap:2px;align-items:center;border-bottom:1px solid #0001;margin-bottom:8px;overflow:visible;flex-wrap:nowrap}
    .u-db-tab{position:relative;display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:#888;cursor:pointer;font-size:13px;padding:6px 10px;border-bottom:2px solid transparent;white-space:nowrap;margin-bottom:-1px}
    .u-db-tab:hover{color:#333;background:#00000006}
    .u-db-tab.on{color:#333;font-weight:600;border-bottom-color:#333}
    .u-db-tab-ic{opacity:.55;font-size:12px}
    .u-db-tbl td{padding:0;vertical-align:middle}
    .u-td-title{position:relative}
    .u-row-ti{width:100%;box-sizing:border-box;padding:6px 62px 6px 8px;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;font-size:13px}
    .u-row-ti:hover,.u-row-ti:focus{border-color:#4A90C2;background:#00000008;outline:none}
    .u-open-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);opacity:0;font-size:11px;padding:1px 9px;border:1px solid #0002;border-radius:4px;background:#fff;color:#555;cursor:pointer;line-height:1.5}
    .u-td-title:hover .u-open-btn,.u-open-btn:focus{opacity:1}
    .u-row-dt{color-scheme:dark;padding:4px;border:1px solid #0002;border-radius:4px;background:transparent;color:inherit;font-size:12px}
    .u-row-tilde{margin:0 4px;color:#999}
    [data-theme=light] .u-row-dt{color-scheme:light}
    [data-theme=dark] .u-db-tab{color:#ffffff8a}
    [data-theme=dark] .u-db-tab:hover{color:#fff;background:#ffffff0f}
    [data-theme=dark] .u-db-tab.on{color:#fff;border-bottom-color:#fff}
    [data-theme=dark] .u-open-btn{background:#2a2b2e;color:#ddd;border-color:#ffffff2b}
    .u-col-th{position:relative;white-space:nowrap}
    .u-col-del{margin-left:5px;border:0;background:transparent;color:#bbb;cursor:pointer;font-size:12px;opacity:0}
    .u-col-th:hover .u-col-del{opacity:1}
    .u-col-del:hover{color:#c0392b}
    .u-col-add{width:34px}
    .u-col-add-btn{border:1px dashed #0003;background:transparent;color:#888;cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px}
    .u-col-add-btn:hover{color:#333;border-color:#4A90C2}
    .u-cell{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;font-size:12px;color-scheme:dark}
    .u-cell:hover,.u-cell:focus{border-color:#4A90C2;background:#00000008;outline:none}
    [data-theme=light] .u-cell{color-scheme:light}
    [data-theme=dark] .u-col-add-btn{border-color:#ffffff2b;color:#ffffff8a}
    .u-db-tab-menu{margin-left:4px;border:0;background:transparent;color:#aaa;cursor:pointer;font-size:12px;opacity:0;padding:0 2px}
    .u-db-tab:hover .u-db-tab-menu{opacity:.85}
    .u-db-tab-add{color:#999;font-weight:400}
    .u-col-name{border:0;background:transparent;color:inherit;cursor:pointer;font-weight:700;font-size:11px;padding:2px 4px;display:inline-flex;gap:4px;align-items:center}
    .u-col-name:hover{background:#00000010;border-radius:4px}
    .u-col-kind{font-size:10px;opacity:.7}
    .u-db-pop{position:absolute;top:calc(100% + 4px);left:0;z-index:40;background:#fff;border:1px solid #0002;border-radius:6px;box-shadow:0 4px 16px #0003;padding:4px;min-width:140px;display:flex;flex-direction:column;gap:1px}
    .u-db-pop-item{text-align:left;border:0;background:transparent;color:#333;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:4px;white-space:nowrap}
    .u-db-pop-item:hover{background:#00000010}
    .u-db-pop-del{color:#c0392b}
    .u-menu-overlay{position:fixed;inset:0;z-index:30}
    [data-theme=dark] .u-db-pop{background:#26282c;border-color:#ffffff22;box-shadow:0 4px 16px #0007}
    [data-theme=dark] .u-db-pop-item{color:#ddd}
    [data-theme=dark] .u-db-pop-item:hover{background:#ffffff14}
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
    .u-tg-chip input{cursor:pointer;margin:0;accent-color:#4A90C2}
    /* 変更できない流派ではチェックが無効になる。ブラウザ既定の淡色だと選択の有無が
       読み取れないので、色を落とさず背景と枠で選択状態を示す。 */
    .u-tg-chip input:disabled{cursor:default;opacity:1}
    .u-parts-grid .u-tg-chip{border:1px solid transparent;border-radius:11px;padding:2px 8px;margin:-2px 0}
    .u-parts-grid .u-tg-chip:has(input:checked){background:#4A90C21f;border-color:#4A90C266;color:#1f2937;font-weight:600}
    [data-theme=dark] .u-parts-grid .u-tg-chip:has(input:checked){background:#4A90C233;border-color:#4A90C2aa;color:#e8edf3}
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
    /* 出生時刻の幅で不確実な要素のグレーアウト */
    tr.u-uncertain td{opacity:.4}
    td.u-uncertain{opacity:.4;text-decoration:line-through}
    .u-tbl.u-uncertain td{opacity:.45}
    caption.u-uncertain-note{caption-side:top;text-align:left;font-size:11px;color:#c26a00;padding:4px 2px}
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
    /* 人物ごとの流派。基本情報の下に置く。 */
    .u-person-rs{margin-top:10px;padding-top:8px;border-top:1px solid #0001}
    [data-theme=dark] .u-person-rs{border-top-color:#ffffff1a}
    /* 流派が決める項目。錠前と背景で、変更できないことを一目で分かるようにする。 */
    .u-set-locked select{opacity:.65;cursor:not-allowed}
    .u-set-locked label{color:#6b7280}
    .u-lock-ic{margin-right:5px;font-size:10px;border:1px solid currentColor;border-radius:3px;padding:0 3px;opacity:.7}
    .u-lock-note{font-size:11px;color:#888;margin:2px 0 10px;line-height:1.6}
    [data-theme=dark] .u-set-locked label{color:#9aa3af}
    /* 使えない部品の説明。薄い注記ではなく、目に留まる枠で出す。 */
    .u-part-disabled{border:1px solid #d9a441;background:#fdf6e6;border-radius:6px;padding:10px 12px;margin:4px 0 10px;font-size:12px;line-height:1.7}
    .u-part-disabled-h{font-weight:600;margin-bottom:4px}
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
    [data-theme=dark] .u-part-disabled{border-color:#7a5c1c;background:#2a2317;color:#e6ddc7}
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
  // 設定は人物リストの中にしか入口が無く、モバイルでは人物ペインを開かないと辿り着けない。
  // ペインの切替ではないので dataset.pane は持たせず、押しても選択状態にしない。
  const footSet = el("button", { className: "u-foot-btn", type: "button", textContent: "設定" });
  footSet.addEventListener("click", () => { setPane("main"); showSettings(); });
  foot.append(footSet);
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
    let chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    const birth = await api<Birth>(`/api/v1/uranai/person/${personId}/birth`).catch(() => null);
    // 流派を切り替えた直後は、その流派での計算がまだ無く配置が空になる。
    // 出生データがあるなら作る。無いときだけ入力フォームへ回す。
    if (chart.placements.length === 0 && birth?.born_at) {
      main.innerHTML = ""; main.append(el("div", { textContent: "この流派で計算中…" }));
      await api(`/api/v1/uranai/astrology/person/${personId}/compute`, { method: "POST", body: "{}" }).catch(() => {});
      chart = await api<Chart>(`/api/v1/uranai/astrology/person/${personId}/chart`);
    }
    main.innerHTML = "";
    if (chart.placements.length === 0) { showForm(personId, { label }, push); return; }
    // 参照データはその人物の流派で読む。全体の既定で読むと、人物ごとに別の流派を
    // 選んでいる場合にタブが前の流派のまま出る。
    await loadMeanings(chart.ruleset);
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
