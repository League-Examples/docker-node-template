---
status: draft
---

# Sprint 013 Use Cases

## SUC-001: Field-Level Audit Trail on Mutations
Parent: Infrastructure

- **Actor**: Any user or system process performing a write operation
- **Preconditions**: AuditLog model exists, AuditService is registered
- **Main Flow**:
  1. User or system triggers a write operation (create, update, delete)
  2. Service captures the object state before the mutation
  3. Service performs the mutation
  4. Service calls AuditService.diff() with before/after snapshots
  5. AuditService compares field values and writes entries for changed fields
  6. Each entry records: userId, objectType, objectId, field, oldValue, newValue, source
- **Postconditions**: AuditLog entries exist for every changed field
- **Acceptance Criteria**:
  - [ ] Creating a record generates audit entries for each populated field
  - [ ] Updating a record generates entries only for changed fields
  - [ ] Deleting a record generates entries with newValue = null
  - [ ] Unchanged fields do not generate entries
  - [ ] Source correctly reflects UI vs MCP vs API

## SUC-002: Audit Source Propagation
Parent: Infrastructure

- **Actor**: ServiceRegistry
- **Preconditions**: ServiceRegistry supports source parameter
- **Main Flow**:
  1. Route middleware creates ServiceRegistry with appropriate source (UI, MCP, API)
  2. Registry injects source into AuditService
  3. All audit entries created through that registry inherit the source
- **Postconditions**: Audit entries automatically have the correct source
- **Acceptance Criteria**:
  - [ ] UI routes produce audit entries with source = UI
  - [ ] MCP handlers produce audit entries with source = MCP
  - [ ] API routes produce audit entries with source = API

## SUC-003: Admin Audit Log Viewer
Parent: Admin Dashboard

- **Actor**: Admin user
- **Preconditions**: User has admin role, audit log entries exist
- **Main Flow**:
  1. Admin navigates to Audit Log panel in admin dashboard
  2. Panel displays paginated list of audit entries (newest first)
  3. Admin filters by object type, object ID, user, or date range
  4. Panel updates to show filtered results
- **Postconditions**: Admin can view and filter audit log entries
- **Acceptance Criteria**:
  - [ ] GET /api/admin/audit-log returns paginated audit entries
  - [ ] Supports filters: objectType, objectId, userId, from, to
  - [ ] Returns entries with user display info (name, email)
  - [ ] Non-admin users get 403
  - [ ] Admin UI panel renders entries with field, old→new, source, timestamp
