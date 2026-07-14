---
id: '006'
title: Google-only login page wireframe
status: done
use-cases:
- SUC-005
depends-on:
- '003'
- '005'
github-issue: ''
issue: wireframe-mockups.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Google-only login page wireframe

## Description

Build the fourth and final planned mockup, `/mockups/login`
(UC-001/SUC-005): a wireframe of the login page as it should read in the
eventual product — an app-name heading, one line of purpose text, and a
single "Sign in with Google" affordance, with no other provider or
credential form. Note that the *real* login page was already reduced to
Google-only in ticket 002 (`client/src/pages/Login.tsx`), which fetches
`/api/integrations/status` via `useProviderStatus` and conditionally shows
the Google button or a not-configured message. That real page already
satisfies the *content* goal SUC-005 describes.

**Scoping decision (made here, not deferred)**: this ticket still builds a
distinct static page under `client/src/pages/mockups/`, rather than
linking straight to `/login` or importing `Login.tsx`, for two reasons —
(1) the mockups module's zero-fan-out constraint (architecture-update.md:
"New `client/src/pages/mockups/` module exists, self-contained, with zero
imports from the rest of the app") rules out importing `Login.tsx` or
`useProviderStatus`, and (2) `Login.tsx` makes a live `fetch` call, which
would break the "no page calls the backend" invariant every other mockup
upholds. Building a second, static copy risks drifting from the real
page, so this ticket keeps the copy minimal (heading, one tagline line,
one button label) and cross-references `Login.tsx` in a doc comment so a
future edit to either page prompts a check of the other. If an
implementer judges even this thin duplication unwarranted, the documented
fallback is to scope `/mockups/login` down to an annotated link from
`MockupsIndex` pointing at the real `/login` page instead of a separate
route — noted here as an option, but the acceptance criteria below assume
the full mockup page, since that is what keeps this mockup consistent
with the other three (a real, static, reachable `/mockups/*` page rather
than an external pointer).

`completes_issue: true` — this is the fourth and last of the four mockups
tracked by `wireframe-mockups.md` (003: shell/index/main-layout; 004:
new-project; 005: postcard-edit; 006: this ticket). Once this ticket is
done, all four mockups plus the index exist and the issue is archived.

## Acceptance Criteria

- [x] `client/src/pages/mockups/MockupLogin.tsx` renders at
      `/mockups/login`, registered as a sibling route of the other
      `/mockups/*` pages in `App.tsx` (outside `AppLayout`, not
      auth-gated).
- [x] Page shows an app-name heading, one line of purpose text, and
      exactly one Google sign-in affordance — no other provider button, no
      credential form.
- [x] The Google affordance on this page is static/non-functional (no
      real `href`/OAuth call), consistent with the module's "no backend
      calls" rule — this is the deliberate, documented difference from
      the real `/login` page.
- [x] A doc comment in `MockupLogin.tsx` cross-references
      `client/src/pages/Login.tsx`, noting the two pages should be kept
      structurally consistent.
- [x] No page in `client/src/pages/mockups/` (including this one) imports
      anything from outside `client/src/pages/mockups/`, and none makes a
      `fetch`/XHR call — the login mockup does not import `Login.tsx` or
      `useProviderStatus`.
- [x] `client/src/pages/mockups/MockupsIndex.tsx`'s Google-only login
      entry is now a live `<Link to="/mockups/login">`; no not-yet-built
      placeholders remain on the index page.
- [x] `tests/client/LoginPage.test.tsx` (the real `/login` page's test
      suite) is unaffected — this ticket touches nothing in
      `client/src/pages/Login.tsx`'s dependency chain.
- [x] `npm run test:client` and `npm run test:server` pass; `tsc -b
      --noEmit` is clean in both `client/` and `server/`.

## Testing

- **Existing tests to run**: `npm run test:server` (178 tests,
  untouched); `npm run test:client` (baseline carried over from ticket
  005 must keep passing); specifically re-run
  `tests/client/LoginPage.test.tsx` to confirm the real login page is
  untouched.
- **Existing test to update**: `tests/client/MockupsIndex.test.tsx` —
  replace the remaining not-yet-built assertion for Google-only login
  with a positive link assertion (mirroring the pattern from tickets
  004/005). After this ticket, the
  `'shows not-yet-built mockups as non-navigable placeholders'` case has
  no remaining not-yet-built entries to assert on — remove it or
  repurpose it to assert the index has zero non-navigable placeholders
  left.
- **New tests to write**: `tests/client/MockupLogin.test.tsx`:
  - renders the app-name heading and the "Sign in with Google" affordance
    text;
  - asserts no other provider text (GitHub, Pike13) and no
    username/password labels appear (mirroring `LoginPage.test.tsx`'s
    negative assertions);
  - asserts the Google affordance is not a real link to
    `/api/auth/google` (no `href` attribute, or not rendered as an `<a>`
    at all) — confirming it is a static wireframe element, not a working
    sign-in control.
- **Verification command**: `npm run test:client` (from repo root; also
  run `npm run test:server` to confirm no regressions in the untouched
  server suite).

### Results

- `npm run test:server`: 178/178 passed, untouched (Pike13/GitHub/password
  auth suites all still green — confirms this ticket's scope stayed
  client-only).
- `npm run test:client`: 81/81 passed (baseline 75 from ticket 005, minus
  the removed `'shows not-yet-built mockups as non-navigable placeholders'`
  case, plus 2 new `MockupsIndex.test.tsx` cases — a positive login-link
  assertion and a "no not-yet-built placeholders remain" assertion — plus
  5 new `MockupLogin.test.tsx` cases).
- `tests/client/LoginPage.test.tsx`: re-ran individually within the full
  client suite — all 8 cases pass unchanged, confirming `Login.tsx` and
  `useProviderStatus` were not touched.
- `tsc -b --noEmit`: clean in both `client/` and `server/`.
- `client/src/pages/mockups/MockupLogin.tsx` was written as a
  self-contained component with no imports outside
  `client/src/pages/mockups/` (only React JSX and inline SVG) and no
  `fetch`/XHR call — the Google affordance renders as a disabled
  `<button>`, not an `<a href>`.
