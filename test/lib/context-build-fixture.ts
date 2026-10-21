import { beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../../src/hooks/lib/settings";
import { removeOnceReleased } from "./remove-once-released";
import { testHome } from "./test-home";

export function freshPalHomeEachTest(file: string) {
  const home = testHome(file);

  function write(relPath: string, content: string) {
    const full = resolve(home, relPath);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  beforeEach(() => {
    removeOnceReleased(home);
    mkdirSync(home, { recursive: true });
    process.env.PAL_HOME = home;
    reload();
  });

  return { home, write };
}
