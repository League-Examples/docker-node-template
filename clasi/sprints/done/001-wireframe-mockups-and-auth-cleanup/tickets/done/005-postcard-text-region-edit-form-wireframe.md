---
id: '005'
title: Postcard text-region edit form wireframe
status: done
use-cases:
- SUC-004
depends-on:
- '003'
- '004'
github-issue: ''
issue: wireframe-mockups.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Postcard text-region edit form wireframe

## Description

Build the fourth mockup: `/mockups/postcard-edit`, previewing the
agent-generated postcard text-region editing surface (spec §11's concrete
"the agent makes a web page for that" example; UC-010/SUC-004). Ground the
stub data in the predecessor's real `postcard-content.json` shape — see
e.g. `marketing/projects/Robot-Riot-Postcard/postcard-content.json` — a
`front_regions`/`back_regions` array of objects with `name`, `label`,
`style`, `text`, `position` (`top`/`left`-or-`right`/`width`, all in
inches), and `font` (`family`, `size`); plus a
`back_extra_html`/`front_extra_html` string used for non-text overlays
(e.g. a composited QR-code image) that sit outside the text-region form.
This ticket does not implement chroma-key rendering, PDF export, or any
backend region JSON — it is a static wireframe demonstrating the
structural relationship between a labeled preview and a matching edit
form.

`completes_issue: false` — this is the third of four mockups tracked by
`wireframe-mockups.md` (003: shell/index/main-layout; 004: new-project;
ticket 006's login mockup remains). The issue is archived once ticket 006
is done.

## Acceptance Criteria

- [x] `client/src/pages/mockups/MockupPostcardEdit.tsx` renders at
      `/mockups/postcard-edit`, registered as a sibling route of the other
      `/mockups/*` pages in `App.tsx` (outside `AppLayout`, not
      auth-gated).
- [x] A front/back toggle switches which side's postcard preview and
      region form are shown; the postcard preview renders as a
      fixed-aspect, postcard-shaped rectangle.
- [x] The back side's preview renders each stub text region as a labeled
      outline box, positioned per the region's stub `position` values
      (structural approximation only, not a print-accurate renderer),
      showing its current (editable) text.
- [x] The back side's preview also renders a visually distinct placeholder
      box representing the QR/`extra_html` overlay, separate from the
      text regions.
- [x] The form lists one row per region in the active side, each showing
      the region's label, a position/font summary derived from its stub
      `position`/`font` data (e.g. "top 1.0in · left 0.5in · width 3.4in —
      Arial Black 34px"), and a text input pre-filled with the region's
      stub text.
- [x] At least 3 distinct labeled text-region inputs are present on the
      back side (SUC-004 acceptance criterion).
- [x] Editing a region's text input updates only that region's rendered
      text in the preview box above (local `useState` keyed by region
      name) — no other region changes, no network call, no persistence.
- [x] No page in `client/src/pages/mockups/` makes a `fetch`/XHR call or
      imports anything from outside `client/src/pages/mockups/`.
- [x] `client/src/pages/mockups/MockupsIndex.tsx`'s postcard-edit entry is
      now a live `<Link to="/mockups/postcard-edit">`.
- [x] `npm run test:client` and `npm run test:server` pass; `tsc -b
      --noEmit` is clean in both `client/` and `server/`.

## Testing

- **Existing tests to run**: `npm run test:server` (178 tests, untouched);
  `npm run test:client` (baseline carried over from ticket 004 must keep
  passing).
- **Existing test to update**: `tests/client/MockupsIndex.test.tsx` — add
  a positive link assertion for postcard-edit (mirroring the pattern used
  for new-project in ticket 004) and drop it from the remaining
  not-yet-built assertions (only Google-only login stays not-yet-built
  after this ticket).
- **New tests to write**: `tests/client/MockupPostcardEdit.test.tsx`:
  - renders at least 3 labeled region inputs pre-filled with their stub
    text on the default (back) side;
  - typing into one region's input updates that region's rendered label
    text in the preview, and leaves a different region's preview text
    unchanged;
  - clicking the front toggle switches the preview/form to the front
    side's (empty or single) region set, and clicking back switches back;
  - renders the QR/`extra_html` placeholder box on the back side,
    distinguishable from the text-region boxes (e.g. by a distinct label,
    test id, or role).
- **Verification command**: `npm run test:client` (from repo root; also
  run `npm run test:server` to confirm no regressions in the untouched
  server suite).

### Notes (post-implementation)

- Stub region data (`STUB_POSTCARD_REGIONS`, `STUB_POSTCARD_EXTRA_OVERLAY`
  in `mockupStubData.ts`) is copied directly from
  `marketing/projects/Robot-Riot-Postcard/postcard-content.json` (sibling
  repo, read-only reference — not imported at runtime): 6 back regions,
  an empty front-region array (matching the real project, whose front
  side is image-only), and one back-side QR/`extra_html` placeholder
  overlay. `front_extra_html` was empty in the source data too, so the
  front side renders no overlay.
- Position/font summary format matches the ticket's example exactly for
  `back_headline`: "top 1.0in · left 0.5in · width 3.4in — Arial Black
  34px".
- `npm run test:client`: 75/75 passed (11 files, up from 70/70 baseline —
  net +5: 4 new `MockupPostcardEdit.test.tsx` tests, 1 new positive-link
  assertion added to `MockupsIndex.test.tsx` replacing the removed
  postcard-edit half of the old not-yet-built test).
- `npm run test:server`: 178/178 passed, untouched.
- `tsc -b --noEmit`: clean in both `client/` and `server/`.
