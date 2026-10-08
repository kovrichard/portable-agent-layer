import { describe, expect, test } from "bun:test";
import { detectTerminal, type TerminalProbe } from "../src/cli/ui/terminal";

const probe = (overrides: Partial<TerminalProbe> = {}): TerminalProbe => ({
  env: {},
  isTTY: true,
  columns: 100,
  platform: "linux",
  ...overrides,
});

describe("what the terminal can show", () => {
  test("a person at a terminal gets rich output", () => {
    expect(detectTerminal(probe()).rich).toBe(true);
  });

  test("a pipe, an agent's tool call or a dumb terminal gets plain output", () => {
    expect(detectTerminal(probe({ isTTY: false })).rich).toBe(false);
    expect(detectTerminal(probe({ env: { TERM: "dumb" } })).rich).toBe(false);
  });

  test("a pipe is colourless unless colour is forced", () => {
    expect(detectTerminal(probe({ isTTY: false })).color).toBe("none");
    expect(detectTerminal(probe({ isTTY: false, env: { FORCE_COLOR: "1" } })).color).toBe(
      "256"
    );
  });

  test("NO_COLOR and FORCE_COLOR=0 win over everything", () => {
    expect(
      detectTerminal(probe({ env: { NO_COLOR: "1", FORCE_COLOR: "3" } })).color
    ).toBe("none");
    expect(detectTerminal(probe({ env: { FORCE_COLOR: "0" } })).color).toBe("none");
  });

  test("truecolor when the terminal says so, 256 colours otherwise", () => {
    const depth = (env: TerminalProbe["env"]) => detectTerminal(probe({ env })).color;

    expect(depth({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(depth({ WT_SESSION: "x" })).toBe("truecolor");
    expect(depth({ TERM_PROGRAM: "iTerm.app" })).toBe("truecolor");
    expect(depth({ TERM: "xterm-kitty" })).toBe("truecolor");
    expect(depth({ FORCE_COLOR: "3" })).toBe("truecolor");
    expect(depth({ TERM: "xterm-256color" })).toBe("256");
  });

  test("only the legacy Windows console falls back to ASCII", () => {
    const unicode = (overrides: Partial<TerminalProbe>) =>
      detectTerminal(probe(overrides)).unicode;

    expect(unicode({ platform: "win32" })).toBe(false);
    expect(unicode({ platform: "win32", env: { WT_SESSION: "x" } })).toBe(true);
    expect(unicode({ platform: "darwin" })).toBe(true);
  });

  test("width comes from the terminal, 80 when it is unknown", () => {
    expect(detectTerminal(probe({ columns: 44 })).width).toBe(44);
    expect(detectTerminal(probe({ columns: undefined })).width).toBe(80);
    expect(detectTerminal(probe({ columns: 0 })).width).toBe(80);
  });
});
