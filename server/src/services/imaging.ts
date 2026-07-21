import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';
import { resolveWorkspacePath } from './workspaceDirectorySync';

/**
 * Image & Vision Service (architecture-001 Module 9; architecture-update.md
 * Sprint 004 Step 3). The only place in the codebase that talks to OpenAI
 * or OpenRouter directly -- a stateless, side-effect-free HTTP wrapper with
 * zero outward dependencies on any other Flyerbot module (a pure
 * Infrastructure leaf), with one narrow exception: `callOpenAiEdits` imports
 * `services/workspaceDirectorySync.ts`'s `resolveWorkspacePath` (ticket
 * 013-002, SUC-025) to enforce path containment on a caller-supplied
 * reference-image path immediately before reading it -- an Infrastructure-
 * to-Infrastructure dependency (that module is itself dependency-free), not
 * a Domain-layer one, so this remains a leaf relative to every Domain-layer
 * node. Two entry points:
 *
 * - `generateImage`: OpenAI direct. `POST /v1/images/generations` when no
 *   reference images are attached, `POST /v1/images/edits` (multipart,
 *   attaching each reference image) when one or more are attached. Model
 *   from `IMAGE_MODEL` (`gpt-image-2`), quality always `high`, size one of
 *   `1536x1024` / `1024x1536` / `1024x1024` -- mirrors the predecessor's
 *   `cli.py` (`_generate_openai_core` / `_generate_openai_edits`) request
 *   shape exactly (spec §9 grounding). Returns raw image bytes plus the
 *   model/size/quality actually used; never writes to disk or the DB --
 *   that's the caller's job (ticket 002's `ImageVisionClient` adapter for
 *   the agent-loop path).
 * - `classifyAndDescribe`: OpenRouter vision. `POST
 *   {OPENROUTER_BASE}/chat/completions` with an image payload (base64 data
 *   URI or a plain URL) and model from `OPENROUTER_MODEL`, asking for the
 *   four required classification fields (`isPhotograph`, `isLogo`,
 *   `style`, `peopleReal`) plus a rich `description` and a `tags` array.
 *   All four classification fields are always present in the result, even
 *   when the model's answer is ambiguous (defaulted, never omitted) --
 *   ticket 003's Description & Embedding Pipeline writes the result
 *   directly into `AssetDescription`.
 *
 * **Reference images are read from caller-supplied, workspace-relative
 * paths** (ticket 013-002, SUC-025 -- previously the caller resolved the
 * path to absolute itself before calling in; now `callOpenAiEdits` resolves
 * each `referenceImages` entry via `resolveWorkspacePath` immediately
 * before reading it, rejecting one that would escape the workspace root
 * independent of whether the caller already validated it, then opens it
 * directly, matching the predecessor's `_generate_openai_edits(...,
 * reference_images, ...)` read shape exactly). This does not violate
 * architecture-001's "no DB or filesystem access of its own" boundary
 * statement for this module -- that statement is about *persistence*: this
 * module never writes to the Workspace Filesystem or the Catalog Store.
 * Reading bytes from a workspace-relative path to attach as a multipart
 * upload is a pure passthrough, not a persistence side effect.
 *
 * **Credentials, constructed lazily**: no API key is read, and no network
 * call is made, until `generateImage`/`classifyAndDescribe` actually run.
 * `OPENAI_API_KEY` / `OPENROUTER_API` may be genuinely absent in dev/test/
 * CI -- failing at import/module-load time would make every other module
 * that merely imports this file require both keys. Each function resolves
 * its key (or a test-injected `options.openaiApiKey`/`options.openrouterApiKey`
 * / `options.fetchImpl`) lazily and throws a clear, specific
 * `ImagingServiceError` only if it is actually invoked with neither. Tests
 * always inject `options.fetchImpl` (a stub), so the real global `fetch` is
 * never reached and no network call is ever attempted in the suite.
 *
 * **Spend logging**: every *successful* call (both entry points) logs an
 * approximate spend estimate -- a small static price table keyed by
 * model + size (generation) or model (vision), not a live billing API call
 * -- via `pino` (`options.logger`, defaulting to a module-level instance
 * mirroring `app.ts`'s level convention: silent under `NODE_ENV=test`). No
 * budget cap is enforced (architecture-001 Open Question 7, unchanged).
 *
 * **Timeouts (ticket 006-001)**: every outbound `fetch` this module makes --
 * both OpenAI calls, the image-download-by-URL fallback in
 * `extractFirstImageBytes`, and the OpenRouter chat-completions call -- is
 * bound to an `AbortController` timeout (default 5 minutes; overridable via
 * `options.timeoutMs` or `IMAGING_TIMEOUT_MS`). On expiry the call rejects
 * with the same `ImagingServiceError` type (never a bare `AbortError`),
 * naming the provider and the elapsed wait, so a stalled upstream connection
 * can no longer hang the caller (and the `project_turn` lock it holds)
 * indefinitely.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro';

/** OpenAI truncates prompts; the predecessor's own cap. */
const MAX_PROMPT_CHARS = 32000;

