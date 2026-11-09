# Session lifetimes

The API sets a 30-minute idle window and a 24-hour absolute lifetime by default. Deployments can use shorter windows with these environment variables.

| Environment variable             | Default | Allowed integer range |
| -------------------------------- | ------: | --------------------: |
| `SESSION_IDLE_TIMEOUT_MINUTES`   |      30 |                  1–30 |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` |      24 |                  1–24 |

Set the same values across API replicas. A value outside the supported range prevents startup.

The server assigns and stores the absolute deadline when issuing a session. Session activity and credential rotation clamp the idle window to that deadline. The CSRF cookie uses the configured absolute window, and the server validates its token against the active session. [Cookie and CSRF policy](cookies.md).
