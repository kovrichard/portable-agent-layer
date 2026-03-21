@echo off
set PAL_DIR=%~dp0
set PAL_CLAUDE_DIR=%USERPROFILE%\.claude
set PAL_OPENCODE_DIR=%USERPROFILE%\.config\opencode
set PAL_AGENTS_DIR=%USERPROFILE%\.agents
bun run "%~dp0install.ts" %*
