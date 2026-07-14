/**
 * Coverage for the predecessor knowledge seed import job (ticket 002-006):
 * `importPredecessorKnowledge` reading a committed fixture directory
 * (`tests/fixtures/predecessor-knowledge/`) that mimics the predecessor
 * `marketing` repo's layout -- not the live sibling repo, so this suite is
 * hermetic and runs the same in CI as it does locally (see the ticket's
 * Testing Plan).
 *
 * The fixture mirrors the real repo's quirks on purpose: a non-markdown
 * `palettes/index.html` and a non-markdown `layouts/zone-maps/`
 * subdirectory, both of which must be skipped by the ".md files only,
 * non-recursive" read.
 */
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { prisma } from '../../server/src/services/prisma';
import { resolveWorkspacePath } from '../../server/src/services/workspaceDirectorySync';
import { importPredecessorKnowledge } from '../../server/src/scripts/import-predecessor-knowledge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/predecessor-knowledge');

// Fixture content: 3 styles, 2 palettes (+1 skipped index.html), 3
// compositions, 2 layouts (+1 skipped zone-maps/ subdirectory) -- see
// tests/fixtures/predecessor-knowledge/.
const EXPECTED_COUNTS = { style: 3, palette: 2, composition: 3, layout: 2 };

let previousWorkspaceDir: string | undefined;
let testWorkspaceRoot: string;

async function cleanupImportedRows() {
  const kinds = ['style', 'palette', 'composition', 'layout'];
  const names = [
    'pop-art',
    'manga',
    'flat-poster',
    'brand-guide',
    'midnight-arcade',
    'action-page',
    'hero-pose',
    'multi-panel',
    'postcard-4x6',
    'full-page-flyer',
  ];
  await prisma.knowledgeEntry.deleteMany({ where: { kind: { in: kinds }, name: { in: names } } });
  const dirPaths = [
    'knowledge/styles/pop-art',
    'knowledge/styles/manga',
    'knowledge/styles/flat-poster',
    'knowledge/palettes/brand-guide',
    'knowledge/palettes/midnight-arcade',
    'knowledge/compositions/action-page',
    'knowledge/compositions/hero-pose',
    'knowledge/compositions/multi-panel',
    'knowledge/layouts/postcard-4x6',
    'knowledge/layouts/full-page-flyer',
  ];
  await prisma.workspaceDirectory.deleteMany({ where: { path: { in: dirPaths } } });
}

beforeAll(async () => {
  testWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-import-knowledge-test-'));
  previousWorkspaceDir = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = testWorkspaceRoot;
  await cleanupImportedRows();
});

afterAll(async () => {
  await cleanupImportedRows();
  if (previousWorkspaceDir === undefined) {
    delete process.env.WORKSPACE_DIR;
  } else {
    process.env.WORKSPACE_DIR = previousWorkspaceDir;
  }
  await fs.rm(testWorkspaceRoot, { recursive: true, force: true });
});

describe('importPredecessorKnowledge', () => {
  it('fails loudly (throws) when the source path does not exist, rather than silently no-oping', async () => {
    const missingRoot = path.join(FIXTURE_ROOT, 'does-not-exist');
    await expect(importPredecessorKnowledge(missingRoot, prisma)).rejects.toThrow(/source path not found/);
  });

  it('imports styles, palettes, compositions, and layouts from the fixture, skipping non-.md entries', async () => {
    const counts = await importPredecessorKnowledge(FIXTURE_ROOT, prisma);
    expect(counts).toEqual(EXPECTED_COUNTS);
  });

  it('creates a KnowledgeEntry for each fixture style with kind="style", the slug as name, and non-empty bodyText combining positive+negative', async () => {
    for (const slug of ['pop-art', 'manga', 'flat-poster']) {
      const entry = await prisma.knowledgeEntry.findFirst({ where: { kind: 'style', name: slug } });
      expect(entry).not.toBeNull();
      expect(entry!.bodyText.length).toBeGreaterThan(0);
      expect(entry!.bodyText).toContain('---');
    }
  });

  it('creates KnowledgeEntry rows for palettes, compositions, and layouts with the correct kind', async () => {
    const palette = await prisma.knowledgeEntry.findFirst({ where: { kind: 'palette', name: 'brand-guide' } });
    expect(palette).not.toBeNull();
    expect(palette!.bodyText.length).toBeGreaterThan(0);

    const composition = await prisma.knowledgeEntry.findFirst({ where: { kind: 'composition', name: 'action-page' } });
    expect(composition).not.toBeNull();
    expect(composition!.bodyText.length).toBeGreaterThan(0);

    const layout = await prisma.knowledgeEntry.findFirst({ where: { kind: 'layout', name: 'postcard-4x6' } });
    expect(layout).not.toBeNull();
    expect(layout!.bodyText.length).toBeGreaterThan(0);
  });

  it('does not import the non-markdown palettes/index.html or the layouts/zone-maps/ subdirectory', async () => {
    const indexEntry = await prisma.knowledgeEntry.findFirst({ where: { kind: 'palette', name: 'index' } });
    expect(indexEntry).toBeNull();
    const zoneMapsEntry = await prisma.knowledgeEntry.findFirst({ where: { kind: 'layout', name: 'zone-maps' } });
    expect(zoneMapsEntry).toBeNull();
  });

  it('places each imported entry under a matching WorkspaceDirectory row with a synced _dir.json mirror', async () => {
    const dir = await prisma.workspaceDirectory.findUnique({ where: { path: 'knowledge/styles/pop-art' } });
    expect(dir).not.toBeNull();

    const entry = await prisma.knowledgeEntry.findFirst({ where: { kind: 'style', name: 'pop-art' } });
    expect(entry!.directoryId).toBe(dir!.id);

    const mirrorPath = path.join(resolveWorkspacePath('knowledge/styles/pop-art'), '_dir.json');
    const raw = await fs.readFile(mirrorPath, 'utf8');
    expect(JSON.parse(raw)).toEqual(dir!.descriptorJson);
  });

  it('is idempotent -- running twice does not create duplicate KnowledgeEntry rows, and updates content in place', async () => {
    const before = await prisma.knowledgeEntry.count({
      where: { kind: { in: ['style', 'palette', 'composition', 'layout'] }, name: { in: ['pop-art', 'brand-guide', 'action-page', 'postcard-4x6'] } },
    });

    const secondRunCounts = await importPredecessorKnowledge(FIXTURE_ROOT, prisma);
    expect(secondRunCounts).toEqual(EXPECTED_COUNTS);

    const after = await prisma.knowledgeEntry.count({
      where: { kind: { in: ['style', 'palette', 'composition', 'layout'] }, name: { in: ['pop-art', 'brand-guide', 'action-page', 'postcard-4x6'] } },
    });
    expect(after).toBe(before);

    const popArtEntries = await prisma.knowledgeEntry.findMany({ where: { kind: 'style', name: 'pop-art' } });
    expect(popArtEntries).toHaveLength(1);
  });
});
