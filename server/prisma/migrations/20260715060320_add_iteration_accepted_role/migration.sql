-- Ticket 005-001: additive columns on `Iteration` resolving Sprint 004's
-- Open Question 2 (front/back/accepted state was previously kept inside
-- postcard-content.json only). See
-- clasi/sprints/005-real-two-pane-app/architecture-update.md Step 3
-- (Catalog & Knowledge Store) / Design Rationale R4.
--
-- Both columns are additive with safe defaults so every existing
-- `Iteration` row remains valid: `accepted` defaults to false (0) and
-- `role` defaults to NULL (no role assigned). Hand-authored rather than
-- generated via `prisma migrate dev` because this project's `SearchIndex`
-- FTS5 virtual table (see 20260714230500_add_search_indexes) causes
-- Prisma's shadow-database diff engine to propose dropping the FTS5
-- shadow tables (`SearchIndex_config`, `SearchIndex_data`); a plain
-- `ALTER TABLE ... ADD COLUMN` avoids that diff entirely.
ALTER TABLE "Iteration" ADD COLUMN "accepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Iteration" ADD COLUMN "role" TEXT;
