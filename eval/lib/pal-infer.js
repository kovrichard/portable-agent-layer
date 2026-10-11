/**
 * A promptfoo provider that runs each case through `pal cli infer`, so the eval
 * takes the same route, tier-to-model mapping and hook isolation as PAL's own
 * background calls, on whichever agent is active on this machine.
 *
 * Usage in a config:
 *   providers:
 *     - id: file://../lib/pal-infer.js
 *       label: medium
 *       config:
 *         tier: medium
 *         system: eval/<name>/generated/system.txt   # repo-relative
 *         schema: eval/<name>/generated/schema.json  # repo-relative, optional
 */

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = resolve(__dirname, "../..");
const TIMEOUT_SECONDS = 120;

function repoFile(path) {
  if (!path) return undefined;
  const file = resolve(REPO, path);
  if (!existsSync(file)) throw new Error(`${path} is missing: build it before the eval`);
  return file;
}

function inferArgs(config) {
  const args = [resolve(REPO, "src/cli/index.ts"), "cli", "infer"];
  args.push("--tier", config.tier ?? "small", "--timeout", String(TIMEOUT_SECONDS));
  args.push("--caller", config.caller ?? "eval");
  const system = repoFile(config.system);
  if (system) args.push("--system", system);
  const schema = repoFile(config.schema);
  if (schema) args.push("--schema", schema);
  return args;
}

class PalInferProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.label = options.label ?? this.config.tier ?? "small";
  }

  id() {
    return `pal-infer:${this.config.tier ?? "small"}`;
  }

  callApi(prompt) {
    const started = Date.now();
    const result = spawnSync("bun", inferArgs(this.config), {
      input: prompt,
      encoding: "utf-8",
      timeout: (TIMEOUT_SECONDS + 15) * 1000,
      env: { ...process.env, CLAUDECODE: undefined },
    });
    const latencyMs = Date.now() - started;
    if (result.error) return Promise.resolve({ error: String(result.error), latencyMs });
    if (result.status !== 0) {
      const reason =
        (result.stderr ?? "").trim() || `pal cli infer exited ${result.status}`;
      return Promise.resolve({ error: reason, latencyMs });
    }
    return Promise.resolve({ output: (result.stdout ?? "").trim(), latencyMs });
  }
}

module.exports = PalInferProvider;
