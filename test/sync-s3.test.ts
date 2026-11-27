import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { syncCommandWith } from "../src/cli/sync";
import { readAccount, storeConfigOf, storeWhere } from "../src/sync/account";
import { runSync } from "../src/sync/run";
import { runCommand } from "../src/tools/lib/command";
import { fakeS3 } from "./lib/fake-s3";
import { freshTestDir } from "./lib/test-home";

const GOALS = "telos/GOALS.md";
const KEY_LINE = /^ {2}([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/gm;

let dir: string;
const server = fakeS3("bucket");
const homes = { A: "", B: "" };
type Machine = keyof typeof homes;

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  homes.A = resolve(dir, "a");
  homes.B = resolve(dir, "b");
  server.reset();
  const credentials = resolve(dir, "aws-credentials");
  writeFileSync(
    credentials,
    "[pal-sync]\naws_access_key_id = AKID\naws_secret_access_key = secret\n"
  );
  process.env.AWS_SHARED_CREDENTIALS_FILE = credentials;
  process.env.AWS_CONFIG_FILE = resolve(dir, "aws-config");
});

const where = () =>
  `s3://bucket/pal?profile=pal-sync&endpoint=${encodeURIComponent(server.endpoint)}`;

function put(machine: Machine, path: string, text: string): void {
  const file = resolve(homes[machine], path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

async function cli(machine: Machine, args: string[], recoveryKey = "") {
  process.env.PAL_HOME = homes[machine];
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
  const log = spyOn(console, "log").mockImplementation(capture);
  const error = spyOn(console, "error").mockImplementation(capture);

  try {
    const command = syncCommandWith({
      home: () => homes[machine],
      readRecoveryKey: async () => recoveryKey,
      sync: runSync,
    });
    const code = await runCommand(command, args, ["pal", "cli", "sync"]);

    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const keyIn = (out: string) => (out.match(KEY_LINE) ?? []).map((l) => l.trim()).join("-");

describe("an S3 store named on the command line", () => {
  test("keeps the bucket, the prefix without slashes, the profile and the endpoint", () => {
    expect(
      storeConfigOf("s3://my-bucket//pal/sync/?profile=p&endpoint=http://x:9", String)
    ).toEqual({
      kind: "s3",
      bucket: "my-bucket",
      prefix: "pal/sync",
      profile: "p",
      endpoint: "http://x:9",
    });
  });

  test("leaves out the settings it was not given", () => {
    expect(storeConfigOf("s3://my-bucket", String)).toEqual({
      kind: "s3",
      bucket: "my-bucket",
      prefix: "",
    });
  });

  test("is written back the way it can be typed again", () => {
    for (const typed of ["s3://b/pal?profile=p", "s3://b/", where()])
      expect(storeConfigOf(storeWhere(storeConfigOf(typed, String)), String)).toEqual(
        storeConfigOf(typed, String)
      );
  });
});

describe("two machines syncing through S3", () => {
  test("set up on one, joined on the other, a file reaches the second", async () => {
    const setup = await cli("A", ["setup", "--store", where()]);
    expect(setup.code).toBe(0);
    expect(setup.out).toContain(
      `Add a machine: pal cli sync join --store s3://bucket/pal?`
    );

    expect((await cli("B", ["join", "--store", where()], keyIn(setup.out))).code).toBe(0);
    put("A", GOALS, "# Goals\n");
    expect((await cli("A", ["run"])).code).toBe(0);
    expect((await cli("B", ["run"])).code).toBe(0);

    expect(readFileSync(resolve(homes.B, GOALS), "utf-8")).toBe("# Goals\n");
    const keys = [...server.objects.keys()];
    expect(keys).toContain("pal/account/check");
    expect(keys.every((key) => key.startsWith("pal/"))).toBe(true);
  });

  test("the account file names the profile, never the key", async () => {
    await cli("A", ["setup", "--store", where()]);
    const saved = readFileSync(
      resolve(homes.A, "state", "sync", "account.json"),
      "utf-8"
    );

    expect(readAccount(homes.A)?.store).toMatchObject({
      kind: "s3",
      profile: "pal-sync",
    });
    expect(saved).not.toContain("AKID");
    expect(saved).not.toContain("secret");
  });

  test("status names the S3 store", async () => {
    await cli("A", ["setup", "--store", where()]);

    expect((await cli("A", ["status"])).out).toContain("Store: S3 s3://bucket/pal?");
  });

  test("a profile with no key is refused, naming the profile", async () => {
    const setup = await cli("A", ["setup", "--store", "s3://bucket/pal?profile=nobody"]);

    expect(setup.code).not.toBe(0);
    expect(setup.out).toContain('the AWS profile "nobody" has no access key');
  });
});
