/** The arguments a spawned tool was given: argv leads with the runtime and the script path. */
export function scriptArgs(argv: string[] = process.argv): string[] {
  return argv.slice(2);
}
