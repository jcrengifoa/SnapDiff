#!/usr/bin/env bash
# Creates a throwaway git repo containing an image with uncommitted changes,
# so you can exercise the extension in the Extension Development Host.
set -euo pipefail

DIR="${1:-/tmp/git-image-diff-fixture}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "fixture@example.com"
git config user.name "Fixture"

# Committed ("before") version.
node "$HERE/gen-png.js" "$DIR/logo.png" 240 240 before >/dev/null
git add logo.png
git commit -q -m "Add logo"

# Uncommitted ("after") version — moved rectangle, new circle, tweaked bg.
node "$HERE/gen-png.js" "$DIR/logo.png" 240 240 after >/dev/null

echo
echo "Fixture ready at: $DIR"
echo "Open it in the Extension Development Host, then click logo.png."
echo "  - 'logo.png' has uncommitted changes vs HEAD."
echo
git -C "$DIR" status --short
