/** ISO 8601 UTC timestamp */
export function now(): string {
  return new Date().toISOString();
}

/** Date-based path segment: YYYY/MM */
export function monthPath(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Compact timestamp for filenames: YYYYMMDD-HHmmss */
export function fileTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\.\d+Z/, "");
}
