import { describe, expect, test } from "bun:test";
import {
  type BlobPlace,
  fileId,
  type Manifest,
  openBlob,
  randomKey,
  SyncCryptoError,
  sealBlob,
  signManifest,
  unwrapDataKey,
  verifyManifest,
  wrapDataKey,
} from "../src/sync/crypto";

const text = (s: string) => new TextEncoder().encode(s);
const PLACE: BlobPlace = { fileId: "f1", machine: "m1", seq: 3 };

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;

    return "none";
  } catch (err) {
    return err instanceof SyncCryptoError ? err.failure : `other: ${err}`;
  }
}

describe("blobs", () => {
  test("a sealed blob opens back to its plaintext, and differs each time", async () => {
    const key = randomKey();
    const first = await sealBlob(key, text("line\n"), PLACE);
    const second = await sealBlob(key, text("line\n"), PLACE);

    expect(new TextDecoder().decode(await openBlob(key, first, PLACE))).toBe("line\n");
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    expect(Buffer.from(first).includes(Buffer.from("line"))).toBe(false);
  });

  test("a blob with one flipped bit is rejected as tampered", async () => {
    const key = randomKey();
    const blob = await sealBlob(key, text("line\n"), PLACE);
    blob[blob.length - 1] ^= 1;

    expect(await failureOf(openBlob(key, blob, PLACE))).toBe("tampered");
  });

  for (const [what, place] of [
    ["another file", { ...PLACE, fileId: "f2" }],
    ["another machine", { ...PLACE, machine: "m2" }],
    ["another position", { ...PLACE, seq: 4 }],
  ] as const)
    test(`a blob served as ${what} is rejected`, async () => {
      const key = randomKey();
      const blob = await sealBlob(key, text("line\n"), PLACE);

      expect(await failureOf(openBlob(key, blob, place))).toBe("tampered");
    });

  test("a blob does not open with another file's key", async () => {
    const blob = await sealBlob(randomKey(), text("line\n"), PLACE);

    expect(await failureOf(openBlob(randomKey(), blob, PLACE))).toBe("tampered");
  });
});

describe("data keys", () => {
  test("a wrapped key unwraps only with the account key, for its own file", async () => {
    const account = randomKey();
    const dataKey = randomKey();
    const wrapped = await wrapDataKey(account, dataKey, "f1");

    expect(Buffer.from(await unwrapDataKey(account, wrapped, "f1"))).toEqual(
      Buffer.from(dataKey)
    );
    expect(await failureOf(unwrapDataKey(account, wrapped, "f2"))).toBe("tampered");
    expect(await failureOf(unwrapDataKey(randomKey(), wrapped, "f1"))).toBe("tampered");
  });
});

describe("file ids", () => {
  test("are stable per account and path, and reveal neither", async () => {
    const account = randomKey();
    const id = await fileId(account, "memory/relationship/notes.md");

    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await fileId(account, "memory/relationship/notes.md")).toBe(id);
    expect(await fileId(account, "memory/knowledge/notes.md")).not.toBe(id);
    expect(await fileId(randomKey(), "memory/relationship/notes.md")).not.toBe(id);
  });
});

describe("manifests", () => {
  const manifest: Manifest = { machine: "m1", counter: 5, files: { f1: 3, f0: 9 } };

  test("a signed manifest verifies, whatever order its files are listed in", async () => {
    const account = randomKey();
    const signed = await signManifest(account, manifest);
    const reordered = { ...signed, manifest: { ...manifest, files: { f0: 9, f1: 3 } } };

    expect(await verifyManifest(account, signed, 5)).toEqual(manifest);
    expect(await verifyManifest(account, reordered)).toEqual(reordered.manifest);
  });

  test("an edited manifest fails its signature", async () => {
    const account = randomKey();
    const signed = await signManifest(account, manifest);
    const edited = { ...signed, manifest: { ...manifest, files: { f1: 2, f0: 9 } } };

    expect(await failureOf(verifyManifest(account, edited))).toBe("bad-signature");
    expect(await failureOf(verifyManifest(randomKey(), signed))).toBe("bad-signature");
  });

  test("a manifest older than the last one seen is a rollback", async () => {
    const account = randomKey();
    const signed = await signManifest(account, manifest);

    expect(await failureOf(verifyManifest(account, signed, 6))).toBe("rollback");
  });
});
