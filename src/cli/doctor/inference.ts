import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { previewInferenceRoute } from "../../hooks/lib/inference";
import { opencodeBackgroundModel } from "../../hooks/lib/opencode-config";
import { palEnvPath, readPalEnvFile } from "../../hooks/lib/pal-env";
import { platform } from "../../hooks/lib/paths";
import type { AgentName } from "./agents";
import { type Finding, failing, optional, passed, warning } from "./finding";

type Env = Record<string, string | undefined>;

const SUBPROCESS_ONLY = {
  PAL_SPAWNED_INFERENCE: "every inference call refuses",
  PAL_INFERENCE_DEPTH: "the depth breaker fires on the first call",
  PAL_INFERENCE_DISABLED: "every inference call fails",
} as const;

const INFERENCE_KEYS = {
  PAL_ANTHROPIC_API_KEY: "fallback when the claude CLI cannot answer",
  PAL_OPENAI_API_KEY: "fallback when the codex CLI cannot answer",
} as const;

const SKILL_KEYS = [
  "PAL_GEMINI_API_KEY",
  "PAL_XAI_API_KEY",
  "PAL_PERPLEXITY_API_KEY",
  "PAL_FYZZ_API_KEY",
  "PAL_FYZZ_BASE_URL",
] as const;

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
            external: true,
          }
        )
      : passed(`env.${name}`, `${name} not set`)
  );
}

function shellKeyConsequence(shellValue: string, fileValue: string | undefined): string {
  if (fileValue === undefined)
    return "so agents launched outside a terminal never see it";
  if (fileValue === shellValue) return `and duplicated in ${palEnvPath()}`;
  return `and overrides the different value in ${palEnvPath()}`;
}

function shellKeyFinding(name: string, shellValue: string, fileValue?: string): Finding {
  return warning(
    `key.${name}`,
    `${name} is set in your shell, ${shellKeyConsequence(shellValue, fileValue)}`,
    {
      say:
        fileValue === undefined
          ? `Move it to ${palEnvPath()} and remove it from your shell profile`
          : "Remove it from your shell profile",
    }
  );
}

function keyFinding(
  name: string,
  shell: Env,
  file: Record<string, string>,
  ifUnset: () => Finding | null
): Finding | null {
  const shellValue = shell[name];
  if (shellValue) return shellKeyFinding(name, shellValue, file[name]);
  if (file[name]) return passed(`key.${name}`, `${name} set`);
  return ifUnset();
}

export function apiKeyFindings(
  shell: Env,
  file: Record<string, string> = readPalEnvFile()
): Finding[] {
  const inference = Object.entries(INFERENCE_KEYS).map(([name, unlocks]) =>
    keyFinding(name, shell, file, () =>
      optional(`key.${name}`, `${name} — ${unlocks}`, {
        say: `add it to ${palEnvPath()}`,
      })
    )
  );
  const skills = SKILL_KEYS.map((name) => keyFinding(name, shell, file, () => null));
  return [...inference, ...skills].filter((f): f is Finding => f !== null);
}

const OAUTH_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";

function isMalformedToken(value: string): boolean {
  return value === "" || /[\s"']/.test(value);
}

/** Silent unless a token is set; it is optional, and the native login needs none of this. */
export function oauthTokenFindings(
  shell: Env,
  file: Record<string, string> = readPalEnvFile()
): Finding[] {
  const shellToken = shell[OAUTH_TOKEN];
  const fileToken = file[OAUTH_TOKEN];
  if (shellToken === undefined && fileToken === undefined) return [];
  const findings: Finding[] = [];
  if ([shellToken, fileToken].some((t) => t !== undefined && isMalformedToken(t)))
    findings.push(
      warning("oauth.malformed", `${OAUTH_TOKEN} is empty or contains spaces or quotes`, {
        say: `Paste the token from 'claude setup-token' as a bare value in ${palEnvPath()}`,
      })
    );
  if (shellToken && fileToken && shellToken !== fileToken)
    findings.push(
      warning(
        "oauth.shadowed",
        `Your shell's ${OAUTH_TOKEN} differs from the one in ${palEnvPath()}, and the shell's wins`,
        {
          say: "Keep one copy: drop it from your shell, or have your shell read it from the file",
        }
      )
    );
  return findings.length > 0 ? findings : [passed("oauth", `${OAUTH_TOKEN} set`)];
}

type Preview = ReturnType<typeof previewInferenceRoute>;

function modelSuffix(preview: Preview): string {
  return preview.model ? ` on ${preview.model}` : "";
}

export function routeFinding(preview: Preview = previewInferenceRoute()): Finding | null {
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
      `Background inference goes through ${preview.route}${modelSuffix(preview)} (${preview.reason}) — it bills the API key`,
      { say: "Put the agent's CLI on PATH to use your subscription instead" }
    );
  return passed(
    "inference",
    `Inference: ${preview.route}${modelSuffix(preview)} (${preview.reason})`
  );
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

function aboutField(about: string, field: string): string | null {
  const line = about.split("\n").find((l) => l.startsWith(`${field} `));
  return line ? line.slice(field.length).trim() || null : null;
}

/** Cursor's free plan refuses every named model, so a pinned one fails all background inference. */
export function cursorPlanFinding(about: string): Finding | null {
  const model = aboutField(about, "Model");
  const tier = aboutField(about, "Subscription Tier");
  if (!model || !tier) return null;
  if (tier === "Free" && model !== "Auto")
    return warning(
      "cursor.model",
      `Cursor is set to ${model}, but its free plan only runs Auto — background inference fails`,
      { say: "Switch Cursor's model to Auto, or upgrade the plan" }
    );
  return passed("cursor.model", `Cursor model ${model} runs on the ${tier} plan`);
}

function cursorAbout(): string {
  const result = spawnSync("cursor-agent", ["about"], {
    encoding: "utf-8",
    shell: true,
    timeout: 15_000,
  });
  return result.status === 0 ? result.stdout : "";
}

function cursorFindings(): Finding[] {
  const finding = cursorPlanFinding(cursorAbout());
  return finding ? [finding] : [];
}

export function inferenceFindings(agents: AgentName[]): Finding[] {
  const route = routeFinding();
  return [
    ...(route ? [route] : []),
    ...(agents.includes("opencode") ? [opencodeModelFinding()] : []),
    ...(agents.includes("cursor") ? cursorFindings() : []),
    ...leakedEnvFindings(process.env, process.platform),
    ...apiKeyFindings(process.env),
    ...oauthTokenFindings(process.env),
  ];
}
