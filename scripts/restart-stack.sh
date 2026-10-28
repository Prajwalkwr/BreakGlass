#!/usr/bin/env bash
# Restarts the local API and worker processes.
#
#   ./scripts/restart-stack.sh          # restart both
#   ./scripts/restart-stack.sh api      # restart only the API
#   ./scripts/restart-stack.sh stop     # stop both
#
# Each service runs in its own session/process group (setsid), and the pid file
# records that group id, so stopping a service also stops the tsx child process
# it spawned. This script never pattern-matches process names — that would risk
# signalling the shell running it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.data"
mkdir -p "$DATA"

stop_service() {
  local name="$1" file="$DATA/$1.pid"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

start_service() {
  local name="$1" entry="$2" file="$DATA/$1.pid"
  ( cd "$ROOT" && setsid nohup npx tsx "$entry" >>"$DATA/$name.log" 2>&1 & echo $! >"$file" )
  printf '  %-7s pid %s\n' "$name" "$(cat "$file")"
}

health_wait() {
  for _ in $(seq 1 60); do
    if curl -fsS -m 2 http://127.0.0.1:4000/api/v1/health/live >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "API did not become healthy; see .data/api.log" >&2
  return 1
}

case "${1:-all}" in
  stop)
    stop_service api
    stop_service worker
    echo "Stack stopped."
    exit 0
    ;;
  api)
    stop_service api
    start_service api apps/api/src/index.ts
    health_wait && curl -fsS -m 5 http://127.0.0.1:4000/api/v1/health && echo
    ;;
  worker)
    stop_service worker
    start_service worker apps/worker/src/index.ts
    ;;
  all)
    stop_service worker
    stop_service api
    start_service api apps/api/src/index.ts
    health_wait
    start_service worker apps/worker/src/index.ts
    curl -fsS -m 5 http://127.0.0.1:4000/api/v1/health && echo
    ;;
  *)
    echo "usage: $0 [all|api|worker|stop]" >&2
    exit 1
    ;;
esac
