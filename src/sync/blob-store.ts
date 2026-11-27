/**
 * The only thing the sync asks of a server: put, get and list opaque blobs,
 * with a put that can refuse to replace. An S3 bucket meets it; so does a
 * folder, which is what the tests and the rehearsal use.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export interface BlobStore {
  /** False when `ifAbsent` is set and the name already holds a blob. */
  put(name: string, data: Uint8Array, options?: { ifAbsent?: boolean }): Promise<boolean>;
  get(name: string): Promise<Uint8Array<ArrayBuffer> | null>;
  list(prefix: string): Promise<string[]>;
}

function namesUnder(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);

    return statSync(path).isDirectory()
      ? namesUnder(root, path)
      : [relative(root, path).split(sep).join("/")];
  });
}

export function directoryStore(root: string): BlobStore {
  const pathOf = (name: string) => resolve(root, ...name.split("/"));

  return {
    async put(name, data, options = {}) {
      const path = pathOf(name);
      mkdirSync(dirname(path), { recursive: true });

      try {
        writeFileSync(path, data, { flag: options.ifAbsent ? "wx" : "w" });

        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw err;
      }
    },
    async get(name) {
      const path = pathOf(name);

      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    },
    async list(prefix) {
      return namesUnder(root, root)
        .filter((name) => name.startsWith(prefix))
        .sort();
    },
  };
}
