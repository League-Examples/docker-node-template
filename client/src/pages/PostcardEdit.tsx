import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ChatPanel from './ProjectDetail/ChatPanel';
import { fileUrl } from './ProjectDetail/types';
import type { ProjectDetailDTO } from './ProjectDetail/types';

/**
 * `/projects/:id/postcard` -- the real postcard text-region editor (ticket
 * 005-012, SUC-009), promoted from `pages/mockups/MockupPostcardEdit.tsx`.
 * Reached from the output pane's "Text Entry" button (`OutputPane.tsx`,
 * ticket 005-009).
 *
 * The mockup's interaction mechanics (click-to-edit popup, drag-to-draw,
 * corner move handles, QR URL popup) are already fully built against stub
 * data -- this promotion swaps in the two real data seams the stakeholder
 * called out, without rebuilding anything else:
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
 *     `front_regions`/`back_regions`/`*_extra_html` (not just the two
 *     image paths `OutputPane`'s quick-PDF button sends), then `POST
 *     /api/postcards/:id/pdf` to render and open the result.
 *
 * **Text-region data is client-side state for the duration of one editing
 * session** -- there is no `GET` of a previously-saved
 * `postcard-content.json` on mount. The ticket's Description and
 * Acceptance Criteria only specify the *write* path (`PUT`); round-tripping
 * a prior save back into the editor on reload would need a new read
 * endpoint on `postcards.ts`, which is out of this ticket's scope (see the
 * ticket file's deviation note). Every "Generate PDF" click still submits
 * a complete, self-consistent content JSON for whatever is currently drawn
 * in this session.
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

export interface PostcardRegionPosition {
  top: string;
  left?: string;
  right?: string;
  width: string;
  /** Drawn boxes keep their exact drawn height; content is clipped, not
   * overflowed (stakeholder, 2026-07-14; `postcardRender.ts`'s
   * `position.height` -> `overflow:hidden` contract). */
  height?: string;
}

export interface PostcardRegionFont {
  family: string;
  size: string;
}

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

/** Fixed QR-overlay geometry, identical on both faces -- a content-JSON
 * `*_extra_html` seam (`postcardRender.ts`: "anything that doesn't fit the
 * region model, injected verbatim"), not a `PostcardRegion`. Actual QR
 * *image* generation is out of this ticket's scope -- the placeholder box
 * below carries the encoded URL as both visible text and a `data-qr-url`
 * attribute so it round-trips through the content JSON unambiguously. */
const QR_OVERLAY_POSITION: PostcardRegionPosition = {
  top: '1.15in',
  right: '0.5in',
  width: '1.5in',
  height: '1.5in',
};

/** Turn a label into a region name unique across both faces (server-side
 * `data-region` identifier, `postcardRender.ts`'s `renderRegion`). */
function makeRegionName(side: PostcardSide, label: string, taken: Set<string>): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'box';
  let name = `${side}_${slug}`;
  let n = 2;
  while (taken.has(name)) name = `${side}_${slug}_${n++}`;
  return name;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Builds the `*_extra_html` value for a face's QR overlay -- injected
 * verbatim by `renderPostcardHtml` (Sprint 004). */
