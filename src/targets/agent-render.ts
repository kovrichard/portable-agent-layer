/**
 * Renders one merged subagent definition into the file each agent reads:
 * Markdown with that platform's frontmatter, or a Codex agent-role TOML.
 */

import {
  type AgentDefinition,
  parseAgentDefinition,
} from "../hooks/lib/agent-definition";
import type { AgentName } from "../hooks/lib/agent-registry";

const CODEX_OWNED_KEYS = new Set(["name", "description", "developer_instructions"]);

export function agentFileName(stem: string, platform: AgentName): string {
  return `${stem}.${platform === "codex" ? "toml" : "md"}`;
}

export function renderAgentForPlatform(content: string, platform: AgentName): string {
  const definition = parseAgentDefinition(content);
  if (platform === "codex") return renderCodexAgent(definition);
  if (!definition.hasFrontmatter) return content;
  const frontmatter = [...definition.global, ...(definition.platforms[platform] ?? [])];
  return `---\n${frontmatter.join("\n")}\n---${definition.body}`;
}

function renderCodexAgent(definition: AgentDefinition): string {
  if (!definition.hasFrontmatter)
    throw new Error("no frontmatter to build a Codex agent from");
  const { name, description, ...unmapped } = yamlMapping(
    definition.global,
    "frontmatter"
  );
  rejectUnmappedGlobals(Object.keys(unmapped));
  const overrides = Object.entries(
    yamlMapping(definition.platforms.codex ?? [], "codex block")
  );
  const instructions = `${definition.body.trim()}\n`;
  const lines = [
    `name = ${tomlString(requiredText(name, "name"))}`,
    `description = ${tomlString(requiredText(description, "description"))}`,
    ...overrides.map(
      ([key, value]) => `${tomlKey(key)} = ${codexOverrideValue(key, value)}`
    ),
    `developer_instructions = ${tomlText(instructions)}`,
  ];
  return `${lines.join("\n")}\n`;
}

function yamlMapping(lines: string[], where: string): Record<string, unknown> {
  if (lines.length === 0) return {};
  const parsed = Bun.YAML.parse(lines.join("\n"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`the ${where} is not a YAML mapping`);
  }
  return parsed as Record<string, unknown>;
}

function rejectUnmappedGlobals(keys: string[]): void {
  if (keys.length === 0) return;
  throw new Error(
    `Codex has no field for global ${keys.join(", ")}; move it into a platform block`
  );
}

function requiredText(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`Codex needs a non-empty ${field}`);
}

function codexOverrideValue(key: string, value: unknown): string {
  if (CODEX_OWNED_KEYS.has(key)) {
    throw new Error(
      `codex.${key} is built from the shared definition and cannot be overridden`
    );
  }
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return `[${value.map(tomlString).join(", ")}]`;
  }
  throw new Error(`codex.${key} must be a string, number, boolean or list of strings`);
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", String.raw`\u007f`);
}

function tomlText(text: string): string {
  return fitsLiteralString(text) ? `'''\n${text}'''` : tomlString(text);
}

function fitsLiteralString(text: string): boolean {
  if (text.includes("'''")) return false;
  return Array.from(text).every((char) => {
    const code = char.charCodeAt(0);
    return char === "\t" || char === "\n" || (code >= 0x20 && code !== 0x7f);
  });
}
