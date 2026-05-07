import { describe, expect, it } from "vitest";
import { allocateDefaultEntityName, assignDefaultEntityNames } from "../src/name";

describe("entity naming", () => {
  it("allocates unique names with a kind prefix", () => {
    const name = allocateDefaultEntityName(
      [
        { id: "a", kind: "canvas", name: "canvas-1" },
        { id: "b", kind: "canvas", name: "canvas-2" },
      ],
      "canvas",
    );

    expect(name).toBe("canvas-3");
  });

  it("fills in missing names without changing existing ones", () => {
    const named = assignDefaultEntityNames([
      { id: "a", kind: "component-editor", name: "" },
      { id: "b", kind: "button", name: "manual-name" },
      { id: "c", kind: "button" },
    ]);

    expect(named[0]?.name).toBe("editor-1");
    expect(named[1]?.name).toBe("manual-name");
    expect(named[2]?.name).toBe("button-1");
  });
});
