import { useEffect, useRef, useState } from 'react';
import type { PostcardContentDTO, PostcardQr, PostcardRegionPosition } from './types';
import {
  AUTOSAVE_DEBOUNCE_MS,
  QR_OVERLAY_POSITION,
  toContentRegion,
  type PostcardRegion,
  type PostcardSide,
} from '../../lib/postcardFaceEditing';

/**
 * Postcard content-JSON data layer (Sprint 005 OOP change, 2026-07-15) --
 * extracted from `pages/PostcardEdit.tsx`'s own load-on-mount /
 * debounced-autosave / `buildContentPayload` machinery (that whole
 * standalone page is deleted by this change; see
 * `ProjectDetail/PostcardFaceEditor.tsx`'s module header for the
 * companion extraction of the interactive canvas itself).
 *
 * Owned once per `ProjectDetail/index.tsx` mount (not per face): a `PUT`
 * always carries BOTH faces' regions (`postcards.ts`'s "replace wholesale"
 * contract -- never clobber the face the stakeholder isn't currently
 * looking at), so this hook holds `front`/`back` state together regardless
 * of which stream tab is active, and switching tabs never re-fetches.
 *
 * `frontImagePath`/`backImagePath` are the CURRENT accepted iteration's
 * image for each stream (`ProjectDetail/index.tsx` computes these from
 * `iterations.find(i => i.role === X && i.accepted)`) -- read through a
 * ref kept fresh every render, so accepting a different iteration is
 * reflected in the very next built payload without needing a region edit
 * to trigger it.
 */

const SIDES: PostcardSide[] = ['front', 'back'];

export interface UsePostcardEditorStateResult {
  regionsBySide: Record<PostcardSide, PostcardRegion[]>;
  regionText: Record<string, string>;
  qrBySide: Record<PostcardSide, PostcardQr | null>;
  /** `true` once the load-on-mount `GET` has actually succeeded (2xx) --
   * mirrors `PostcardEdit.tsx`'s old `autosaveEnabledRef`, exposed here so
   * a caller (the PDF-generate button) can avoid building/sending a
   * payload before hydration has had a chance to populate real content. */
  loaded: boolean;
  /** Region names in use across BOTH faces -- passed to
   * `PostcardFaceEditor`'s `makeRegionName` call so a freshly-drawn box on
   * one face can never collide with a name already used on the other. */
  existingRegionNames: Set<string>;
  addRegion: (side: PostcardSide, region: PostcardRegion, text: string) => void;
  setRegionText: (name: string, value: string) => void;
  setRegionPosition: (side: PostcardSide, name: string, position: PostcardRegionPosition) => void;
  removeRegion: (side: PostcardSide, name: string) => void;
  addQr: (side: PostcardSide) => void;
  setQrUrl: (side: PostcardSide, url: string) => void;
  setQrPosition: (side: PostcardSide, position: PostcardRegionPosition) => void;
  removeQr: (side: PostcardSide) => void;
  /** The current content-JSON payload (`postcardRender.ts`'s shape), or
   * `null` when there's no front image yet -- mirrors
   * `PostcardEdit.tsx`'s own `!frontIteration` guard (a PUT needs at least
   * `front_image`). */
  buildContentPayload: () => Record<string, unknown> | null;
  /** Sends any still-pending debounced autosave immediately and awaits it
   * -- used by the PDF-generate button so it always PUTs/PDFs the latest
   * edits, never a stale pre-debounce snapshot. A no-op (resolves
   * immediately) when nothing is pending. */
  flushPendingAutosave: () => Promise<void>;
}

