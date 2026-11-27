import { beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { directoryStore } from "../src/sync/blob-store";
import { openBlob, randomKey } from "../src/sync/crypto";
import { fileKeys } from "../src/sync/keys";
import { readSyncState } from "../src/sync/state";
import { syncOnce } from "../src/sync/sync";
import { linkDir } from "./lib/links";
import { freshTestDir } from "./lib/test-home";

const EVENTS = "records/bronze/events/2026-10.jsonl";
const GOALS = "telos/GOALS.md";

let dir: string;
let storeRoot: string;
let account: Uint8Array<ArrayBuffer>;
const homes = { A: "", B: "" };

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  storeRoot = resolve(dir, "bucket");
  homes.A = resolve(dir, "a");
  homes.B = resolve(dir, "b");
  account = randomKey();
});

function put(machine: keyof typeof homes, path: string, text: string): void {
  const file = resolve(homes[machine], path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const read = (machine: keyof typeof homes, path: string) =>
  readFileSync(resolve(homes[machine], path), "utf-8");

const lineSet = (machine: keyof typeof homes, path: string) =>
  new Set(read(machine, path).split("\n").filter(Boolean));

function sync(machine: keyof typeof homes) {
  process.env.PAL_HOME = homes[machine];

  return syncOnce({
    store: directoryStore(storeRoot),
    account,
    home: homes[machine],
    machine: `m${machine}`,
  });
}

function blobFiles(root = storeRoot): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((entry) => {
    const path = resolve(root, entry);

    return statSync(path).isDirectory() ? blobFiles(path) : [path];
  });
}

async function converge() {
  await sync("A");
  await sync("B");
  await sync("A");
}

describe("two machines", () => {
  beforeEach(() => {
    put("A", EVENTS, '{"id":"a1","type":"turn"}\n');
    put("B", EVENTS, '{"id":"b1","type":"turn"}\n');
    put("A", GOALS, "Ship sync.\n");
  });

  test("end with the same lines in append-only files and the same whole files", async () => {
    await converge();

    expect(lineSet("A", EVENTS)).toEqual(lineSet("B", EVENTS));
    expect(lineSet("B", EVENTS).has('{"id":"a1","type":"turn"}')).toBe(true);
    expect(read("B", GOALS)).toBe("Ship sync.\n");
  });

  test("settle: another run on either machine uploads and changes nothing", async () => {
    await converge();
    await converge();
    const blobs = blobFiles().length;

    for (const machine of ["A", "B", "A"] as const)
      expect(await sync(machine)).toEqual({
        pushed: 0,
        pulled: 0,
        written: [],
        quarantined: [],
        refused: [],
      });
    expect(blobFiles().length).toBe(blobs);
  });

  test("lines pulled from another machine are not uploaded back", async () => {
    await sync("A");
    await sync("B");
    const store = directoryStore(storeRoot);
    const { id, dataKey } = await fileKeys(store, account).forPath(EVENTS);
    const uploads = await store.list(`seg/mB/${id}/`);
    const uploaded = await Promise.all(
      uploads.map(async (name) => {
        const seq = Number(name.split("/").at(-1));
        const blob = (await store.get(name)) as Uint8Array<ArrayBuffer>;

        return new TextDecoder().decode(
          await openBlob(dataKey, blob, { fileId: id, machine: "mB", seq })
        );
      })
    );

    expect(uploaded.join("")).toBe('{"id":"b1","type":"turn"}\n');
    expect(readSyncState(homes.B).pushed[EVENTS].bytes).toBe(
      Buffer.byteLength(read("B", EVENTS))
    );
  });

  test("the store holds no plaintext: no line, no path, no file name", async () => {
    await converge();
    const everything = blobFiles()
      .map((file) => `${file.slice(storeRoot.length)}\n${readFileSync(file, "latin1")}`)
      .join("\n");

    for (const secret of ['"id":"a1"', "Ship sync", "GOALS", "telos", "bronze"])
      expect(everything.includes(secret)).toBe(false);
  });
});

describe("scope", () => {
  test("machine state, backups, raw transcripts and linked skills never leave", async () => {
    put("A", "memory/state/sessions.json", "{}");
    put("A", "telos/backups/GOALS.md", "old");
    put("A", "records/raw/claude/x.jsonl", "{}\n");
    put("A", "records/ledger/actions.jsonl", "{}\n");
    put("A", "skills/mine/SKILL.md", "mine");
    put("A", "shipped/SKILL.md", "shipped");
    linkDir(resolve(homes.A, "shipped"), resolve(homes.A, "skills/linked"));
    await converge();

    expect(read("B", "skills/mine/SKILL.md")).toBe("mine");

    for (const path of [
      "memory/state/sessions.json",
      "telos/backups/GOALS.md",
      "records/raw/claude/x.jsonl",
      "records/ledger/actions.jsonl",
      "skills/linked/SKILL.md",
    ])
      expect(existsSync(resolve(homes.B, path))).toBe(false);
  });
});

describe("whole files changed on both machines", () => {
  test("the later sync keeps its copy and quarantines the other; both then agree", async () => {
    put("A", GOALS, "v1\n");
    await converge();
    put("A", GOALS, "from A\n");
    await sync("A");
    put("B", GOALS, "from B\n");
    const result = await sync("B");
    await sync("A");

    expect(result.quarantined).toContain(GOALS);
    expect(read("B", GOALS)).toBe("from B\n");
    expect(read("A", GOALS)).toBe("from B\n");
    expect(
      readFileSync(resolve(homes.B, "backups/sync-quarantine", `${GOALS}.v2`), "utf-8")
    ).toBe("from A\n");
  });

  test("a machine joining with its own copy yields, and keeps it in quarantine", async () => {
    put("A", GOALS, "real goals\n");
    put("B", GOALS, "template\n");
    await sync("A");
    await sync("B");

    expect(read("B", GOALS)).toBe("real goals\n");
    expect(
      readFileSync(resolve(homes.B, "backups/sync-quarantine", `${GOALS}.local`), "utf-8")
    ).toBe("template\n");
  });
});

describe("a machine joining with its own actor", () => {
  const actor = (id: string) => `${JSON.stringify({ id, label: id, createdAt: "x" })}\n`;

  test("adopts the first machine's actor, and both know the old id as an alias", async () => {
    put("A", "memory/actor.json", actor("actor-a"));
    put("B", "memory/actor.json", actor("actor-b"));
    await sync("A");
    await sync("B");
    await converge();

    expect(read("B", "memory/actor.json")).toBe(actor("actor-a"));

    for (const machine of ["A", "B"] as const)
      expect(read(machine, "memory/actors/actor-b.md")).toContain('aliasOf: "actor-a"');
  });
});

describe("a dishonest server", () => {
  beforeEach(() => {
    put("A", EVENTS, '{"id":"a1","type":"turn"}\n');
    put("A", GOALS, "Ship sync.\n");
  });

  test("a tampered segment is refused, and the rest still syncs", async () => {
    await sync("A");
    const segment = blobFiles().find((file) =>
      file.startsWith(resolve(storeRoot, "seg", "mA"))
    ) as string;
    const bytes = readFileSync(segment);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(segment, bytes);
    const result = await sync("B");

    expect(result.refused.some((line) => line.endsWith(": tampered"))).toBe(true);
    expect(read("B", GOALS)).toBe("Ship sync.\n");
  });

  test("an older manifest served again is a rollback", async () => {
    await sync("A");
    await sync("B");
    const manifest = resolve(storeRoot, "manifest", "mA");
    const old = readFileSync(manifest);
    put("A", EVENTS, '{"id":"a1","type":"turn"}\n{"id":"a2","type":"turn"}\n');
    await sync("A");
    await sync("B");
    writeFileSync(manifest, old);

    expect((await sync("B")).refused).toEqual(["mA: rollback"]);
  });
});
