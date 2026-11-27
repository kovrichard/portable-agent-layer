/**
 * Directories within PAL_HOME that carry the user's own data; export and sync
 * travel the same ones. `skills` and `agents` hold user-authored personal
 * skills and subagents. Shipped skills live in `skills/` only as symlinks back
 * to the repo, and the walkers skip symlinks, so only user-owned files travel.
 *
 * Its own module so that sync, which every hook can start, never loads the zip
 * library export needs.
 */
export const EXPORT_DIRS = ["telos", "memory", "records", "work", "skills", "agents"];
