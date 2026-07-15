import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ChatPanel from './ProjectDetail/ChatPanel';
import { fileUrl } from './ProjectDetail/types';
import type {
  ProjectDetailDTO,
  PostcardRegionPosition,
  PostcardRegionFont,
  PostcardQr,
  PostcardContentRegionDTO,
  PostcardContentDTO,
} from './ProjectDetail/types';
import { buildQrGraphic, normalizeQrUrl, displayQrUrl, CAPTION_VIEWBOX_WIDTH, CAPTION_VIEWBOX_HEIGHT } from '../lib/qrCode';
import { regionBoxStyle, hasExplicitHeight } from '../lib/postcardRegionLayout';

/**
 * `/projects/:id/postcard` -- the real postcard text-region editor (ticket
 * 005-012, SUC-009), promoted from `pages/mockups/MockupPostcardEdit.tsx`.
 * Reached from the output pane's "Text Entry" button (`OutputPane.tsx`,
 * ticket 005-009).
 *
 * The mockup's interaction mechanics (click-to-edit popup, drag-to-draw,
 * corner move/resize handles, QR URL popup) are already fully built against
 * stub data -- this promotion swaps in the two real data seams the
 * stakeholder called out, without rebuilding anything else:
 *
 *  1. **Preview images**: sourced from whichever `Iteration` currently
 *     holds `role: 'front'`/`role: 'back'` (ticket 001/002's state model,
 *     read here off `GET /api/projects/:id`'s `iterations` field, same
 *     shape `OutputPane.tsx` already consumes), rendered via
 *     `GET /api/files/*` (ticket 004) -- never the mockup's hardcoded
 *     `/mockup-assets/*` paths.
 *  2. **Persistence**: "Generate PDF" follows the exact same PUT-then-POST
 *     round trip as the output pane's own PDF button
 *     (`OutputPane.tsx`'s `handleGeneratePdf`, ticket 005-009) -- `PUT
 *     /api/postcards/:id` with the validated content-JSON shape
 *     (`postcardRender.ts`, Sprint 004), now carrying this page's actual
 *     `front_regions`/`back_regions`/`front_qr`/`back_qr` (not just the two
 *     image paths `OutputPane`'s quick-PDF button sends), then `POST
 *     /api/postcards/:id/pdf` to render and open the result.
 *
 * **QR overlay (OOP change)**: the QR code is an optional, addable,
 * deletable, movable element per face -- NOT an always-present fixture.
 * Added via the side toolbar's "QR" button, positioned/repositioned via
 * the same corner-handle drag mechanism as text regions, deleted from
 * its own popup. Persisted as a structured `front_qr`/`back_qr` content-
 * JSON object (`{ url, position }`, `postcardRender.ts`'s
 * `PostcardQrSchema`), not the old always-on `*_extra_html` string.
 *
 * **Real QR rendering (OOP change, 2026-07-15)**: once a URL is set, the
 * box renders an actual scannable QR code (`../lib/qrCode.ts`'s
 * `buildQrGraphic`, backed by the `qrcode` package's synchronous,
 * canvas-free `create()`) as an inline SVG, with the URL displayed
 * directly beneath it in a second SVG whose `<text>` carries
 * `textLength={CAPTION_VIEWBOX_WIDTH}` +
 * `lengthAdjust="spacingAndGlyphs"` -- both SVGs are `width:100%` of the
 * same wrapper, so the caption always spans exactly the QR's rendered
 * width, for both short and long URLs. `server/src/services/qrCode.ts`
 * renders the identical structure server-side for the PDF (no shared
 * package between the two workspaces, so the logic is duplicated but
 * kept in lockstep -- see that file's header). Before a URL is typed, the
 * box still shows a lightweight placeholder (nothing to encode yet).
 *
 * **Height-less regions render auto-height, in flow (OOP fix, 2026-07-15)**:
 * a region's `position.height` is optional (`postcardRender.ts`'s own
 * contract) -- marketing-imported regions are auto-height, text-flow boxes
 * that never had one. Previously EVERY region box rendered its text via an
 * absolutely-positioned `inset-0` layer; with no `height` on the button
 * itself and nothing else in normal flow, the box collapsed to zero height
 * and the (correctly-present) text simply never appeared. A region WITHOUT
 * an explicit `position.height` now renders its text in normal document
 * flow instead, so the box grows to fit it, matching how
 * `postcardRender.ts` (and the predecessor system) render height-less
 * regions. A region WITH an explicit height (freshly-drawn or resized
 * boxes) is unchanged: fixed size, `overflow:hidden`-clipped text. Both
 * modes share the exact same move-grip/resize-handle/click-to-edit
 * mechanics (`hasExplicitHeight` from `../lib/postcardRegionLayout.ts` is
 * the only branch point) -- resizing a height-less box gives it an
 * explicit height, which switches it into fixed/clipped mode, by design.
 * `../lib/postcardRegionLayout.ts`'s `regionBoxStyle`/`hasExplicitHeight`
 * are shared with `OutputPane.tsx`'s read-only gallery overlay
 * (`PostcardOverlay`), so a height-less region renders the same way (auto-
 * height, in flow) everywhere it appears, not just here.
 *
 * **Move/resize handles (OOP change)**: both text-region boxes and the QR
 * box carry two distinct corner handles rather than two same-purpose ones.
 * The top-left handle drags to MOVE the box (position.top/left change, size
 * unchanged); the bottom-right handle drags to RESIZE it (the top-left
 * corner stays put, position.width/height follow the pointer, clamped to
 * `MIN_BOX_WIDTH_IN`/`MIN_BOX_HEIGHT_IN`). One shared drag mechanism
 * (`handleMoveStart`/`handlePreviewMouseMove`) drives both actions for both
 * element kinds, keyed by `moving.action`.
 *
 * **Load-on-mount + debounced autosave (OOP change, 2026-07-15)**: text
 * regions and the QR overlay are no longer purely client-side state that
 * vanishes on reload. On mount (an effect keyed on `projectId`, running in
 * parallel with `loadProject`), a `GET /api/postcards/:projectId` call
 * reads back whatever `postcard-content.json` was last persisted for this
 * project and hydrates `regionsBySide`/`regionText`/`qrBySide` from its
 * `front_regions`/`back_regions`/`front_qr`/`back_qr` (the inverse of
 * `toContentRegion` below). `GET`'s two "nothing to hydrate" outcomes --
 * `200 { content: null }` (no prior save) and any fetch/parse error alike
 * -- both just leave the editor at its client-only defaults; neither is
 * surfaced as an error. Preview *images* are unaffected by any of this --
 * they still come from `Iteration.role`, per the section above.
 *
 * Every change to `regionsBySide`/`regionText`/`qrBySide` (box add/delete/
 * move/resize, text commit, QR add/url-set/move/resize/delete) schedules a
 * debounced `PUT` of `buildContentPayload()`'s result (`AUTOSAVE_DEBOUNCE_MS`
 * = 700ms of no further changes; a `useRef`-held timer, cleared and
 * re-armed on every qualifying change) -- the same payload shape
 * `handleGeneratePdf`'s own explicit `PUT` sends, factored into
 * `buildContentPayload()` so there is exactly one place that knows how
 * editor state maps to the content-JSON shape. The debounce effect
 * deliberately does NOT fire for the state changes hydration itself makes
 * (the initial default state, or the one-time population from a successful
 * `GET`) -- `skipNextAutosaveRef` arms itself before those specific
 * `setState` calls and is consumed by the very next autosave-effect run, so
 * only a stakeholder-driven change ever reaches the debounced `PUT`. A
 * pending autosave is always flushed immediately (bypassing the debounce)
 * on unmount or a `projectId` change, using a `latestPayloadRef` kept fresh
 * every render, so no edit is lost to an unmounted timer. Autosave `PUT`
 * failures are swallowed (logged nowhere, no UI surface) -- distinct from
 * `handleGeneratePdf`'s own explicit `pdfError` UI, which is unchanged.
 * Autosave never fires while `buildContentPayload()` returns `null` (no
 * `frontIteration` yet), mirroring `handleGeneratePdf`'s own guard.
 *
 * **No asset/library browser on this page** -- explicit stakeholder rule.
 * `LibraryDrawer` is never imported here, let alone rendered (verified by
 * construction, not by a runtime flag).
 *
 * **No separate text-region list section** (stakeholder round 10,
 * reconfirmed by this ticket) -- editing is click-on-box only.
 */

