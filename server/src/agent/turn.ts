/**
 * Agent Runtime turn controller (architecture-001 §Module 3; this
 * sprint's architecture-update.md Step 3 "Agent Runtime" bullet; ticket
 * 005). The one place in this sprint that composes tickets 001-004: fresh
 * context reconstruction from `ChatMessage` history plus unmoderated
 * knowledge retrieval (D8/D9), the active `ProviderAdapter` (ticket 004),
 * the Workspace MCP Server's tool handlers (tickets 002/003, called
 * in-process -- this module imports and calls the same pure functions
 * `fsTools.ts`/`catalogTools.ts` register on `workspaceMcpServer`, not an
 * HTTP or MCP-transport client), the shared `project_turn` `Lock`
 * (`locks.ts`), and the Versioning Service's batched `commitTurn`.
 *
 * Loop shape: acquire the `project_turn` lock -> reconstruct context
 * (history + knowledge retrieval) -> call the provider -> if it returns
 * tool calls, dispatch each to the Workspace MCP Server and feed results
 * back, repeat -> once it returns a final message, persist `ChatMessage`
 * rows for the whole exchange -> `commitTurn` -> release the lock (always,
 * success or error).
 *
 * **Statelessness (D8)**: `runTurn` reads no in-memory or cross-request
 * session state -- every call reloads the project's `ChatMessage` history
 * and re-runs knowledge retrieval fresh from the DB/search index. A
 * process restart between two turns is invisible to this function; the
 * next call reconstructs the identical context from the same rows.
 *
 * **`create_project` argument injection (ticket 007-002, SUC-002)**: like
 * `activeFace` below (asserted to the model as context, never a tool
 * input), the model is never expected to know or ask for internal IDs --
 * `dispatchToolCall`'s pre-dispatch step (`injectCreateProjectArgs`) fills
 * `version`/`ownerUserId` on a `create_project` update from the project row
 * this turn already scopes, and `ownerUserId` on a brand-new project from
 * `RunTurnInput.authenticatedUserId`, only where the model's own args left
 * a gap. `catalogTools.createProject`'s validation itself is unchanged.
 *
 * **Turn serialization (R5, this ticket's AC5)**: the `Lock` table's
 * unique constraint rejects a conflicting acquisition immediately
 * (`LockConflictError`, see `agent-mcp/locks.ts`) rather than queuing at
 * the DB layer -- so this module adds a bounded wait/retry loop
 * (`acquireProjectTurnLock`) on top of that primitive, giving a
 * concurrent turn-start on the *same* project queue-and-wait semantics
 * (Open Question 5: "a bounded wait with a clear... timeout") while a
 * different project's turn, or any read-only call, is never blocked by it
 * (different `resourceKey`, no contention at all).
 */
import { prisma as defaultPrisma } from '../services/prisma';
import { keywordSearch } from '../services/search';
import { acquireLock, releaseLock, LockConflictError } from '../agent-mcp/locks';
import { versioningService as defaultVersioningService, type CommitResult } from '../services/versioning';
import { createAnthropicAdapter } from './providers/anthropic';
import type {
  ProviderAdapter,
  ProviderMessage,
  ProviderToolCall,
  ProviderToolCallRecord,
  ProviderToolDefinition,
  ProviderTurnResult,
} from './providers/types';
import { createStubImageVisionClient, type ImageVisionClient, type GenerateImageResult } from './imageVisionStub';
import * as fsTools from '../agent-mcp/fsTools';
import * as catalogTools from '../agent-mcp/catalogTools';
import type { VersioningRecorder } from '../agent-mcp/fsTools';
import type { ChatMessageModel } from '../generated/prisma/models/ChatMessage';
import type { ProjectModel } from '../generated/prisma/models/Project';

// ---------------------------------------------------------------------------
// Lock acquisition: bounded wait/retry on top of locks.ts's reject-on-
// conflict primitive (see module header).
// ---------------------------------------------------------------------------

const PROJECT_TURN_RESOURCE_TYPE = 'project_turn';
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 25;

/** Thrown when a turn could not acquire the `project_turn` lock within
 * the configured bound -- a different, already-in-progress turn on the
 * same project held it the whole time. Distinguishable so a caller (e.g.
 * `routes/chat.ts`) can surface a clear "still working on your last
 * message" error rather than a generic failure. */
export class TurnLockTimeoutError extends Error {
  readonly projectId: number;
  readonly timeoutMs: number;

  constructor(projectId: number, timeoutMs: number) {
    super(
      `Turn for project ${projectId} timed out after ${timeoutMs}ms waiting for another turn on this project to finish`
    );
    this.name = 'TurnLockTimeoutError';
    this.projectId = projectId;
    this.timeoutMs = timeoutMs;
  }
}

