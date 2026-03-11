---
id: '006'
title: Enhance environment and session panels
status: todo
use-cases:
- SUC-005
depends-on: []
---

# Enhance environment and session panels

## Description

Enhance the existing `EnvironmentPanel` to show integration configuration
status and the existing `SessionPanel` to display linked user information
with expiry highlighting. These improvements give administrators better
visibility into the system's runtime state.

### Changes

1. **`server/src/routes/admin/environment.ts`** (or equivalent existing route):
   - Add an `integrations` field to the environment API response. For each
     integration, report whether the required environment variables are set
     (boolean, without revealing actual values):
     - GitHub OAuth: `GITHUB_CLIENT_ID` configured? true/false
     - Google OAuth: `GOOGLE_CLIENT_ID` configured? true/false
     - Pike 13: `PIKE13_ACCESS_TOKEN` configured? true/false
     - MCP: `MCP_DEFAULT_TOKEN` configured? true/false

2. **`client/src/components/admin/EnvironmentPanel.tsx`** — Enhancement:
   - Add an "Integrations" section below the existing environment info.
   - Display each integration as a row with name and status (configured /
     not configured) using visual indicators (green check / red X or similar).

3. **`server/src/routes/admin/sessions.ts`** (or equivalent existing route):
   - Enhance the sessions API response to include linked user information
     for each session. Look up the `User` record via the session's user ID
     and include: email, display name, role.
   - Include session expiry timestamp in the response.

4. **`client/src/components/admin/SessionPanel.tsx`** — Enhancement:
   - Display user email, display name, and role instead of raw session JSON.
   - Show session creation time and expiry time.
   - Highlight sessions expiring within 1 hour (visual warning style).
   - Add a manual "Refresh" button.

## Acceptance Criteria

- [ ] Environment API response includes `integrations` object with boolean
      status for each integration
- [ ] `EnvironmentPanel` displays integration config status with visual indicators
- [ ] Integration status does not reveal actual secret values
- [ ] Sessions API response includes linked user info (email, name, role)
- [ ] Sessions API response includes session expiry timestamp
- [ ] `SessionPanel` displays user info instead of raw session data
- [ ] Sessions expiring within 1 hour are visually highlighted
- [ ] `SessionPanel` has a manual refresh button
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Verification command**: `cd server && npx tsc --noEmit`
