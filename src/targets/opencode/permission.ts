import { palHome } from "../../hooks/lib/paths";

type OpencodeConfig = Record<string, unknown>;
type Rules = Record<string, string>;

export function palHomePattern(): string {
  return `${palHome().replaceAll("\\", "/")}/**`;
}

function externalDirectoryRules(config: OpencodeConfig): Rules {
  const permission = (config.permission ?? {}) as Record<string, unknown>;
  const rules = permission.external_directory;
  if (typeof rules === "string") return { "*": rules };
  return { ...((rules ?? {}) as Rules) };
}

function withExternalDirectoryRules(
  config: OpencodeConfig,
  rules: Rules
): OpencodeConfig {
  const permission = { ...((config.permission ?? {}) as Record<string, unknown>) };
  if (Object.keys(rules).length > 0) permission.external_directory = rules;
  else delete permission.external_directory;
  const { permission: _previous, ...rest } = config;
  return Object.keys(permission).length > 0 ? { ...rest, permission } : rest;
}

export function allowPalHome(config: OpencodeConfig, pattern: string): OpencodeConfig {
  const { [pattern]: _previous, ...rules } = externalDirectoryRules(config);
  return withExternalDirectoryRules(config, { ...rules, [pattern]: "allow" });
}

export function removePalHomeAllow(
  config: OpencodeConfig,
  pattern: string
): OpencodeConfig {
  const { [pattern]: _removed, ...rules } = externalDirectoryRules(config);
  return withExternalDirectoryRules(config, rules);
}
