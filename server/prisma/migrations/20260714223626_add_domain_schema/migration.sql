-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Counter";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentProjectId" INTEGER,
    "ownerUserId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detailsHeader" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Iteration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "imagePath" TEXT NOT NULL,
    "promptUsed" TEXT NOT NULL,
    "modelParams" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Iteration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "Reference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "directoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "Collection_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "WorkspaceDirectory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" INTEGER NOT NULL,
    "sourceIterationId" INTEGER,
    "path" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "mtime" DATETIME NOT NULL,
    CONSTRAINT "Asset_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_sourceIterationId_fkey" FOREIGN KEY ("sourceIterationId") REFERENCES "Iteration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetDescription" (
    "assetId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "isPhotograph" BOOLEAN NOT NULL,
    "isLogo" BOOLEAN NOT NULL,
    "style" TEXT,
    "peopleReal" TEXT,
    "description" TEXT NOT NULL,
    "tags" JSONB,
    CONSTRAINT "AssetDescription_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "directoryId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "structuredFields" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeEntry_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "WorkspaceDirectory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeCorrection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "proposedByUserId" INTEGER NOT NULL,
    "contextProjectId" INTEGER,
    "diff" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "KnowledgeCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCorrection_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCorrection_contextProjectId_fkey" FOREIGN KEY ("contextProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerType" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "vector" BLOB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkspaceDirectory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentId" INTEGER,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "descriptorJson" JSONB,
    CONSTRAINT "WorkspaceDirectory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkspaceDirectory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "resourceType" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "holder" TEXT,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Iteration_projectId_idx" ON "Iteration"("projectId");

-- CreateIndex
CREATE INDEX "ChatMessage_projectId_idx" ON "ChatMessage"("projectId");

-- CreateIndex
CREATE INDEX "Reference_projectId_idx" ON "Reference"("projectId");

-- CreateIndex
CREATE INDEX "Reference_assetId_idx" ON "Reference"("assetId");

-- CreateIndex
CREATE INDEX "Collection_directoryId_idx" ON "Collection"("directoryId");

-- CreateIndex
CREATE INDEX "Asset_collectionId_idx" ON "Asset"("collectionId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_directoryId_idx" ON "KnowledgeEntry"("directoryId");

-- CreateIndex
CREATE INDEX "KnowledgeCorrection_entryId_idx" ON "KnowledgeCorrection"("entryId");

-- CreateIndex
CREATE INDEX "Embedding_ownerType_ownerId_idx" ON "Embedding"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceDirectory_path_key" ON "WorkspaceDirectory"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Lock_resourceType_resourceKey_key" ON "Lock"("resourceType", "resourceKey");

