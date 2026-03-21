@echo off
REM Jarvis — Claude Code wrapper with session summary on exit.
REM
REM Uses PowerShell to start Claude, capture its PID, read the session ID
REM from %USERPROFILE%\.claude\sessions\<PID>.json, then show a cost
REM summary after Claude exits.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pai.ps1" %*
