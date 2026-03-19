---
id: "013"
title: "Audit Logging"
status: planning
branch: sprint/013-audit-logging
use-cases: [SUC-001, SUC-002, SUC-003]
---

# Sprint 013: Audit Logging

## Goals

Add a comprehensive field-level audit trail that records every write
operation: who changed what field, from what value to what value, when,
and through which interface (UI, API, MCP, SYSTEM).

## Problem

The application has no audit trail. When data is changed — a user role
updated, a record deleted, configuration modified — there is no way to
determine who made the change, when, or what the previous value was.
This is a requirement for any production application managing real data.

## Solution

1. Add an `AuditLog` Prisma model with fields for user, object type/ID,
   field name, old/new values, source (UI/API/MCP/SYSTEM), and timestamp.
2. Create an `AuditService` with `write()` and `diff()` methods. The
   `diff()` method compares two object snapshots and logs all changed fields.
3. Integrate audit logging into existing services (UserService,
   PermissionsService, ChannelService, ConfigService) by calling `diff()`
   after mutations.
4. Propagate audit source through the ServiceRegistry so that UI routes,
   MCP handlers, and API routes automatically record the correct source.
5. Add an admin Audit Log panel with filtering by object type, user,
   date range, and pagination.

## Success Criteria

- Every write operation (create, update, delete) generates audit entries
- Audit entries record the actor, object, field, old value, new value, source
- `diff()` skips unchanged fields (no noise)
- ServiceRegistry propagates source (UI, MCP, API) to AuditService
- Admin panel displays audit log with filtering and pagination
- All existing tests continue to pass
- New tests cover AuditService write/diff and admin audit API

## Scope

### In Scope

- AuditLog Prisma model and migration
- AuditService with write() and diff() methods
- Integration with UserService, PermissionsService, ChannelService, ConfigService
- Source propagation through ServiceRegistry
- Admin audit log panel (list, filter, paginate)
- Server tests for AuditService and admin audit API

### Out of Scope

- Audit log export/download
- Audit log retention/cleanup policies
- Client-side audit display outside admin panel
- Audit logging for read operations

## Test Strategy

- Unit tests for AuditService.diff() — verifies correct entries for
  changed/unchanged fields
- Integration tests for audit log admin API — filtering, pagination, auth
- Regression tests — all existing tests must pass with audit logging added

## Architecture Notes

- AuditService is injected via ServiceRegistry alongside other services
- Source is set once at registry creation time, not per-call
- Audit entries use string objectId for flexibility across model types
- Old/new values are stored as strings (null for creates/deletes)
- Indexed on (objectType, objectId), userId, and createdAt for query performance

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

(To be created after sprint approval.)
