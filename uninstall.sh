#!/bin/bash
exec bun run "$(dirname "$0")/uninstall.ts" "$@"
