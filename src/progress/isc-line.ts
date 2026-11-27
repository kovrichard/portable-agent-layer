/**
 * The markdown line an ISC is shown as: `- [ ] ISC-k7m2: text`. The escaping
 * keeps a multi-paragraph criterion on one line.
 */

export type IscStatus = "open" | "done" | "retired";

export const ISC_BOX: Record<IscStatus, string> = {
  open: "[ ]",
  done: "[x]",
  retired: "[~]",
};

export function statusFromBox(box: string): IscStatus {
  if (box.toLowerCase() === "x") return "done";

  if (box === "~") return "retired";

  return "open";
}

/** Lowercase base32 without i, l, o, u, so an id reads back unambiguously. */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export const allDigits = (id: string) => /^\d+$/.test(id);

export interface Isc {
  /** Four random characters for a new ISC; older ones keep their number. */
  id: string;
  text: string;
  status: IscStatus;
}

/**
 * An ISC is one markdown line, so a newline in its text would end the record
 * and strand every paragraph after it as unparseable debris. Backslashes are
 * escaped first so that decoding a literal "\n" in a regex cannot be mistaken
 * for the separator.
 */
export function encodeIscText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n");
}

const ISC_UNESCAPE: Record<string, string> = { n: "\n", "\\": "\\" };

export function decodeIscText(stored: string): string {
  return stored.replaceAll(/\\(.)/g, (whole, ch) => ISC_UNESCAPE[ch] ?? whole);
}

const ISC_LINE = /^-\s+\[( |x|~)\]\s+ISC-([0-9a-z]+):\s+(.+)$/i;

export function isIscLine(line: string): boolean {
  return ISC_LINE.test(line);
}

export function parseIscs(criteria: string): Isc[] {
  const out: Isc[] = [];

  for (const line of criteria.split("\n")) {
    const m = ISC_LINE.exec(line);
    if (m)
      out.push({
        id: m[2].toLowerCase(),
        text: decodeIscText(m[3].trim()),
        status: statusFromBox(m[1]),
      });
  }

  return out;
}

export function iscLine(isc: Isc): string {
  return `- ${ISC_BOX[isc.status]} ISC-${isc.id}: ${encodeIscText(isc.text)}`;
}
