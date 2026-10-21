#!/usr/bin/env bash
# macOS / Linux: start the server and a free Cloudflare quick tunnel
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --omit=dev
if ! command -v cloudflared >/dev/null; then
  echo "Install cloudflared: macOS -> brew install cloudflared; Linux -> https://github.com/cloudflare/cloudflared/releases"
  exit 1
fi
node server/index.js &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 2
echo "Send friends the https://....trycloudflare.com link with /play at the end"
cloudflared tunnel --no-autoupdate --url http://localhost:3000
