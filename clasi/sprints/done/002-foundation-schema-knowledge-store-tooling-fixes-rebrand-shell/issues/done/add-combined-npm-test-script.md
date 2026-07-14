---
status: done
sprint: '002'
tickets:
- '001'
---

# Add a combined `npm test` script (server + client) for tooling that takes a single test command

`close_sprint`'s `test_command` parameter is split naively on whitespace
(no shell interpretation), so compound commands (`a && b`) and quoted
`sh -c "..."` wrappers both fail. Sprint 001's close had to gate on
`npm run test:server` alone, with the client suite verified manually.

## Scope

- Add a root `package.json` script, e.g. `"test": "npm run test:server && npm run test:client"`,
  so a single token (`npm test`) runs both suites.
- Use it in future `close_sprint` calls and anywhere else a single
  test command is required (CI, hooks).

## References

- Sprint 001 close attempt, 2026-07-13: first close failed with vitest
  treating `&& npm run test:client` as filter args; second failed with
  shell quoting errors (`run: -c: unexpected EOF`).
