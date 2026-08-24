#!/bin/sh
# Barghsa shared API/Worker HEALTHCHECK
#
# In API mode (default CMD: node dist/src/main.js), verifies the
# /api/health endpoint is responding. In worker mode (CMD override),
# verifies the worker Node process is still alive.
#
# Returns 0 (healthy) or 1 (unhealthy).

set -e

# Try the API health endpoint. In API mode this directly verifies readiness.
if wget --no-verbose --tries=1 --spider http://localhost:4000/api/health 2>/dev/null; then
    exit 0
fi

# Capture wget exit code
es=$?

# Exit code 4 = network failure (connection refused, DNS failure, etc.)
# This is expected in worker mode where no HTTP server is listening.
if [ "$es" -eq 4 ]; then
    # Worker mode — verify the Node process is alive
    if pgrep -f "node dist/src/worker.js" > /dev/null; then
        exit 0
    fi
    # If neither worker process is found, the container is unhealthy
    exit 1
fi

# Any other exit code = HTTP error from a running server (5xx, 4xx)
# The API is unhealthy — fail cleanly so orchestrator restarts the container
exit 1