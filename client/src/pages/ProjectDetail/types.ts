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

/** Renders any workspace-relative path (an `Iteration.imagePath` or an
 * `Asset.path`) via ticket 004's `GET /api/files/*` route -- same helper
 * `ProjectList.tsx` already established for this exact purpose. */
export function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath}`;
}
