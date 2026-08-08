import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// The uranai API is read/write, but these tools are read-only except for migration: the agent
// reads a chart to interpret it, and authoring (birth data, rulesets, life events, readings) is
// the user's own act. Mirrors the graph rule — the agent changes the graph only during a
// migration — so the one write tool here is scoped to bulk transfer and marked [migration].

function tenantCtx(env: AuthorizeEnv) {
  // Same shape the browser proxy in routes/layout.ts sends: the backend resolves the tenant's
  // UranaiDO from tenantId and attributes the read to subjectId.
  return env.actor?.tenant ? { tenantId: env.actor.tenant, subjectId: env.actor.userId } : undefined;
}

async function uranaiFetch(env: AuthorizeEnv, resource: string): Promise<Response> {
  return authorizeFetch(env, {
    path: `/api/v1/uranai${resource}`,
    method: "GET",
    tenantContext: tenantCtx(env),
    scopes: env.actor?.scopes,
  });
}

async function readJson(env: AuthorizeEnv, resource: string, label: string): Promise<unknown> {
  const res = await uranaiFetch(env, resource);
  if (!res.ok) throw new Error(`${label}_failed:${res.status}`);
  return res.json();
}

/** Write path. Same tenant attribution as the reads. */
async function uranaiWrite(env: AuthorizeEnv, resource: string, body: unknown, method = "PUT"): Promise<Response> {
  return authorizeFetch(env, {
    path: `/api/v1/uranai${resource}`,
    method,
    body: JSON.stringify(body),
    tenantContext: tenantCtx(env),
    scopes: env.actor?.scopes,
  });
}

// Mirrors CONCEPT_KINDS in backend/src/routes/v1/uranai.ts. A kind missing here is rejected
// before we spend a request; a kind missing THERE is rejected by the API with concept_invalid.
const CONCEPT_KINDS = [
  "planet", "sign", "house", "house_system", "aspect_type",
  "element", "quality", "dignity", "polarity", "ruleset", "body_role",
  "quadrant", "phase", "motion", "shape", "note_type", "part", "aspect_figure",
] as const;

