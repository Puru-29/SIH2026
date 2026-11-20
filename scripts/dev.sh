#!/usr/bin/env bash
# Start the AgriSense backend (port 3001) and frontend (port 5173) together.
# Usage (from anywhere):  ./scripts/dev.sh      Stop both with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  echo "Created backend/.env from .env.example (set ADMIN_PHONE and ADMIN_PIN for an admin account)."
fi

echo "Starting backend (cargo run)..."
(cd "$ROOT/backend" && PORT=3001 cargo run) &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT INT TERM

cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies (npm install)..."
  npm install
fi
echo "Starting frontend on http://localhost:5173 ..."
npm run dev
