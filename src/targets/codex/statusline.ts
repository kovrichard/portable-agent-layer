const PAL_CODEX_STATUS_LINE = [
  "model-with-reasoning",
  "context-remaining",
  "context-used",
  "five-hour-limit",
  "weekly-limit",
  "git-branch",
  "used-tokens",
  "thread-id",
  "current-dir",
  "codex-version",
] as const;

function codexStatusLineToml(): string {
  const quotedItems = PAL_CODEX_STATUS_LINE.map((item) => JSON.stringify(item)).join(
    ", "
  );
  return `tui.status_line = [${quotedItems}]\ntui.status_line_use_colors = true\n`;
}

function hasCodexStatusLine(content: string): boolean {
  return /^[ \t]*(?:tui\.)?status_line[ \t]*=/m.test(content);
}

/** Add Codex TUI status-line defaults unless the user already configured one. */
export function addCodexStatuslineConfig(content: string): string {
  if (hasCodexStatusLine(content)) return content;

  const block = codexStatusLineToml();
  if (content.trim() === "") return block;

  const firstTable = content.search(/^[ \t]*\[/m);
  if (firstTable === -1) {
    return `${content}${content.endsWith("\n") ? "" : "\n"}${block}`;
  }

  const before = content.slice(0, firstTable);
  const after = content.slice(firstTable);
  return `${before}${before.endsWith("\n") || before === "" ? "" : "\n"}${block}\n${after}`;
}

/** Remove PAL's default Codex status-line config if it still matches exactly. */
export function removeCodexStatuslineConfig(content: string): string {
  const lines = content.split("\n");
  const statusLine = codexStatusLineToml().trim().split("\n")[0];
  const colors = codexStatusLineToml().trim().split("\n")[1];
  const filtered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    const next = lines[i + 1]?.trim();
    if (line === statusLine && next === colors) {
      i++;
      continue;
    }
    filtered.push(lines[i] ?? "");
  }

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n");
}