async function acquireProjectTurnLock(
  projectId: number,
  options: {
    holder?: string;
    prismaClient?: any;
    timeoutMs?: number;
    pollIntervalMs?: number;
    onWait?: () => void;
  } = {}
): Promise<void> {
  const resourceKey = String(projectId);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let waited = false;

  for (;;) {
    try {
      await acquireLock(PROJECT_TURN_RESOURCE_TYPE, resourceKey, options.holder, options.prismaClient);
      return;
    } catch (err) {
      if (!(err instanceof LockConflictError)) throw err;
      if (Date.now() >= deadline) {
        throw new TurnLockTimeoutError(projectId, timeoutMs);
      }
      if (!waited) {
        waited = true;
        options.onWait?.();
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace MCP Server tool dispatch table -- the exact pure functions
// `agent-mcp/fsTools.ts` and `agent-mcp/catalogTools.ts` register on
// `workspaceMcpServer`, called in-process (see module header).
// ---------------------------------------------------------------------------

export interface WorkspaceToolOptions {
  versioning?: VersioningRecorder;
  lockHolder?: string;
  prismaClient?: any;
}

export type WorkspaceToolHandler = (args: any, options: WorkspaceToolOptions) => Promise<unknown>;

/** The 11 tools tickets 002/003 registered on `workspaceMcpServer`, plus
 * ticket 005-002's four more (`add_reference`, `remove_reference`,
 * `set_iteration_state`, `search_catalog`) -- 15 total, dispatched here by
 * name -- and no others (R2: fixed, statically-registered tool surface). */
export const DEFAULT_TOOL_HANDLERS: Record<string, WorkspaceToolHandler> = {
  read_file: (args) => fsTools.readFile(args),
  stat: (args) => fsTools.statPath(args),
  move_file: (args, options) => fsTools.moveFile(args, options),
  create_directory: (args, options) => fsTools.createDirectory(args, options),
  create_knowledge_entry: (args, options) => catalogTools.createKnowledgeEntry(args, options),
  propose_correction: (args, options) => catalogTools.proposeCorrection(args, options),
  resolve_correction: (args, options) => catalogTools.resolveCorrection(args, options),
  add_asset_to_collection: (args, options) => catalogTools.addAssetToCollection(args, options),
  create_project: (args, options) => catalogTools.createProject(args, options),
  create_iteration: (args, options) => catalogTools.createIteration(args, options),
  create_agent_page: (args, options) => catalogTools.createAgentPage(args, options),
  add_reference: (args, options) => catalogTools.addReference(args, options),
  remove_reference: (args, options) => catalogTools.removeReference(args, options),
  set_iteration_state: (args, options) => catalogTools.setIterationState(args, options),
  search_catalog: (args, options) => catalogTools.searchCatalog(args, options),
};

/** Tool definitions handed to `ProviderAdapter.sendTurn` -- the
 * provider-neutral shape (name/description/JSON-schema-ish inputSchema)
 * mirroring the zod schemas `fsTools.ts`/`catalogTools.ts` register on
 * `workspaceMcpServer` (kept in sync by hand; both describe the same 15
 * tools, not two independent tool surfaces). */
export const WORKSPACE_TOOL_DEFINITIONS: ProviderToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file under the workspace root. Returns base64-encoded content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root' } },
      required: ['path'],
    },
  },
  {
    name: 'stat',
    description: 'Get metadata for a path under the workspace root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root' } },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move/rename a file or directory within the workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path relative to the workspace root' },
        destination: { type: 'string', description: 'Destination path relative to the workspace root' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and any missing parents) under the workspace root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root' } },
      required: ['path'],
    },
  },
  {
    name: 'create_knowledge_entry',
    description:
      "Create a new KnowledgeEntry, or update an existing one's metadata (id + version; never bodyText -- use propose_correction/resolve_correction for that).",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Update an existing entry (requires version) instead of creating.' },
        version: { type: 'integer', description: 'Required with id: the version last read.' },
        directoryId: { type: 'integer', description: 'Required to create.' },
        kind: { type: 'string', description: 'Required to create.' },
        name: { type: 'string', description: 'Required to create.' },
        bodyText: { type: 'string', description: 'Required to create; not accepted on update.' },
        structuredFields: {},
      },
    },
  },
  {
    name: 'propose_correction',
    description: 'Propose a correction to a KnowledgeEntry as a unified diff. Does not modify the entry.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'integer' },
        proposedBodyText: { type: 'string' },
        proposedByUserId: { type: 'integer' },
        contextProjectId: { type: 'integer' },
      },
      required: ['entryId', 'proposedBodyText', 'proposedByUserId'],
    },
  },
  {
    name: 'resolve_correction',
    description:
      'Accept or reject a pending KnowledgeCorrection. Accept applies the diff and bumps the entry version; reject only changes the correction status.',
    inputSchema: {
      type: 'object',
      properties: {
        correctionId: { type: 'integer' },
        action: { type: 'string', enum: ['accept', 'reject'] },
      },
      required: ['correctionId', 'action'],
    },
  },
  {
    name: 'add_asset_to_collection',
    description:
      'Add an Asset row to a named Collection under a WorkspaceDirectory, creating the Collection if it does not already exist.',
    inputSchema: {
      type: 'object',
      properties: {
        directoryId: { type: 'integer' },
        collectionName: { type: 'string' },
        collectionKind: { type: 'string' },
        path: { type: 'string' },
        hash: { type: 'string' },
        mtime: { type: 'string' },
        sourceIterationId: { type: 'integer' },
      },
      required: ['directoryId', 'collectionName', 'path', 'hash'],
    },
  },
  {
    name: 'create_project',
    description: "Create a new Project (optionally a subproject via parentProjectId), or update an existing one's metadata (id + version).",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        version: { type: 'integer' },
        title: { type: 'string' },
        ownerUserId: { type: 'integer' },
        parentProjectId: { type: 'integer' },
        detailsHeader: {},
        status: { type: 'string' },
      },
    },
  },
  {
    name: 'create_iteration',
    description: 'Add a new Iteration row to a Project. Always inserts -- never overwrites an existing iteration.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer' },
        imagePath: { type: 'string' },
        promptUsed: { type: 'string' },
        modelParams: {},
        seq: { type: 'integer' },
      },
      required: ['projectId', 'imagePath', 'promptUsed'],
    },
  },
  {
    name: 'create_agent_page',
    description: 'Write a self-contained agent-authored page file to projects/<id>/outputs/ and record a minimal output-metadata Iteration row.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer' },
        filename: { type: 'string' },
        content: { type: 'string' },
        contentType: { type: 'string' },
      },
      required: ['projectId', 'filename', 'content'],
    },
  },
  {
    name: 'add_reference',
    description:
      "Create a Reference row linking an Asset to a Project with a role ('style' | 'composition' | 'template').",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer' },
        assetId: { type: 'integer' },
        role: { type: 'string', description: "'style' | 'composition' | 'template'" },
      },
      required: ['projectId', 'assetId', 'role'],
    },
  },
  {
    name: 'remove_reference',
    description: 'Delete a Reference row by id.',
    inputSchema: {
      type: 'object',
      properties: { referenceId: { type: 'integer' } },
      required: ['referenceId'],
    },
  },
  {
    name: 'set_iteration_state',
    description:
      "Update an Iteration's accepted/role flags. role is stream membership ('front'|'back'); many Iterations may share a role. Setting accepted: true clears accepted from every OTHER Iteration sharing the same (projectId, role) stream only. Setting role never affects any other Iteration's role.",
    inputSchema: {
      type: 'object',
      properties: {
        iterationId: { type: 'integer' },
        accepted: { type: 'boolean' },
        role: { type: ['string', 'null'], enum: ['front', 'back', null] },
      },
      required: ['iterationId'],
    },
  },
  {
    name: 'search_catalog',
    description:
      'Hybrid vector + keyword search over the Catalog & Knowledge Store (Asset/KnowledgeEntry rows), merged and deduped by (ownerType, ownerId).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        k: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate a new image via the Image & Vision Service and record it as a new Iteration on the project. Always inserts a new Iteration -- never overwrites an existing one.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt text describing the desired image.' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional filesystem paths to reference images for an edit-style generation. Note: nest under modelParams.referenceImages -- this call site only forwards prompt and modelParams.',
        },
        modelParams: {
          description:
            'Optional free-form model parameters (e.g. size, referenceImages, background), passed through unmodified to the Image & Vision Service.',
        },
      },
      required: ['prompt'],
    },
  },
];

