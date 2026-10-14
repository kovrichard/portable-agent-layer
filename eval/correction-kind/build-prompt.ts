/**
 * Writes the correction-kind system prompt and schema straight from src/, so the
 * eval always measures the prompt that ships.
 */
import { mkdir } from "node:fs/promises";
import {
  CORRECTION_KIND_SYSTEM,
  correctionKindSchema,
} from "../../src/hooks/lib/correction-kind";

const generated = new URL("generated/", import.meta.url).pathname;
await mkdir(generated, { recursive: true });
await Bun.write(`${generated}system.txt`, CORRECTION_KIND_SYSTEM);
await Bun.write(
  `${generated}schema.json`,
  `${JSON.stringify(correctionKindSchema(), null, 2)}\n`
);
