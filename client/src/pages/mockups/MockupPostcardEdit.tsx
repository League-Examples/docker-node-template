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

/**
 * /mockups/postcard-edit — the postcard text-region edit form wireframe
 * (spec §11's "the agent makes a web page for that" example; UC-010/
 * SUC-004). A front/back toggle switches between two postcard-shaped
 * preview boxes, each showing its side's stub text regions as labeled
 * outline boxes at their stub `position`, plus (on the back) a distinct
 * placeholder for the `extra_html` QR overlay. The form below lists one
 * row per region; editing a row's text input live-updates only that
 * region's text in the preview above via local `useState` — no network
 * call, no persistence. See architecture-update.md, Decision 4.
 */
export default function MockupPostcardEdit() {
  const [side, setSide] = useState<PostcardSide>('back');
  const [regionText, setRegionText] = useState<Record<string, string>>(buildInitialTextMap);

  const regions = STUB_POSTCARD_REGIONS[side];
  const overlay = STUB_POSTCARD_EXTRA_OVERLAY[side];

  function handleRegionTextChange(name: string, value: string) {
    setRegionText((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold text-slate-800">
          Postcard text-region edit form
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Structural wireframe only — region positions are an
          approximation, not a print-accurate renderer.
        </p>

        <div
          role="group"
          aria-label="Postcard side"
          className="mb-6 inline-flex overflow-hidden rounded border border-slate-300"
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

        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Preview — {side}
            </h2>
            <div
              data-testid="postcard-preview"
              className="relative mx-auto border-2 border-slate-300 bg-white shadow-sm"
              style={{ width: '6in', height: '4in' }}
            >
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
                  <span className="block font-semibold text-indigo-700">
                    {region.label}
                  </span>
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

          <div>
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
      </div>
    </div>
  );
}
