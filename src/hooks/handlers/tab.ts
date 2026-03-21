/**
 * Stop handler: resets terminal tab title to default.
 */

export async function resetTab(): Promise<void> {
  // Reset terminal tab title
  process.stdout.write("\x1b]0;claude\x07");
}
