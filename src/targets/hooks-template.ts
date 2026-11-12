import { readFileSync } from "node:fs";

/** Any agent's hooks template with PKG_ROOT filled in, parsed. */
export function loadHooksTemplate(
  templatePath: string,
  pkgRoot: string,
  agentLabel: string
): unknown {
  const resolved = readFileSync(templatePath, "utf-8").replaceAll(
    "{{PKG_ROOT}}",
    pkgRoot
  );
  try {
    return JSON.parse(resolved);
  } catch (e) {
    throw new Error(
      `Failed to parse ${agentLabel} hooks template at ${templatePath}: ${e}`
    );
  }
}