/** Build a query string from the caller's params, dropping empties. `ruleset` is threaded here too. */
function query(params: Record<string, unknown> | undefined, ruleset: unknown): string {
  const q = new URLSearchParams();
  if (typeof ruleset === "string" && ruleset.trim() !== "") q.set("ruleset", ruleset.trim());
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

const json = (v: unknown): string => JSON.stringify(v, null, 1);

// Techniques that hang off /astrology/person/:id/<name>. Kept in sync with the route matchers in
// backend/src/routes/v1/uranai.ts — a name missing here is simply unreachable from MCP.
const TECHNIQUES = [
  "cycles", "progressed", "transit", "profection", "solar_arc",
  "fixed_stars", "out_of_bounds", "firdaria", "zodiacal_release", "rectification", "planet_cycle",
  "transit_search", "primary_direction", "time_lords", "dasha", "varga", "yoga",
  "jaimini", "kp", "muntha", "chara_dasha", "ruling_planets", "tajika",
  "synastry", "composite", "notes",
] as const;

// --- Tool definitions ---

export const URANAI_TOOLS = [
  {
    name: "uranai_list_persons",
    description:
      "List the people recorded in ウラナイ (the astrology module) for this tenant — id and label. Every other uranai tool needs a person_id, so start here. Labels are stored encrypted and decrypted by the API, so this returns personal data: only call it when the user asked you to read their chart.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "uranai_read_chart",
    description:
      "Read a natal chart: placements, houses, cusps, aspects (with waxing/waning phase), aspect patterns, whole shape, dispositor chains, house rulers, chart ruler, lunation, elements/qualities, and whatever else the ruleset's part list enables. This is the main tool for interpreting someone's chart. `ruleset` picks the 流派 (e.g. 'psychological', 'hellenistic', 'vedic'); omit it to use the person's own setting. The response only carries sections the ruleset enables, so a missing key means that technique is out of scope for this 流派 — do not reach for it elsewhere. Use `sections` to fetch only the keys you need (the full response is ~30KB).",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string", description: "Person id from uranai_list_persons" },
        ruleset: { type: "string", description: "Ruleset id (流派). Omit to use the person's own setting." },
        sections: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only return these top-level keys, e.g. ['placements','aspects','patterns','dispositors','house_rulers']",
        },
      },
      required: ["person_id"],
    },
  },
  {
    name: "uranai_read_reference",
    description:
      "Read a ruleset's own definition: which parts (部品/技法) it enables, which aspect types and orbs it uses, its sign rulers and dignity rule, its names and meanings, its lineage, and — importantly — `conventions`, the list of places where a number is OUR convention rather than the source's (aspect orbs, whole-shape thresholds, the 8-fold lunation split). Read this before claiming a technique belongs to a school, and before treating a threshold as authoritative.",
    inputSchema: {
      type: "object",
      properties: {
        ruleset: { type: "string", description: "Ruleset id (流派). Omit for the tenant's default." },
      },
      required: [],
    },
  },
  {
    name: "uranai_list_events",
    description:
      "List a person's recorded life events — date, kind (external/internal/quiet), weight 1-10, and body text. These are the events a ruleset's timing techniques get checked against. Bodies are stored encrypted and decrypted by the API: this is personal data.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string", description: "Person id from uranai_list_persons" },
      },
      required: ["person_id"],
    },
  },
  {
    name: "uranai_set_events",
    description:
      "Record life events for a person — the dated facts a ruleset's timing techniques get checked against. Events are person-scoped and shared across 流派 (they are facts, not readings). Pass one or more events; each needs `at` (YYYY-MM-DD) and `body` (what happened). `until` marks a span, `kind` is external/internal/quiet_external/quiet_internal, `weight` is 1-10. Omit `id` to create; pass the id from uranai_list_events to update. Bodies are stored encrypted: this writes personal data, so only call it when the user asked you to record something.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string", description: "Person id from uranai_list_persons" },
        events: {
          type: "array",
          description: "Events to create or update",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Existing event id. Omit to create a new one." },
              at: { type: "string", description: "Date the event starts, YYYY-MM-DD" },
              until: { type: "string", description: "End date for a span, YYYY-MM-DD. Omit for a point in time." },
              kind: { type: "string", enum: ["external", "internal", "quiet_external", "quiet_internal"] },
              weight: { type: "number", description: "How large it felt, 1-10" },
              body: { type: "string", description: "What happened, in the user's own words" },
              anchor: { type: "string", description: "Optional note on how the date was established" },
            },
            required: ["at"],
          },
        },
      },
      required: ["person_id", "events"],
    },
  },
  {
    name: "uranai_read_technique",
    description:
      "Read one derived or time-based technique for a person: progressions, transits, profection, solar arc, planetary cycles, transit search, primary directions, time lords, Vimshottari dasha, vargas, yogas, Jaimini, KP, muntha, chara dasha, ruling planets, Tajika, synastry, composite, or the user's own interpretation notes. Most take `date`; some take extra params (e.g. planet_cycle: until_age; dasha: levels; synastry/composite: the partner's person id). Pass them through `params`. Check the technique is in the ruleset's part list first (uranai_read_reference) — the API will compute it regardless. For technique 'notes', pass params {note_type:'event'|'concept'} to fetch a single tab/view; each note also carries its own note_type and period (at/until).",
    inputSchema: {
      type: "object",
      properties: {
        person_id: { type: "string", description: "Person id from uranai_list_persons" },
        technique: { type: "string", enum: [...TECHNIQUES], description: "Which technique to read" },
        ruleset: { type: "string", description: "Ruleset id (流派). Omit to use the person's own setting." },
        params: {
          type: "object",
          description: "Extra query params, e.g. {date:'2018-10-15'}, {until_age:90}, {levels:3}",
        },
      },
      required: ["person_id", "technique"],
    },
  },
  {
    name: "uranai_set_concept_notes",
    description:
      "[migration] Write the user's OWN meanings for astrology concepts (p_concept_note) in bulk — the layer that sits beside the school's meanings (p_ruleset_concept_meaning), not on top of them. Use this only to transfer meanings the user has already settled elsewhere (e.g. from the word graph); do not invent or edit meanings on your own. Each note is {concept_kind, concept_id, value}; an empty value DELETES that note. `concept_id` is not validated against the name table, so a concept with no seeded name still accepts a note but will render as a bare id. Notes are NOT scoped to a ruleset — one note per concept, visible from every 流派. Read them back with uranai_read_reference → concept_notes.",
    inputSchema: {
      type: "object",
      properties: {
        notes: {
          type: "array",
          description: "Notes to upsert. Empty value deletes.",
          items: {
            type: "object",
            properties: {
              concept_kind: { type: "string", enum: [...CONCEPT_KINDS], description: "Concept kind" },
              concept_id: { type: "string", description: "Concept id, e.g. 'sun', 'scorpio', 'house_9'" },
              value: { type: "string", description: "The meaning. Empty string deletes the note." },
            },
            required: ["concept_kind", "concept_id", "value"],
          },
        },
      },
      required: ["notes"],
    },
  },
];

// --- Tool handler ---

