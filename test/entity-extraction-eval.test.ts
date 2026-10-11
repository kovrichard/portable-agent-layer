import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { extractionUser } from "../src/hooks/lib/entity-extraction";
import { buildNameIndex, type NamedEntity } from "../src/hooks/lib/entity-names";

const CONFIG = resolve(import.meta.dir, "../eval/entity-extraction/promptfoo.yaml");

const KNOWN: NamedEntity[] = [
  { slug: "mira-holt", domain: "People", title: "Mira Holt", aliases: [] },
  { slug: "pip-lanter", domain: "People", title: "Pip Lanter", aliases: ["Pipster"] },
  {
    slug: "brightmoor-io",
    domain: "Companies",
    title: "Brightmoor Kft.",
    aliases: [],
    domainName: "brightmoor.io",
  },
  {
    slug: "fenwick-consult-zrt",
    domain: "Companies",
    title: "Fenwick Consult Zrt.",
    aliases: [],
  },
];

async function evalUserPrompt(messages: string): Promise<string> {
  const config = Bun.YAML.parse(await Bun.file(CONFIG).text()) as {
    prompts: { raw: string }[];
    defaultTest: { vars: { known: string } };
  };
  return config.prompts[0].raw
    .replace("{{known}}", config.defaultTest.vars.known)
    .replace("{{messages}}", messages)
    .trimEnd();
}

test("the extraction eval sends the user prompt extractionUser builds", async () => {
  const index = buildNameIndex(KNOWN, ["Alex", "Atlas"]);
  expect(await evalUserPrompt("1. Hello")).toBe(extractionUser("1. Hello", index));
});
