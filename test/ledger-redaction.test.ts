import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The point of this suite is the false positives. A denylist that redacts .env
// is trivial; one that also redacts the ten committed .env.sample files and the
// source files named credentials-*.test.ts has quietly cost the ledger the
// deltas it exists to hold. Both directions are asserted.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-redact-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(async () => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
  (await import("../src/hooks/lib/settings")).reload();
});

async function sensitive() {
  return (await import("../src/hooks/lib/sensitive-path")).isSensitivePath;
}

async function withUserPatterns(patterns: unknown) {
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({ ledger: { redactPaths: patterns } }),
    "utf-8"
  );
  (await import("../src/hooks/lib/settings")).reload();
}

function entries(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("isSensitivePath — the floor redacts", () => {
  // One example per entry in the floor, each chosen so no other rule would
  // also catch it — otherwise dropping an entry leaves the suite green.
  const SECRET = [
    "/work/app/.env",
    "/work/app/.env.local",
    "/work/app/.env.production",
    "/work/app/.envrc",
    "/work/app/.npmrc",
    "/work/app/.netrc",
    "/work/app/_netrc",
    "/work/app/.pgpass",
    "/work/app/.htpasswd",
    "/work/app/creds/credentials",
    "/work/app/certs/server.pem",
    "/work/app/certs/server.key",
    "/work/app/certs/bundle.p12",
    "/work/app/certs/bundle.P12",
    "/work/app/certs/store.pfx",
    "/work/app/certs/store.keystore",
    "/work/app/certs/store.jks",
    "/work/app/certs/pub.asc",
    "/work/app/certs/secring.gpg",
    "/work/app/vault.kdbx",
    "/work/keys/id_rsa",
    "/work/keys/id_dsa",
    "/work/keys/id_ecdsa",
    "/work/keys/id_ecdsa_sk",
    "/work/keys/id_ed25519",
    "/work/keys/id_ed25519_sk",
    "/home/u/.ssh/config",
    "/home/u/.gnupg/gpg.conf",
    "/home/u/.aws/config",
    "/home/u/.docker/config.json",
    "/home/u/.kube/config",
    "/home/u/.gcloud/access_tokens.db",
    "/home/u/.azure/azureProfile.json",
    "/home/u/.config/gh/hosts.yml",
    "/home/u/.config/gcloud/application_default.json",
    "/home/u/.local/share/keyrings/login.keyring",
  ];

  for (const path of SECRET) {
    test(`redacts ${path}`, async () => {
      expect((await sensitive())(path)).toBe(true);
    });
  }

  test("redacts a Windows-separated path the same way", async () => {
    expect((await sensitive())("C:\\Users\\u\\.ssh\\id_rsa")).toBe(true);
  });

  test("an empty path is not sensitive", async () => {
    expect((await sensitive())("")).toBe(false);
  });

  test("a directory pair only matches under its parent", async () => {
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/gh/hosts.yml")).toBe(false);
    expect(isSensitive("/work/app/share/keyrings/login.keyring")).toBe(false);
  });
});

describe("isSensitivePath — the floor leaves ordinary files alone", () => {
  const ORDINARY = [
    "/work/app/.env.sample",
    "/work/app/.env.example",
    "/work/app/.env.template",
    "/work/app/.env.dist",
    "/work/app/.env.defaults",
    "/work/app/test/credentials-connect.test.ts",
    "/work/app/src/credentials.ts",
    "/work/app/src/id_generator.ts",
    "/work/app/src/keychain.ts",
    "/work/app/docs/environment.md",
    "/work/app/src/index.ts",
    "/work/app/package.json",
    "/work/app/src/id_ed25519_parser.ts",
    "/work/app/src/local/share/keyrings.ts",
    "/work/app/config/gh-actions.yml",
  ];

  for (const path of ORDINARY) {
    test(`keeps ${path}`, async () => {
      expect((await sensitive())(path)).toBe(false);
    });
  }
});

describe("isSensitivePath — the user list is additive", () => {
  test("a user pattern redacts a path the floor does not cover", async () => {
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/config/secrets.yaml")).toBe(false);

    await withUserPatterns(["**/config/secrets.yaml"]);
    expect((await sensitive())("/work/app/config/secrets.yaml")).toBe(true);
  });

  test("a bare filename pattern matches without the caller knowing the shape", async () => {
    await withUserPatterns(["*.secret"]);
    expect((await sensitive())("/work/app/deep/nested/token.secret")).toBe(true);
  });

  test("an empty user list changes nothing", async () => {
    await withUserPatterns([]);
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/.env")).toBe(true);
    expect(isSensitive("/work/app/.env.sample")).toBe(false);
  });

  test("a user list cannot remove anything from the floor", async () => {
    await withUserPatterns(["!.env", "!**/.ssh/**", ".env.sample"]);
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/.env")).toBe(true);
    expect(isSensitive("/home/u/.ssh/id_rsa")).toBe(true);
  });

  test("a malformed user list is ignored and the floor still holds", async () => {
    await withUserPatterns({ nope: true });
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/.env")).toBe(true);
    expect(isSensitive("/work/app/src/index.ts")).toBe(false);
  });

  test("a non-string entry is skipped without taking the rest of the list with it", async () => {
    await withUserPatterns([42, "*.secret", null]);
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/token.secret")).toBe(true);
    expect(isSensitive("/work/app/src/index.ts")).toBe(false);
  });

  test("a malformed glob matches nothing and does not take the list with it", async () => {
    await withUserPatterns(["[", "{a", "*.secret"]);
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/token.secret")).toBe(true);
    expect(isSensitive("/work/app/src/index.ts")).toBe(false);
  });

  test("an empty pattern is dropped instead of matching everything", async () => {
    await withUserPatterns(["", "*.secret"]);
    const isSensitive = await sensitive();
    expect(isSensitive("/work/app/src/index.ts")).toBe(false);
    expect(isSensitive("/work/app/token.secret")).toBe(true);
  });
});

describe("recordAction on a sensitive target", () => {
  const SECRET_EDIT = {
    tool: "Edit",
    target: "/work/app/.env",
    outcome: "applied" as const,
    before: "API_KEY=old-secret-value\n",
    after: "API_KEY=new-secret-value\n",
  };

  test("writes no part of the content to the ledger", async () => {
    const { recordAction, ledgerPath } = await import("../src/hooks/lib/ledger");
    recordAction(SECRET_EDIT);
    const raw = readFileSync(ledgerPath(), "utf-8");
    expect(raw).not.toContain("old-secret-value");
    expect(raw).not.toContain("new-secret-value");
    expect(raw).not.toContain("API_KEY");
  });

  test("marks the delta redacted with no hunks", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction(SECRET_EDIT);
    expect(entry.delta).toEqual({ hunks: [], redacted: true });
  });

  test("keeps both hashes and byte counts", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction(SECRET_EDIT);
    const hashOf = (s: string) =>
      new Bun.CryptoHasher("sha256").update(s, "utf-8").digest("hex");

    expect(entry.before).toEqual({
      hash: hashOf(SECRET_EDIT.before),
      bytes: Buffer.byteLength(SECRET_EDIT.before),
    });
    expect(entry.after).toEqual({
      hash: hashOf(SECRET_EDIT.after),
      bytes: Buffer.byteLength(SECRET_EDIT.after),
    });
  });

  test("keeps the tool, outcome, target and attribution", async () => {
    const { recordAction, ledgerPath } = await import("../src/hooks/lib/ledger");
    recordAction(SECRET_EDIT);
    const [row] = entries(ledgerPath());
    expect(row.tool).toBe("Edit");
    expect(row.outcome).toBe("applied");
    expect(row.target).toBe("/work/app/.env");
    expect(String(row.actor).length).toBeGreaterThan(0);
    expect(String(row.machine).length).toBeGreaterThan(0);
  });

  test("is redacted on a denied outcome too, so the mark tracks the path not the ending", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction({
      ...SECRET_EDIT,
      outcome: "denied",
      after: null,
      reason: "user refused",
    });
    expect(entry.delta).toEqual({ hunks: [], redacted: true });
    expect(entry.after).toBeNull();
    expect(entry.reason).toBe("user refused");
  });

  test("an ordinary target keeps its delta", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction({
      ...SECRET_EDIT,
      target: "/work/app/.env.sample",
    });
    expect(entry.delta?.redacted).toBeUndefined();
    expect(entry.delta?.hunks.length).toBeGreaterThan(0);
  });
});

