import { describe, expect, test } from "bun:test";
import {
  addCodexStatuslineConfig,
  removeCodexStatuslineConfig,
} from "../src/targets/lib";

describe("Codex status line config", () => {
  test("inserts root tui.status_line before existing TOML tables", () => {
    const config = 'model = "gpt-5.5"\n\n[features]\nhooks = true\n';
    const updated = addCodexStatuslineConfig(config);

    expect(updated).toStartWith(
      'model = "gpt-5.5"\n\ntui.status_line = ["model-with-reasoning"'
    );
    expect(updated).toContain('"context-remaining"');
    expect(updated).toContain('"weekly-limit"');
    expect(updated).toContain('"codex-version"');
    expect(updated).toContain("\n[features]\nhooks = true\n");
  });

  test("preserves user-defined Codex status line", () => {
    const config = '[tui]\nstatus_line = ["git-branch"]\n';
    expect(addCodexStatuslineConfig(config)).toBe(config);
  });

  test("removes PAL default status line without touching user config", () => {
    const updated = addCodexStatuslineConfig("[features]\nhooks = true\n");
    const cleaned = removeCodexStatuslineConfig(updated);

    expect(cleaned).not.toContain("model-with-reasoning");
    expect(cleaned).toContain("[features]\nhooks = true\n");

    const userConfig = '[tui]\nstatus_line = ["git-branch"]\n';
    expect(removeCodexStatuslineConfig(userConfig)).toBe(userConfig);
  });
});
