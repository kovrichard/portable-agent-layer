/**
 * Where the control room listens. Split from server.ts so the build can read it
 * without importing the server itself — server.ts imports the page bundle, and
 * a bundler asked to load that would be chasing its own output.
 */

export const DEFAULT_PORT = 7250;
export const LOOPBACK = "127.0.0.1";
