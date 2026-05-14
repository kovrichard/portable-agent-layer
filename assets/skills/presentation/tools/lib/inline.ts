import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function dataUri(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  let mime = "application/octet-stream";
  if (ext === ".svg") mime = "image/svg+xml";
  else if (ext === ".png") mime = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
  else if (ext === ".webp") mime = "image/webp";

  if (ext === ".svg") {
    // Inline SVGs as URL-encoded text — smaller than base64 and renders crisply at any size.
    const svg = await readFile(path, "utf8");
    const enc = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
    return `url("data:${mime};utf8,${enc}")`;
  }

  const buf = await readFile(path);
  return `url("data:${mime};base64,${buf.toString("base64")}")`;
}

// Escape literal "</textarea>" inside markdown so it doesn't terminate the data-template wrapper.
export function escapeForTextarea(content: string): string {
  return content.replace(/<\/textarea>/gi, "<\\/textarea>");
}
