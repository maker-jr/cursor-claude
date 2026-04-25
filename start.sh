#!/bin/bash
# Legacy wrapper. Prefer `cursor-claude start` (see README).
# This script installs deps, builds, and delegates to the CLI.
set -e

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Building..."
npm run build

echo "Starting cursor-claude..."
exec node ./bin/cursor-claude.js start "$@"