/** Default per-call timeout for every outbound fetch in this module (ticket
 * 006-001): image generation legitimately takes minutes, so this is
 * generous, but a stalled upstream connection must not hang the caller (and
 * the `project_turn` lock it holds) indefinitely. Overridable via
 * `ImagingCallOptions.timeoutMs` or `process.env.IMAGING_TIMEOUT_MS`. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

function mimeTypeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'image/png';
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** The minimal logger shape this module depends on -- narrow enough that a
 * test can inject a plain stub (`{ info: vi.fn(), error: vi.fn() }`) with
 * no real `pino` instance. */
export interface ImagingLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const defaultLogger: ImagingLogger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
});

// ---------------------------------------------------------------------------
// Spend estimation (static price table -- no live billing API call)
// ---------------------------------------------------------------------------

/** Approximate USD price per image, by model then size. Not billing-grade
 * accuracy -- a rough estimate for the spend-visibility log line only
 * (architecture-001 Open Question 7: logged, uncapped). */
const IMAGE_GENERATION_PRICE_USD: Record<string, Partial<Record<ImageSize, number>>> = {
  'gpt-image-2': {
    '1024x1024': 0.02,
    '1536x1024': 0.03,
    '1024x1536': 0.03,
  },
};
const FALLBACK_IMAGE_PRICE_USD = 0.03;

/** Approximate USD price per vision call, by model. */
const VISION_CALL_PRICE_USD: Record<string, number> = {
  'deepseek/deepseek-v4-pro': 0.01,
};
const FALLBACK_VISION_PRICE_USD = 0.01;

function estimateImageSpend(model: string, size: ImageSize): number {
  return IMAGE_GENERATION_PRICE_USD[model]?.[size] ?? FALLBACK_IMAGE_PRICE_USD;
}

function estimateVisionSpend(model: string): number {
  return VISION_CALL_PRICE_USD[model] ?? FALLBACK_VISION_PRICE_USD;
}

