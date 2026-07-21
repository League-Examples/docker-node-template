/**
 * Test-harness helper (sprint 013 ticket 001): one persistent,
 * explicitly-created `http.Server` per test file, reused for every
 * `request()`/`request.agent()` call in that file, in place of the bare
 * Express `app`.
 *
 * Background -- why this exists:
 * Passing the bare Express `app` (a callable function) straight to
 * supertest's `request()`/`request.agent()` makes supertest wrap it in a
 * brand-new `http.createServer(app)` AND call `.listen(0)` on it for
 * *every single call* (see `supertest/lib/test.js`'s `Test` constructor
 * and `serverAddress()`), then close that ephemeral server again once the
 * response is asserted (`Test.prototype.end()`). Across a test file making
 * dozens of HTTP assertions, that is dozens of brand-new loopback TCP
 * listeners bound and torn down in rapid succession -- confirmed
 * (sprint 002 ticket 002's investigation) as the structural cause of this
 * suite's residual ~9% flake rate ("socket hang up", "Parse Error:
 * Expected HTTP/", or a response that doesn't match the request sent).
 *
 * The fix: create and `.listen(0)` exactly one `http.Server` per test
 * file (via `startTestServer`), and pass *that* to `request()`/
 * `request.agent()` instead of `app`. This sidesteps supertest's
 * per-call auto-wrap entirely:
 *   - `Test`'s constructor only calls `http.createServer(app)` when
 *     `typeof app === 'function'`; an already-constructed `http.Server`
 *     instance is used as-is.
 *   - `serverAddress()` only calls `.listen(0)` when `app.address()` is
 *     still falsy (not yet listening) -- never true here, since this
 *     helper's own `.listen(0)` call already happened, once.
 *   - `.end()` only closes `this._server`, which is only ever set by
 *     that internal `.listen(0)` call -- so supertest itself never closes
 *     a server that was already listening when it was handed one. The
 *     server is closed exactly once, explicitly, via `stopTestServer` in
 *     the test file's own `afterAll`.
 *
 * Vitest runs each test file in its own forked process even with
 * `fileParallelism: false` (confirmed, this directory's `setup.ts`), so
 * "one server per file" needs no cross-file coordination -- it is a
 * per-file, per-process concern only. Multiple distinct HTTP targets
 * within one file (e.g. a file testing both the real app and a small
 * fixture app) each get their own persistent server via their own
 * `startTestServer`/`stopTestServer` pair.
 */
import http from 'http';
import type { Express } from 'express';

/**
 * Creates an `http.Server` wrapping `app` and starts it listening on an
 * OS-assigned port (`.listen(0)`). Call once per test file (or once per
 * distinct app-under-test within a file); pass the resolved `Server` to
 * every `request()`/`request.agent()` call for that app instead of the
 * bare Express app.
 */
export function startTestServer(app: Express): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

/**
 * Closes a server started by {@link startTestServer}. Call exactly once
 * per file (or once per server), in a top-level `afterAll`, after any
 * test-level cleanup hooks that still need the server reachable have run.
 */
export function stopTestServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
