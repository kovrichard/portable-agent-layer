import { describe, expect, test } from "bun:test";
import { awsEndpoint, s3Store } from "../src/sync/s3-store";
import { fakeS3 } from "./lib/fake-s3";

const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" };
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null);

const server = fakeS3("bucket");

function storeOn(prefix: string, pageSize?: number) {
  server.reset(pageSize);

  return s3Store({ bucket: "bucket", prefix, endpoint: server.endpoint }, credentials);
}

describe("the S3 store", () => {
  test("a put is read back from under the prefix", async () => {
    const store = storeOn("pal");
    await store.put("whole/a/1", bytes("one"));

    expect(text(await store.get("whole/a/1"))).toBe("one");
    expect([...server.objects.keys()]).toEqual(["pal/whole/a/1"]);
  });

  test("a missing name reads as null", async () => {
    expect(await storeOn("pal").get("whole/none")).toBeNull();
  });

  test("a put that may not replace is refused once the name holds a blob", async () => {
    const store = storeOn("pal");

    expect(await store.put("key/a", bytes("first"), { ifAbsent: true })).toBe(true);
    expect(await store.put("key/a", bytes("second"), { ifAbsent: true })).toBe(false);
    expect(text(await store.get("key/a"))).toBe("first");
  });

  test("only a put that may not replace asks S3 to refuse an existing key", async () => {
    const store = storeOn("pal");
    await store.put("manifest/m", bytes("1"));
    await store.put("key/a", bytes("1"), { ifAbsent: true });
    const puts = server.requests.filter((r) => r.method === "PUT");

    expect(puts.map((r) => [r.key, r.headers.get("if-none-match")])).toEqual([
      ["pal/manifest/m", null],
      ["pal/key/a", "*"],
    ]);
  });

  test("a plain put replaces", async () => {
    const store = storeOn("pal");
    await store.put("manifest/m", bytes("1"));
    await store.put("manifest/m", bytes("2"));

    expect(text(await store.get("manifest/m"))).toBe("2");
  });

  test("a failed conditional put throws instead of reading as taken", async () => {
    storeOn("pal");
    const missingBucket = s3Store(
      { bucket: "missing", prefix: "pal", endpoint: server.endpoint },
      credentials
    );

    await expect(
      missingBucket.put("key/a", bytes("1"), { ifAbsent: true })
    ).rejects.toThrow("404");
  });

  test("list returns every name under a prefix across pages, without the store prefix", async () => {
    const store = storeOn("pal/", 2);

    for (const name of ["seg/m/1", "seg/m/3", "seg/m/2", "whole/x/1", "seg/n/1"])
      await store.put(name, bytes("x"));
    server.objects.set("other/seg/m/9", bytes("x"));

    expect(await store.list("seg/")).toEqual([
      "seg/m/1",
      "seg/m/2",
      "seg/m/3",
      "seg/n/1",
    ]);
  });

  test("without a prefix, names are keys at the bucket root", async () => {
    const store = storeOn("");
    await store.put("account/check", bytes("c"), { ifAbsent: true });

    expect([...server.objects.keys()]).toEqual(["account/check"]);
    expect(await store.list("account/")).toEqual(["account/check"]);
  });

  test("AWS is reached at the region's own endpoint", () => {
    expect(awsEndpoint("eu-central-1")).toBe("https://s3.eu-central-1.amazonaws.com");
  });
});
