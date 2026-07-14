---
id: '002'
title: Reduce login to Google-only and strip remaining client Pike13 references
status: done
use-cases: []
depends-on: []
github-issue: ''
issue: remove-pike13-google-only-auth.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Reduce login to Google-only and strip remaining client Pike13 references

## Description

Ticket 001 removed all server-side Pike13 code, env vars, and tests. This
ticket completes the `remove-pike13-google-only-auth` issue by stripping
the remaining client-side Pike13 references and reducing the primary
login surface to Google-only, per the stakeholder's "no managing or
creating accounts other than in Google" and the sprint's
`architecture-update.md` §2 ("Client Auth Pages") and Decisions 1-3.

## Acceptance Criteria

- [x] `client/src/hooks/useProviderStatus.ts`: `pike13` field removed from
      the `ProviderStatus` interface and hook state/fetch mapping.
- [x] `client/src/pages/Login.tsx`: rewritten to a single "Sign in with
      Google" affordance shown only when `useProviderStatus().google` is
      true; a not-configured message otherwise. The GitHub button, Pike13
      button, demo username/password form, and "Register" link are all
      removed.
- [x] `client/src/pages/Account.tsx`: `pike13` removed from
      `PROVIDER_LABELS` and `addButtonStyle`. GitHub linking left
      untouched (Decision 2 — out of scope for this ticket).
- [x] `client/src/pages/admin/UsersPanel.tsx`: `pike13` removed from
      `PROVIDER_LOGOS`.
- [x] `client/src/pages/admin/EnvironmentInfo.tsx`: `pike13` removed from
      `INTEGRATION_LABELS`.
- [x] `client/src/App.tsx`: `/register` route removed (Decision 3).
      `Register.tsx` remains as an unrouted component; its test
      (`RegisterPage.test.tsx`) is unaffected since it renders the
      component directly.
- [x] No remaining case-insensitive `pike13`/`pike 13` references in
      `client/src` (verified by repo-wide grep; only remaining hit is the
      new test's own "does not render" assertion string).
- [x] Server-side GitHub and password auth routes/strategies
      (`/api/auth/github`, `/api/auth/login`, `/api/auth/register`,
      `/api/auth/test-login`) intentionally left in place per
      architecture-update.md Decision 1 — not in this ticket's scope.

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
  (both from repo root); `tsc --noEmit` in `client/` and `server/`.
- **New tests to write**:
  - `tests/client/LoginPage.test.tsx` rewritten for Google-only: shows
    the Google button when configured, shows a not-configured message
    when not, never renders GitHub/Pike13 buttons, no demo form, no
    Register link, and falls back to the not-configured message if the
    status fetch fails.
  - `tests/client/Account.test.tsx`: Pike13-specific cases removed;
    remaining GitHub/Google cases updated to a two-provider
    `mockProviderStatus` shape (no `pike13` field).
- **Verification command**: `npm run test:server && npm run test:client`
  (repo root).

### Results

- `npm run test:client`: 58/58 passed (was 69/69 before this ticket;
  count dropped because the Pike13/GitHub/demo-form provider-button
  cases in `LoginPage.test.tsx` no longer apply to a Google-only page,
  and the three Pike13 cases in `Account.test.tsx` were removed).
- `npm run test:server`: 178/178 passed (unchanged — this ticket touches
  client only).
- `tsc --noEmit` clean in both `client/` and `server/`.
