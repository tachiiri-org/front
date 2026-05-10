import { describe, expect, it } from "vitest";
import { isSchemaField } from "../src/schema/component";

describe("schema field validation", () => {
  it("accepts unknown field kinds with nested fields", () => {
    expect(
      isSchemaField({
        kind: "custom-field",
        key: "custom",
        label: "custom",
        fields: [{ kind: "text-field", key: "value", label: "value" }],
      }),
    ).toBe(true);
  });

  it("rejects obviously broken shapes", () => {
    expect(isSchemaField(null)).toBe(false);
    expect(isSchemaField({ kind: 123 })).toBe(false);
    expect(isSchemaField({ kind: "custom-field", fields: ["nope"] })).toBe(false);
  });
});
