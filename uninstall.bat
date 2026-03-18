@echo off
set PAI_CLAUDE_DIR=%USERPROFILE%\.claude
set PAI_OPENCODE_DIR=%USERPROFILE%\.config\opencode
set PAI_AGENTS_DIR=%USERPROFILE%\.agents
bun run "%~dp0uninstall.ts" %*
