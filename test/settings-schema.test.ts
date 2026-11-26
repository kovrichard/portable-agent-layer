import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const SCHEMAS = resolve(import.meta.dir, "..", "assets", "schema");
const json = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

describe("the settings schema", () => {
  test("the template points at a schema PAL ships", () => {
    const template = json(resolve(SCHEMAS, "..", "templates", "settings.json"));
    expect(existsSync(resolve(SCHEMAS, basename(template.$schema)))).toBe(true);
  });

  test("its former name still leads to it, for files written before the rename", () => {
    const former = json(resolve(SCHEMAS, "pal-settings.schema.json"));
    expect(json(resolve(SCHEMAS, former.$ref)).title).toBe("PAL settings");
  });
});
