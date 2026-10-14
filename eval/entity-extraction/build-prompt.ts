/**
 * Writes the extraction system prompt and schema straight from src/, so the eval
 * always measures the prompt that ships. Alex and Atlas stand in for the user
 * and the assistant.
 */
import { mkdir } from "node:fs/promises";
import {
  extractionSchema,
  extractionSystem,
} from "../../src/hooks/lib/entity-extraction";

const generated = new URL("generated/", import.meta.url).pathname;
await mkdir(generated, { recursive: true });
await Bun.write(`${generated}system.txt`, extractionSystem("Alex", "Atlas"));
await Bun.write(
  `${generated}schema.json`,
  `${JSON.stringify(extractionSchema(), null, 2)}\n`
);