/** Not a registered Workspace MCP Server tool by itself -- a second
 * dispatch target this turn controller recognizes for the injected
 * `ImageVisionClient` (Sprint 003 AC8). Ticket 004-002 added a matching
 * `generate_image` entry to `WORKSPACE_TOOL_DEFINITIONS` above (so a
 * `ProviderAdapter` can see and call it) and wired the real,
 * `imaging.ts`-backed client (`realImageVisionClient.ts`) into
 * production (`routes/chat.ts`) -- this constant and the dispatch shape
 * below are unchanged from Sprint 003. */
export const IMAGE_GENERATION_TOOL_NAME = 'generate_image';

// ---------------------------------------------------------------------------
// Context reconstruction (D8: no in-memory/cross-request session state).
// ---------------------------------------------------------------------------

async function loadHistory(projectId: number, prismaClient: any): Promise<ChatMessageModel[]> {
  return prismaClient.chatMessage.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
  });
}

/** Maps a persisted `ChatMessage` row from a *past* turn back into a
 * `ProviderMessage` for the next turn's history. A past tool-call round
 * (role `assistant`, non-null `toolCalls`) is rendered as plain
 * conversational text summarizing what was called and its result --
 * deliberately not as `ProviderMessage.toolCalls`/`toolResults`, which
 * only make sense for the *live*, in-progress tool-call round-trip within
 * one `sendTurn` exchange (matching provider-call ids that no longer
 * exist once a turn is over and persisted). */