export function usePostcardEditorState(
  projectId: number,
  frontImagePath: string | undefined,
  backImagePath: string | undefined,
): UsePostcardEditorStateResult {
  const [regionsBySide, setRegionsBySide] = useState<Record<PostcardSide, PostcardRegion[]>>({ front: [], back: [] });
  const [regionText, setRegionTextState] = useState<Record<string, string>>({});
  const [qrBySide, setQrBySide] = useState<Record<PostcardSide, PostcardQr | null>>({ front: null, back: null });
  const [loaded, setLoaded] = useState(false);

  const autosaveEnabledRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPayloadRef = useRef<Record<string, unknown> | null>(null);
  const skipNextAutosaveRef = useRef(true);
  const imagesRef = useRef({ front: frontImagePath, back: backImagePath });
  imagesRef.current = { front: frontImagePath, back: backImagePath };

  function buildContentPayload(): Record<string, unknown> | null {
    const images = imagesRef.current;
    if (!images.front) return null;
    const content: Record<string, unknown> = {
      front_image: images.front,
      front_regions: regionsBySide.front.map((r) => toContentRegion(r, regionText)),
      back_regions: regionsBySide.back.map((r) => toContentRegion(r, regionText)),
    };
    if (images.back) content.back_image = images.back;
    if (qrBySide.front) content.front_qr = qrBySide.front;
    if (qrBySide.back) content.back_qr = qrBySide.back;
    return content;
  }

  // Load-on-mount: hydrate a previously-saved layout, if any. Both
  // "nothing saved yet" (`{ content: null }`) and any fetch/parse error
  // leave state at its client-only defaults; neither is surfaced as an
  // error (matches `PostcardEdit.tsx`'s original swallow behavior).
  useEffect(() => {
    if (Number.isNaN(projectId)) return;
    autosaveEnabledRef.current = false;
    setLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/postcards/${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: PostcardContentDTO | null };
        const content = data?.content;
        if (cancelled) return;
        autosaveEnabledRef.current = true;
        setLoaded(true);
        if (!content) return;

        const hydratedRegions: Record<PostcardSide, PostcardRegion[]> = { front: [], back: [] };
        const hydratedText: Record<string, string> = {};
        for (const s of SIDES) {
          const contentRegions = s === 'front' ? content.front_regions : content.back_regions;
          for (const region of contentRegions ?? []) {
            hydratedRegions[s].push({
              name: region.name,
              label: region.label,
              style: region.style,
              position: region.position,
              font: region.font,
            });
            hydratedText[region.name] = region.text;
          }
        }

        skipNextAutosaveRef.current = true;
        setRegionsBySide(hydratedRegions);
        setRegionTextState(hydratedText);
        setQrBySide({ front: content.front_qr ?? null, back: content.back_qr ?? null });
      } catch {
        // Leave state at defaults; autosaveEnabledRef/loaded stay false --
        // a subsequent edit must never autosave over content this GET
        // failed to read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    latestPayloadRef.current = buildContentPayload();
  });

  // Debounced autosave: any change to regionsBySide/regionText/qrBySide
  // schedules a PUT after AUTOSAVE_DEBOUNCE_MS of no further changes --
  // except the one run this effect itself skips via skipNextAutosaveRef
  // (the hydration write above).
  useEffect(() => {
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (!autosaveEnabledRef.current) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const payload = buildContentPayload();
    if (!payload || Number.isNaN(projectId)) return;
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void fetch(`/api/postcards/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsBySide, regionText, qrBySide]);

  // Flush a still-pending autosave immediately on unmount or a projectId
  // change.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        const payload = latestPayloadRef.current;
        if (payload) {
          void fetch(`/api/postcards/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      }
    };
  }, [projectId]);

  async function flushPendingAutosave(): Promise<void> {
    if (!autosaveTimerRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    const payload = buildContentPayload();
    if (!payload) return;
    try {
      await fetch(`/api/postcards/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort, same swallow as the debounced autosave itself.
    }
  }

  function addRegion(side: PostcardSide, region: PostcardRegion, text: string) {
    setRegionsBySide((prev) => ({ ...prev, [side]: [...prev[side], region] }));
    setRegionTextState((prev) => ({ ...prev, [region.name]: text }));
  }

  function setRegionText(name: string, value: string) {
    setRegionTextState((prev) => ({ ...prev, [name]: value }));
  }

  function setRegionPosition(side: PostcardSide, name: string, position: PostcardRegionPosition) {
    setRegionsBySide((prev) => ({
      ...prev,
      [side]: prev[side].map((r) => (r.name === name ? { ...r, position } : r)),
    }));
  }

  function removeRegion(side: PostcardSide, name: string) {
    setRegionsBySide((prev) => ({ ...prev, [side]: prev[side].filter((r) => r.name !== name) }));
  }

  function addQr(side: PostcardSide) {
    setQrBySide((prev) => (prev[side] ? prev : { ...prev, [side]: { url: '', position: QR_OVERLAY_POSITION } }));
  }

  function setQrUrl(side: PostcardSide, url: string) {
    setQrBySide((prev) => {
      const current = prev[side];
      if (!current) return prev;
      return { ...prev, [side]: { ...current, url } };
    });
  }

  function setQrPosition(side: PostcardSide, position: PostcardRegionPosition) {
    setQrBySide((prev) => {
      const current = prev[side];
      if (!current) return prev;
      return { ...prev, [side]: { ...current, position } };
    });
  }

  function removeQr(side: PostcardSide) {
    setQrBySide((prev) => ({ ...prev, [side]: null }));
  }

  const existingRegionNames = new Set(SIDES.flatMap((s) => regionsBySide[s].map((r) => r.name)));

  return {
    regionsBySide,
    regionText,
    qrBySide,
    loaded,
    existingRegionNames,
    addRegion,
    setRegionText,
    setRegionPosition,
    removeRegion,
    addQr,
    setQrUrl,
    setQrPosition,
    removeQr,
    buildContentPayload,
    flushPendingAutosave,
  };
}
