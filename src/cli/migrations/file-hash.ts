import { createHash } from "node:crypto";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";

const HASH_CHUNK = 1024 * 1024;

export function sha256Of(file: string): string {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(HASH_CHUNK);
  const fd = openSync(file, "r");

  try {
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }

  return hash.digest("hex");
}

/** The regular files under a folder, or the path itself when it is a file. */
export function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => resolve(item.parentPath, item.name));
}
