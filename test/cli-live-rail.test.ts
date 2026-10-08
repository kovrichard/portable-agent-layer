import { describe, expect, test } from "bun:test";
import { LiveRail, stepTime } from "../src/cli/ui/live";
import { createStyle } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";

function railOn(term: Partial<Terminal>) {
  let out = "";
  const style = createStyle({
    rich: true,
    color: "none",
    unicode: true,
    width: 80,
    ...term,
  });
  const rail = new LiveRail(style, (text) => {
    out += text;
  });
  return { rail, output: () => out };
}

const finalLines = (out: string) =>
  out
    .split("\n")
    .map((line) => line.split("\r\x1b[2K").at(-1) ?? "")
    .filter(Boolean);

describe("a step, piped", () => {
  test("prints one plain line with what it did, then its notes", async () => {
    const { rail, output } = railOn({ rich: false });

    await rail.step("Claude Code", "installing…", () => ({
      detail: ["25 skills", "13 hooks"],
      notes: [{ level: "warn", text: "kept your settings" }],
    }));

    expect(output()).toBe(
      "ok   Claude Code: 25 skills, 13 hooks\nwarn kept your settings\n"
    );
  });

  test("prints nothing for a step that had nothing to do", async () => {
    const { rail, output } = railOn({ rich: false });

    await rail.step("Migrations", "applying…", () => null);

    expect(output()).toBe("");
  });

  test("names the step that failed and rethrows", async () => {
    const { rail, output } = railOn({ rich: false });
    const failing = rail.step("Download", "…", () => {
      throw new Error("offline");
    });

    await expect(failing).rejects.toThrow("offline");
    expect(output()).toBe("fail Download: offline\n");
  });
});

describe("a step, at a terminal", () => {
  test("spins, then settles into one line with its notes under it", async () => {
    const { rail, output } = railOn({});

    await rail.step("Cursor", "installing…", async () => {
      await Bun.sleep(5);
      return { detail: ["12 hooks"], notes: [{ level: "warn", text: "kept rules" }] };
    });

    expect(output()).toContain("◐  Cursor       installing…");
    expect(finalLines(output())).toEqual(["✓  Cursor       12 hooks", "│  ▲ kept rules"]);
  });

  test("clears the spinner for a step that had nothing to do", async () => {
    const { rail, output } = railOn({});

    await rail.step("Migrations", "applying…", () => null);

    expect(finalLines(output())).toEqual([]);
  });

  test("leaves a failed row behind when the step throws", async () => {
    const { rail, output } = railOn({});
    const failing = rail.step("Download", "…", () => {
      throw new Error("offline");
    });

    await expect(failing).rejects.toThrow("offline");
    expect(finalLines(output())).toEqual(["✖  Download     offline"]);
  });
});

describe("a step's time", () => {
  test("is left out when the step was instant", () => {
    expect(stepTime(12)).toBe("");
    expect(stepTime(1234)).toBe("1.2s");
  });
});
