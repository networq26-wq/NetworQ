#!/usr/bin/env bash
# NetworQ Unified Startup Script

echo "🚀 Starting NetworQ Backend Proxy & Expo Server..."

# Kill any existing lingering processes on port 3001 and 8081 if needed
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:8081 | xargs kill -9 2>/dev/null || true

# Start backend proxy in background (only :3001 — Expo needs :8081)
PORT=3001 NODE_ENV=development NETWORQ_SINGLE_PORT=1 node server.js &
BACKEND_PID=$!
echo "✅ Backend AI Proxy running on port 3001"

# Start Expo dev server
echo "📱 Launching Expo (Port 8081)..."
npx expo start

# Cleanup on exit
kill $BACKEND_PID 2>/dev/null || true
