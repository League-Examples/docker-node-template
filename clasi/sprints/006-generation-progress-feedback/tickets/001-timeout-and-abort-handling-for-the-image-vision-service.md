---
id: '001'
title: Timeout and abort handling for the Image & Vision Service
status: done
use-cases:
- SUC-002
depends-on: []
github-issue: ''
issue: generation-progress-feedback.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Timeout and abort handling for the Image & Vision Service

## Description

`server/src/services/imaging.ts`'s `generateImage` (both the
`/v1/images/generations` and `/v1/images/edits` call sites),
`extractFirstImageBytes`'s image-download-by-URL fallback, and
`classifyAndDescribe`'s OpenRouter chat-completions call all invoke
`fetchImpl`/`fetch` with no `AbortSignal` and no timeout. A stalled
upstream connection hangs the call — and therefore the whole turn,
which holds the `project_turn` lock (`turn.ts`) — indefinitely, with no
feedback to the user at all. This was diagnosed live on 2026-07-17 (see
`clasi/issues/generation-progress-feedback.md`).

Add an `AbortController`-based timeout to every outbound `fetch` in this
module, with a sensible default (5 minutes — image generation
legitimately takes minutes) that is overridable via `ImagingCallOptions`
and/or an environment variable, and a fallback default if neither is
set. On expiry, throw the existing `ImagingServiceError` type (not a new
error class) with a message that names the `provider` and the elapsed
wait in milliseconds/seconds, so the failure is distinguishable from a
non-timeout upstream failure (a 4xx/5xx response) without inspecting the
error any differently at call sites.

This ticket is scoped to `imaging.ts` only — it does not touch `turn.ts`,
`realImageVisionClient.ts`, or the client. The existing error-propagation
path (`realImageVisionClient.ts` → `turn.ts`'s `dispatchToolCall` catch →
`tool_call_finished { isError: true }` → `ChatPanel.tsx`'s existing error
rendering) already carries any `ImagingServiceError` — including this
new timeout variant — to the user without modification.

## Acceptance Criteria

- [x] `generateImage`'s OpenAI `/v1/images/generations` call is bound to
      an `AbortController` timeout.
- [x] `generateImage`'s OpenAI `/v1/images/edits` call (the
      reference-images path) is bound to the same timeout mechanism.
- [x] `extractFirstImageBytes`'s image-download-by-URL fallback `fetch`
      is bound to the same timeout mechanism.
- [x] `classifyAndDescribe`'s OpenRouter chat-completions call is bound
      to the same timeout mechanism.
- [x] The default timeout is 5 minutes; overridable per call via
      `ImagingCallOptions` (new optional field, e.g. `timeoutMs`) and/or
      an environment variable, without changing any existing option's
      meaning or default.
- [x] On expiry, the call rejects with an `ImagingServiceError` (not an
      unhandled `AbortError`) whose message names the `provider` and the
      elapsed wait.
- [x] A call that completes before its timeout is unaffected — no
      change in behavior, return shape, or logged spend for the
      already-passing test suite.
- [x] Tests inject a `fetchImpl` that never resolves (or resolves after
      the injected timeout) and assert the timeout fires at the
      *injected* (short, test-only) duration, never the real 5-minute
      wall-clock default.

## Testing

- **Existing tests to run**: `imaging.ts`'s existing test suite (all
  `generateImage`/`classifyAndDescribe` success and failure cases) —
  must continue to pass unchanged, since every existing test injects
  `fetchImpl` and a call that resolves normally is unaffected by adding
  a timeout.
- **New tests to write**: a `fetchImpl` stub that never resolves (or
  resolves past a short injected timeout) for each of the four call
  sites listed above, asserting an `ImagingServiceError` naming the
  provider and elapsed wait; a test confirming a normal, fast-resolving
  call is unaffected.
- **Verification command**: the server package's test command (e.g.
  `npm test` / `npm run test:server` — confirm against
  `server/package.json`).
