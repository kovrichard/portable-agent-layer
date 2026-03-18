@echo off
set PAI_CLAUDE_DIR=%APPDATA%\Claude
set PAI_OPENCODE_DIR=%APPDATA%\opencode
set PAI_AGENTS_DIR=%USERPROFILE%\.agents
bun run "%~dp0uninstall.ts" %*
