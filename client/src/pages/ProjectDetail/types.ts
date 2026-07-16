/**
 * Shared DTO shapes for the real `/projects/:id` two-pane view (ticket
 * 005-009), mirroring `GET /api/projects/:id`'s response
 * (`server/src/routes/projects.ts`'s `PROJECT_DETAIL_INCLUDE`) rather than
 * the wireframe's `mockupStubData.ts` stand-ins.
 */

export interface IterationDTO {
  id: number;
  projectId: number;
  seq: number;
  imagePath: string;
  promptUsed?: string | null;
  accepted: boolean;
  role: 'front' | 'back' | null;
  createdAt?: string;
}

export interface ChatMessageDTO {
  id: number;
  projectId: number;
  role: string;
  content: string;
  toolCalls?: unknown;
  createdAt: string;
}

/** Nested `Asset` fields the reference strip needs to render a thumbnail --
 * added to `PROJECT_DETAIL_INCLUDE` by this ticket (see `projects.ts`'s
 * module header for the deviation note: the include previously stopped at
 * the bare `Reference` row). */
export interface ReferenceAssetDTO {
  id: number;
  path: string;
}

export interface ReferenceDTO {
  id: number;
  projectId: number;
  assetId: number;
  role: string;
  asset?: ReferenceAssetDTO | null;
}

export interface ProjectDetailDTO {
  id: number;
  title: string;
  status: string;
  detailsHeader?: Record<string, unknown> | null;
  iterations: IterationDTO[];
  references: ReferenceDTO[];
  chatMessages: ChatMessageDTO[];
}

/**
 * Postcard content-JSON shapes (`server/src/services/postcardRender.ts`'s
 * `PostcardContent`, as seen from the client) -- shared between
 * `PostcardFaceEditor.tsx` (the editable text-region editor) and `OutputPane.tsx`'s
 * `PostcardOverlay` (the read-only iteration-gallery overlay, OOP change
 * 2026-07-15) so both render a `position.height`-less region the same way
 * (auto-height, normal document flow) rather than each carrying its own
 * copy of the rule. Only the fields either consumer reads are listed here;
 * `front_image`/`back_image`/`front_extra_html`/`back_extra_html` are read
 * (and re-sent) elsewhere, so they're omitted rather than duplicated.
 */
export interface PostcardRegionPosition {
  top: string;
  left?: string;
  right?: string;
  width: string;
  /** Drawn/resized boxes keep their exact size; content is clipped, not
   * overflowed (stakeholder, 2026-07-14; `postcardRender.ts`'s
   * `position.height` -> `overflow:hidden` contract). Omitted means the
   * region auto-heights to fit its text, in normal document flow -- the
   * common case for marketing-imported regions, which never had an
   * explicit drawn height to begin with. */
  height?: string;
}

export interface PostcardRegionFont {
  family: string;
  size: string;
}

/** A face's optional QR overlay: `{ url, position }`,
 * `postcardRender.ts`'s `PostcardQrSchema`. */
export interface PostcardQr {
  url: string;
  position: PostcardRegionPosition;
}

/** One region as it appears in `GET /api/postcards/:projectId`'s
 * `content.front_regions`/`content.back_regions` (the inverse of
 * `../../lib/postcardFaceEditing.ts`'s `toContentRegion`). */
export interface PostcardContentRegionDTO {
  name: string;
  label: string;
  style: string;
  text: string;
  position: PostcardRegionPosition;
  font: PostcardRegionFont;
}

/** `GET /api/postcards/:projectId`'s `content` field, when non-null. */
export interface PostcardContentDTO {
  front_regions?: PostcardContentRegionDTO[];
  back_regions?: PostcardContentRegionDTO[];
  front_qr?: PostcardQr;
  back_qr?: PostcardQr;
}

/** Mirrors `agent-mcp/catalogTools.ts`'s `SearchCatalogMatch` -- the shape
 * a `search_catalog` tool call's `tool_call_finished` SSE event carries as
 * its `result` (ticket 010, SUC-015). `LibraryDrawer.tsx` renders these
 * directly: an `ownerType: 'asset'` match with a `path` gets a real
 * thumbnail via `fileUrl`; a `knowledge_entry` match (no `path`) renders as
 * a label-only card and is never double-click-addable (`Reference.assetId`
 * has no knowledge-entry equivalent). */
export interface SearchCatalogMatch {
  ownerType: string;
  ownerId: number;
  matchedVia: ('vector' | 'keyword')[];
  score?: number;
  path?: string;
  label?: string;
}

/** Renders any workspace-relative path (an `Iteration.imagePath` or an
 * `Asset.path`) via ticket 004's `GET /api/files/*` route -- same helper
 * `ProjectList.tsx` already established for this exact purpose. */
export function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath}`;
}