export async function callUranaiTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  try {
    if (name === "uranai_list_persons") {
      const data = (await readJson(env, "/person", "list_persons")) as {
        persons?: Array<{ id: string; label?: string | null }>;
      };
      const persons = data.persons ?? [];
      if (persons.length === 0) return { content: [{ type: "text", text: "(人物の登録なし)" }] };
      const text = [`ウラナイの人物（${persons.length}件）:`,
        ...persons.map((p) => `[${p.id}] ${p.label ?? "(ラベルなし)"}`)].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (name === "uranai_read_chart") {
      const personId = String(args.person_id);
      const q = query(undefined, args.ruleset);
      const chart = (await readJson(env,
        `/astrology/person/${encodeURIComponent(personId)}/chart${q}`, "read_chart")) as Record<string, unknown>;
      const wanted = Array.isArray(args.sections)
        ? args.sections.map(String).filter((k) => k in chart) : null;
      // Keep ruleset/house_system even when filtering: a chart section is meaningless without
      // knowing which 流派 and house system produced it.
      const out = wanted
        ? Object.fromEntries([...new Set(["ruleset", "house_system", ...wanted])]
            .filter((k) => k in chart).map((k) => [k, chart[k]]))
        : chart;
      const missing = Array.isArray(args.sections)
        ? args.sections.map(String).filter((k) => !(k in chart)) : [];
      const note = missing.length ? `\n[存在しないセクション: ${missing.join(", ")}]` : "";
      return { content: [{ type: "text", text: json(out) + note }] };
    }

    if (name === "uranai_read_reference") {
      const data = await readJson(env, `/astrology/reference${query(undefined, args.ruleset)}`, "read_reference");
      return { content: [{ type: "text", text: json(data) }] };
    }

    if (name === "uranai_list_events") {
      const personId = String(args.person_id);
      const data = await readJson(env, `/person/${encodeURIComponent(personId)}/event`, "list_events");
      return { content: [{ type: "text", text: json(data) }] };
    }

    if (name === "uranai_set_events") {
      const personId = String(args.person_id);
      const events = Array.isArray(args.events) ? args.events : [];
      if (!events.length) return { content: [{ type: "text", text: "events が空です" }], isError: true };
      const res = await uranaiWrite(env, `/person/${encodeURIComponent(personId)}/event`, { events }, "POST");
      if (!res.ok) throw new Error(`set_events_failed:${res.status}`);
      const data = await readJson(env, `/person/${encodeURIComponent(personId)}/event`, "list_events");
      return { content: [{ type: "text", text: json(data) }] };
    }

    if (name === "uranai_read_technique") {
      const personId = String(args.person_id);
      const technique = String(args.technique);
      if (!(TECHNIQUES as readonly string[]).includes(technique)) {
        return {
          content: [{ type: "text", text: `Unknown technique: ${technique}. Valid: ${TECHNIQUES.join(", ")}` }],
          isError: true,
        };
      }
      const params = typeof args.params === "object" && args.params !== null
        ? (args.params as Record<string, unknown>) : undefined;
      const q = query(params, args.ruleset);
      const data = await readJson(env,
        `/astrology/person/${encodeURIComponent(personId)}/${technique}${q}`, "read_technique");
      return { content: [{ type: "text", text: json(data) }] };
    }

    if (name === "uranai_set_concept_notes") {
      const notes = Array.isArray(args.notes) ? args.notes : [];
      if (notes.length === 0) {
        return { content: [{ type: "text", text: "notes が空です。" }], isError: true };
      }
      const ok: string[] = [];
      const failed: string[] = [];
      // One request per note: the API upserts a single (ruleset, kind, id, lang) row. Sequential
      // on purpose — a partial failure should stop at a known point, not scatter.
      for (const raw of notes) {
        const n = (raw ?? {}) as Record<string, unknown>;
        const kind = String(n.concept_kind ?? "");
        const id = String(n.concept_id ?? "");
        const value = String(n.value ?? "");
        const label = `${kind}/${id}`;
        if (!(CONCEPT_KINDS as readonly string[]).includes(kind) || id === "") {
          failed.push(`${label}: 不正な concept_kind / concept_id`);
          continue;
        }
        const res = await uranaiWrite(env, "/astrology/concept-note",
          { concept_kind: kind, concept_id: id, value });
        if (res.ok) ok.push(`${label} = ${value === "" ? "(削除)" : value}`);
        else failed.push(`${label}: HTTP ${res.status}`);
      }
      const text = [
        `自分の意味を書き込みました（流派をまたぐ共通の意味）`,
        `成功 ${ok.length}件 / 失敗 ${failed.length}件`,
        ...ok.map((s) => `  ok   ${s}`),
        ...failed.map((s) => `  NG   ${s}`),
      ].join("\n");
      return { content: [{ type: "text", text }], isError: failed.length > 0 };
    }

    return { content: [{ type: "text", text: `Unknown uranai tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