function logSpend(
  logger: ImagingLogger,
  entry: { provider: 'openai' | 'openrouter'; operation: 'generateImage' | 'classifyAndDescribe'; model: string; estimateUsd: number }
): void {
  logger.info(
    { imagingSpend: entry },
    `imaging: approximate spend $${entry.estimateUsd.toFixed(4)} (${entry.provider}/${entry.model}, ${entry.operation})`
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Typed failure for both entry points -- a simulated OpenAI/OpenRouter
 * failure or timeout throws this (never a partial/garbage result, never
 * bytes on failure). `provider` lets a caller distinguish which upstream
 * API failed without string-matching the message. */
export class ImagingServiceError extends Error {
  constructor(message: string, public readonly provider: 'openai' | 'openrouter', public readonly cause?: unknown) {
    super(message);
    this.name = 'ImagingServiceError';
  }
}

// ---------------------------------------------------------------------------
// Shared HTTP options
// ---------------------------------------------------------------------------

export interface ImagingCallOptions {
  /** Falls back to `process.env.OPENAI_API_KEY`. Only consulted by
   * `generateImage`. */
  openaiApiKey?: string;
  /** Falls back to `process.env.OPENROUTER_API`. Only consulted by
   * `classifyAndDescribe`. */
  openrouterApiKey?: string;
  /** Falls back to `process.env.IMAGE_MODEL`, then `gpt-image-2`. */
  imageModel?: string;
  /** Falls back to `process.env.OPENROUTER_MODEL`, then
   * `deepseek/deepseek-v4-pro`. */
  openrouterModel?: string;
  /** Test-injectable stand-in for the global `fetch` -- when supplied, no
   * real network call is ever attempted. */
  fetchImpl?: typeof fetch;
  /** Test-injectable stand-in for the default `pino`-backed logger. */
  logger?: ImagingLogger;
  /** Per-call `AbortController` timeout (ms) applied to every outbound fetch
   * this call makes (generation/edits/download-fallback/chat-completions).
   * Falls back to `process.env.IMAGING_TIMEOUT_MS`, then `DEFAULT_TIMEOUT_MS`
   * (5 minutes). Tests inject a short value here to assert timeout behavior
   * without waiting on the real default. */
  timeoutMs?: number;
}

/** Resolves the effective timeout for a call: explicit option, then env var,
 * then the 5-minute default. Ignores a non-positive/non-numeric env value
 * rather than throwing, since it is not a required config value. */
function resolveTimeoutMs(options: ImagingCallOptions): number {
  if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) return options.timeoutMs;
  const envValue = Number(process.env.IMAGING_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return DEFAULT_TIMEOUT_MS;
}

/** Races `executor` (which receives an `AbortSignal` to attach to its
 * fetch call) against a timeout. Uses a real timer rather than relying on
 * the executor honoring the abort signal, so a test-injected `fetchImpl`
 * that never resolves and never inspects the signal still times out
 * (the ticket's test requirement) -- the signal is still passed through so
 * a real `fetch` call is also actually cancelled, freeing its socket. On
 * expiry, rejects with `ImagingServiceError` naming `provider` and the
 * elapsed wait, never a bare `AbortError`. */
function withTimeout<T>(
  provider: 'openai' | 'openrouter',
  timeoutMs: number,
  executor: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const startedAt = Date.now();

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      const elapsedMs = Date.now() - startedAt;
      reject(
        new ImagingServiceError(
          `${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} request to ${provider} timed out after ${elapsedMs}ms (${(
            elapsedMs / 1000
          ).toFixed(1)}s) with no response`,
          provider
        )
      );
    }, timeoutMs);

    Promise.resolve()
      .then(() => executor(controller.signal))
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
  });
}

