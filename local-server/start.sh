#!/bin/bash
# Start the transcript proxy server + Cloudflare tunnel
# Automatically updates the Netlify env var with the new tunnel URL
# and triggers a redeploy.
# Usage: ./start.sh

cd "$(dirname "$0")"
PROJECT_DIR="$(cd .. && pwd)"

# Ensure node and cloudflared are in PATH (needed for launchd)
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

export TRANSCRIPT_PROXY_SECRET="yt-digest-proxy-2026"
CLOUDFLARED="$HOME/.local/bin/cloudflared"
NETLIFY_CLI="$PROJECT_DIR/node_modules/.bin/netlify"
LOG_DIR="$HOME/.transcript-proxy-logs"
CONFIG_FILE="$HOME/.transcript-proxy-config"
mkdir -p "$LOG_DIR"

# Netlify config
NETLIFY_SITE_ID="2674176e-d158-462e-9105-cdb4fc25df2a"
NETLIFY_ACCOUNT_SLUG="699d16c9b222007fba3b68ab"

# Load Netlify API token from config file
if [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
fi

if [ -z "$NETLIFY_API_TOKEN" ]; then
  echo "WARNING: No NETLIFY_API_TOKEN found."
  echo "The tunnel URL won't be auto-synced to Netlify."
  echo "To fix: echo 'NETLIFY_API_TOKEN=your_token_here' > $CONFIG_FILE"
  echo ""
fi

# --- Helper: update Netlify env var and redeploy ---
update_netlify() {
  local url="$1"
  if [ -z "$NETLIFY_API_TOKEN" ]; then return 1; fi

  echo "[$(date)] Updating Netlify env var TRANSCRIPT_PROXY_URL..."

  # Delete existing env var
  curl -s -X DELETE \
    "https://api.netlify.com/api/v1/accounts/$NETLIFY_ACCOUNT_SLUG/env/TRANSCRIPT_PROXY_URL?site_id=$NETLIFY_SITE_ID" \
    -H "Authorization: Bearer $NETLIFY_API_TOKEN" > /dev/null 2>&1

  # Create new env var
  RESULT=$(curl -s -w "%{http_code}" -o /dev/null -X POST \
    "https://api.netlify.com/api/v1/accounts/$NETLIFY_ACCOUNT_SLUG/env?site_id=$NETLIFY_SITE_ID" \
    -H "Authorization: Bearer $NETLIFY_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "[{\"key\":\"TRANSCRIPT_PROXY_URL\",\"scopes\":[\"builds\",\"functions\",\"runtime\",\"post_processing\"],\"values\":[{\"value\":\"$url\",\"context\":\"all\"}]}]")

  if [ "$RESULT" = "201" ] || [ "$RESULT" = "200" ]; then
    echo "[$(date)] Netlify env var updated."
  else
    echo "[$(date)] WARNING: Netlify env var update returned HTTP $RESULT"
    return 1
  fi

  # Redeploy using Netlify CLI
  echo "[$(date)] Triggering Netlify redeploy..."
  cd "$PROJECT_DIR"
  NETLIFY_AUTH_TOKEN="$NETLIFY_API_TOKEN" "$NETLIFY_CLI" deploy --prod --dir=src >> "$LOG_DIR/deploy.log" 2>&1
  local deploy_exit=$?
  cd "$(dirname "$0")"

  if [ $deploy_exit -eq 0 ]; then
    echo "[$(date)] Redeploy complete. Functions now use new tunnel URL."
  else
    echo "[$(date)] WARNING: Redeploy failed (exit $deploy_exit). Check $LOG_DIR/deploy.log"
  fi

  # Clear retry backoff so videos aren't stuck in 24h wait after a tunnel outage
  echo "[$(date)] Clearing video retry backoff timers..."
  SITE_URL="https://youtube-ai-digest.netlify.app"
  CLEAR_RESULT=$(curl -s -w "%{http_code}" -o /tmp/clear-backoff.json \
    "$SITE_URL/api/debug?action=clear-backoff" 2>/dev/null)
  if [ "$CLEAR_RESULT" = "200" ]; then
    CLEARED=$(cat /tmp/clear-backoff.json 2>/dev/null | grep -o '"cleared":[0-9]*' | cut -d: -f2)
    echo "[$(date)] Cleared backoff for ${CLEARED:-?} retrying videos."
  else
    echo "[$(date)] WARNING: clear-backoff returned HTTP $CLEAR_RESULT"
  fi
}

# Kill any existing instances
lsof -ti:3377 2>/dev/null | xargs kill -9 2>/dev/null
pkill -f "cloudflared tunnel --url" 2>/dev/null
sleep 1

# Clear old logs
> "$LOG_DIR/server.log"
> "$LOG_DIR/tunnel.log"
> "$LOG_DIR/deploy.log"

echo "[$(date)] Starting transcript proxy server on port 3377..."
node server.cjs >> "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
sleep 2

if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "ERROR: Server failed to start. Check $LOG_DIR/server.log"
  exit 1
fi

echo "[$(date)] Server running (PID $SERVER_PID)"
echo "[$(date)] Starting Cloudflare tunnel..."
"$CLOUDFLARED" tunnel --url http://localhost:3377 >> "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL to appear in logs (up to 30 seconds)
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -o 'https://[a-z-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: Could not detect tunnel URL after 30s. Check $LOG_DIR/tunnel.log"
  kill $SERVER_PID $TUNNEL_PID 2>/dev/null
  exit 1
fi

echo ""
echo "=========================================="
echo "  Transcript proxy is running!"
echo "  Tunnel URL: $TUNNEL_URL"
echo "  Server PID: $SERVER_PID"
echo "  Tunnel PID: $TUNNEL_PID"
echo "=========================================="

# Auto-update Netlify
update_netlify "$TUNNEL_URL"

echo ""
echo "Logs: $LOG_DIR/"
echo ""

# Keep running until interrupted
trap "echo '[$(date)] Shutting down...'; kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit 0" INT TERM

# Keep the script alive, restart processes if they die
while true; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[$(date)] Server died. Restarting..."
    node server.cjs >> "$LOG_DIR/server.log" 2>&1 &
    SERVER_PID=$!
    sleep 2
  fi

  if ! kill -0 $TUNNEL_PID 2>/dev/null; then
    echo "[$(date)] Tunnel died. Restarting..."
    "$CLOUDFLARED" tunnel --url http://localhost:3377 >> "$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    sleep 15

    # Get new tunnel URL and update Netlify
    NEW_URL=$(grep -o 'https://[a-z-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | tail -1)
    if [ -n "$NEW_URL" ] && [ "$NEW_URL" != "$TUNNEL_URL" ]; then
      TUNNEL_URL="$NEW_URL"
      echo "[$(date)] New tunnel URL: $TUNNEL_URL"
      update_netlify "$TUNNEL_URL"
    fi
  fi

  sleep 10
done
