export function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  if (trimmed === "true") return true;

  if (trimmed === "false") return false;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

export function parseStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "[]") return [];

  if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];

  return splitOutsideQuotes(inner).map((piece) => String(parseScalar(piece)));
}

function splitOutsideQuotes(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inStr = false;
  let esc = false;

  for (const ch of inner) {
    if (esc) {
      buf += ch;
      esc = false;
      continue;
    }

    if (ch === "\\" && inStr) {
      buf += ch;
      esc = true;
      continue;
    }

    if (ch === '"') {
      inStr = !inStr;
      buf += ch;
      continue;
    }

    if (ch === "," && !inStr) {
      out.push(buf);
      buf = "";
      continue;
    }

    buf += ch;
  }

  if (buf.trim() !== "") out.push(buf);

  return out;
}
