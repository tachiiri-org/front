import { describe, expect, it } from "vitest";
import { COMPONENT_KINDS, componentSchemas, isSchemaField } from "../src/schema/component";

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
    for (const kind of COMPONENT_KINDS) {
      expect(componentSchemas[kind]?.[0]).toMatchObject({
        kind: "text-field",
        key: "name",
        label: "name",
      });
    }
  });
});
