import '../env';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma, initPrisma, disconnectPrisma } from '../services/prisma';
import { resolveWorkspacePath, writeDirDescriptor } from '../services/workspaceDirectorySync';

/**
 * Predecessor knowledge seed import job (ticket 002-006).
 *
 * One-time (but idempotent, re-runnable) import of the predecessor
 * `marketing` repo's opinionated style/palette/composition/layout prompt
 * text into `KnowledgeEntry` rows, so Sprint 003's Agent Runtime has real
 * content to assemble prompts from instead of an empty knowledge store. Per
 * architecture-update.md's Open Question 2, this imports *all* predecessor
 * content (10 styles, all palettes, all compositions, all layouts) rather
 * than a subset.
 *
 * Source layout read (predecessor repo root):
 *  - `app/prompts/styles/<slug>/{positive,negative}.md` -> kind 'style'
 *  - `app/prompts/palettes/*.md`                        -> kind 'palette'
 *  - `app/prompts/compositions/*.md`                    -> kind 'composition'
 *  - `app/layouts/*.md`                                 -> kind 'layout'
 * Only files directly inside each directory ending in `.md` are read (e.g.
 * `app/prompts/palettes/index.html` and `app/layouts/zone-maps/` are
 * skipped -- they aren't knowledge prompt text).
 *
 * Natural-key upsert convention: every imported `KnowledgeEntry` is keyed by
 * (`kind`, `name`) -- not `id` -- and looked up with `findFirst` + update-or-
 * create rather than a DB-level `upsert()`, since the schema has no unique
 * constraint on that pair. Re-running this script against the same source
 * therefore updates existing rows in place instead of creating duplicates.
 * Any future importer of additional predecessor content (e.g. a later
 * sprint's asset catalog import) should follow the same (kind, name)
 * natural-key pattern for the same reason.
 *
 * Each entry is filed under a `WorkspaceDirectory` row at
 * `knowledge/<kind-plural>/<slug>/` (created via ticket 004's
 * `writeDirDescriptor` sync utility if not already scaffolded), so the
 * import produces both DB rows and correct `_dir.json` mirrors.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default predecessor repo location for local/dev use: a sibling checkout
// at `<...>/infrastructure/marketing`, matching this repo's actual layout
// (`<...>/infrastructure/flyerbot`). Resolved relative to this file's own
// location (not `process.cwd()`) so the default works the same whether the
// script is invoked from the repo root or from `server/`. Override with
// `PREDECESSOR_REPO_PATH` for any other location (CI never sets this --
// see the "fails loudly" behavior below).
export const DEFAULT_SOURCE_ROOT = path.resolve(__dirname, '../../../../marketing');

export const STYLE_KIND = 'style';
export const PALETTE_KIND = 'palette';
export const COMPOSITION_KIND = 'composition';
export const LAYOUT_KIND = 'layout';

export interface ImportCounts {
  style: number;
  palette: number;
  composition: number;
  layout: number;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

interface MarkdownFile {
  slug: string;
  filePath: string;
}

/** Lists `.md` files directly inside `dir` (non-recursive), sorted by slug for deterministic import order. */
async function listMarkdownFiles(dir: string): Promise<MarkdownFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => ({ slug: entry.name.replace(/\.md$/, ''), filePath: path.join(dir, entry.name) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Ensures a `WorkspaceDirectory` row exists at `knowledge/<kindPlural>/<slug>/`,
 * parented under `knowledge/<kindPlural>/` when that category directory has
 * already been scaffolded (ticket 004), and re-syncs its `_dir.json` mirror.
 * Returns the row's id for use as `KnowledgeEntry.directoryId`.
 */
async function ensureKnowledgeDirectory(client: any, kindPlural: string, slug: string): Promise<number> {
  const relPath = `knowledge/${kindPlural}/${slug}`;
  const existing = await client.workspaceDirectory.findUnique({ where: { path: relPath } });
  if (existing) {
    await writeDirDescriptor(existing);
    return existing.id;
  }

  const parent = await client.workspaceDirectory.findUnique({ where: { path: `knowledge/${kindPlural}` } });
  const row = await client.workspaceDirectory.create({
    data: {
      path: relPath,
      kind: 'knowledge-category',
      parentId: parent ? parent.id : null,
      descriptorJson: { kind: 'knowledge-category', name: slug },
    },
  });
  await writeDirDescriptor(row);
  return row.id;
}

/** Upserts a `KnowledgeEntry` by the (kind, name) natural key -- see module doc comment. */
async function upsertKnowledgeEntry(
  client: any,
  params: { kind: string; name: string; bodyText: string; structuredFields?: unknown; directoryId: number }
): Promise<void> {
  const existing = await client.knowledgeEntry.findFirst({ where: { kind: params.kind, name: params.name } });
  const data = {
    bodyText: params.bodyText,
    structuredFields: params.structuredFields ?? null,
    directoryId: params.directoryId,
  };

  if (existing) {
    await client.knowledgeEntry.update({ where: { id: existing.id }, data });
  } else {
    await client.knowledgeEntry.create({ data: { kind: params.kind, name: params.name, ...data } });
  }
}

/**
 * Imports the 10 predecessor styles from `app/prompts/styles/<slug>/`.
 * Each style's `positive.md` and `negative.md` are combined into one
 * `bodyText`, positive first, separated by a `---` delimiter, so the
 * documented "not formalizing this too much" combination is simple and
 * human-readable in the DB. Missing halves (should not happen against a
 * real predecessor checkout) read as an empty string rather than failing
 * the whole import.
 */
async function importStyles(client: any, sourceRoot: string): Promise<number> {
  const stylesDir = path.join(sourceRoot, 'app/prompts/styles');
  if (!(await pathExists(stylesDir))) return 0;

  const entries = await fs.readdir(stylesDir, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let count = 0;
  for (const slug of slugs) {
    const [positive, negative] = await Promise.all([
      fs.readFile(path.join(stylesDir, slug, 'positive.md'), 'utf8').catch(() => ''),
      fs.readFile(path.join(stylesDir, slug, 'negative.md'), 'utf8').catch(() => ''),
    ]);
    const bodyText = `${positive.trim()}\n\n---\n\n${negative.trim()}`.trim();

    const directoryId = await ensureKnowledgeDirectory(client, 'styles', slug);
    await upsertKnowledgeEntry(client, { kind: STYLE_KIND, name: slug, bodyText, directoryId });
    count += 1;
  }
  return count;
}

/**
 * Imports every `.md` file directly inside `relSourceDir` as one
 * `KnowledgeEntry` of `kind`, using the filename stem as `name`/slug and the
 * raw file content (trimmed) as `bodyText`. Shared by palettes,
 * compositions, and layouts -- all three predecessor directories are a flat
 * list of one-file-per-entry prompt text with no further structure to
 * capture in `structuredFields`.
 */
async function importFlatMarkdownKind(
  client: any,
  sourceRoot: string,
  relSourceDir: string,
  kind: string,
  kindPlural: string
): Promise<number> {
  const dir = path.join(sourceRoot, relSourceDir);
  if (!(await pathExists(dir))) return 0;

  const files = await listMarkdownFiles(dir);
  let count = 0;
  for (const { slug, filePath } of files) {
    const bodyText = (await fs.readFile(filePath, 'utf8')).trim();
    const directoryId = await ensureKnowledgeDirectory(client, kindPlural, slug);
    await upsertKnowledgeEntry(client, { kind, name: slug, bodyText, directoryId });
    count += 1;
  }
  return count;
}

/**
 * Runs the full import against `sourceRoot` (the predecessor repo's root
 * directory). Fails loudly -- throws, does not silently no-op -- if
 * `sourceRoot` does not exist, per the ticket's acceptance criterion that
 * this script must not fail `npm test`/the build (it is never called from
 * either) but also must not pretend to succeed when the source isn't
 * present (e.g. CI, a future production host without the sibling checkout).
 *
 * `client` defaults to the app's shared Prisma client; tests pass their own
 * to keep assertions scoped to test-created rows.
 */
export async function importPredecessorKnowledge(sourceRoot: string, client: any = prisma): Promise<ImportCounts> {
  if (!(await pathExists(sourceRoot))) {
    throw new Error(
      `import-predecessor-knowledge: source path not found: ${sourceRoot}. ` +
        'This script requires a checkout of the predecessor marketing repo to import from -- ' +
        'set PREDECESSOR_REPO_PATH to its location, or pass an explicit sourceRoot. It does not ' +
        'silently no-op when the source is unavailable.'
    );
  }

  const style = await importStyles(client, sourceRoot);
  const palette = await importFlatMarkdownKind(client, sourceRoot, 'app/prompts/palettes', PALETTE_KIND, 'palettes');
  const composition = await importFlatMarkdownKind(
    client,
    sourceRoot,
    'app/prompts/compositions',
    COMPOSITION_KIND,
    'compositions'
  );
  const layout = await importFlatMarkdownKind(client, sourceRoot, 'app/layouts', LAYOUT_KIND, 'layouts');

  return { style, palette, composition, layout };
}

// Run directly (`tsx src/scripts/import-predecessor-knowledge.ts`), not on
// import -- lets tests import the functions above without side effects, and
// keeps this out of `npm test` / `prisma migrate dev` per the ticket's
// acceptance criteria (must be explicitly invoked).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  (async () => {
    const sourceRoot = process.env.PREDECESSOR_REPO_PATH
      ? path.resolve(process.env.PREDECESSOR_REPO_PATH)
      : DEFAULT_SOURCE_ROOT;

    // Touch the workspace root so writeDirDescriptor's fs.mkdir calls below
    // never race an entirely-absent workspace/ tree on a fresh checkout.
    await fs.mkdir(resolveWorkspacePath('.'), { recursive: true });

    await initPrisma();
    try {
      const counts = await importPredecessorKnowledge(sourceRoot);
      console.log(
        `Predecessor knowledge import complete (source: ${sourceRoot}): ` +
          `${counts.style} style(s), ${counts.palette} palette(s), ` +
          `${counts.composition} composition(s), ${counts.layout} layout(s).`
      );
    } finally {
      await disconnectPrisma();
    }
  })().catch((err) => {
    console.error('Predecessor knowledge import failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
