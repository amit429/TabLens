#!/usr/bin/env bash
# Renders scripts/icon.svg to the PNG sizes Chrome needs, using any headless Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
SHELL_BIN="${CHROME_BIN:-$(ls -d ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)}"
mkdir -p public/icon
for s in 16 32 48 128; do
  cat > /tmp/tablens-icon.html <<HTML
<html><body style="margin:0;background:transparent"><img src="file://$PWD/scripts/icon.svg" width="$s" height="$s"></body></html>
HTML
  "$SHELL_BIN" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=$s,$s --screenshot="public/icon/$s.png" /tmp/tablens-icon.html >/dev/null 2>&1
done
ls -la public/icon
