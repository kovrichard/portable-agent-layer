import { readFileSync } from "node:fs";

const CODEX_RULES_BEGIN = "# BEGIN PAL MANAGED CODEX RULES";
const CODEX_RULES_END = "# END PAL MANAGED CODEX RULES";

export function loadCodexRulesTemplate(templatePath: string): string {
  return readFileSync(templatePath, "utf-8").trim();
}

function stripPalCodexRules(content: string): string {
  const escapedBegin = CODEX_RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = CODEX_RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(String.raw`\n?${escapedBegin}[\s\S]*?${escapedEnd}\n?`, "g");

  return content
    .replace(block, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mergeCodexRules(existing: string, template: string): string {
  const preserved = stripPalCodexRules(existing);
  const prefix = preserved ? `${preserved}\n\n` : "";

  return `${prefix}${template.trim()}\n`;
}

export function unmergeCodexRules(existing: string): string {
  const cleaned = stripPalCodexRules(existing);

  return cleaned ? `${cleaned}\n` : "";
}
