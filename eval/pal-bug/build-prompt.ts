/**
 * Writes the pal-bug system prompt and schema straight from src/, so the eval
 * always measures the prompt that ships.
 */
import { mkdir } from "node:fs/promises";
import { PAL_BUG_SYSTEM, palBugSchema } from "../../src/report/pal-bug";

const generated = new URL("generated/", import.meta.url).pathname;
await mkdir(generated, { recursive: true });
await Bun.write(`${generated}system.txt`, PAL_BUG_SYSTEM);
await Bun.write(
  `${generated}schema.json`,
  `${JSON.stringify(palBugSchema(), null, 2)}\n`
);
