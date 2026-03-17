#!/bin/bash
exec bun run "$(dirname "$0")/install.ts" "$@"
