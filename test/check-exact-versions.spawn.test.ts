import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nonExactVersions,
  trackedManifests,
} from "../.agents/scripts/check-exact-versions";

test("every tracked package.json in this repo pins every dependency exactly", () => {
  const root = resolve(import.meta.dir, "..");
  const manifests = trackedManifests(root);
  expect(manifests).toContain("package.json");
  const offenders = manifests.flatMap((path) =>
    nonExactVersions(JSON.parse(readFileSync(resolve(root, path), "utf8"))).map(
      (offender) => ({ path, ...offender })
    )
  );
  expect(offenders).toEqual([]);
});