function qrOverlayExtraHtml(url: string): string {
  const pos = QR_OVERLAY_POSITION;
  const style =
    `position:absolute; top:${pos.top}; right:${pos.right}; width:${pos.width}; height:${pos.height}; ` +
    'border:1px dashed #999; display:flex; align-items:center; justify-content:center; ' +
    'font-size:8px; color:#999; text-align:center; overflow:hidden;';
  return `<div style="${style}" data-qr-url="${escapeHtml(url)}">QR code<br/>${escapeHtml(url)}</div>`;
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
  // QR popup state: the URL each face's QR code encodes, and the in-flight draft.
  const [qrUrlBySide, setQrUrlBySide] = useState<Record<PostcardSide, string>>({ front: '', back: '' });
  const [editingQrSide, setEditingQrSide] = useState<PostcardSide | null>(null);
  const [draftQrUrl, setDraftQrUrl] = useState('');
  // Draw-a-box state: anchor corner, live rubber-band rect, then naming.
  const previewRef = useRef<HTMLDivElement>(null);
  const [drawAnchor, setDrawAnchor] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<DrawRect | null>(null);
  const [namingRect, setNamingRect] = useState<DrawRect | null>(null);
  const [draftName, setDraftName] = useState('');
  // Move-a-box state: which region is being dragged by a corner handle.
  const [moving, setMoving] = useState<{
    name: string;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const movedRef = useRef(false);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

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

  const frontIteration = project?.iterations.find((iteration) => iteration.role === 'front');
  const backIteration = project?.iterations.find((iteration) => iteration.role === 'back');
  const iterationBySide = { front: frontIteration, back: backIteration } as const;
  const currentIteration = iterationBySide[side];

  const regions = regionsBySide[side];
  const qrUrl = qrUrlBySide[side];

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

  function handleMoveStart(event: React.MouseEvent, regionName: string) {
    event.stopPropagation();
    const box = (event.currentTarget as HTMLElement).parentElement;
    if (!box) return;
    const p = previewPoint(event);
    setMoving({
      name: regionName,
      startX: p.x,
      startY: p.y,
      startLeft: box.offsetLeft,
      startTop: box.offsetTop,
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
      const left = (moving.startLeft + (p.x - moving.startX)) / ppi;
      const top = (moving.startTop + (p.y - moving.startY)) / ppi;
      movedRef.current = true;
      setRegionsBySide((prev) => ({
        ...prev,
        [side]: prev[side].map((r) =>
          r.name === moving.name
            ? {
                ...r,
                position: {
                  ...r.position,
                  right: undefined,
                  left: `${Math.max(left, 0).toFixed(2)}in`,
                  top: `${Math.max(top, 0).toFixed(2)}in`,
                },
              }
            : r,
        ),
      }));
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
   * and streams back the PDF, opened in a new tab. */
  async function handleGeneratePdf() {
    if (!frontIteration || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const content: Record<string, unknown> = {
        front_image: frontIteration.imagePath,
        front_regions: regionsBySide.front.map((r) => toContentRegion(r, regionText)),
        back_regions: regionsBySide.back.map((r) => toContentRegion(r, regionText)),
        front_extra_html: qrUrlBySide.front ? qrOverlayExtraHtml(qrUrlBySide.front) : '',
        back_extra_html: qrUrlBySide.back ? qrOverlayExtraHtml(qrUrlBySide.back) : '',
      };
      if (backIteration) content.back_image = backIteration.imagePath;

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
                  edit or delete it; drag a corner handle to move it.
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

          <div
            ref={previewRef}
            data-testid="postcard-preview"
            onMouseDown={handlePreviewMouseDown}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={handlePreviewMouseUp}
            className="relative mx-auto mb-4 cursor-crosshair border-2 border-slate-300 bg-white shadow-sm"
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

            {currentIteration && regions.length === 0 && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                {side} image only — drag to draw a text box
              </p>
            )}

            {regions.map((region) => (
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
                className="absolute cursor-pointer overflow-hidden border border-dashed border-indigo-400 bg-indigo-50/60 p-1 text-left text-[9px] leading-tight hover:bg-indigo-100"
                style={{
                  top: region.position.top,
                  left: region.position.left,
                  right: region.position.right,
                  width: region.position.width,
                  height: region.position.height,
                }}
              >
                <span className="block font-semibold text-indigo-700">{region.label}</span>
                <span data-testid={`postcard-region-text-${region.name}`}>{regionText[region.name]}</span>
                {/* Corner grab squares: drag to move the box. */}
                <span
                  data-testid={`move-handle-bl-${region.name}`}
                  onMouseDown={(event) => handleMoveStart(event, region.name)}
                  className="absolute -bottom-1 -left-1 h-2.5 w-2.5 cursor-move rounded-sm border border-white bg-indigo-600"
                />
                <span
                  data-testid={`move-handle-tr-${region.name}`}
                  onMouseDown={(event) => handleMoveStart(event, region.name)}
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 cursor-move rounded-sm border border-white bg-indigo-600"
                />
              </button>
            ))}

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

            <button
              type="button"
              data-testid="postcard-extra-overlay"
              aria-label="QR code overlay — set URL"
              onClick={() => {
                setDraftQrUrl(qrUrl);
                setEditingQrSide(side);
              }}
              className="absolute flex cursor-pointer flex-col items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/70 p-1 text-center text-[9px] font-semibold text-amber-700 hover:bg-amber-100"
              style={{
                top: QR_OVERLAY_POSITION.top,
                right: QR_OVERLAY_POSITION.right,
                width: QR_OVERLAY_POSITION.width,
                height: QR_OVERLAY_POSITION.height,
              }}
            >
              <span>QR code overlay</span>
              <span data-testid="postcard-qr-url" className="mt-0.5 block max-w-full truncate font-normal">
                {qrUrl}
              </span>
            </button>
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
            aria-label="Set QR code URL"
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-700">QR code</h3>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              The QR code encodes this URL — Return applies, Esc cancels
            </p>
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
                  setQrUrlBySide((prev) => ({ ...prev, [targetSide]: draftQrUrl }));
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
