import { useState } from 'react';
import {
  STUB_POSTCARD_REGIONS,
  STUB_POSTCARD_EXTRA_OVERLAY,
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
function printPageHtml(side: PostcardSide, regionText: Record<string, string>): string {
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
    ? `<div style="position:absolute;top:${overlay.position.top};${overlay.position.left ? `left:${overlay.position.left};` : ''}${overlay.position.right ? `right:${overlay.position.right};` : ''}width:${overlay.position.width};height:${overlay.position.height};border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:8px;color:#999;">${escapeHtml(overlay.label)}</div>`
    : '';

  return `<div class="page">${regionDivs}${overlayDiv}</div>`;
}

/** Opens a new window with both sides print-formatted at 6x4in and invokes
 * the browser print dialog — on macOS that dialog is the PDF preview /
 * "Open in Preview" path. Wireframe stand-in for the real server-side PDF
 * pipeline (spec §11 grounding: postcard-content.json -> HTML -> PDF). */
function openPdfPreview(regionText: Record<string, string>) {
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
${printPageHtml('front', regionText)}
${printPageHtml('back', regionText)}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  w.document.close();
}

function SidePreview({
  side,
  regionText,
}: {
  side: PostcardSide;
  regionText: Record<string, string>;
}) {
  const regions = STUB_POSTCARD_REGIONS[side];
  const overlay = STUB_POSTCARD_EXTRA_OVERLAY[side];

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Preview — {side}
      </h2>
      <div
        data-testid={`postcard-preview-${side}`}
        className="relative border-2 border-slate-300 bg-white shadow-sm"
        style={{ width: '6in', height: '4in' }}
      >
        {regions.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
            {side} image only — no text regions
          </p>
        )}
        {regions.map((region) => (
          <div
            key={region.name}
            data-testid={`postcard-region-box-${region.name}`}
            className="absolute overflow-hidden border border-dashed border-indigo-400 bg-indigo-50/60 p-1 text-[9px] leading-tight"
            style={{
              top: region.position.top,
              left: region.position.left,
              right: region.position.right,
              width: region.position.width,
            }}
          >
            <span className="block font-semibold text-indigo-700">{region.label}</span>
            <span data-testid={`postcard-region-text-${region.name}`}>
              {regionText[region.name]}
            </span>
          </div>
        ))}

        {overlay && (
          <div
            data-testid="postcard-extra-overlay"
            role="img"
            aria-label={overlay.label}
            className="absolute flex items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/70 p-1 text-center text-[9px] font-semibold text-amber-700"
            style={{
              top: overlay.position.top,
              left: overlay.position.left,
              right: overlay.position.right,
              width: overlay.position.width,
              height: overlay.position.height,
            }}
          >
            {overlay.label}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * /mockups/postcard-edit — the postcard text-region edit form wireframe
 * (spec §11's "the agent makes a web page for that" example; UC-010/
 * SUC-004). Both sides render as postcard-shaped previews stacked one on
 * top of the other (front, then back), each showing its side's stub text
 * regions as labeled outline boxes at their stub `position`, plus (on the
 * back) a distinct placeholder for the `extra_html` QR overlay. The form
 * below lists one row per region; editing a row's text input live-updates
 * only that region's text in the previews above via local `useState` — no
 * network call, no persistence. "Generate PDF" opens a print-formatted
 * window (6x4in pages, both sides) and triggers the print dialog, which on
 * macOS doubles as the PDF preview. See architecture-update.md, Decision 4.
 */
export default function MockupPostcardEdit() {
  const [regionText, setRegionText] = useState<Record<string, string>>(buildInitialTextMap);

  function handleRegionTextChange(name: string, value: string) {
    setRegionText((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-semibold text-slate-800">
              Postcard text-region edit form
            </h1>
            <p className="text-sm text-slate-500">
              Structural wireframe only — region positions are an
              approximation, not a print-accurate renderer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPdfPreview(regionText)}
            className="flex-shrink-0 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Generate PDF
          </button>
        </div>

        {/* Both sides, stacked one on top of the other. */}
        <div className="mb-8 flex flex-col gap-6">
          {SIDES.map((side) => (
            <SidePreview key={side} side={side} regionText={regionText} />
          ))}
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Regions
        </h2>
        <ul className="space-y-4">
          {SIDES.flatMap((side) =>
            STUB_POSTCARD_REGIONS[side].map((region) => (
              <li
                key={region.name}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <label
                  htmlFor={`region-input-${region.name}`}
                  className="block text-sm font-semibold text-slate-700"
                >
                  {region.label}
                  <span className="ml-2 text-xs font-normal uppercase text-slate-400">
                    {side}
                  </span>
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
            )),
          )}
        </ul>
      </div>
    </div>
  );
}
