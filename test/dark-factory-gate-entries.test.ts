import { describe, expect, test } from "bun:test";
import { gateEntriesFor } from "../assets/plugins/dark-factory/scripts/gate.mjs";

const TWO_ENTRIES = [{ name: "a" }, { name: "b", roles: ["test-writer"] }];

function namesFor(config: { gate: unknown[] }, role: string) {
  return gateEntriesFor(config as never, role).map(
    (entry: { name: string }) => entry.name
  );
}

describe("gateEntriesFor", () => {
  test("code-writer gets the entry without roles and not the test-writer-only one", () => {
    expect(namesFor({ gate: TWO_ENTRIES }, "code-writer")).toEqual(["a"]);
  });

  test("test-writer gets the entry that lists it", () => {
    expect(namesFor({ gate: TWO_ENTRIES }, "test-writer")).toEqual(["b"]);
  });

  test("debugger gets the entry without roles", () => {
    expect(namesFor({ gate: TWO_ENTRIES }, "debugger")).toEqual(["a"]);
  });

  test("reviewer gets no entry from a config with an entry without roles", () => {
    expect(namesFor({ gate: TWO_ENTRIES }, "reviewer")).toEqual([]);
  });

  test("an empty gate gives no entries for code-writer", () => {
    expect(namesFor({ gate: [] }, "code-writer")).toEqual([]);
  });

  test("an entry with an empty roles list gates no role", () => {
    expect(namesFor({ gate: [{ name: "c", roles: [] }] }, "code-writer")).toEqual([]);
  });

  test("entries keep config order when both list the role or lack roles", () => {
    expect(
      namesFor(
        { gate: [{ name: "d", roles: ["code-writer"] }, { name: "e" }] },
        "code-writer"
      )
    ).toEqual(["d", "e"]);
  });
});
