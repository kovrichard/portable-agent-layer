/** ISO 8601 UTC timestamp */
export function now(): string {
  return new Date().toISOString();
}
