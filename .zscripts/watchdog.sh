#!/bin/bash

# .zscripts/watchdog.sh — keeps the Next.js dev server alive for the whole VM
# lifetime. Started by .zscripts/dev.sh (which the platform runs at every VM
# boot). If the server process dies while the VM is still running, the
# watchdog relaunches it — the preview comes back on its own, with no code or
# data loss (the server only ever reads the same project files and DB).

# Single instance guarded by watchdog.pid: a second copy exits immediately.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/watchdog.log"
PID_FILE="$SCRIPT_DIR/watchdog.pid"
INTERVAL="${1:-15}"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
	exit 0
fi
echo $$ > "$PID_FILE"

cleanup() { rm -f "$PID_FILE"; }
trap cleanup TERM INT EXIT

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG_FILE"; }

log "watchdog started (pid $$, interval ${INTERVAL}s)"

while true; do
	if ! curl -s --connect-timeout 2 --max-time 5 http://localhost:3000 >/dev/null 2>&1; then
		if ! pgrep -f "next dev" >/dev/null 2>&1; then
			log "server down and no 'next dev' process — restarting"
			(
				cd "$PROJECT_DIR" || exit 1
				if command -v setsid >/dev/null 2>&1; then
					nohup setsid bun run dev </dev/null >/dev/null 2>&1 &
				else
					nohup bun run dev </dev/null >/dev/null 2>&1 &
				fi
				disown 2>/dev/null || true
			)
			# Give the server time to bind and compile before judging the restart.
			sleep 30
			if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000 >/dev/null 2>&1; then
				log "restart OK — server healthy on :3000"
			else
				log "restart attempt not healthy yet — will keep checking"
			fi
		fi
	fi
	sleep "$INTERVAL"
done
