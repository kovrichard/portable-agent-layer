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
 *         agent: codex                                # optional; default is the active agent
 *         system: eval/<name>/generated/system.txt   # repo-relative
 *         schema: eval/<name>/generated/schema.json  # repo-relative, optional
 */

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = resolve(__dirname, "../..");
const CLI = resolve(REPO, "src/cli/index.ts");
const TIMEOUT_SECONDS = 120;

function inferEnv(agent) {
  return { ...process.env, CLAUDECODE: undefined, ...(agent && { PAL_AGENT: agent }) };
}

function plannedRoute(config) {
  const args = [CLI, "cli", "infer", "--route", "--tier", config.tier ?? "small"];
  args.push("--caller", config.caller ?? "eval");
  const result = spawnSync("bun", args, {
    encoding: "utf-8",
    env: inferEnv(config.agent),
  });
  if (result.status !== 0)
    throw new Error((result.stderr ?? "").trim() || "pal cli infer --route failed");
  const plan = JSON.parse(result.stdout);
  if (config.agent && plan.agent !== config.agent) {
    throw new Error(`Unknown agent "${config.agent}": PAL fell back to ${plan.agent}`);
  }
  return plan;
}

function routeTag(plan) {
  return plan.model ? `${plan.agent}:${plan.model}` : plan.agent;
}

function repoFile(path) {
  if (!path) return undefined;
  const file = resolve(REPO, path);
  if (!existsSync(file)) throw new Error(`${path} is missing: build it before the eval`);
  return file;
}

function inferArgs(config) {
  const args = [CLI, "cli", "infer"];
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
    this.plan = plannedRoute(this.config);
    this.label = `${options.label ?? this.config.tier ?? "small"}@${routeTag(this.plan)}`;
  }

  id() {
    return `pal-infer:${this.config.tier ?? "small"}@${routeTag(this.plan)}`;
  }

  callApi(prompt) {
    const started = Date.now();
    const result = spawnSync("bun", inferArgs(this.config), {
      input: prompt,
      encoding: "utf-8",
      timeout: (TIMEOUT_SECONDS + 15) * 1000,
      env: inferEnv(this.plan.agent),
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
