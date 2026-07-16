/**
 * POST-based Server-Sent Events consumer (ticket 005-009's implementation
 * plan: "a `fetch()` + `ReadableStream` SSE-consumption hook/utility,
 * shared by the chat panel here and (per SUC-009/ticket 012) the postcard
 * editor's chat box").
 *
 * The native `EventSource` API is GET-only and cannot be pointed at a
 * `POST` endpoint -- `server/src/routes/chat.ts`'s
 * `POST /api/projects/:projectId/chat` streams `TurnEvent`s as
 * `data: <json>\n\n` frames (see that file's `writeEvent`), so this module
 * reads the response body directly via `fetch()` + a `ReadableStream`
 * reader and parses frames itself. **Do not use `EventSource` anywhere in
 * a component that consumes this endpoint family** -- confirmed during
 * architecture review as the single most important detail to get right.
 */

/** POSTs `body` as JSON to `url` and invokes `onEvent` once per `data:
 * ...\n\n` frame in the streamed response, in arrival order, decoding each
 * frame's payload as JSON. Multiple `data:` lines within one frame (SSE's
 * multi-line data convention) are joined with `\n` before parsing, matching
 * the standard SSE frame grammar even though this codebase's server side
 * only ever emits single-line `data:` frames today.
 *
 * Resolves once the stream ends (the server closes the response). Throws
 * if the initial response is not `ok`, or if the response has no readable
 * body. A single malformed frame is skipped rather than aborting the whole
 * stream -- callers get every well-formed event that did arrive.
 */
export async function postSseStream<TEvent = unknown>(
  url: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error('Response body is not readable');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function consumeFrame(frame: string) {
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    try {
      onEvent(JSON.parse(dataLines.join('\n')) as TEvent);
    } catch {
      // Malformed frame -- skip it rather than throwing and killing the
      // rest of the stream.
    }
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd !== -1) {
      consumeFrame(buffer.slice(0, frameEnd));
      buffer = buffer.slice(frameEnd + 2);
      frameEnd = buffer.indexOf('\n\n');
    }
  }

  // A final frame with no trailing blank line (stream ended without the
  // usual `\n\n` terminator) is still honored.
  if (buffer.trim().length > 0) {
    consumeFrame(buffer);
  }
}
