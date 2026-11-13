import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "../../src/hooks/lib/paths";
import { writeProject } from "../../src/hooks/lib/projects";

export const STAMP = "2026-01-02T03:04:05.000Z";

export function writeAt(file: string, content: string): string {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, content, "utf-8");

  return content;
}

export const homeFile = (...segments: string[]) => resolve(palHome(), ...segments);

export const isaFile = (slug: string) => homeFile("memory", "projects", slug, "ISA.md");

/** A project checked out in an existing folder; the remote is preset so no git call is made. */
export function boundProject(name: string, criteria?: string, folder = name): string {
  const dir = homeFile("checkouts", folder);
  mkdirSync(dir, { recursive: true });
  writeProject({
    name,
    path: dir,
    remote: `example.com/${name}`,
    status: "active",
    created: STAMP,
    updated: STAMP,
    criteria,
  });

  return dir;
}

export function unboundProject(name: string): void {
  writeProject({ name, status: "active", created: STAMP, updated: STAMP });
}

/** An ISA written before bindings existed, which still stores its own path. */
export function legacyIsa(slug: string, frontmatter: string): void {
  writeAt(
    isaFile(slug),
    `---\nname: ${slug}\n${frontmatter}\ncreated: ${STAMP}\nupdated: ${STAMP}\n---\n`
  );
}
