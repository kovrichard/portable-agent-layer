/**
 * Writes the drafter's system prompt, schema and one test per case straight
 * from drafterRequest(), so the eval always measures the request that ships.
 */
import { mkdir } from "node:fs/promises";
import { drafterRequest } from "../../src/hooks/lib/rule-drafter";
import { asTurns, CASES } from "./cases";

const generated = new URL("generated/", import.meta.url).pathname;
await mkdir(generated, { recursive: true });

const requests = CASES.map((c) => ({
  c,
  request: drafterRequest(asTurns(c.corrections), c.known ?? []),
}));
const [{ request: first }] = requests;
await Bun.write(`${generated}system.txt`, first.system);
await Bun.write(
  `${generated}schema.json`,
  `${JSON.stringify(first.jsonSchema, null, 2)}\n`
);
await Bun.write(
  `${generated}tests.json`,
  `${JSON.stringify(
    requests.map(({ c, request }) => ({
      description: `${c.id} ${c.description}`,
      vars: { caseId: c.id, user: request.user },
    })),
    null,
    2
  )}\n`
);