export function chatMessageToProviderMessage(row: ChatMessageModel): ProviderMessage {
  const role = row.role === 'assistant' ? 'assistant' : 'user';
  if (role === 'assistant' && row.toolCalls) {
    const records = row.toolCalls as unknown as ProviderToolCallRecord[];
    const summary = records
      .map((r) => `Called tool "${r.name}" with args ${JSON.stringify(r.args)} -> result ${JSON.stringify(r.result)}`)
      .join('\n');
    return { role, content: row.content ? `${row.content}\n${summary}` : summary };
  }
  return { role, content: row.content };
}

/** Base system prompt, prepended to knowledge-retrieval results when any
 * are found. Deliberately generic -- postcard/flyer-specific prompt
 * content generation is Sprint 004/005 scope. */
const SYSTEM_PROMPT_BASE =
  'You are the Flyerbot design assistant. Help the project owner develop postcard/flyer concepts. ' +
  "Use only the tools provided when a change to the project's workspace or catalog is needed -- never fabricate a tool call for anything outside that list.";

// ---------------------------------------------------------------------------
// Project + active-stream context (Sprint 005 OOP change, 2026-07-15): the
// chat box previously "had no sense of what project it's in" -- every turn
// now loads the Project row (title/status/detailsHeader) plus a brief
// Iteration/Reference summary from the DB (D8: fresh every call, same as
// history/knowledge retrieval above) and folds it into the system prompt as
// a concise PROJECT CONTEXT block, alongside a plain statement of which
// stream (`RunTurnInput.activeFace`) the user is currently on so a
// `generate_image` call this turn lands in the right stream. `activeFace`
// itself stays out of `WORKSPACE_TOOL_DEFINITIONS` -- it is asserted to the
// model as context, never offered as something to reason about or pass as
// a tool argument.
// ---------------------------------------------------------------------------

interface ProjectContextIteration {
  seq: number;
  role: string | null;
  accepted: boolean;
}

interface ProjectContextReference {
  role: string;
  label: string;
}

export interface ProjectContext {
  project: Pick<ProjectModel, 'title' | 'status' | 'detailsHeader'>;
  iterations: ProjectContextIteration[];
  references: ProjectContextReference[];
}

/** Loads the project + a lightweight iterations/references summary for the
 * PROJECT CONTEXT block below. Returns `null` when the project row itself
 * can't be found (e.g. a stale/bad `projectId`) -- best-effort, like
 * `retrieveKnowledge`: a missing project degrades the prompt rather than
 * failing the whole turn. */
async function loadProjectContext(projectId: number, prismaClient: any): Promise<ProjectContext | null> {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    select: { title: true, status: true, detailsHeader: true },
  });
  if (!project) return null;

  const iterations = await prismaClient.iteration.findMany({
    where: { projectId },
    select: { seq: true, role: true, accepted: true },
    orderBy: { seq: 'asc' },
  });

  const references = await prismaClient.reference.findMany({
    where: { projectId },
    select: {
      role: true,
      asset: { select: { path: true, description: { select: { description: true } } } },
    },
  });

  return {
    project,
    iterations,
    references: references.map((r: any) => ({
      role: r.role,
      label: r.asset?.description?.description || r.asset?.path || 'untitled asset',
    })),
  };
}

/** Renders `Project.detailsHeader` (free-form JSON filled in by the model
 * itself via `create_project`, e.g. `style`/`outputType`/`goal` -- see
 * `client/src/pages/ProjectDetail/ProjectDetailsHeader.tsx`) as a compact
 * "key: value" listing of whatever fields are actually set, rather than
 * hard-coding the three current keys -- so an added field surfaces here
 * without this file changing too. */
