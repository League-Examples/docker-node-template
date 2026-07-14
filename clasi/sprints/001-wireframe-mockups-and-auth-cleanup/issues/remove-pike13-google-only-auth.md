---
status: in-progress
sprint: '001'
tickets:
- 001-001
- 001-002
---

# Remove Pike13 integration and reduce auth to Google-only

The stakeholder: "I want you to clean out Pike13, which I don't think we
need. People are going to log in with Gmail... they'll log in with Google.
We won't be managing or creating accounts other than creating accounts in
Google."

## Scope

- Remove the Pike13 OAuth route module (`server/src/routes/pike13.ts`), its
  import/mount in `server/src/app.ts`, and references in
  `server/src/routes/integrations.ts`, `server/src/routes/admin/env.ts`,
  `server/src/services/config.ts`.
- Remove client references: `useProviderStatus.ts` pike13 field,
  `Login.tsx` Pike13 button, `Account.tsx`, `admin/UsersPanel.tsx`,
  `admin/EnvironmentInfo.tsx`.
- Remove `PIKE13_*` env vars from `config/{dev,prod}` env files.
- Remove/adjust tests: `tests/server/pike13.test.ts` and Pike13 references
  in integrations, account-linking, auth-linkedproviders, admin-environment,
  LoginPage, and Account tests.
- Reduce login to the Google strategy only (drop GitHub and
  username/password login UI; decide fate of demo-user seeding — likely
  keep for dev/test only or remove).

## References

- `docs/design/specification.md` §13 (process directives), §13 grounding
  (Pike13 removal footprint), §13/14 (auth target state)
