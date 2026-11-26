import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const LINKED_WORKTREE = /^gitdir:\s*(.+)[\\/]\.git[\\/]worktrees[\\/][^\\/]+\s*$/;

/** The main checkout a linked worktree belongs to, read from its `.git` file; the path itself otherwise. */
export function mainCheckoutOf(cwd: string): string {
  let dir = resolve(cwd);

  for (;;) {
    const dotGit = resolve(dir, ".git");

    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return resolve(cwd);
      const main = LINKED_WORKTREE.exec(readFileSync(dotGit, "utf-8").trim())?.[1];

      return main ? resolve(main, relative(dir, resolve(cwd))) : resolve(cwd);
    }

    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}
