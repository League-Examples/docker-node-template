import type { PostcardContentDTO, PostcardContentRegionDTO, PostcardQr } from '../pages/ProjectDetail/types';

/**
 * "Which face's regions/QR does THIS iteration's overlay show" helper (OOP
 * change, 2026-07-15) -- both `ProjectDetail/OutputPane.tsx`'s iteration
 * gallery overlay and `ProjectList.tsx`'s new hero-card overlay need the
 * exact same three-way `role === 'front' ? front_* : role === 'back' ?
 * back_* : undefined` routing against a saved `PostcardContentDTO` (see
 * `ProjectDetail/types.ts`'s own header for that shape). Pulled out here so
 * there is one implementation, not two hand-written copies of the same
 * ternary that could silently drift apart. `role` is typed loosely
 * (`string | null | undefined`) because callers narrow it from slightly
 * different DTOs (`IterationDTO.role` vs. `ProjectList.tsx`'s
 * `IterationSummary.role`) that don't share a common role type.
 */
export function postcardFaceRegions(
  content: PostcardContentDTO | null | undefined,
  role: string | null | undefined,
): PostcardContentRegionDTO[] | undefined {
  if (role === 'front') return content?.front_regions;
  if (role === 'back') return content?.back_regions;
  return undefined;
}

export function postcardFaceQr(
  content: PostcardContentDTO | null | undefined,
  role: string | null | undefined,
): PostcardQr | undefined {
  if (role === 'front') return content?.front_qr;
  if (role === 'back') return content?.back_qr;
  return undefined;
}
