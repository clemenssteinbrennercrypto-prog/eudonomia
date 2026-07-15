#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

python3 "$DIR/activity-server.py" &
SERVER_PID=$!

python3 "$DIR/activity-daemon.py" &
DAEMON_PID=$!

echo "Activity server started (PID $SERVER_PID)"
echo "Activity daemon started (PID $DAEMON_PID)"
