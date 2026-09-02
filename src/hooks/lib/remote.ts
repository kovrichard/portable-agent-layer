/**
 * Repository identity — the one thing about a project that means the same on
 * every machine.
 *
 * A path answers "where is it here", which is why it cannot travel. A git remote
 * answers "which repository is this", which is true everywhere the repo is
 * cloned. That makes it the portable half of a project's identity, and the
 * evidence that lets PAL suggest a binding without guessing from a directory
 * name — two unrelated checkouts can share a name, but not a remote.
 *
 * Nothing has to be committed into the repo for this to work: the remote is
 * already there.
 */

import { spawnSync } from "node:child_process";

const GIT_TIMEOUT_MS = 2000;

/**
 * SSH and HTTPS clone URLs of one repository both normalize to the same value —
 * `git@github.com:owner/repo.git` becomes `github.com/owner/repo` — so the same
 * repository matches however it was cloned. Any credential embedded before the
 * host is stripped rather than stored: this value lives in a record that travels
 * in exports.
 */
export function normalizeRemote(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const scp = /^[^@/]+@([^:]+):(.+)$/.exec(trimmed);
  const withoutScheme = scp
    ? `${scp[1]}/${scp[2]}`
    : trimmed.replace(/^[a-z+]+:\/\//i, "");

  const withoutCredentials = withoutScheme.replace(/^[^@/]*@/, "");
  const cleaned = withoutCredentials
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  // A remote on the local filesystem identifies nothing portable — it is just
  // another path — so only a real host earns the right to be identity.
  const [hostWithPort, ...rest] = cleaned.split("/");
  const host = hostWithPort.split(":")[0];
  if (rest.length === 0 || rest.join("/").length === 0) return null;
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(host)) return null;
  return cleaned;
}

/** The normalized origin remote of the repo at `dir`, or null if there is none. */
export function detectRemote(dir: string): string | null {
  const res = spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (res.status !== 0 || !res.stdout) return null;
  return normalizeRemote(res.stdout);
}
