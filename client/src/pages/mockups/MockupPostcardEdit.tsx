import { useState } from 'react';
import MockupChatPanel from './MockupChatPanel';
import {
  STUB_POSTCARD_REGIONS,
  STUB_POSTCARD_EXTRA_OVERLAY,
  STUB_POSTCARD_CHAT_MESSAGES,
} from './mockupStubData';
import type { PostcardRegion, PostcardSide } from './mockupStubData';

const SIDES: PostcardSide[] = ['front', 'back'];

/** Builds the initial name -> text map from every region on every side.
 * Region names are unique across front/back, so a single flat map is
 * enough to keep each side's edits independent of the other. */
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
  regionText: Record<string, string>,
  qrUrl: string,
): string {
  const regions = STUB_POSTCARD_REGIONS[side];
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
function openPdfPreview(regionText: Record<string, string>, qrUrl: string) {
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
${printPageHtml('front', regionText, qrUrl)}
${printPageHtml('back', regionText, qrUrl)}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  w.document.close();
}

/**
 * /mockups/postcard-edit — the postcard text-region edit form wireframe
 * (spec §11's "the agent makes a web page for that" example; UC-010/
 * SUC-004). Explicit design decisions (stakeholder, 2026-07-14):
 * - This view does NOT show the left-pane asset browser — it is a
 *   full-width, agent-authored editing surface.
 * - Front/back are tabs: only one side's preview and region fields show
 *   at a time.
 * - Vertical stack (stakeholder, 2026-07-14, round 3): postcard with its
 *   front/back tabs on top; below it a scrollable box holding the text
 *   fields; below that the chat session.
 * - The chat box is present at the bottom: instructions here are not
 *   limited to the text regions — the user can instruct about almost
 *   anything (layout, fonts, images, the QR overlay...).
 * Editing a region's text input live-updates only that region's text in
 * the preview via local `useState` — no network call, no persistence.
 * "Generate PDF" opens a print-formatted window (6x4in pages, BOTH sides
 * regardless of the active tab) and triggers the print dialog, which on
 * macOS doubles as the PDF preview. See architecture-update.md, Decision 4.
 */
export default function MockupPostcardEdit() {
  const [side, setSide] = useState<PostcardSide>('back');
  const [regionText, setRegionText] = useState<Record<string, string>>(buildInitialTextMap);
  // Click-to-edit popup state: which region is being edited, and its draft.
  const [editingRegion, setEditingRegion] = useState<PostcardRegion | null>(null);
  const [draftText, setDraftText] = useState('');
  // QR popup state: the URL the QR code encodes, and its draft.
  const [qrUrl, setQrUrl] = useState('https://jointheleague.org/robot-riot');
  const [editingQr, setEditingQr] = useState(false);
  const [draftQrUrl, setDraftQrUrl] = useState('');

  const regions = STUB_POSTCARD_REGIONS[side];
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

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      {/* Top: title row, then the postcard with its front/back tabs. */}
      <div className="flex-shrink-0 px-8 pt-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">
                Postcard text-region edit form
              </h1>
              <p className="text-sm text-slate-500">
                Structural wireframe only — region positions are an
                approximation, not a print-accurate renderer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openPdfPreview(regionText, qrUrl)}
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
            data-testid="postcard-preview"
            className="relative mx-auto mb-4 border-2 border-slate-300 bg-white shadow-sm"
            style={{ width: '6in', height: '4in' }}
          >
                {regions.length === 0 && (
                  <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                    {side} image only — no text regions
                  </p>
                )}
                {regions.map((region) => (
                  <button
                    key={region.name}
                    type="button"
                    data-testid={`postcard-region-box-${region.name}`}
                    aria-label={`Edit ${region.label}`}
                    onClick={() => openRegionEditor(region)}
                    className="absolute cursor-pointer overflow-hidden border border-dashed border-indigo-400 bg-indigo-50/60 p-1 text-left text-[9px] leading-tight hover:bg-indigo-100"
                    style={{
                      top: region.position.top,
                      left: region.position.left,
                      right: region.position.right,
                      width: region.position.width,
                    }}
                  >
                    <span className="block font-semibold text-indigo-700">
                      {region.label}
                    </span>
                    <span data-testid={`postcard-region-text-${region.name}`}>
                      {regionText[region.name]}
                    </span>
                  </button>
                ))}

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

      {/* Click-to-edit popup: click a region on the postcard, edit its
          text here, hit return to apply. */}
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
            <h3 className="text-sm font-semibold text-slate-700">
              {editingRegion.label}
            </h3>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              {summarizePositionAndFont(editingRegion)} — Return applies,
              Shift+Return for a new line, Esc cancels
            </p>
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

      {/* QR popup: click the QR overlay, enter the URL the QR code
          should encode, hit return to apply. */}
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
