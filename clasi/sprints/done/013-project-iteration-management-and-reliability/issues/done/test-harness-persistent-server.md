---
status: done
sprint: '013'
tickets:
- 013-001
---

# Test harness: one persistent HTTP server per test file (kill residual suite flake)

Sprint 002 ticket 002's investigation (2026-07-14) found the residual
~9% full-suite flake rate is structural: supertest's `request(app)` /
`request.agent(app)` creates and tears down an ephemeral `http.Server`
per call — hundreds of times across ~40 test files — producing loopback
TCP listener churn (stale keep-alive sockets, "socket hang up",
"Parse Error: Expected HTTP/"). Reproduced in DB-free tests, so it is
not the data/session layer. Hardening already landed (busy_timeout,
test-mode Connection: close, prisma disconnect in teardown) but does not
eliminate it.

## Fix

Suite-wide harness change: one persistent `http.Server` per test file
(supertest against a listening server instance instead of the app
object), applied mechanically across `tests/server/`.

## References

- `clasi/sprints/002-.../tickets/done/002-fix-flaky-admin-sessions-test.md`
  Testing section (root-cause evidence, 120+ run data)
