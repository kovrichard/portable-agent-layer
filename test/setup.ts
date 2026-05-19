/**
 * Bun test preload — runs before every test file.
 *
 * Disables real inference globally so no test can accidentally spawn `claude
 * --print` or hit the Anthropic API. Tests that intentionally exercise the
 * inference dispatcher (e.g. via a fake binary on PATH) opt back in by
 * deleting this env var in their own beforeEach.
 */
process.env.PAL_INFERENCE_DISABLED = "1";
process.env.PAL_NOTIFICATIONS_DISABLED = "1";