function formatDetailsHeader(detailsHeader: unknown): string {
  if (!detailsHeader || typeof detailsHeader !== 'object') return 'no creative brief set yet';
  const entries = Object.entries(detailsHeader as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'string' && v.length > 0
  ) as [string, string][];
  if (entries.length === 0) return 'no creative brief set yet';
  return entries.map(([key, value]) => `${key}: ${value}`).join('; ');
}

/** Per-stream counts plus which iteration (if any) is the accepted one in
 * each stream -- "what exists so far" for the PROJECT CONTEXT block. */
function summarizeIterations(iterations: ProjectContextIteration[]): string {
  if (iterations.length === 0) return 'no iterations yet';
  const front = iterations.filter((i) => i.role === 'front');
  const back = iterations.filter((i) => i.role === 'back');
  const other = iterations.filter((i) => i.role !== 'front' && i.role !== 'back');
  const acceptedFront = front.find((i) => i.accepted);
  const acceptedBack = back.find((i) => i.accepted);
  const parts = [
    `front: ${front.length} (accepted: ${acceptedFront ? `#${acceptedFront.seq}` : 'none'})`,
    `back: ${back.length} (accepted: ${acceptedBack ? `#${acceptedBack.seq}` : 'none'})`,
  ];
  if (other.length > 0) parts.push(`unassigned: ${other.length}`);
  return parts.join(', ');
}

function summarizeReferences(references: ProjectContextReference[]): string {
  if (references.length === 0) return 'none attached';
  return references.map((r) => `${r.role}: ${r.label}`).join('; ');
}

/** Builds the PROJECT CONTEXT block folded into the system prompt --
 * project identity, what exists so far (iterations/references), and an
 * unambiguous statement of the active stream. `null` (project not found)
 * renders no block at all rather than a misleading one. */
function buildProjectContextBlock(context: ProjectContext | null, activeFace: 'front' | 'back'): string {
  if (!context) return '';
  const { project, iterations, references } = context;
  const faceLabel = activeFace.toUpperCase();
  const lines = [
    'PROJECT CONTEXT:',
    `- Project: "${project.title}" (status: ${project.status})`,
    `- Creative brief: ${formatDetailsHeader(project.detailsHeader)}`,
    `- Iterations so far: ${summarizeIterations(iterations)}`,
    `- References attached: ${summarizeReferences(references)}`,
    `- Active stream: You are working on the ${faceLabel} of this postcard. Any image you generate this turn ` +
      `becomes a new iteration in the ${faceLabel} stream.`,
  ];
  return lines.join('\n');
}

export interface ConsultedKnowledgeEntry {
  ownerType: string;
  ownerId: number;
}

/** Turns a free-text chat message into a safe FTS5 `MATCH` query: extracts
 * word tokens and OR-joins them, each individually quoted so punctuation
 * in the user's message (quotes, colons, hyphens -- all FTS5 syntax
 * characters) can never produce a malformed query. Returns `undefined` for
 * a message with no extractable tokens (e.g. all punctuation/emoji). */
function toFtsQuery(message: string): string | undefined {
  const tokens = message.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return undefined;
  return tokens
    .slice(0, 12)
    .map((token) => `"${token}"`)
    .join(' OR ');
}

/**
 * Fresh, unmoderated knowledge-store retrieval for this turn (D9: calls
 * `services/search.ts` directly, never ad hoc, per spec §8) -- and
 * traceable: the caller gets back exactly which entries were consulted,
 * folded into the system prompt below. Best-effort: a retrieval failure
 * (e.g. a still-malformed query) degrades to "no entries consulted"
 * rather than failing the whole turn, since retrieval augments the
 * prompt, it doesn't gate it.
 */
export function retrieveKnowledge(message: string): ConsultedKnowledgeEntry[] {
  const query = toFtsQuery(message);
  if (!query) return [];
  try {
    return keywordSearch(query, { limit: 5 }).map((r) => ({ ownerType: r.ownerType, ownerId: r.ownerId }));
  } catch {
    return [];
  }
}

