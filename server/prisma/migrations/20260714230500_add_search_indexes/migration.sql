-- Ticket 002-005: keyword index for the Vector & Full-Text Indexing module
-- (architecture-001 §Vector Index; this sprint's architecture-update.md).
--
-- `SearchIndex` is an FTS5 virtual table that indexes both
-- `AssetDescription` (description, tags) and `KnowledgeEntry` (name,
-- bodyText) content, keyed polymorphically by (ownerType, ownerId) the same
-- way `Embedding` is -- one table serves both content types instead of a
-- per-model FTS5 table. It is populated explicitly by
-- server/src/services/search.ts's indexKnowledgeEntry()/
-- indexAssetDescription() functions (not by SQL triggers mirroring
-- AssetDescription/KnowledgeEntry), since FTS5's automatic content-table
-- sync (`content=`) only supports mirroring a single source table and these
-- two source tables have different column shapes.
--
-- FTS5 is compiled into SQLite core (unlike the `sqlite-vec` extension), so
-- creating it here via the normal Prisma migration path is safe on every
-- platform. The companion `vec0` virtual table (`VecEmbeddings`) is
-- deliberately NOT created here -- `CREATE VIRTUAL TABLE ... USING vec0(...)`
-- requires the sqlite-vec module to already be registered on the connection
-- that runs it, and Prisma's migration engine (a separate process from the
-- app's better-sqlite3 connection) never loads that extension. See
-- server/src/services/search.ts for the lazy, capability-checked creation of
-- `VecEmbeddings` instead.
CREATE VIRTUAL TABLE "SearchIndex" USING fts5(
  ownerType UNINDEXED,
  ownerId UNINDEXED,
  name,
  body,
  tags
);
