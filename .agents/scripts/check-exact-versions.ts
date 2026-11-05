import { readFileSync } from "node:fs";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

type Manifest = Partial<Record<string, unknown>>;

interface NonExactVersion {
  section: (typeof DEPENDENCY_SECTIONS)[number];
  name: string;
  version: string;
}

export function nonExactVersions(manifest: Manifest): NonExactVersion[] {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries((manifest[section] ?? {}) as Record<string, string>)
      .filter(([, version]) => !EXACT_SEMVER.test(version))
      .map(([name, version]) => ({ section, name, version }))
  );
}

if (import.meta.main) {
  const offenders = nonExactVersions(JSON.parse(readFileSync("package.json", "utf8")));
  if (offenders.length === 0) {
    process.stdout.write("Every dependency in package.json is pinned exactly.\n");
    process.exit(0);
  }
  const lines = offenders.map((o) => `  ${o.section}: ${o.name} ${o.version}`);
  process.stderr.write(
    `package.json has dependencies without an exact version:\n${lines.join("\n")}\n` +
      "Pin each to the version bun.lock resolves (bun add --exact <name>@<version>).\n"
  );
  process.exit(1);
}
