import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPORT_LABEL, REPORT_MARK } from "../src/report/report";

test("the labelling workflow matches the line pal cli report writes", () => {
  const workflow = readFileSync(
    resolve(import.meta.dir, "..", ".github", "workflows", "label-user-reports.yml"),
    "utf-8"
  );

  expect(workflow).toContain(`grep -qF '${REPORT_MARK}'`);
  expect(workflow).toContain(`--add-label ${REPORT_LABEL}`);
});
