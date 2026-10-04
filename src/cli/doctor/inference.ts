import { resolve } from "node:path";
import { previewInferenceRoute } from "../../hooks/lib/inference";
import { opencodeBackgroundModel } from "../../hooks/lib/opencode-config";
import { platform } from "../../hooks/lib/paths";
import type { AgentName } from "./agents";
import { type Finding, failing, optional, passed, warning } from "./finding";

type Env = Record<string, string | undefined>;

const SUBPROCESS_ONLY = {
  PAL_SPAWNED_INFERENCE: "every inference call refuses",
  PAL_INFERENCE_DEPTH: "the depth breaker fires on the first call",
  PAL_INFERENCE_DISABLED: "every inference call fails",
} as const;

const API_KEYS = {
  PAL_ANTHROPIC_API_KEY: "fallback when the claude CLI cannot answer",
  PAL_OPENAI_API_KEY: "fallback when the codex CLI cannot answer",
  PAL_GEMINI_API_KEY: "YouTube analysis and Gemini research",
  PAL_XAI_API_KEY: "the Grok researcher",
  PAL_PERPLEXITY_API_KEY: "the Perplexity researcher",
} as const;

function unsetCommand(name: string, os: NodeJS.Platform): string {
  return os === "win32" ? `Remove-Item Env:${name}` : `unset ${name}`;
}

export function leakedEnvFindings(env: Env, os: NodeJS.Platform): Finding[] {
  return Object.entries(SUBPROCESS_ONLY).map(([name, effect]) =>
    env[name]
      ? failing(
          `env.${name}`,
          `${name}=${env[name]} leaked into your shell — ${effect}`,
          {
            say: "Clear it, and remove it from your shell profile if it is set there",
            command: unsetCommand(name, os),
          }
        )
      : passed(`env.${name}`, `${name} not set`)
  );
}

export function apiKeyFindings(env: Env): Finding[] {
  return Object.entries(API_KEYS).map(([name, unlocks]) =>
    env[name]
      ? passed(`key.${name}`, `${name} set`)
      : optional(`key.${name}`, `${name} — ${unlocks}`, {
          say: "set it in your shell profile",
        })
  );
}

function routeFinding(): Finding | null {
  const preview = previewInferenceRoute();
  if (preview.route === "disabled") return null;
  if (preview.route === "none")
    return failing(
      "inference.none",
      `Background inference has no route for ${preview.agent} — ${preview.reason}`,
      { say: "Install the agent's CLI, or set an API key PAL can fall back to" }
    );
  if (preview.route.endsWith("-api"))
    return warning(
      "inference.api",
      `Background inference goes through ${preview.route} (${preview.reason}) — it bills the API key`,
      { say: "Put the agent's CLI on PATH to use your subscription instead" }
    );
  return passed("inference", `Inference: ${preview.route} (${preview.reason})`);
}

function opencodeModelFinding(): Finding {
  return opencodeBackgroundModel()
    ? passed("opencode.model", "opencode background model pinned")
    : warning(
        "opencode.model",
        "opencode background model is not pinned — background inference uses whatever the TUI last picked",
        {
          say: `Pin one with "model" in ${resolve(platform.opencodeDir(), "config.json")}`,
        }
      );
}

export function inferenceFindings(agents: AgentName[]): Finding[] {
  const route = routeFinding();
  return [
    ...(route ? [route] : []),
    ...(agents.includes("opencode") ? [opencodeModelFinding()] : []),
    ...leakedEnvFindings(process.env, process.platform),
    ...apiKeyFindings(process.env),
  ];
}