function buildSystemPrompt(consulted: ConsultedKnowledgeEntry[], projectContextBlock: string): string {
  let prompt = SYSTEM_PROMPT_BASE;
  if (projectContextBlock) {
    prompt += `\n\n${projectContextBlock}`;
  }
  if (consulted.length > 0) {
    const listing = consulted.map((c) => `- ${c.ownerType}#${c.ownerId}`).join('\n');
    prompt += `\n\nKnowledge-store entries consulted for this turn (traceable retrieval, per spec §8):\n${listing}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// SSE-friendly turn events (routes/chat.ts translates these into `data:`
// frames; exact shape is this ticket's call, kept structured so Sprint
// 005's MockupChatPanel.tsx wiring doesn't need to guess).
// ---------------------------------------------------------------------------

export type TurnEvent =
  | { type: 'status'; status: 'lock_wait' | 'started' | 'completed' }
  | { type: 'knowledge_consulted'; entries: ConsultedKnowledgeEntry[] }
  | { type: 'stage'; stage: string; label: string; startedAt: number }
  | { type: 'tool_call_started'; callId: string; name: string; args: unknown }
  | { type: 'tool_call_finished'; callId: string; name: string; args: unknown; result: unknown; isError: boolean }
  | { type: 'message'; content: string }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Turn controller.
// ---------------------------------------------------------------------------

export interface TurnVersioningService extends VersioningRecorder {
  commitTurn(summary: string, options?: { skipSnapshot?: boolean }): Promise<CommitResult>;
}

export interface RunTurnInput {
  projectId: number;
  message: string;
  /** Which stream tab (`'front'` | `'back'`) was active in the client when
   * this message was sent (Sprint 005 OOP change, 2026-07-15: "new
   * iterations join the currently-active tab's stream"). Threaded straight
   * through to any `generate_image` tool call this turn dispatches (see
   * `dispatchToolCall` below), and stated in plain language in the PROJECT
   * CONTEXT block folded into the system prompt (`buildProjectContextBlock`
   * above) -- but never exposed as a *tool input* the model must reason
   * about or supply itself (it's not in `WORKSPACE_TOOL_DEFINITIONS`'s
   * `generate_image` `inputSchema`): it describes client UI state, asserted
   * to the model as context rather than offered as something to choose.
   * Defaults to `'front'` when omitted (an older client, or a test that
   * doesn't care), matching "a new project starts on Front". */
  activeFace?: 'front' | 'back';
  /** The authenticated caller's `User.id` (ticket 007-002, SUC-002:
   * "agent asks user for internal IDs"), threaded from `routes/chat.ts`'s
   * `req.user.id`. Used only to fill `create_project`'s `ownerUserId` when
   * the model omits it for a genuinely new (no `id`) project -- there is no
   * existing `Project` row to source an owner from in that case, unlike an
   * update, which sources its `ownerUserId`/`version` from the project
   * row already scoped by `projectId` (see `dispatchToolCall` below).
   * Optional and omittable like `activeFace`: existing callers/tests that
   * don't set it are unaffected, and a `create_project` update (which
   * never needs it) works the same either way. */
  authenticatedUserId?: number;
}

export interface TurnControllerOptions {
  /** Defaults to the Anthropic adapter. Injectable for tests (the mock
   * adapter, architecture-update.md R4). */
  provider?: ProviderAdapter;
  /** Defaults to `DEFAULT_TOOL_HANDLERS`. Test-injectable so a test can
   * substitute spies without touching the real Workspace MCP Server. */
  toolHandlers?: Record<string, WorkspaceToolHandler>;
  /** Defaults to `WORKSPACE_TOOL_DEFINITIONS`. */
  toolDefinitions?: ProviderToolDefinition[];
  /** Defaults to a stub (AC8) -- Sprint 004 injects the real client here. */
  imageVisionClient?: ImageVisionClient;
  /** Defaults to the shared app Prisma singleton. Test-injectable. */
  prismaClient?: any;
  /** Defaults to the shared app Versioning Service singleton.
   * Test-injectable so tests don't touch real git. */
  versioning?: TurnVersioningService;
  /** Overrides the bounded lock wait (Open Question 5's "small, fixed
   * number of seconds" default). */
  lock?: { timeoutMs?: number; pollIntervalMs?: number };
  /** Safety cap on tool-call rounds within one turn, guarding against a
   * misbehaving/scripted provider never producing a final message. */
  maxToolRounds?: number;
  /** Called for every step of the loop -- `routes/chat.ts`'s SSE hook. */
  onEvent?: (event: TurnEvent) => void;
}

export interface RunTurnResult {
  finalMessage: string;
  /** Every `ChatMessage` row persisted for this turn, in creation order:
   * the user message, one row per tool-call round, then the final
   * assistant message. */
  messages: ChatMessageModel[];
  /** Every tool call dispatched this turn, flattened across rounds, in
   * the provider-neutral `{ name, args, result }` shape. */
  toolCalls: ProviderToolCallRecord[];
  commit: CommitResult;
  consultedKnowledge: ConsultedKnowledgeEntry[];
}

const DEFAULT_MAX_TOOL_ROUNDS = 8;

const CREATE_PROJECT_TOOL_NAME = 'create_project';

/**
 * `create_project`-only pre-dispatch injection (ticket 007-002, SUC-002:
 * "agent asks user for internal IDs" -- observed live asking the end user
 * "What's the owner user ID?"). Fills the `ownerUserId`/`version` gaps the
 * model has no way to know or ask for cleanly, from context this turn
 * already has -- never overriding a value the model explicitly supplied
 * (injection only fills a gap):
 *
 * - `args.id` set (updating an existing project): fills `version` and
 *   `ownerUserId` from that project's current row when the model omitted
 *   them, so a plain rename (`{ id, title }`) succeeds without the model
 *   ever seeing those internal fields.
 * - `args.id` unset (a genuinely new project): fills `ownerUserId` from
 *   `ctx.authenticatedUserId` when the model omitted it -- there is no
 *   existing `Project` row to source an owner from here.
 *
 * `catalogTools.createProject`'s own signature and validation are
 * untouched; this only changes what `turn.ts` passes into it.
 */
async function injectCreateProjectArgs(
  args: Record<string, unknown>,
  ctx: { authenticatedUserId?: number; prismaClient: any }
): Promise<Record<string, unknown>> {
  const merged = { ...args };

  if (merged.id !== undefined) {
    const existing = await ctx.prismaClient.project.findUnique({
      where: { id: merged.id },
      select: { version: true, ownerUserId: true },
    });
    if (existing) {
      if (merged.version === undefined) merged.version = existing.version;
      if (merged.ownerUserId === undefined) merged.ownerUserId = existing.ownerUserId;
    }
  } else if (merged.ownerUserId === undefined && ctx.authenticatedUserId !== undefined) {
    merged.ownerUserId = ctx.authenticatedUserId;
  }

  return merged;
}

async function dispatchToolCall(
  call: ProviderToolCall,
  ctx: {
    toolHandlers: Record<string, WorkspaceToolHandler>;
    imageVisionClient: ImageVisionClient;
    projectId: number;
    versioning: VersioningRecorder;
    lockHolder: string;
    prismaClient: any;
    activeFace: 'front' | 'back';
    authenticatedUserId?: number;
  }
): Promise<unknown> {
  if (call.name === IMAGE_GENERATION_TOOL_NAME) {
    const args = (call.args ?? {}) as { prompt?: string; modelParams?: unknown };
    if (!args.prompt) throw new Error('generate_image: prompt is required');
    const result: GenerateImageResult = await ctx.imageVisionClient.generateImage({
      prompt: args.prompt,
      projectId: ctx.projectId,
      modelParams: args.modelParams,
      activeFace: ctx.activeFace,
    });
    return result;
  }

  const handler = ctx.toolHandlers[call.name];
  if (!handler) {
    throw new Error(`No Workspace MCP Server tool named "${call.name}"`);
  }

  const args =
    call.name === CREATE_PROJECT_TOOL_NAME
      ? await injectCreateProjectArgs((call.args ?? {}) as Record<string, unknown>, {
          authenticatedUserId: ctx.authenticatedUserId,
          prismaClient: ctx.prismaClient,
        })
      : call.args;

  return handler(args, {
    versioning: ctx.versioning,
    lockHolder: ctx.lockHolder,
    prismaClient: ctx.prismaClient,
  });
}

/**
 * Runs one full agent turn for `input.projectId`: acquires the
 * `project_turn` lock (bounded wait if already held, see module header),
 * reconstructs context, drives the provider/tool-dispatch loop to a final
 * message, persists every `ChatMessage` row for the exchange, commits the
 * turn's changes via the Versioning Service, and releases the lock --
 * always, whether the turn succeeded or threw.
 */
export async function runTurn(input: RunTurnInput, options: TurnControllerOptions = {}): Promise<RunTurnResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const provider = options.provider ?? createAnthropicAdapter();
  const versioning = options.versioning ?? defaultVersioningService;
  const imageVisionClient = options.imageVisionClient ?? createStubImageVisionClient();
  const toolHandlers = options.toolHandlers ?? DEFAULT_TOOL_HANDLERS;
  const toolDefinitions = options.toolDefinitions ?? WORKSPACE_TOOL_DEFINITIONS;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const emit = options.onEvent ?? (() => {});
  const holder = `turn:${input.projectId}:${Date.now()}`;
  const activeFace: 'front' | 'back' = input.activeFace ?? 'front';

  let lockAcquired = false;

  try {
    await acquireProjectTurnLock(input.projectId, {
      holder,
      prismaClient,
      timeoutMs: options.lock?.timeoutMs,
      pollIntervalMs: options.lock?.pollIntervalMs,
      onWait: () => emit({ type: 'status', status: 'lock_wait' }),
    });
    lockAcquired = true;
    emit({ type: 'status', status: 'started' });

    // -- Context reconstruction (D8): fresh from the DB every call. -----
    const historyRows = await loadHistory(input.projectId, prismaClient);
    emit({ type: 'stage', stage: 'knowledge_retrieval', label: 'Consulting knowledge sources…', startedAt: Date.now() });
    const consultedKnowledge = retrieveKnowledge(input.message);
    if (consultedKnowledge.length > 0) {
      emit({ type: 'knowledge_consulted', entries: consultedKnowledge });
    }
    const projectContext = await loadProjectContext(input.projectId, prismaClient);
    const projectContextBlock = buildProjectContextBlock(projectContext, activeFace);
    const systemPrompt = buildSystemPrompt(consultedKnowledge, projectContextBlock);

    const createdMessages: ChatMessageModel[] = [];
    const allToolCallRecords: ProviderToolCallRecord[] = [];

    const userRow = await prismaClient.chatMessage.create({
      data: { projectId: input.projectId, role: 'user', content: input.message },
    });
    createdMessages.push(userRow);

    const messages: ProviderMessage[] = [
      ...historyRows.map(chatMessageToProviderMessage),
      { role: 'user', content: input.message },
    ];

    // -- Provider / tool-dispatch loop. ----------------------------------
    let finalContent: string | undefined;
    let rounds = 0;
    // Whether a tool-call round has already completed this turn -- distinguishes
    // the first provider.sendTurn call ("drafting") from any later one
    // ("assembling"), per this ticket's phase-transition stage events.
    let hadToolCallRound = false;
    // Per-turn, monotonically-increasing count of generate_image calls
    // dispatched so far (starting at 1) -- never a pre-announced "of N"
    // total (sprint.md Design Rationale).
    let generateImageCallCount = 0;

    while (finalContent === undefined) {
      rounds += 1;
      if (rounds > maxToolRounds) {
        throw new Error(
          `Turn for project ${input.projectId} exceeded ${maxToolRounds} tool-call rounds without a final message`
        );
      }

      emit({
        type: 'stage',
        stage: hadToolCallRound ? 'assembling' : 'drafting',
        label: hadToolCallRound ? 'Assembling flyer…' : 'Drafting flyer content…',
        startedAt: Date.now(),
      });

      const result: ProviderTurnResult = await provider.sendTurn({ systemPrompt, messages, tools: toolDefinitions });

      if (result.kind === 'message') {
        finalContent = result.content;
        break;
      }

      const records: ProviderToolCallRecord[] = [];
      const toolResults: { toolCallId: string; result: unknown; isError?: boolean }[] = [];

      for (const call of result.calls) {
        if (call.name === IMAGE_GENERATION_TOOL_NAME) {
          generateImageCallCount += 1;
          emit({
            type: 'stage',
            stage: 'generating_image',
            label: `Generating image (#${generateImageCallCount})…`,
            startedAt: Date.now(),
          });
        }
        emit({ type: 'tool_call_started', callId: call.id, name: call.name, args: call.args });
        let callResult: unknown;
        let isError = false;
        try {
          callResult = await dispatchToolCall(call, {
            toolHandlers,
            imageVisionClient,
            projectId: input.projectId,
            versioning,
            lockHolder: holder,
            prismaClient,
            activeFace,
            authenticatedUserId: input.authenticatedUserId,
          });
        } catch (err: any) {
          isError = true;
          callResult = { error: err?.message ?? String(err) };
        }
        emit({ type: 'tool_call_finished', callId: call.id, name: call.name, args: call.args, result: callResult, isError });
        records.push({ name: call.name, args: call.args, result: callResult });
        toolResults.push({ toolCallId: call.id, result: callResult, isError });
      }

      allToolCallRecords.push(...records);

      const toolCallRow = await prismaClient.chatMessage.create({
        data: { projectId: input.projectId, role: 'assistant', content: '', toolCalls: records as any },
      });
      createdMessages.push(toolCallRow);

      messages.push({ role: 'assistant', toolCalls: result.calls });
      messages.push({ role: 'user', toolResults });

      hadToolCallRound = true;
    }

    const finalRow = await prismaClient.chatMessage.create({
      data: { projectId: input.projectId, role: 'assistant', content: finalContent },
    });
    createdMessages.push(finalRow);
    emit({ type: 'message', content: finalContent });

    const commit = await versioning.commitTurn(`Agent turn: project ${input.projectId}`);
    emit({ type: 'status', status: 'completed' });

    return {
      finalMessage: finalContent,
      messages: createdMessages,
      toolCalls: allToolCallRecords,
      commit,
      consultedKnowledge,
    };
  } catch (err: any) {
    emit({ type: 'error', message: err?.message ?? String(err) });
    throw err;
  } finally {
    if (lockAcquired) {
      await releaseLock(PROJECT_TURN_RESOURCE_TYPE, String(input.projectId), prismaClient);
    }
  }
}
