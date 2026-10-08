import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg } from "../hooks/lib/paths";

export interface Release {
  tag_name: string;
  body?: string | null;
}

export interface WhatsNew {
  items: string[];
  more: number;
  url: string;
}

const SHOWN = 3;

function parts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number);
}

export function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** "* **rating:** confirm corrections ([abc](url))" reads "Confirm corrections". */
export function noteText(bullet: string): string {
  const text = bullet
    .replace(/^\s*[*-]\s*/, "")
    .replace(/^\*\*[^*]+:\*\*\s*/, "")
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function section(body: string, heading: string): string[] {
  const start = body.indexOf(`### ${heading}`);
  if (start < 0) return [];
  const rest = body.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((line) => /^\s*[*-]\s/.test(line))
    .map(noteText);
}

export function releaseNotes(body: string): string[] {
  return [...section(body, "Features"), ...section(body, "Bug Fixes")];
}

function repoSlug(pkg = palPkg()): string | null {
  try {
    const manifest = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8")) as {
      repository?: { url?: string };
    };
    return (
      /github\.com\/([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? "")?.[1] ?? null
    );
  } catch {
    return null;
  }
}

export function summarizeReleases(
  releases: Release[],
  from: string,
  to: string,
  slug: string
): WhatsNew | null {
  const items = releases
    .filter((r) => newer(r.tag_name, from) && !newer(r.tag_name, to))
    .flatMap((r) => releaseNotes(r.body ?? ""));
  if (items.length === 0) return null;
  return {
    items: items.slice(0, SHOWN),
    more: Math.max(0, items.length - SHOWN),
    url: `github.com/${slug}/releases/tag/v${to}`,
  };
}

async function fetchReleases(slug: string): Promise<Release[]> {
  const response = await fetch(
    `https://api.github.com/repos/${slug}/releases?per_page=30`,
    {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(3000),
    }
  );
  return response.ok ? ((await response.json()) as Release[]) : [];
}

/** Null when the notes cannot be fetched in time: an update never waits on GitHub. */
export async function whatsNew(
  from: string,
  to: string,
  fetchAll: (slug: string) => Promise<Release[]> = fetchReleases
): Promise<WhatsNew | null> {
  const slug = repoSlug();
  if (!slug) return null;
  try {
    return summarizeReleases(await fetchAll(slug), from, to, slug);
  } catch {
    return null;
  }
}
