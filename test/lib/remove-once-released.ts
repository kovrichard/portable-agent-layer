import { rmSync } from "node:fs";

/** The detached children still hold files in the home; Windows refuses to delete those. */
export function removeOnceReleased(dir: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EBUSY" || attempt >= 50) throw err;
      Bun.sleepSync(100);
    }
  }
}
