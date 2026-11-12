#!/bin/bash
# Start the Next.js dev server if it's not already running on port 3000.
# Called by the cron job every 5 minutes to keep the server alive between
# conversation messages (the sandbox kills all processes between turns).
cd /home/z/my-project

# Check if port 3000 is already responding
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -qE "^(200|302)$"; then
  echo "Server already running — no action needed"
  exit 0
fi

# Kill any stale process
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 1

# Start fresh
setsid nohup bash -c 'exec ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1' </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

# Wait for it to come up
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ] || [ "$CODE" = "302" ]; then
    echo "✓ Server started (HTTP $CODE after ${i}s)"
    exit 0
  fi
  sleep 1
done
echo "✗ Server failed to start"
exit 1
