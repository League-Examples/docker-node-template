import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MockupChatPanel from './MockupChatPanel';
import {
  STUB_POSTCARD_REGIONS,
  STUB_POSTCARD_EXTRA_OVERLAY,
  STUB_POSTCARD_CHAT_MESSAGES,
} from './mockupStubData';
import type { PostcardRegion, PostcardSide } from './mockupStubData';

const SIDES: PostcardSide[] = ['front', 'back'];

/** Builds the initial name -> text map from every stub region. New
 * regions created by drawing get their entries added on creation. */
function buildInitialTextMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const side of SIDES) {
    for (const region of STUB_POSTCARD_REGIONS[side]) {
      map[region.name] = region.text;
    }
  }
  return map;
}

/** "top 1.0in · left 0.5in · width 3.4in — Arial Black 34px" */
function summarizePositionAndFont(region: PostcardRegion): string {
  const { position, font } = region;
  const parts = [`top ${position.top}`];
  if (position.left) parts.push(`left ${position.left}`);
  if (position.right) parts.push(`right ${position.right}`);
  parts.push(`width ${position.width}`);
  const primaryFamily = font.family.split(',')[0].replace(/['"]/g, '').trim();
  return `${parts.join(' · ')} — ${primaryFamily} ${font.size}`;
}

/** Escape text destined for the print window's HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One 6in x 4in page of print HTML for a postcard side. */
function printPageHtml(
  side: PostcardSide,
  regions: PostcardRegion[],
  regionText: Record<string, string>,
  qrUrl: string,
): string {
  const overlay = STUB_POSTCARD_EXTRA_OVERLAY[side];

  const regionDivs = regions
    .map((region) => {
      const pos = [
        `top:${region.position.top}`,
        region.position.left ? `left:${region.position.left}` : '',
        region.position.right ? `right:${region.position.right}` : '',
        `width:${region.position.width}`,
      ]
        .filter(Boolean)
        .join(';');
      return `<div style="position:absolute;${pos};font-family:${region.font.family};font-size:${region.font.size};line-height:1.15;">${escapeHtml(regionText[region.name] ?? '')}</div>`;
    })
    .join('\n');

  const overlayDiv = overlay
    ? `<div style="position:absolute;top:${overlay.position.top};${overlay.position.left ? `left:${overlay.position.left};` : ''}${overlay.position.right ? `right:${overlay.position.right};` : ''}width:${overlay.position.width};height:${overlay.position.height};border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:8px;color:#999;flex-direction:column;">${escapeHtml(overlay.label)}<br/>${escapeHtml(qrUrl)}</div>`
    : '';

  return `<div class="page">${regionDivs}${overlayDiv}</div>`;
}

/** Opens a new window with both sides print-formatted at 6x4in and invokes
 * the browser print dialog — on macOS that dialog is the PDF preview /
 * "Open in Preview" path. Wireframe stand-in for the real server-side PDF
 * pipeline (spec §11 grounding: postcard-content.json -> HTML -> PDF). */
function openPdfPreview(
  regionsBySide: Record<PostcardSide, PostcardRegion[]>,
  regionText: Record<string, string>,
  qrUrl: string,
) {
  const w = window.open('', '_blank', 'width=700,height=550');
  if (!w) return;
  w.document.write(`<!doctype html>
<html>
<head>
<title>Postcard PDF preview</title>
<style>
  @page { size: 6in 4in; margin: 0; }
  body { margin: 0; }
  .page {
    position: relative;
    width: 6in;
    height: 4in;
    page-break-after: always;
    background: white;
  }
</style>
</head>
<body>
${printPageHtml('front', regionsBySide.front, regionText, qrUrl)}
${printPageHtml('back', regionsBySide.back, regionText, qrUrl)}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  w.document.close();
}

interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Turn a label into a region name unique within the side. */
function makeRegionName(side: PostcardSide, label: string, taken: Set<string>): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'box';
  let name = `${side}_${slug}`;
  let n = 2;
  while (taken.has(name)) name = `${side}_${slug}_${n++}`;
  return name;
}

/**
 * /mockups/postcard-edit — the postcard text-entry view (spec §11's "the
 * agent makes a web page for that" example; UC-010/SUC-004). Explicit
 * design decisions (stakeholder, 2026-07-14, rounds 2-7):
 * - No left-pane asset browser here — full-width, agent-authored surface.
 * - Front/back are tabs: one side's preview and fields at a time.
 * - Vertical stack: postcard + tabs on top, scrollable text-field box
 *   below, chat session at the bottom (instructions in chat are not
 *   limited to the text regions).
 * - Regions are clickable: popup editor, Return applies, popup sized to
 *   fit the text; the popup also carries the DELETE button that removes
 *   the box.
 * - DRAWING a box: drag on the postcard from an anchor corner to rubber-
 *   band a new text box; on release a popup asks for its name; the name
 *   then shows in the box just like the stub regions.
 * - The QR overlay is clickable: enter the URL the QR code encodes.
 * Reached from the iterations page's "Text Entry" button.
 */
export default function MockupPostcardEdit() {
  const [side, setSide] = useState<PostcardSide>('back');
  const [regionsBySide, setRegionsBySide] = useState<Record<PostcardSide, PostcardRegion[]>>(
    () => ({ front: [...STUB_POSTCARD_REGIONS.front], back: [...STUB_POSTCARD_REGIONS.back] }),
  );
  const [regionText, setRegionText] = useState<Record<string, string>>(buildInitialTextMap);
  // Click-to-edit popup state: which region is being edited, and its draft.
  const [editingRegion, setEditingRegion] = useState<PostcardRegion | null>(null);
  const [draftText, setDraftText] = useState('');
  // QR popup state: the URL the QR code encodes, and its draft.
  const [qrUrl, setQrUrl] = useState('https://jointheleague.org/robot-riot');
  const [editingQr, setEditingQr] = useState(false);
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

  const regions = regionsBySide[side];
  const overlay = STUB_POSTCARD_EXTRA_OVERLAY[side];

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
    // Preview is 6in wide; jsdom reports zero width, so fall back to 96dpi.
    const ppi = pxPerInch();
    const taken = new Set(SIDES.flatMap((s) => regionsBySide[s].map((r) => r.name)));
    const name = makeRegionName(side, label, taken);
    const region: PostcardRegion = {
      name,
      label,
      style: 'custom',
      text: '',
      // The drawn box IS the box: exact drawn size, content clipped.
      position: {
        top: `${(rect.y / ppi).toFixed(2)}in`,
        left: `${(rect.x / ppi).toFixed(2)}in`,
        width: `${Math.max(rect.w / ppi, 0.3).toFixed(2)}in`,
        height: `${Math.max(rect.h / ppi, 0.2).toFixed(2)}in`,
      },
      font: { family: 'Arial, sans-serif', size: '14px' },
    };
    setRegionsBySide((prev) => ({ ...prev, [side]: [...prev[side], region] }));
    setRegionText((prev) => ({ ...prev, [name]: '' }));
    setNamingRect(null);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      {/* Top: title row, then the postcard with its front/back tabs. */}
      <div className="flex-shrink-0 px-8 pt-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link
                to="/mockups/main"
                aria-label="Back to iterations"
                className="mt-0.5 rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                ←
              </Link>
              <div>
              <h1 className="text-xl font-semibold text-slate-800">
                Postcard text entry
              </h1>
              <p className="text-sm text-slate-500">
                Drag on the postcard to draw a new text box. Click a box to
                edit or delete it; drag a corner handle to move it.
              </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openPdfPreview(regionsBySide, regionText, qrUrl)}
              className="flex-shrink-0 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Generate PDF
            </button>
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
            className="relative mx-auto mb-4 cursor-crosshair border-2 border-slate-300 bg-white bg-cover bg-center shadow-sm"
            style={{
              width: '6in',
              height: '4in',
              backgroundImage:
                side === 'front'
                  ? "url('/mockup-assets/robot-riot-iter-002.jpg')"
                  : "url('/mockup-assets/robot-riot-iter-004.jpg')",
            }}
          >
            {regions.length === 0 && (
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
                <span data-testid={`postcard-region-text-${region.name}`}>
                  {regionText[region.name]}
                </span>
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

            {overlay && (
              <button
                type="button"
                data-testid="postcard-extra-overlay"
                aria-label={`${overlay.label} — set URL`}
                onClick={() => {
                  setDraftQrUrl(qrUrl);
                  setEditingQr(true);
                }}
                className="absolute flex cursor-pointer flex-col items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/70 p-1 text-center text-[9px] font-semibold text-amber-700 hover:bg-amber-100"
                style={{
                  top: overlay.position.top,
                  left: overlay.position.left,
                  right: overlay.position.right,
                  width: overlay.position.width,
                  height: overlay.position.height,
                }}
              >
                <span>{overlay.label}</span>
                <span
                  data-testid="postcard-qr-url"
                  className="mt-0.5 block max-w-full truncate font-normal"
                >
                  {qrUrl}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Middle: scrollable box holding the text fields. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200 px-8 py-4">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Regions — {side}
          </h2>
          {regions.length === 0 ? (
            <p className="text-sm text-slate-400">
              No text regions on the {side} side.
            </p>
          ) : (
            <ul className="space-y-4">
              {regions.map((region) => (
                <li
                  key={region.name}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <label
                    htmlFor={`region-input-${region.name}`}
                    className="block text-sm font-semibold text-slate-700"
                  >
                    {region.label}
                  </label>
                  <p className="mb-2 mt-0.5 text-xs text-slate-500">
                    {summarizePositionAndFont(region)}
                  </p>
                  <input
                    id={`region-input-${region.name}`}
                    type="text"
                    value={regionText[region.name] ?? ''}
                    onChange={(event) =>
                      handleRegionTextChange(region.name, event.target.value)
                    }
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Chat: instructions here are not limited to the text regions. */}
      <div className="flex h-64 flex-shrink-0 flex-col border-t border-slate-200">
        <MockupChatPanel messages={STUB_POSTCARD_CHAT_MESSAGES} />
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
                <h3 className="text-sm font-semibold text-slate-700">
                  {editingRegion.label}
                </h3>
                <p className="mb-3 mt-0.5 text-xs text-slate-500">
                  {summarizePositionAndFont(editingRegion)} — Return applies,
                  Shift+Return for a new line, Esc cancels
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
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              Name it — Return creates, Esc discards
            </p>
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

      {/* QR popup: enter the URL the QR code should encode. */}
      {editingQr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setEditingQr(false)}
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
                if (event.key === 'Escape') setEditingQr(false);
                if (event.key === 'Enter') {
                  event.preventDefault();
                  setQrUrl(draftQrUrl);
                  setEditingQr(false);
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
