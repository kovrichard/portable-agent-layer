/**
 * A promptfoo provider that spawns the `claude` CLI exactly the way PAL does.
 *
 * PAL's inference layer routes through claude-spawn when the binary is on PATH
 * (previewInferenceRoute reports "claude-spawn"), never through an API key. An
 * anthropic: provider would therefore be evaluating a route that does not ship.
 * This mirrors buildClaudeArgs, so the eval exercises the real one.
 *
 * Usage in a config:
 *   providers:
 *     - id: file://../lib/claude-cli.js
 *       label: sonnet-5
 *       config: { model: claude-sonnet-5 }
 */

const { spawnSync } = require("node:child_process");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 120000;

class ClaudeCliProvider {
  constructor(options = {}) {
    this.model = options.config?.model ?? DEFAULT_MODEL;
    this.label = options.label ?? this.model;
  }

  id() {
    return `claude-cli:${this.model}`;
  }

  callApi(prompt) {
    const result = spawnSync(
      "claude",
      [
        "--print",
        "--model",
        this.model,
        "--tools",
        "",
        "--output-format",
        "text",
        "--setting-sources",
        "",
      ],
      {
        input: prompt,
        encoding: "utf-8",
        timeout: TIMEOUT_MS,
        env: { ...process.env, CLAUDECODE: undefined },
      }
    );

    if (result.error) return Promise.resolve({ error: String(result.error) });
    if (result.status !== 0) {
      return Promise.resolve({
        error: result.stderr || `claude exited ${result.status}`,
      });
    }
    return Promise.resolve({ output: (result.stdout ?? "").trim() });
  }
}

module.exports = ClaudeCliProvider;
