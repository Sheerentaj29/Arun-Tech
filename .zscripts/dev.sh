#!/bin/bash

# .zscripts/dev.sh — project dev-server startup.
#
# Executed AUTOMATICALLY by the platform boot script (/start.sh) at every VM
# boot, and safe to run manually at any time:  bash .zscripts/dev.sh
#
# Design goals:
#   - Idempotent: if the app already answers on :3000, nothing is restarted.
#   - Never touches an existing database (prisma db push runs ONLY when the
#     DB file is missing, i.e. a genuinely fresh project).
#   - Server runs fully detached (nohup + setsid) so it is not tied to the
#     shell/session that launched it.
#   - A watchdog (watchdog.sh) keeps the server alive for the whole VM
#     lifetime and revives it if the process ever dies.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_LOG="$PROJECT_DIR/dev.log"
DB_FILE="$PROJECT_DIR/db/custom.db"

log_step_start() {
	local step_name="$1"
	echo "=========================================="
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
	echo "=========================================="
	export STEP_START_TIME
	STEP_START_TIME=$(date +%s)
}

log_step_end() {
	local step_name="${1:-Unknown step}"
	local end_time
	end_time=$(date +%s)
	local duration=$((end_time - STEP_START_TIME))
	echo "=========================================="
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
	echo "[LOG] Step: $step_name | Duration: ${duration}s"
	echo "=========================================="
	echo ""
}

wait_for_service() {
	local host="$1"
	local port="$2"
	local service_name="$3"
	local max_attempts="${4:-90}"
	local attempt=1

	echo "Waiting for $service_name to be ready on $host:$port..."

	while [ "$attempt" -le "$max_attempts" ]; do
		if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
			echo "$service_name is ready!"
			return 0
		fi
		sleep 1
		attempt=$((attempt + 1))
	done

	echo "ERROR: $service_name failed to start within $max_attempts seconds"
	return 1
}

start_mini_services() {
	local mini_services_dir="$PROJECT_DIR/mini-services"
	local started_count=0

	log_step_start "Starting mini-services"
	if [ ! -d "$mini_services_dir" ]; then
		echo "Mini-services directory not found, skipping..."
		log_step_end "Starting mini-services"
		return 0
	fi

	for service_dir in "$mini_services_dir"/*; do
		if [ ! -d "$service_dir" ]; then
			continue
		fi
		if [ ! -f "$service_dir/package.json" ]; then
			continue
		fi
		if ! grep -q '"dev"' "$service_dir/package.json"; then
			continue
		fi

		local service_name
		service_name=$(basename "$service_dir")
		echo "Starting $service_name in background..."
		(
			cd "$service_dir"
			bun install
			exec bun run dev
		) >"$SCRIPT_DIR/mini-service-${service_name}.log" 2>&1 &
		disown "$!" 2>/dev/null || true
		started_count=$((started_count + 1))
	done

	echo "Mini-services startup completed. Started $started_count service(s)."
	log_step_end "Starting mini-services"
}

healthy() {
	curl -s --connect-timeout 2 --max-time 5 http://localhost:3000 >/dev/null 2>&1
}

next_running() {
	pgrep -f "next dev" >/dev/null 2>&1
}

# Launch a command fully detached from this shell (survives shell exit).
launch_detached() {
	if command -v setsid >/dev/null 2>&1; then
		nohup setsid "$@" </dev/null >/dev/null 2>&1 &
	else
		nohup "$@" </dev/null >/dev/null 2>&1 &
	fi
	disown 2>/dev/null || true
}

start_watchdog() {
	if pgrep -f "[w]atchdog.sh" >/dev/null 2>&1; then
		echo "[DEV] Watchdog already running — skipping."
		return 0
	fi
	launch_detached bash "$SCRIPT_DIR/watchdog.sh"
	echo "[DEV] Watchdog started — it revives the server automatically if the process ever dies."
}

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
	echo "ERROR: bun is not installed or not in PATH"
	exit 1
fi

# 0) Idempotency: nothing to start when the app already answers on :3000.
if healthy; then
	echo "[DEV] Server already healthy on :3000 — nothing to start."
	start_watchdog
	start_mini_services
	exit 0
fi

# 1) Dependencies — skipped when already installed (faster boot, avoids
#    registry-timeout stalls; the server can also start on a warm cache).
if [ ! -f "$PROJECT_DIR/node_modules/.bin/next" ]; then
	log_step_start "bun install"
	echo "[BUN] Installing dependencies (node_modules missing)..."
	bun install || echo "[BUN] WARNING: bun install failed — attempting to start server with what is on disk."
	log_step_end "bun install"
else
	echo "[BUN] Dependencies already installed — skipping bun install."
fi

# 2) Database — bootstrap ONLY when the DB file does not exist yet.
#    'bun run db:push' is 'prisma db push --accept-data-loss' and must NEVER
#    run against an existing database with real records.
if [ ! -f "$DB_FILE" ]; then
	log_step_start "database bootstrap"
	echo "[DB] No database file found — creating a fresh one (prisma db push)."
	bun run db:push || echo "[DB] WARNING: db:push failed — server may start, DB routes may error."
	log_step_end "database bootstrap"
else
	echo "[DB] Existing database found (db/custom.db) — left untouched."
fi

# 3) Start the server unless a 'next dev' process is already alive.
if next_running; then
	echo "[DEV] A 'next dev' process already exists but :3000 is not healthy yet — waiting for it to settle."
	else
		log_step_start "Starting Next.js dev server"
		launch_detached bun run dev
		log_step_end "Starting Next.js dev server"
	fi

# 4) Readiness + health check.
log_step_start "Waiting for Next.js dev server"
if wait_for_service "localhost" "3000" "Next.js dev server" 90; then
	log_step_end "Waiting for Next.js dev server"
	log_step_start "Health check"
	if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
		echo "[BUN] Health check passed"
	else
		echo "[BUN] WARNING: health check request failed, but the port answers — continuing."
	fi
	log_step_end "Health check"
else
	echo "ERROR: server did not become healthy within 90s — inspect $DEV_LOG"
fi

# 5) Watchdog keeps the server alive for the whole VM lifetime.
start_watchdog
start_mini_services

echo "[DEV] Done. Server runs detached; watchdog revives it if the process dies."
