import { describe, expect, test } from "bun:test";
import {
  algorithmTurnFacts,
  lastPhase,
  PHASES,
  phasesIn,
  runVerdict,
} from "../src/progress/algorithm-run-facts";
import {
  algorithmReply,
  FORMAT_HEADER,
  marker,
  NATIVE_HEADER,
  PAL_HEADER,
} from "./lib/algorithm-run-fixture";

describe("the turn's ALGORITHM facts", () => {
  test("the header in the first text", () => {
    expect(algorithmTurnFacts([algorithmReply(["OBSERVE", "PLAN"]), "done"])).toEqual({
      header: "pal",
      headerFirst: true,
      phases: ["OBSERVE", "PLAN"],
      startsNew: true,
    });
  });

  test("the header only in a later text", () => {
    expect(
      algorithmTurnFacts(["let me look first", algorithmReply(["EXECUTE"])])
    ).toEqual({
      header: "pal",
      headerFirst: false,
      phases: ["EXECUTE"],
      startsNew: false,
    });
  });

  test("no header is no ALGORITHM turn, phase markers or not", () => {
    expect(algorithmTurnFacts([`${NATIVE_HEADER}\n${marker("OBSERVE")}`])).toBeNull();
    expect(algorithmTurnFacts([])).toBeNull();
  });

  test("a header past the first 400 characters still counts", () => {
    const late = `${"x".repeat(500)}\n${PAL_HEADER}`;
    expect(algorithmTurnFacts([late])?.header).toBe("pal");
  });

  test("a NATIVE header before an ALGORITHM header in one text still counts", () => {
    expect(algorithmTurnFacts([`${NATIVE_HEADER}\n${PAL_HEADER}`])?.header).toBe("pal");
  });

  test("the Output Format header alone makes an ALGORITHM turn", () => {
    expect(algorithmTurnFacts([algorithmReply(["OBSERVE"], FORMAT_HEADER)])).toEqual({
      header: "format",
      headerFirst: true,
      phases: ["OBSERVE"],
      startsNew: true,
    });
    expect(algorithmTurnFacts(["♻️ ALGORITHM"])).toBeNull();
    expect(algorithmTurnFacts(["♻ ALGORITHM ═══"])?.header).toBe("format");
  });

  test("headers written without spaces still count", () => {
    expect(algorithmTurnFacts(["═PAL|ALGORITHM═"])?.header).toBe("pal");
    expect(algorithmTurnFacts(["═PAL | ALGORITHM ═"])?.header).toBe("pal");
    expect(algorithmTurnFacts(["══ PAL |ALGORITHM══"])?.header).toBe("pal");
    expect(algorithmTurnFacts(["♻️ALGORITHM═══"])?.header).toBe("format");
    expect(algorithmTurnFacts(["♻️ ALGORITHM═══"])?.header).toBe("format");
  });

  test("a NATIVE reply quoting the ALGORITHM header inline is not an ALGORITHM turn", () => {
    expect(
      algorithmTurnFacts([
        `${NATIVE_HEADER}\nCLAUDE.md tells me to write \`${PAL_HEADER}\` at the top.`,
      ])
    ).toBeNull();
    expect(
      algorithmTurnFacts([`${NATIVE_HEADER}\nThe format block shows "${FORMAT_HEADER}".`])
    ).toBeNull();
  });

  test("a header in the middle of a sentence is not one", () => {
    expect(algorithmTurnFacts([`I would start with ${PAL_HEADER} here`])).toBeNull();
    expect(algorithmTurnFacts([`I would start with ${FORMAT_HEADER} here`])).toBeNull();
  });

  test("an indented header at a line start is one", () => {
    expect(algorithmTurnFacts([`intro\n   ${PAL_HEADER}`])?.header).toBe("pal");
    expect(algorithmTurnFacts([`intro\n\t${FORMAT_HEADER}`])?.header).toBe("format");
  });

  test("the Output Format header needs three bars", () => {
    expect(algorithmTurnFacts(["♻️ ALGORITHM ══"])).toBeNull();
  });

  test("the first text with a header names it", () => {
    expect(algorithmTurnFacts(["plain", FORMAT_HEADER, PAL_HEADER])?.header).toBe(
      "format"
    );
  });

  test("final reply only: one text", () => {
    expect(algorithmTurnFacts([algorithmReply(["VERIFY", "LEARN"])])).toEqual({
      header: "pal",
      headerFirst: true,
      phases: ["VERIFY", "LEARN"],
      startsNew: false,
    });
  });
});

describe("phase markers", () => {
  test.each(PHASES.map((phase) => [phase]))("%s is read from its marker", (phase) => {
    expect(phasesIn([marker(phase)])).toEqual([phase]);
  });

  test("in the order first seen, each once, across texts", () => {
    expect(
      phasesIn([
        `${marker("PLAN")}\n${marker("OBSERVE")}`,
        `${marker("PLAN")}\n${marker("LEARN")}`,
      ])
    ).toEqual(["PLAN", "OBSERVE", "LEARN"]);
  });

  test("a phase marker quoted inline is not a phase", () => {
    expect(phasesIn([`The marker \`${marker("OBSERVE")}\` opens a run`])).toEqual([]);
    expect(phasesIn([`then ${marker("PLAN")}`])).toEqual([]);
  });

  test("a phase marker at a line start, indented or not, is one", () => {
    expect(phasesIn([`intro\n${marker("PLAN")}\n  ${marker("VERIFY")}`])).toEqual([
      "PLAN",
      "VERIFY",
    ]);
  });

  test("a phase name without the marker line is not a phase", () => {
    expect(phasesIn(["OBSERVE 1/5", "━━━ OBSERVE ━━━", "━━━ observe ━━━ 1/5"])).toEqual(
      []
    );
    expect(phasesIn(["━━━ OBSERVE ━━━ 6/5", "━━━\nOBSERVE 1/5"])).toEqual([]);
  });
});

describe("the verdict", () => {
  test("no active node", () => {
    expect(runVerdict(null, { run: "r" })).toBe("no-node");
  });

  test("the node has no open run", () => {
    expect(runVerdict("n1", undefined)).toBe("started");
  });

  test("the node has an open run", () => {
    expect(runVerdict("n1", { run: "r" })).toBe("over-open-run");
  });
});

describe("the last phase reached", () => {
  test("by phase order, not by the order written", () => {
    expect(lastPhase(["EXECUTE", "OBSERVE"])).toBe("EXECUTE");
    expect(lastPhase(["OBSERVE", "PLAN", "EXECUTE", "VERIFY", "LEARN"])).toBe("LEARN");
  });

  test("none written", () => {
    expect(lastPhase([])).toBeNull();
  });
});
