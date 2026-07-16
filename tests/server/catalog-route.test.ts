/**
 * Coverage for `server/src/routes/catalog.ts` (ticket 005): `GET
 * /api/catalog/tree` (real `WorkspaceDirectory`/`Collection`/
 * `KnowledgeEntry`/`Asset` browse) and `GET /api/catalog/search` (FTS5
 * passthrough to `services/search.ts`'s `keywordSearch`).
 *
 * Seeds a small fixture directly via Prisma (one `collection`-kind
 * directory with a `Collection` holding two `Asset`+`AssetDescription`
 * rows, one `knowledge-category`-kind directory with a `KnowledgeEntry`)
 * and indexes the asset/knowledge text into the FTS5 `SearchIndex` via
 * `search.ts`'s `indexAssetDescription`/`indexKnowledgeEntry` -- mirrors
 * `tests/server/search.test.ts`'s fixture pattern, since `/catalog/search`
 * reads from `SearchIndex`, not `Asset`/`KnowledgeEntry` directly.
 *
 * `requireAuth`-only gate (this sprint's posture, distinct from
 * `chat.ts`/`postcards.ts`'s prior `requireAdmin`) is verified with a
 * non-admin authenticated user, per ticket 005 AC.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let app: typeof import('../../server/src/app').default;
let prisma: typeof import('../../server/src/services/prisma').prisma;
let indexAssetDescription: typeof import('../../server/src/services/search').indexAssetDescription;
let indexKnowledgeEntry: typeof import('../../server/src/services/search').indexKnowledgeEntry;
let removeFromKeywordIndex: typeof import('../../server/src/services/search').removeFromKeywordIndex;
let versioningService: typeof import('../../server/src/services/versioning').versioningService;

beforeAll(async () => {
  app = (await import('../../server/src/app')).default;
  prisma = (await import('../../server/src/services/prisma')).prisma;
  const search = await import('../../server/src/services/search');
  indexAssetDescription = search.indexAssetDescription;
  indexKnowledgeEntry = search.indexKnowledgeEntry;
  removeFromKeywordIndex = search.removeFromKeywordIndex;
  versioningService = (await import('../../server/src/services/versioning')).versioningService;
});

const marker = `t005005${Date.now()}`;

let regularUserId: number;

const cleanup = {
  directoryIds: [] as number[],
  collectionIds: [] as number[],
  assetIds: [] as number[],
  knowledgeEntryIds: [] as number[],
};

let assetDirId: number;
let collectionId: number;
let robotAssetId: number;
let bannerAssetId: number;
let knowledgeDirId: number;
let styleEntryId: number;

beforeAll(async () => {
  const regular = await prisma.user.create({
    data: {
      email: `${marker}-user@example.com`,
      displayName: 'Catalog Route User',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-user`,
    },
  });
  regularUserId = regular.id;

  const dir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/assets/stock-art`, kind: 'collection' },
  });
  assetDirId = dir.id;
  cleanup.directoryIds.push(dir.id);

  const collection = await prisma.collection.create({
    data: { directoryId: assetDirId, name: `${marker}-collection`, kind: 'stock-art' },
  });
  collectionId = collection.id;
  cleanup.collectionIds.push(collection.id);

  const robotAsset = await prisma.asset.create({
    data: { collectionId, path: `${marker}/assets/robot-hero.png`, hash: 'robot-hash', mtime: new Date() },
  });
  robotAssetId = robotAsset.id;
  cleanup.assetIds.push(robotAsset.id);
  const robotDescription = `${marker} A friendly robot mascot waving`;
  await prisma.assetDescription.create({
    data: {
      assetId: robotAsset.id,
      isPhotograph: false,
      isLogo: false,
      description: robotDescription,
      tags: ['robot', 'mascot'],
    },
  });
  indexAssetDescription({ assetId: robotAsset.id, description: robotDescription, tags: ['robot', 'mascot'] });

  const bannerAsset = await prisma.asset.create({
    data: { collectionId, path: `${marker}/assets/banner.png`, hash: 'banner-hash', mtime: new Date() },
  });
  bannerAssetId = bannerAsset.id;
  cleanup.assetIds.push(bannerAsset.id);
  const bannerDescription = `${marker} A colorful league banner`;
  await prisma.assetDescription.create({
    data: {
      assetId: bannerAsset.id,
      isPhotograph: false,
      isLogo: false,
      description: bannerDescription,
      tags: ['banner'],
    },
  });
  indexAssetDescription({ assetId: bannerAsset.id, description: bannerDescription, tags: ['banner'] });

  const knowledgeDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/knowledge/styles`, kind: 'knowledge-category' },
  });
  knowledgeDirId = knowledgeDir.id;
  cleanup.directoryIds.push(knowledgeDir.id);

  const styleEntry = await prisma.knowledgeEntry.create({
    data: {
      directoryId: knowledgeDirId,
      kind: 'style',
      name: `${marker}-pop-art`,
      bodyText: 'Pop art style with bold outlines and a robot theme',
    },
  });
  styleEntryId = styleEntry.id;
  cleanup.knowledgeEntryIds.push(styleEntry.id);
  indexKnowledgeEntry({ id: styleEntry.id, name: styleEntry.name, bodyText: styleEntry.bodyText });
});

afterAll(async () => {
  for (const id of cleanup.assetIds) {
    removeFromKeywordIndex('asset', id);
  }
  for (const id of cleanup.knowledgeEntryIds) {
    removeFromKeywordIndex('knowledge_entry', id);
  }
  await prisma.assetDescription.deleteMany({ where: { assetId: { in: cleanup.assetIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
  await prisma.knowledgeEntry.deleteMany({ where: { id: { in: cleanup.knowledgeEntryIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.directoryIds } } });
  await prisma.user.deleteMany({ where: { id: regularUserId } });
});

async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-user@example.com`,
    displayName: 'Catalog Route User',
    role: 'USER',
  });
  return agent;
}

describe('GET /api/catalog/tree -- auth gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/catalog/tree');
    expect(res.status).toBe(401);
  });

  it('allows a non-admin authenticated user', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/tree');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/catalog/tree -- shape', () => {
  it('groups real WorkspaceDirectory/Collection/Asset/KnowledgeEntry rows by directory', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/tree');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.directories)).toBe(true);

    const assetDir = res.body.directories.find((d: any) => d.id === assetDirId);
    expect(assetDir).toBeDefined();
    expect(assetDir.kind).toBe('collection');
    expect(assetDir.path).toBe(`${marker}/assets/stock-art`);
    expect(assetDir.name).toBe('stock-art');
    expect(assetDir.collections).toHaveLength(1);

    const collection = assetDir.collections[0];
    expect(collection.id).toBe(collectionId);
    expect(collection.kind).toBe('stock-art');
    expect(collection.assets).toHaveLength(2);

    const robotItem = collection.assets.find((a: any) => a.id === robotAssetId);
    expect(robotItem).toBeDefined();
    expect(robotItem.path).toBe(`${marker}/assets/robot-hero.png`);
    expect(robotItem.description).toContain('friendly robot mascot');
    expect(robotItem.tags).toEqual(['robot', 'mascot']);

    const knowledgeDir = res.body.directories.find((d: any) => d.id === knowledgeDirId);
    expect(knowledgeDir).toBeDefined();
    expect(knowledgeDir.kind).toBe('knowledge-category');
    expect(knowledgeDir.knowledgeEntries).toHaveLength(1);
    expect(knowledgeDir.knowledgeEntries[0].id).toBe(styleEntryId);
    expect(knowledgeDir.knowledgeEntries[0].bodyText).toContain('Pop art style');
  });

  it('never creates a Lock row', async () => {
    const before = await prisma.lock.count();
    const agent = await loginAsUser();
    await agent.get('/api/catalog/tree');
    const after = await prisma.lock.count();
    expect(after).toBe(before);
  });

  it('never calls versioning.recordChange', async () => {
    const spy = vi.spyOn(versioningService, 'recordChange');
    const agent = await loginAsUser();
    await agent.get('/api/catalog/tree');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GET /api/catalog/search -- auth gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/catalog/search').query({ q: marker });
    expect(res.status).toBe(401);
  });

  it('allows a non-admin authenticated user', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search').query({ q: marker });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/catalog/search -- FTS5 keyword search', () => {
  it('matches an asset by its indexed description text, inlining path/description/tags', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search').query({ q: `${marker} mascot` });
    expect(res.status).toBe(200);

    const robotResult = res.body.results.find((r: any) => r.id === robotAssetId);
    expect(robotResult).toBeDefined();
    expect(robotResult.ownerType).toBe('asset');
    expect(robotResult.path).toBe(`${marker}/assets/robot-hero.png`);
    expect(robotResult.description).toContain('friendly robot mascot');
    expect(robotResult.tags).toEqual(['robot', 'mascot']);

    const ownerIds = res.body.results.map((r: any) => r.id);
    expect(ownerIds).not.toContain(bannerAssetId);
  });

  it('matches a knowledge entry by its indexed name/bodyText, inlining bodyText', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search').query({ q: `${marker} pop` });
    expect(res.status).toBe(200);

    const styleResult = res.body.results.find((r: any) => r.id === styleEntryId);
    expect(styleResult).toBeDefined();
    expect(styleResult.ownerType).toBe('knowledge_entry');
    expect(styleResult.bodyText).toContain('Pop art style');
  });

  it('narrows correctly on a multi-word query (AND semantics across all seeded rows)', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search').query({ q: `${marker} robot mascot` });
    expect(res.status).toBe(200);

    // Only the robot asset's row carries both "robot" and "mascot" --
    // the style entry's bodyText has "robot" but not "mascot", and the
    // banner asset has neither.
    const ownerIds = res.body.results.map((r: any) => `${r.ownerType}:${r.id}`);
    expect(ownerIds).toEqual([`asset:${robotAssetId}`]);
  });

  it('returns an empty array (not an error) for a query matching nothing (UC-002 E1)', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search').query({ q: `${marker}-no-such-match-zzz` });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('returns an empty array (not an error) when q is missing', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/catalog/search');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('never creates a Lock row', async () => {
    const before = await prisma.lock.count();
    const agent = await loginAsUser();
    await agent.get('/api/catalog/search').query({ q: `${marker} robot` });
    const after = await prisma.lock.count();
    expect(after).toBe(before);
  });

  it('never calls versioning.recordChange', async () => {
    const spy = vi.spyOn(versioningService, 'recordChange');
    const agent = await loginAsUser();
    await agent.get('/api/catalog/search').query({ q: `${marker} robot` });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