async function parseJsonResponse(response: Response, provider: 'openai' | 'openrouter'): Promise<any> {
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new ImagingServiceError(
      `${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API request failed: ${response.status} ${response.statusText}${
        bodyText ? ` -- ${bodyText.slice(0, 500)}` : ''
      }`,
      provider
    );
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// generateImage (OpenAI direct: generations or edits)
// ---------------------------------------------------------------------------

export type ImageSize = '1536x1024' | '1024x1536' | '1024x1024';

export interface GenerateImageInput {
  /** The prompt text describing the desired image. */
  prompt: string;
  size: ImageSize;
  /** Workspace-relative paths to reference image files (ticket 013-002,
   * SUC-025) -- resolved internally via `resolveWorkspacePath` immediately
   * before each is read, never a raw/absolute filesystem path. Presence of
   * one or more routes the call through `/v1/images/edits` instead of
   * `/v1/images/generations`; each file is read and attached as an
   * `image[]` multipart part, matching the predecessor's
   * `_generate_openai_edits` exactly. */
  referenceImages?: string[];
  /** Optional passthrough of OpenAI's `background` param (predecessor
   * parity; e.g. `'transparent'`). */
  background?: string;
}

export interface GenerateImageResult {
  bytes: Buffer;
  model: string;
  size: ImageSize;
  quality: 'high';
}

export async function generateImage(input: GenerateImageInput, options: ImagingCallOptions = {}): Promise<GenerateImageResult> {
  const model = options.imageModel ?? process.env.IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  const logger = options.logger ?? defaultLogger;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  const timeoutMs = resolveTimeoutMs(options);

  if (!apiKey) {
    throw new ImagingServiceError(
      'generateImage: no OPENAI_API_KEY configured (set the env var, the AI Services config value, or pass options.openaiApiKey) -- cannot call the OpenAI API without credentials.',
      'openai'
    );
  }

  try {
    const bytes =
      input.referenceImages && input.referenceImages.length > 0
        ? await callOpenAiEdits({ ...input, model, apiKey, fetchImpl, timeoutMs, referenceImages: input.referenceImages })
        : await callOpenAiGenerations({ ...input, model, apiKey, fetchImpl, timeoutMs });

    logSpend(logger, {
      provider: 'openai',
      operation: 'generateImage',
      model,
      estimateUsd: estimateImageSpend(model, input.size),
    });

    return { bytes, model, size: input.size, quality: 'high' };
  } catch (err) {
    logger.error({ err: serializeError(err), provider: 'openai', operation: 'generateImage', model }, 'imaging: generateImage failed');
    if (err instanceof ImagingServiceError) throw err;
    throw new ImagingServiceError(
      `OpenAI image generation failed: ${err instanceof Error ? err.message : String(err)}`,
      'openai',
      err
    );
  }
}

async function callOpenAiGenerations(args: {
  prompt: string;
  size: ImageSize;
  background?: string;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<Buffer> {
  const payload: Record<string, unknown> = {
    model: args.model,
    prompt: args.prompt.slice(0, MAX_PROMPT_CHARS),
    n: 1,
    size: args.size,
    quality: 'high',
  };
  if (args.background) payload.background = args.background;

  const response = await withTimeout('openai', args.timeoutMs, (signal) =>
    args.fetchImpl(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
  );

  const data = await parseJsonResponse(response, 'openai');
  return extractFirstImageBytes(data, 'openai', args.fetchImpl, args.timeoutMs);
}

async function callOpenAiEdits(args: {
  prompt: string;
  size: ImageSize;
  background?: string;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  referenceImages: string[];
}): Promise<Buffer> {
  const form = new FormData();
  form.append('model', args.model);
  form.append('prompt', args.prompt.slice(0, MAX_PROMPT_CHARS));
  form.append('size', args.size);
  form.append('n', '1');
  form.append('quality', 'high');
  if (args.background) form.append('background', args.background);

  for (const refPath of args.referenceImages) {
    // Containment check at the actual read sink (ticket 013-002, SUC-025
    // "Secondary" defense-in-depth note): resolves independently of
    // whether the caller (turn.ts's dispatchToolCall) already validated
    // the path, so this guarantee holds even for a future caller that
    // doesn't. Throws a plain Error ("Path escapes workspace root: ...")
    // for an escaping path, which the caller's try/catch (generateImage,
    // below) wraps into an ImagingServiceError before any fetch is made.
    const resolvedPath = resolveWorkspacePath(refPath);
    const bytes = await fs.readFile(resolvedPath);
    form.append('image[]', new Blob([bytes], { type: mimeTypeForPath(resolvedPath) }), path.basename(resolvedPath));
  }

  const response = await withTimeout('openai', args.timeoutMs, (signal) =>
    args.fetchImpl(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal,
    })
  );

  const data = await parseJsonResponse(response, 'openai');
  return extractFirstImageBytes(data, 'openai', args.fetchImpl, args.timeoutMs);
}

async function extractFirstImageBytes(
  data: any,
  provider: 'openai' | 'openrouter',
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Buffer> {
  const first = data?.data?.[0];
  if (!first) {
    throw new ImagingServiceError('OpenAI response contained no image data', provider);
  }
  if (typeof first.b64_json === 'string') {
    return Buffer.from(first.b64_json, 'base64');
  }
  if (typeof first.url === 'string') {
    const imageResponse = await withTimeout(provider, timeoutMs, (signal) => fetchImpl(first.url, { signal }));
    if (!imageResponse.ok) {
      throw new ImagingServiceError(`Failed to download generated image from ${first.url}: ${imageResponse.status}`, provider);
    }
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  throw new ImagingServiceError('OpenAI response image entry had neither b64_json nor url', provider);
}

// ---------------------------------------------------------------------------
// classifyAndDescribe (OpenRouter vision)
// ---------------------------------------------------------------------------

export type ClassifyAndDescribeInput = { imageBytes: Buffer; mimeType?: string } | { imageUrl: string };

const PEOPLE_REAL_VALUES = ['real', 'ai', 'none', 'unknown'] as const;
export type PeopleReal = (typeof PEOPLE_REAL_VALUES)[number];

export interface AssetClassification {
  isPhotograph: boolean;
  isLogo: boolean;
  style: string;
  peopleReal: PeopleReal;
  description: string;
  tags: string[];
}

const CLASSIFICATION_PROMPT = `You are classifying and describing an image for a searchable creative-asset catalog used by a nonprofit youth-robotics organization.

Respond with ONLY a single JSON object -- no markdown code fences, no commentary before or after it -- matching exactly this shape:

{
  "isPhotograph": boolean,       // true if this is a real photograph, false if illustrated/generated/rendered
  "isLogo": boolean,             // true if the image is primarily a logo/wordmark
  "style": string,               // a short label for the visual style, e.g. "flat illustration", "photo", "3D render" -- "unknown" if you cannot tell
  "peopleReal": "real" | "ai" | "none" | "unknown",  // are any people shown real photographed people, AI-generated/illustrated people, no people at all, or can't tell
  "description": string,         // a rich, retrieval-friendly natural-language description of what's in the image (subjects, setting, mood, colors, composition) -- written so a user searching in chat (e.g. "a young girl looking at a computer screen") would match it
  "tags": string[]                // a free-form list of short, lowercase, single-or-few-word tags describing notable subjects, objects, and themes in the image
}

Every field is required. If you are uncertain about a field, still provide your best answer -- use "unknown" for style/peopleReal rather than omitting the field.`;

export async function classifyAndDescribe(input: ClassifyAndDescribeInput, options: ImagingCallOptions = {}): Promise<AssetClassification> {
  const model = options.openrouterModel ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const logger = options.logger ?? defaultLogger;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.openrouterApiKey ?? process.env.OPENROUTER_API;
  const timeoutMs = resolveTimeoutMs(options);

  if (!apiKey) {
    throw new ImagingServiceError(
      'classifyAndDescribe: no OPENROUTER_API configured (set the env var, the AI Services config value, or pass options.openrouterApiKey) -- cannot call the OpenRouter API without credentials.',
      'openrouter'
    );
  }

  try {
    const imageContent =
      'imageUrl' in input
        ? { type: 'image_url', image_url: { url: input.imageUrl } }
        : { type: 'image_url', image_url: { url: `data:${input.mimeType ?? 'image/png'};base64,${input.imageBytes.toString('base64')}` } };

    const response = await withTimeout('openrouter', timeoutMs, (signal) =>
      fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://league.ai',
          'X-Title': 'Flyerbot Description & Embedding Pipeline',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [imageContent, { type: 'text', text: CLASSIFICATION_PROMPT }],
            },
          ],
          max_tokens: 2048,
        }),
        signal,
      })
    );

    const data = await parseJsonResponse(response, 'openrouter');
    const text = extractMessageText(data);
    const classification = parseClassificationJson(text);

    logSpend(logger, {
      provider: 'openrouter',
      operation: 'classifyAndDescribe',
      model,
      estimateUsd: estimateVisionSpend(model),
    });

    return classification;
  } catch (err) {
    logger.error({ err: serializeError(err), provider: 'openrouter', operation: 'classifyAndDescribe', model }, 'imaging: classifyAndDescribe failed');
    if (err instanceof ImagingServiceError) throw err;
    throw new ImagingServiceError(
      `OpenRouter classify/describe failed: ${err instanceof Error ? err.message : String(err)}`,
      'openrouter',
      err
    );
  }
}

