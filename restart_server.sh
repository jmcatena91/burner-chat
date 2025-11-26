#!/bin/bash
# Find PID of process on port 3000
PID=$(lsof -t -i:3000)
if [ -n "$PID" ]; then
  echo "Killing process $PID on port 3000..."
  kill -9 $PID
fi
echo "Starting server..."
node server.js
