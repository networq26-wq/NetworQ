#!/usr/bin/env bash
# NetworQ mobile dev preview: Expo web (Fast Refresh) + API server + device frames.
set -e
cd "$(dirname "$0")/.."
lsof -ti:8081 -ti:3001 -ti:8090 2>/dev/null | xargs kill 2>/dev/null || true

echo "▶ Expo web dev server (Fast Refresh) on :8081"
EXPO_NO_TELEMETRY=1 BROWSER=none npx expo start --web --port 8081 > .preview-metro.log 2>&1 &
METRO=$!
until curl -s -o /dev/null http://localhost:8081/; do sleep 1; done

echo "▶ API server on :3001 (development)"
PORT=3001 NETWORQ_SINGLE_PORT=1 node server.js > .preview-api.log 2>&1 &
API=$!

node scripts/preview-server.js &
PREVIEW=$!

trap 'kill $METRO $API $PREVIEW 2>/dev/null' EXIT INT TERM
echo ""
echo "  Open  http://localhost:8090  — iPhone + Android frames, live reload"
echo "  Logs  .preview-metro.log  .preview-api.log   (Ctrl+C to stop)"
wait