export type PostcardSide = 'front' | 'back';
const SIDES: PostcardSide[] = ['front', 'back'];

export type { PostcardRegionPosition, PostcardRegionFont, PostcardQr, PostcardContentRegionDTO, PostcardContentDTO };

export interface PostcardRegion {
  name: string;
  label: string;
  /** Raw CSS declarations, appended verbatim to the rendered div's style
   * attribute server-side (`postcardRender.ts`'s `regionStyleAttr`) --
   * empty string for a freshly-drawn box (no extra styling yet). */
  style: string;
  position: PostcardRegionPosition;
  font: PostcardRegionFont;
}

interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_FONT: PostcardRegionFont = { family: 'Arial, sans-serif', size: '14px' };

/** Minimum box size a resize handle can shrink a region or QR overlay to --
 * matches the minimum a freshly drawn box already gets in
 * `createRegionFromRect`, so a resized box can never end up smaller than
 * one you could draw from scratch. */
const MIN_BOX_WIDTH_IN = 0.3;
const MIN_BOX_HEIGHT_IN = 0.2;

/** Default position for a newly-added QR overlay -- identical starting
 * geometry on both faces until moved (long-click-drag on its top-left
 * handle, mirroring the text-region corner handles below). QR
 * presence/url/position are a structured, optional-per-face `front_qr`/
 * `back_qr` content-JSON field (`postcardRender.ts`'s `PostcardQrSchema`)
 * rather than the old
 * always-on `*_extra_html` overlay -- OOP change: the QR needed to be
 * addable/deletable/movable like any other element, which an opaque HTML
 * string couldn't represent cleanly. */
