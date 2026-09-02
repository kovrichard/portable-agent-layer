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

// Marks every test process (and the CLIs they spawn, which inherit the
// environment) as sandboxed. Installer code refuses to write links into the
// developer's real ~/.claude, ~/.codex, ~/.copilot and friends while this is
// set, so a test that forgets to override the PAL_*_DIR vars fails loudly
// instead of quietly rewiring the machine it runs on.
process.env.PAL_TEST_SANDBOX = "1";
