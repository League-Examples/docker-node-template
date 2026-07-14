#!/usr/bin/env bash
# Kill any processes listening on the dev ports so `npm run dev` always
# starts clean. Ports come from args if given, else PORT/CLIENT_PORT env,
# else the defaults (3000 server, 5173 vite).
ports=("$@")
if [ ${#ports[@]} -eq 0 ]; then
  ports=("${PORT:-3000}" "${CLIENT_PORT:-5173}")
fi

for port in "${ports[@]}"; do
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Killing processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
done
echo "Done"