const QR_OVERLAY_POSITION: PostcardRegionPosition = {
  top: '1.15in',
  right: '0.5in',
  width: '1.5in',
  height: '1.5in',
};

/** Debounce window for autosaving edits (box add/delete/move/resize, text
 * commit, QR add/url-set/move/resize/delete) -- see the module header. */
const AUTOSAVE_DEBOUNCE_MS = 700;

/** Turn a label into a region name unique across both faces (server-side
 * `data-region` identifier, `postcardRender.ts`'s `renderRegion`). */
function makeRegionName(side: PostcardSide, label: string, taken: Set<string>): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'box';
  let name = `${side}_${slug}`;
  let n = 2;
  while (taken.has(name)) name = `${side}_${slug}_${n++}`;
  return name;
}

/** "top 1.0in · left 0.5in · width 3.4in — Arial 14px" */
function summarizePositionAndFont(region: PostcardRegion): string {
  const { position, font } = region;
  const parts = [`top ${position.top}`];
  if (position.left) parts.push(`left ${position.left}`);
  if (position.right) parts.push(`right ${position.right}`);
  parts.push(`width ${position.width}`);
  const primaryFamily = font.family.split(',')[0].replace(/['"]/g, '').trim();
  return `${parts.join(' · ')} — ${primaryFamily} ${font.size}`;
}

/** Content-JSON shape a single region maps to (`postcardRender.ts`'s
 * `PostcardRegionSchema`) -- `text` comes from `regionText`, everything
 * else from the region's own geometry/label/style/font. */
function toContentRegion(region: PostcardRegion, regionText: Record<string, string>) {
  return {
    name: region.name,
    label: region.label,
    style: region.style,
    text: regionText[region.name] ?? '',
    position: region.position,
    font: region.font,
  };
}

export default function PostcardEdit() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number.parseInt(id ?? '', 10);

  const [project, setProject] = useState<ProjectDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [side, setSide] = useState<PostcardSide>('front');
  const [regionsBySide, setRegionsBySide] = useState<Record<PostcardSide, PostcardRegion[]>>({
    front: [],
    back: [],
  });
  const [regionText, setRegionText] = useState<Record<string, string>>({});
  // Click-to-edit popup state: which region is being edited, and its draft.
  const [editingRegion, setEditingRegion] = useState<PostcardRegion | null>(null);
  const [draftText, setDraftText] = useState('');
  // Per-face optional QR overlay -- `null` means "no QR on this face" (AC1:
  // no QR by default, including for imported designs with no QR data).
  const [qrBySide, setQrBySide] = useState<Record<PostcardSide, PostcardQr | null>>({ front: null, back: null });
  // QR popup state: which face's QR popup is open, and its in-flight URL draft.
  const [editingQrSide, setEditingQrSide] = useState<PostcardSide | null>(null);
  const [draftQrUrl, setDraftQrUrl] = useState('');
  // Draw-a-box state: anchor corner, live rubber-band rect, then naming.
  const previewRef = useRef<HTMLDivElement>(null);
  const [drawAnchor, setDrawAnchor] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<DrawRect | null>(null);
  const [namingRect, setNamingRect] = useState<DrawRect | null>(null);
  const [draftName, setDraftName] = useState('');
  // Move/resize-a-box state: which element (a text region or the current
  // face's QR overlay) is being dragged by a corner handle, and which
  // action that corner performs -- one mechanism shared by both element
  // kinds and both actions (see `handleMoveStart`/`handlePreviewMouseMove`).
  // Top-left handle -> 'move' (repositions, size unchanged); bottom-right
  // handle -> 'resize' (top-left corner fixed, width/height follow the
  // pointer).
  const [moving, setMoving] = useState<{
    kind: 'region' | 'qr';
    action: 'move' | 'resize';
    name: string;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const movedRef = useRef(false);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Debounced-autosave bookkeeping (see module header). `autosaveTimerRef`
  // holds the pending debounce timer (cleared/re-armed on every qualifying
  // change). `latestPayloadRef` is kept fresh every render so the unmount/
  // projectId-change flush effect below always has the CURRENT payload,
  // never a stale one captured by an effect closure. `skipNextAutosaveRef`
  // starts `true` so the autosave effect's very first run (triggered by the
  // initial-mount render itself) is skipped, and is re-armed immediately
  // before the load-on-mount effect's own `setState` calls so THAT
  // hydration-driven change is skipped too -- only a genuine stakeholder
  // edit ever reaches the debounced PUT.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPayloadRef = useRef<Record<string, unknown> | null>(null);
  const skipNextAutosaveRef = useRef(true);

  const loadProject = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ProjectDetailDTO = await res.json();
      setProject(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load project');
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!Number.isNaN(projectId)) void loadProject();
  }, [projectId, loadProject]);

  // Load-on-mount: hydrate a previously-saved layout, if any (see module
  // header). Runs in parallel with `loadProject` above -- it needs only
  // `projectId`, not `project` itself. Both of "nothing saved yet"
  // (`{ content: null }`) and any fetch/parse error leave editor state at
  // its client-only defaults; neither is surfaced as an error.
  useEffect(() => {
    if (Number.isNaN(projectId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/postcards/${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: PostcardContentDTO | null };
        const content = data?.content;
        if (cancelled || !content) return;

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

        // Arm the skip guard BEFORE these setState calls -- they're the
        // hydration write the autosave effect below must ignore.
        skipNextAutosaveRef.current = true;
        setRegionsBySide(hydratedRegions);
        setRegionText(hydratedText);
        setQrBySide({ front: content.front_qr ?? null, back: content.back_qr ?? null });
      } catch {
        // Nothing saved yet, or a transient fetch/parse error -- leave the
        // editor at its client-only defaults (see module header).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const frontIteration = project?.iterations.find((iteration) => iteration.role === 'front');
  const backIteration = project?.iterations.find((iteration) => iteration.role === 'back');
  const iterationBySide = { front: frontIteration, back: backIteration } as const;
  const currentIteration = iterationBySide[side];

  const regions = regionsBySide[side];
  const qr = qrBySide[side];
  // Computed once per render (not per JSX read) -- `buildQrGraphic` walks
  // the full module grid, so it shouldn't be called more than once for
  // the same URL within a single render pass.
  const qrGraphic = qr && qr.url.trim() ? buildQrGraphic(normalizeQrUrl(qr.url)) : null;

  /** Content-JSON payload for the CURRENT editor state -- the single shared
   * builder both `handleGeneratePdf`'s explicit PUT and the debounced
   * autosave effect below send (see module header). `null` when there's no
   * front image yet (mirrors `handleGeneratePdf`'s own `!frontIteration`
   * guard -- a PUT needs at least `front_image`). */
  function buildContentPayload(): Record<string, unknown> | null {
    if (!frontIteration) return null;
    const content: Record<string, unknown> = {
      front_image: frontIteration.imagePath,
      front_regions: regionsBySide.front.map((r) => toContentRegion(r, regionText)),
      back_regions: regionsBySide.back.map((r) => toContentRegion(r, regionText)),
    };
    if (backIteration) content.back_image = backIteration.imagePath;
    // Structured, optional-per-face QR (`postcardRender.ts`'s
    // `PostcardQrSchema`) -- omitted entirely when a face has no QR
    // (AC1: no QR by default), not sent as an empty placeholder.
    if (qrBySide.front) content.front_qr = qrBySide.front;
    if (qrBySide.back) content.back_qr = qrBySide.back;
    return content;
  }

  // Keep `latestPayloadRef` fresh every render (not just on the deps the
  // autosave effect below watches) so the unmount/projectId-change flush
  // effect always sends the truly-current state, never a stale closure.
  useEffect(() => {
    latestPayloadRef.current = buildContentPayload();
  });

  // Debounced autosave: any change to regionsBySide/regionText/qrBySide
  // schedules a PUT of the current buildContentPayload() after
  // AUTOSAVE_DEBOUNCE_MS of no further changes -- except the one run this
  // effect itself skips via skipNextAutosaveRef (see that ref's own
  // comment, and the module header).
  useEffect(() => {
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
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
      }).catch(() => {
        // Autosave failures are swallowed -- distinct from `pdfError`,
        // which stays an explicit, user-visible failure only for the
        // "Generate PDF" button's own PUT/POST round trip.
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsBySide, regionText, qrBySide]);

  // Flush a still-pending autosave immediately on unmount or a projectId
  // change, rather than letting an unmounted timer's PUT either fire late
  // or (if the timer were cleared without resending) get lost entirely.
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

  function handleRegionTextChange(name: string, value: string) {
    setRegionText((prev) => ({ ...prev, [name]: value }));
  }

  function openRegionEditor(region: PostcardRegion) {
    setEditingRegion(region);
    setDraftText(regionText[region.name] ?? '');
  }

  function commitRegionEditor() {
    if (editingRegion) {
      handleRegionTextChange(editingRegion.name, draftText);
    }
    setEditingRegion(null);
  }

  function deleteEditingRegion() {
    if (!editingRegion) return;
    const name = editingRegion.name;
    setRegionsBySide((prev) => ({
      ...prev,
      [side]: prev[side].filter((r) => r.name !== name),
    }));
    setEditingRegion(null);
  }

  /** Toolbar "Add QR" button: adds a QR overlay to the CURRENT face at a
   * sensible default position (AC2 -- add button). A face can only carry
   * one QR at a time, so this is a no-op if one is already present (the
   * button is also disabled in that case). */
  function handleAddQr() {
    setQrBySide((prev) => (prev[side] ? prev : { ...prev, [side]: { url: '', position: QR_OVERLAY_POSITION } }));
  }

  /** QR popup's Delete button: removes the QR overlay from the current
   * face entirely (AC3 -- distinct from just clearing its URL). */
  function deleteEditingQr() {
    if (!editingQrSide) return;
    const targetSide = editingQrSide;
    setQrBySide((prev) => ({ ...prev, [targetSide]: null }));
    setEditingQrSide(null);
  }

  // --- Drawing handlers (preview background only, not region buttons) ---

  function previewPoint(event: React.MouseEvent): { x: number; y: number } {
    const rect = previewRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  // Preview is 6in wide; jsdom reports zero width, so fall back to 96dpi.
  function pxPerInch(): number {
    const measured = previewRef.current?.getBoundingClientRect().width ?? 0;
    return measured > 0 ? measured / 6 : 96;
  }

  /** Starts a corner-handle drag for either a text region or the current
   * face's QR overlay -- the SAME mechanism for both (`kind` just picks
   * which state bucket `handlePreviewMouseMove` below writes back into).
   * `action` picks what the drag does: the top-left handle passes 'move',
   * the bottom-right handle passes 'resize'. `name` is the region's `name`
   * for `kind: 'region'`, or the active `side` for `kind: 'qr'` (a face has
   * at most one QR). */
  function handleMoveStart(event: React.MouseEvent, kind: 'region' | 'qr', action: 'move' | 'resize', name: string) {
    event.stopPropagation();
    const box = (event.currentTarget as HTMLElement).parentElement;
    if (!box) return;
    const p = previewPoint(event);
    setMoving({
      kind,
      action,
      name,
      startX: p.x,
      startY: p.y,
      startLeft: box.offsetLeft,
      startTop: box.offsetTop,
      startWidth: box.offsetWidth,
      startHeight: box.offsetHeight,
    });
  }

  function handlePreviewMouseDown(event: React.MouseEvent) {
    if (event.target !== event.currentTarget) return; // ignore drags on regions
    setDrawAnchor(previewPoint(event));
    setDrawRect(null);
  }

  function handlePreviewMouseMove(event: React.MouseEvent) {
    if (moving) {
      const p = previewPoint(event);
      const ppi = pxPerInch();
      movedRef.current = true;
      if (moving.action === 'move') {
        const left = (moving.startLeft + (p.x - moving.startX)) / ppi;
        const top = (moving.startTop + (p.y - moving.startY)) / ppi;
        const newLeft = `${Math.max(left, 0).toFixed(2)}in`;
        const newTop = `${Math.max(top, 0).toFixed(2)}in`;
        if (moving.kind === 'region') {
          setRegionsBySide((prev) => ({
            ...prev,
            [side]: prev[side].map((r) =>
              r.name === moving.name
                ? { ...r, position: { ...r.position, right: undefined, left: newLeft, top: newTop } }
                : r,
            ),
          }));
        } else {
          setQrBySide((prev) => {
            const current = prev[side];
            if (!current) return prev;
            return {
              ...prev,
              [side]: { ...current, position: { ...current.position, right: undefined, left: newLeft, top: newTop } },
            };
          });
        }
      } else {
        // Resize: the top-left corner stays put; width/height follow the
        // pointer, clamped so the box can't collapse to zero.
        const widthIn = Math.max((moving.startWidth + (p.x - moving.startX)) / ppi, MIN_BOX_WIDTH_IN);
        const heightIn = Math.max((moving.startHeight + (p.y - moving.startY)) / ppi, MIN_BOX_HEIGHT_IN);
        const newWidth = `${widthIn.toFixed(2)}in`;
        const newHeight = `${heightIn.toFixed(2)}in`;
        if (moving.kind === 'region') {
          setRegionsBySide((prev) => ({
            ...prev,
            [side]: prev[side].map((r) =>
              r.name === moving.name ? { ...r, position: { ...r.position, width: newWidth, height: newHeight } } : r,
            ),
          }));
        } else {
          setQrBySide((prev) => {
            const current = prev[side];
            if (!current) return prev;
            return {
              ...prev,
              [side]: { ...current, position: { ...current.position, width: newWidth, height: newHeight } },
            };
          });
        }
      }
      return;
    }
    if (!drawAnchor) return;
    const p = previewPoint(event);
    setDrawRect({
      x: Math.min(drawAnchor.x, p.x),
      y: Math.min(drawAnchor.y, p.y),
      w: Math.abs(p.x - drawAnchor.x),
      h: Math.abs(p.y - drawAnchor.y),
    });
  }

  function handlePreviewMouseUp() {
    if (moving) {
      setMoving(null);
      return;
    }
    if (drawAnchor && drawRect && (drawRect.w > 10 || drawRect.h > 10)) {
      setNamingRect(drawRect);
      setDraftName('');
    }
    setDrawAnchor(null);
    setDrawRect(null);
  }

  function createRegionFromRect(rect: DrawRect, label: string) {
    const ppi = pxPerInch();
    const taken = new Set(SIDES.flatMap((s) => regionsBySide[s].map((r) => r.name)));
    const name = makeRegionName(side, label, taken);
    const region: PostcardRegion = {
      name,
      label,
      style: '',
      // The drawn box IS the box: exact drawn size, content clipped.
      position: {
        top: `${(rect.y / ppi).toFixed(2)}in`,
        left: `${(rect.x / ppi).toFixed(2)}in`,
        width: `${Math.max(rect.w / ppi, 0.3).toFixed(2)}in`,
        height: `${Math.max(rect.h / ppi, 0.2).toFixed(2)}in`,
      },
      font: DEFAULT_FONT,
    };
    setRegionsBySide((prev) => ({ ...prev, [side]: [...prev[side], region] }));
    setRegionText((prev) => ({ ...prev, [name]: '' }));
    setNamingRect(null);
  }

  /** "Generate PDF": same PUT-then-POST pattern as `OutputPane.tsx`'s PDF
   * button (ticket 005-009), but carrying this page's actual regions/QR
   * overlays rather than just the two image paths -- the PUT persists the
   * edits (this ticket's "Save" acceptance criterion), the POST renders
   * and streams back the PDF, opened in a new tab. Shares
   * `buildContentPayload()` with the debounced autosave effect above, so
   * both send the identical content-JSON shape. */
  async function handleGeneratePdf() {
    if (pdfBusy) return;
    const content = buildContentPayload();
    if (!content) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const putRes = await fetch(`/api/postcards/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);

      const pdfRes = await fetch(`/api/postcards/${projectId}/pdf`, { method: 'POST' });
      if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);

      const blob = await pdfRes.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setPdfError('Failed to generate the PDF -- please try again.');
    } finally {
      setPdfBusy(false);
    }
  }

  if (Number.isNaN(projectId)) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p>Invalid project</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p>Loading project…</p>
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="flex h-full items-center justify-center text-red-600">
        <p>{loadError || 'Project not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-800">
      {/* Top: title row, then the postcard with its front/back tabs. */}
      <div className="flex-shrink-0 overflow-y-auto px-8 pt-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link
                to={`/projects/${projectId}`}
                aria-label="Back to iterations"
                className="mt-0.5 rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                ←
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-slate-800">Text editor — {project.title}</h1>
                <p className="text-sm text-slate-500">
                  Drag on the postcard to draw a new text box. Click a box to
                  edit or delete it; drag its top-left handle to move it, or
                  its bottom-right handle to resize it. Use the QR tool to
                  add a scannable code to the current face.
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1">
              {pdfError && <span className="text-xs text-red-600">{pdfError}</span>}
              <button
                type="button"
                disabled={!frontIteration || pdfBusy}
                onClick={() => void handleGeneratePdf()}
                title={!frontIteration ? 'Mark an iteration as the front in the output view first' : undefined}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {pdfBusy ? 'Generating…' : 'Generate PDF'}
              </button>
            </div>
          </div>

          <div
            role="group"
            aria-label="Postcard side"
            className="mb-3 inline-flex overflow-hidden rounded border border-slate-300"
          >
            {SIDES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={side === option}
                onClick={() => setSide(option)}
                className={
                  side === option
                    ? 'bg-indigo-600 px-4 py-2 text-sm font-semibold capitalize text-white'
                    : 'bg-white px-4 py-2 text-sm font-semibold capitalize text-slate-600 hover:bg-slate-50'
                }
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mb-4 flex items-start justify-center gap-3">
            {/* Side toolbar -- consistent with the draw-to-create text-box
                affordance already on the canvas itself; this is the one
                element-adding tool that isn't a canvas drag, so it gets a
                button (AC2). */}
            <div className="flex flex-shrink-0 flex-col gap-2 pt-1" aria-label="Tools" role="toolbar">
              <button
                type="button"
                onClick={handleAddQr}
                disabled={!!qr}
                aria-label="Add QR code"
                title={qr ? 'This face already has a QR code' : 'Add a QR code to this face'}
                className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-[10px] font-bold uppercase leading-none text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                QR
              </button>
            </div>

            <div
              ref={previewRef}
              data-testid="postcard-preview"
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              className="relative flex-shrink-0 cursor-crosshair border-2 border-slate-300 bg-white shadow-sm"
              style={{ width: '6in', height: '4in' }}
            >
            {currentIteration ? (
              <img
                src={fileUrl(currentIteration.imagePath)}
                alt={`${side} preview`}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-slate-300">
                No {side} image yet — mark an iteration&apos;s side in the output view first
              </p>
            )}

            {regions.map((region) => {
              // A region WITHOUT an explicit position.height (marketing-
              // imported, auto-height, text-flow boxes) renders in normal
              // document flow -- the box grows to fit its text, matching
              // postcardRender.ts's own height-less-region contract (OOP
              // fix, 2026-07-15: these were previously colliding with the
              // text layer's `absolute inset-0`, which collapsed the box
              // to zero height since nothing else in the button was in
              // flow). A region WITH an explicit height (freshly-drawn or
              // resized boxes) keeps the fixed-size, clipped-overflow
              // behavior. Resizing a height-less box always sets an
              // explicit height (`handlePreviewMouseMove`'s resize branch),
              // so a resize switches a box from auto-height into
              // fixed/clipped mode -- expected, not a bug.
              const explicitHeight = hasExplicitHeight(region.position);
              return (
                <button
                  key={region.name}
                  type="button"
                  data-testid={`postcard-region-box-${region.name}`}
                  aria-label={`Edit ${region.label}`}
                  onClick={() => {
                    if (movedRef.current) {
                      movedRef.current = false;
                      return; // a corner-handle drag just ended; not a click
                    }
                    openRegionEditor(region);
                  }}
                  className="absolute cursor-pointer border border-dashed border-indigo-400 bg-indigo-50/60 text-left text-[9px] leading-tight hover:bg-indigo-100"
                  style={regionBoxStyle(region.position)}
                >
                  {explicitHeight ? (
                    // Fixed-size mode: text is clipped to the box bounds
                    // (round-10: overflow clipped, not shown).
                    // overflow-hidden lives here, not on the button, so the
                    // label tag below can straddle the top border.
                    <span
                      data-testid={`postcard-region-text-${region.name}`}
                      className="absolute inset-0 overflow-hidden p-1 pt-2"
                    >
                      {regionText[region.name]}
                    </span>
                  ) : (
                    // Auto-height mode: text sits in normal document flow,
                    // so the button (which has no explicit height of its
                    // own) grows to fit it instead of collapsing.
                    <span
                      data-testid={`postcard-region-text-${region.name}`}
                      className="block whitespace-pre-wrap p-1 pt-3"
                    >
                      {regionText[region.name]}
                    </span>
                  )}
                  {/* Label tag: sits centered on the top border at the upper-left,
                      left-aligned -- white background + solid border laid over the
                      dashed box outline. The whole tag is the MOVE grip: grab it
                      to drag the box. */}
                  <span
                    data-testid={`region-move-${region.name}`}
                    onMouseDown={(event) => handleMoveStart(event, 'region', 'move', region.name)}
                    className="absolute left-1 top-0 -translate-y-1/2 cursor-move rounded-sm border border-solid border-indigo-500 bg-white px-1 font-semibold text-indigo-700"
                  >
                    {region.label}
                  </span>
                  {/* Bottom-right corner handle resizes the box (top-left corner
                      stays fixed, width/height follow the pointer). Move is the
                      label tag above. */}
                  <span
                    data-testid={`move-handle-br-${region.name}`}
                    onMouseDown={(event) => handleMoveStart(event, 'region', 'resize', region.name)}
                    className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-white bg-indigo-600"
                  />
                </button>
              );
            })}

            {drawRect && (
              <div
                data-testid="draw-rubber-band"
                className="pointer-events-none absolute border-2 border-dashed border-emerald-500 bg-emerald-50/40"
                style={{
                  top: drawRect.y,
                  left: drawRect.x,
                  width: drawRect.w,
                  height: drawRect.h,
                }}
              />
            )}

            {/* QR overlay -- present only when this face has one (AC1: no
                QR by default). Click opens its popup; drag its top-left
                handle to move it or its bottom-right handle to resize it,
                mirroring the text-region handles above. */}
            {qr && (
              <button
                type="button"
                data-testid="postcard-qr-box"
                aria-label="QR code — edit or move"
                onClick={() => {
                  if (movedRef.current) {
                    movedRef.current = false;
                    return; // a corner-handle drag just ended; not a click
                  }
                  setDraftQrUrl(qr.url);
                  setEditingQrSide(side);
                }}
                className="absolute cursor-pointer border border-dashed border-slate-300 bg-white/80 p-0 text-left hover:border-indigo-400"
                style={regionBoxStyle(qr.position)}
              >
                {qrGraphic ? (
                  /* Real, scannable QR code (fills the box's WIDTH, not
                     its height -- `aspect-ratio:1/1` keeps it square
                     regardless of how tall the box is) plus the
                     width-matched URL caption directly beneath it. */
                  <div className="flex w-full flex-col gap-1">
                    <div data-testid="postcard-qr-graphic" className="w-full" style={{ aspectRatio: '1 / 1' }}>
                      <svg
                        viewBox={`0 0 ${qrGraphic.size} ${qrGraphic.size}`}
                        width="100%"
                        height="100%"
                        preserveAspectRatio="none"
                        shapeRendering="crispEdges"
                      >
                        <rect width={qrGraphic.size} height={qrGraphic.size} fill="#fff" />
                        <path d={qrGraphic.path} fill="#000" />
                      </svg>
                    </div>
                    <div
                      data-testid="postcard-qr-url"
                      className="w-full"
                      style={{ aspectRatio: `${CAPTION_VIEWBOX_WIDTH} / ${CAPTION_VIEWBOX_HEIGHT}` }}
                    >
                      <svg
                        viewBox={`0 0 ${CAPTION_VIEWBOX_WIDTH} ${CAPTION_VIEWBOX_HEIGHT}`}
                        width="100%"
                        height="100%"
                        preserveAspectRatio="none"
                      >
                        <text
                          x={0}
                          y={CAPTION_VIEWBOX_HEIGHT - 10}
                          fontFamily="Arial, sans-serif"
                          fontSize={CAPTION_VIEWBOX_HEIGHT - 12}
                          textLength={CAPTION_VIEWBOX_WIDTH}
                          lengthAdjust="spacingAndGlyphs"
                          fill="#333"
                        >
                          {displayQrUrl(qr.url)}
                        </text>
                      </svg>
                    </div>
                  </div>
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/70 p-1 text-center text-[9px] font-semibold text-amber-700">
                    Click to set a QR URL
                  </span>
                )}
                {/* Same two-handle mechanism as text regions: top-left
                    moves, bottom-right resizes. */}
                <span
                  data-testid="move-handle-tl-qr"
                  onMouseDown={(event) => handleMoveStart(event, 'qr', 'move', side)}
                  className="absolute -left-1 -top-1 h-2.5 w-2.5 cursor-move rounded-sm border border-white bg-amber-600"
                />
                <span
                  data-testid="move-handle-br-qr"
                  onMouseDown={(event) => handleMoveStart(event, 'qr', 'resize', side)}
                  className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-white bg-amber-600"
                />
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat: instructions here are not limited to the text regions --
          reuses the real ChatPanel/postSseStream, never EventSource. */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200">
        <ChatPanel key={projectId} projectId={projectId} initialMessages={project.chatMessages} />
      </div>

      {/* Click-to-edit popup: edit the text, or delete the box. */}
      {editingRegion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setEditingRegion(null)}
        >
          <div
            role="dialog"
            aria-label={`Edit ${editingRegion.label}`}
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">{editingRegion.label}</h3>
                <p className="mb-3 mt-0.5 text-xs text-slate-500">
                  {summarizePositionAndFont(editingRegion)} — Return applies, Shift+Return for a new line, Esc
                  cancels
                </p>
              </div>
              <button
                type="button"
                onClick={deleteEditingRegion}
                className="flex-shrink-0 rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
            <textarea
              autoFocus
              aria-label={`${editingRegion.label} text`}
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingRegion(null);
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitRegionEditor();
                }
              }}
              rows={Math.max(3, Math.ceil(draftText.length / 60) + 1)}
              className="w-full resize-y rounded border border-slate-300 px-3 py-2 text-base leading-relaxed text-slate-800"
            />
          </div>
        </div>
      )}

      {/* Name-the-new-box popup, after drawing. */}
      {namingRect && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setNamingRect(null)}
        >
          <div
            role="dialog"
            aria-label="Name new text box"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-700">New text box</h3>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">Name it — Return creates, Esc discards</p>
            <input
              autoFocus
              type="text"
              aria-label="Text box name"
              placeholder="e.g. Headline"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNamingRect(null);
                if (event.key === 'Enter' && draftName.trim()) {
                  event.preventDefault();
                  createRegionFromRect(namingRect, draftName.trim());
                }
              }}
              className="w-full rounded border border-slate-300 px-3 py-2 text-base text-slate-800"
            />
          </div>
        </div>
      )}

      {/* QR popup: enter the URL the current face's QR code should encode. */}
      {editingQrSide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setEditingQrSide(null)}
        >
          <div
            role="dialog"
            aria-label="QR code"
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">QR code</h3>
                <p className="mb-3 mt-0.5 text-xs text-slate-500">
                  The QR code encodes this URL — Return applies, Esc cancels
                </p>
              </div>
              <button
                type="button"
                onClick={deleteEditingQr}
                className="flex-shrink-0 rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
            <input
              autoFocus
              type="url"
              aria-label="QR code URL"
              placeholder="https://…"
              value={draftQrUrl}
              onChange={(event) => setDraftQrUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingQrSide(null);
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const targetSide = editingQrSide;
                  setQrBySide((prev) => {
                    const current = prev[targetSide];
                    if (!current) return prev;
                    return { ...prev, [targetSide]: { ...current, url: normalizeQrUrl(draftQrUrl) } };
                  });
                  setEditingQrSide(null);
                }
              }}
              className="w-full rounded border border-slate-300 px-3 py-2 text-base text-slate-800"
            />
          </div>
        </div>
      )}
    </div>
  );
}
