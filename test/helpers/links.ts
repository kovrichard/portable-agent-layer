import { symlinkSync } from "node:fs";

/**
 * Link a directory the way `pal install` does on this platform.
 *
 * `symlinkSync(..., "dir")` needs SeCreateSymbolicLinkPrivilege on Windows,
 * which is off outside Developer Mode, so it throws EPERM on an ordinary dev
 * box. Junctions need no privilege, Node reports them as symbolic links, and
 * they are what src/targets/lib.ts actually creates there — so testing with
 * one exercises the real Windows install rather than skipping it.
 */
export function linkDir(target: string, link: string): void {
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}
