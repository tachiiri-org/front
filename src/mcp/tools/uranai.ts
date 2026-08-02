import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// The uranai API is read/write, but these tools are read-only on purpose: the agent reads a
// chart to interpret it, and every mutation (birth data, rulesets, life events, notes) is the
// user's own act. Mirrors the rule that the agent does not edit the graph.

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
  "fixed_stars", "out_of_bounds", "firdaria", "rectification", "planet_cycle",
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
      "Read a natal chart: placements, houses, cusps, aspects (with waxing/waning phase), aspect patterns, whole shape, dispositor chains, house rulers, chart ruler, lunation, elements/qualities, and whatever else the ruleset's part list enables. This is the main tool for interpreting someone's chart. `ruleset` picks the 流派 (e.g. 'psychological', 'hellenistic', 'vedic'); omit it to use the person's own setting. Note the response currently includes sections the ruleset does not enable — check uranai_read_reference's `parts` before treating a section as in-scope. Use `sections` to fetch only the keys you need (the full response is ~30KB).",
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
    name: "uranai_read_technique",
    description:
      "Read one derived or time-based technique for a person: progressions, transits, profection, solar arc, planetary cycles, transit search, primary directions, time lords, Vimshottari dasha, vargas, yogas, Jaimini, KP, muntha, chara dasha, ruling planets, Tajika, synastry, composite, or the user's own interpretation notes. Most take `date`; some take extra params (e.g. planet_cycle: until_age; dasha: levels; synastry/composite: the partner's person id). Pass them through `params`. Check the technique is in the ruleset's part list first (uranai_read_reference) — the API will compute it regardless.",
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

    return { content: [{ type: "text", text: `Unknown uranai tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