describe("redacted is distinguishable from truncated", () => {
  test("a change too large is truncated, not redacted", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction({
      tool: "Write",
      target: "/work/app/src/big.ts",
      outcome: "applied",
      before: null,
      after: "x".repeat(20000),
    });
    expect(entry.delta?.truncated).toBe(true);
    expect(entry.delta?.redacted).toBeUndefined();
  });

  test("a sensitive target is redacted, not truncated", async () => {
    const { recordAction } = await import("../src/hooks/lib/ledger");
    const entry = recordAction({
      tool: "Write",
      target: "/work/app/.env",
      outcome: "applied",
      before: null,
      after: "K=v\n",
    });
    expect(entry.delta?.redacted).toBe(true);
    expect(entry.delta?.truncated).toBeUndefined();
  });

  test("applyDelta refuses a redacted delta rather than returning a wrong file", async () => {
    const { applyDelta } = await import("../src/hooks/lib/ledger");
    expect(applyDelta("API_KEY=old\n", { hunks: [], redacted: true })).toBeNull();
  });
});

describe("savePending on a sensitive target", () => {
  const SNAPSHOT = {
    toolUseId: "toolu_redact_1",
    tool: "Edit",
    target: "/work/app/.env",
    before: "API_KEY=parked-secret\n",
    ts: "2026-09-04T12:00:00.000Z",
  };

  test("writes no content to the pending file", async () => {
    const { savePending } = await import("../src/hooks/lib/ledger");
    savePending(SNAPSHOT);
    const parked = readFileSync(
      resolve(HOME, "memory", "ledger", "pending", "toolu_redact_1.json"),
      "utf-8"
    );
    expect(parked).not.toContain("parked-secret");
    expect(parked).not.toContain("API_KEY");
  });

  test("keeps the hash so the claimed entry can still name the version", async () => {
    const { savePending, claimPending } = await import("../src/hooks/lib/ledger");
    savePending(SNAPSHOT);
    const claimed = claimPending("toolu_redact_1");
    expect(claimed?.before).toBeNull();
    expect(claimed?.beforeState).toEqual({
      hash: new Bun.CryptoHasher("sha256").update(SNAPSHOT.before, "utf-8").digest("hex"),
      bytes: Buffer.byteLength(SNAPSHOT.before),
    });
  });

  test("an ordinary target parks its content unchanged", async () => {
    const { savePending, claimPending } = await import("../src/hooks/lib/ledger");
    savePending({
      ...SNAPSHOT,
      toolUseId: "toolu_plain_1",
      target: "/work/app/src/a.ts",
    });
    const claimed = claimPending("toolu_plain_1");
    expect(claimed?.before).toBe(SNAPSHOT.before);
    expect(claimed?.beforeState).toBeUndefined();
  });

  test("a creation on a sensitive target stays a creation", async () => {
    const { savePending, claimPending } = await import("../src/hooks/lib/ledger");
    savePending({ ...SNAPSHOT, toolUseId: "toolu_create_1", before: null });
    const claimed = claimPending("toolu_create_1");
    expect(claimed?.before).toBeNull();
    expect(claimed?.beforeState).toBeUndefined();
  });

  test("the withheld hash reaches the entry recordAction writes", async () => {
    const { savePending, claimPending, recordAction } = await import(
      "../src/hooks/lib/ledger"
    );
    savePending(SNAPSHOT);
    const claimed = claimPending("toolu_redact_1");
    const entry = recordAction({
      tool: "Edit",
      target: "/work/app/.env",
      outcome: "applied",
      before: claimed?.before ?? null,
      beforeState: claimed?.beforeState,
      after: "API_KEY=next\n",
    });
    expect(entry.before).toEqual({
      hash: new Bun.CryptoHasher("sha256").update(SNAPSHOT.before, "utf-8").digest("hex"),
      bytes: Buffer.byteLength(SNAPSHOT.before),
    });
  });
});