/** Extracts the assistant's text content from an OpenRouter chat-completions
 * response, handling both the plain-string and content-array message
 * shapes (mirrors the predecessor's own handling of both). */
function extractMessageText(data: any): string {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item?.type === 'text')
      .map((item: any) => item.text ?? '')
      .join('');
  }
  return '';
}

/** Parses the model's classification JSON out of its raw text response,
 * tolerating surrounding prose/code fences, and fills in safe defaults for
 * any missing/invalid field so the four required classification fields
 * (AC3) are never silently omitted. Throws only when no JSON object can be
 * located at all -- that is a genuine failure to classify, not a partial
 * answer to default around. */
function parseClassificationJson(text: string): AssetClassification {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new ImagingServiceError(`classifyAndDescribe: no JSON object found in OpenRouter response: ${text.slice(0, 200)}`, 'openrouter');
  }

  let raw: any;
  try {
    raw = JSON.parse(match[0]);
  } catch (err) {
    throw new ImagingServiceError(
      `classifyAndDescribe: could not parse JSON from OpenRouter response: ${err instanceof Error ? err.message : String(err)}`,
      'openrouter'
    );
  }

  const peopleReal: PeopleReal = PEOPLE_REAL_VALUES.includes(raw?.peopleReal) ? raw.peopleReal : 'unknown';

  return {
    isPhotograph: typeof raw?.isPhotograph === 'boolean' ? raw.isPhotograph : false,
    isLogo: typeof raw?.isLogo === 'boolean' ? raw.isLogo : false,
    style: typeof raw?.style === 'string' && raw.style.trim() ? raw.style : 'unknown',
    peopleReal,
    description: typeof raw?.description === 'string' && raw.description.trim() ? raw.description : 'No description available.',
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
  };
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return err;
}
