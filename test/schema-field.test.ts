import { describe, expect, it } from "vitest";
import { COMPONENT_KINDS, componentSchemas, isSchemaField } from "../src/web/schema/component";

describe("schema field validation", () => {
  it("accepts unknown field kinds with nested fields", () => {
    expect(
      isSchemaField({
        kind: "custom",
        key: "custom",
        label: "custom",
        fields: [{ kind: "text", key: "value", label: "value" }],
      }),
    ).toBe(true);
  });

  it("rejects obviously broken shapes", () => {
    expect(isSchemaField(null)).toBe(false);
    expect(isSchemaField({ kind: 123 })).toBe(false);
    expect(isSchemaField({ kind: "custom", fields: ["nope"] })).toBe(false);
  });

  it("includes name as the first field in every component schema", () => {
    const KINDS_WITHOUT_NAME_FIRST = new Set(['graph-editor']);
    for (const kind of COMPONENT_KINDS) {
      if (KINDS_WITHOUT_NAME_FIRST.has(kind)) continue;
      expect(componentSchemas[kind]?.[0]).toMatchObject({
        kind: "text-field",
        key: "name",
        label: "name",
      });
    }
  });
});
