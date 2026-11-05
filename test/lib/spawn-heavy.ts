/** Windows CI stretches a `pal cli` or git-fixture spawn to 5–12 s under suite load; it ends, it is just slow. */
export const SPAWN_HEAVY_TEST_MS = 20_000;

/** A cold `powershell -File` on a loaded Windows runner overran 20 s on 2026-11-05 (#201, 5 status-line tests). */
export const POWERSHELL_SPAWN_TEST_MS = 60_000;
