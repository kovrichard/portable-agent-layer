import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";

const LOAD_CONTEXT = resolve(import.meta.dir, "../src/hooks/LoadContext.ts");

let sandbox = "";
let additionalContext = "";

function seed(relPath: string, content: string) {
  const full = resolve(sandbox, "home", relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

/** Every agent directory is redirected, so the run cannot rewrite the developer's own files. */
function runLoadContext() {
  return spawnSync("bun", ["run", LOAD_CONTEXT, "--agent=codex"], {
    env: {
      ...process.env,
      PAL_HOME: resolve(sandbox, "home"),
      PAL_CODEX_DIR: resolve(sandbox, "codex"),
      PAL_CLAUDE_DIR: resolve(sandbox, "claude"),
      PAL_OPENCODE_DIR: resolve(sandbox, "opencode"),
      PAL_COPILOT_DIR: resolve(sandbox, "copilot"),
      PAL_CURSOR_DIR: resolve(sandbox, "cursor"),
    },
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    encoding: "utf-8",
    timeout: 60000,
  });
}

beforeAll(() => {
  sandbox = mkdtempSync(resolve(tmpdir(), "pal-codex-ctx-"));
  seed("telos/GOALS.md", "# Goals\n\n- ship PAL\n");
  seed("memory/self-model/current.md", "# Self-Model\nCodex self-model marker");
  seed(
    "memory/wisdom/frames/development.md",
    "### Codex wisdom marker [CRYSTAL: 90%]\nbody"
  );
  seed("docs/STEERING_RULES.md", "# Steering Rules\nCodex steering marker");
  const result = runLoadContext();
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  additionalContext = parsed.hookSpecificOutput?.additionalContext ?? "";
});

afterAll(() => {
  if (sandbox) removeOnceReleased(sandbox);
});

// Codex's AGENTS.md is plain text with no @imports, and no digest file is
// written for it, so the SessionStart hook is its only route to these.
describe("LoadContext on Codex", () => {
  test("hands over the self-model", () => {
    expect(additionalContext).toContain("Codex self-model marker");
  });

  test("hands over the wisdom principles", () => {
    expect(additionalContext).toContain("Codex wisdom marker");
  });

  test("hands over the steering rules", () => {
    expect(additionalContext).toContain("Codex steering marker");
  });
});
