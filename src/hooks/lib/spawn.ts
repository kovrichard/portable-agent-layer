/** Bun.spawnSync hands a child the environment Bun started with unless told otherwise. */
export function spawnInCurrentEnv<
  const In extends Bun.SpawnOptions.Writable = "ignore",
  const Out extends Bun.SpawnOptions.Readable = "pipe",
  const Err extends Bun.SpawnOptions.Readable = "pipe",
>(command: string[], options: Bun.SpawnOptions.SpawnSyncOptions<In, Out, Err> = {}) {
  return Bun.spawnSync(command, { env: process.env, ...options });
}
