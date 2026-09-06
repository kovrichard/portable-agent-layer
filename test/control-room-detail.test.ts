import { describe, expect, test } from "bun:test";
import { parseBullets, parseDecisions } from "../src/tools/control-room/detail";

// Two ISA sections are prose on disk rather than fields, so the page's reading
// of them is the contract: what `add-decision` wrote must come back apart, and
// anything hand-written must survive whole rather than vanish.

describe("parseDecisions", () => {
  test("splits what add-decision wrote into date, decision and rationale", () => {
    const parsed = parseDecisions(
      "- 2026-09-04: Paths live in bindings.json (records travel, disks don't)"
    );
    expect(parsed).toEqual([
      {
        date: "2026-09-04",
        text: "Paths live in bindings.json",
        why: "records travel, disks don't",
      },
    ]);
  });

  test("keeps a hand-written line whole instead of dropping it", () => {
    expect(parseDecisions("- we argued about this for a week")).toEqual([
      { date: null, text: "we argued about this for a week", why: null },
    ]);
  });

  test("a decision with no rationale still parses", () => {
    expect(parseDecisions("- 2026-09-04: ship it")).toEqual([
      { date: "2026-09-04", text: "ship it", why: null },
    ]);
  });

  test("newest first — the file appends, the panel leads with the latest", () => {
    const parsed = parseDecisions(
      ["- 2026-08-30: first (a)", "- 2026-09-04: second (b)"].join("\n")
    );
    expect(parsed.map((d) => d.date)).toEqual(["2026-09-04", "2026-08-30"]);
  });

  test("an absent section is no decisions, not a crash", () => {
    expect(parseDecisions(undefined)).toEqual([]);
    expect(parseDecisions("   \n\n")).toEqual([]);
  });
});

describe("parseBullets", () => {
  test("bullets win when the section has them", () => {
    expect(parseBullets("Some preamble\n- Bun only\n* No Node")).toEqual([
      "Bun only",
      "No Node",
    ]);
  });

  test("prose lines stand alone when there are no bullets", () => {
    expect(parseBullets("Built with Catalyst\nDeployed on Workers")).toEqual([
      "Built with Catalyst",
      "Deployed on Workers",
    ]);
  });

  test("an absent section is no context", () => {
    expect(parseBullets(undefined)).toEqual([]);
  });
});
