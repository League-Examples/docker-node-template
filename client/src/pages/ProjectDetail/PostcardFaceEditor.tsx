import { Fragment, useRef, useState } from 'react';
import { fileUrl, type PostcardQr, type PostcardRegionPosition } from './types';
import { buildQrGraphic, normalizeQrUrl } from '../../lib/qrCode';
import { regionBoxStyle, hasExplicitHeight, REFERENCE_WIDTH_PX } from '../../lib/postcardRegionLayout';
import { useMeasuredWidth } from '../../lib/useMeasuredWidth';
import PostcardRegionContent from '../../lib/PostcardRegionContent';
import PostcardRegionBaseLayer from '../../lib/PostcardRegionBaseLayer';
import PostcardQrBaseLayer from '../../lib/PostcardQrBaseLayer';
import {
  CANVAS_WIDTH_IN,
  MIN_BOX_WIDTH_IN,
  MIN_BOX_HEIGHT_IN,
  boxEdgesPx,
  createDefaultTextRegion,
  inToPx,
  summarizePositionAndFont,
  type PostcardRegion,
  type PostcardSide,
} from '../../lib/postcardFaceEditing';

/**
 * Interactive text-box/QR editor for ONE postcard face's accepted iteration
 * (Sprint 005 OOP change, 2026-07-15; drag-to-draw replaced by a "+ Text"
 * button in a later same-sprint OOP pass, 2026-07-15). Extracted, side-fixed,
 * from `pages/PostcardEdit.tsx` -- that whole standalone page/route is
 * deleted by this same change ("remove the separate PostcardEdit page...
 * reuse the existing editing machinery... extract shared components as
 * needed"). This component IS that extraction: the click-to-edit popup,
 * "+ Text"/"+ QR code" add buttons, corner move/resize handles, QR
 * add/url/delete/move/resize, and the alignment-guide crosshairs all moved
 * here verbatim (same mechanics, same `data-testid`s), just parameterized by
 * a single fixed `side` prop instead of `PostcardEdit.tsx`'s own front/back
 * `<select>` + dual-side state.
 *
 * **Where the OLD page's other half went**: `PostcardEdit.tsx` also owned
 * the load-on-mount GET, the debounced-autosave PUT (with its
 * failed-load-guard), and the `regionsBySide`/`regionText`/`qrBySide` state
 * itself, covering BOTH faces at once (a PUT must carry both to avoid
 * clobbering). That data layer now lives in the sibling
 * `usePostcardEditorState.ts` hook, owned by `ProjectDetail/index.tsx` (one
 * instance covering both faces, since only one face's editor is ever
 * mounted at a time -- whichever stream tab is active -- but the OTHER
 * face's regions must stay in memory so a tab switch doesn't need a
 * refetch, and so autosave never sends a partial/stale payload for the
 * face the stakeholder isn't currently looking at). This component is
 * purely controlled: it receives the CURRENT face's `regions`/`qr` as
 * props and reports every add/edit/move/resize/delete back up via
 * callbacks -- it holds no persistence logic of its own, only the
 * in-progress UI interaction state (which box is being dragged, which
 * popup is open).
 *
 * Deliberately still keyed by `region.name`/`side` exactly like the
 * original -- `usePostcardEditorState`'s `existingRegionNames` set (unioned
 * across BOTH faces) is threaded through so a "+ Text"-added box's generated
 * name still can't collide with one on the other face, matching
 * `PostcardEdit.tsx`'s original `makeRegionName` call site.
 */

export interface PostcardFaceEditorProps {
  side: PostcardSide;
  imagePath: string;
  regions: PostcardRegion[];
  regionText: Record<string, string>;
  qr: PostcardQr | null;
  existingRegionNames: Set<string>;
  onAddRegion: (region: PostcardRegion, initialText: string) => void;
  onRegionTextChange: (name: string, value: string) => void;
  onRegionPositionChange: (name: string, position: PostcardRegionPosition) => void;
  onDeleteRegion: (name: string) => void;
  onAddQr: () => void;
  onQrUrlChange: (url: string) => void;
  onQrPositionChange: (position: PostcardRegionPosition) => void;
  onDeleteQr: () => void;
}

export default function PostcardFaceEditor({
  side,
  imagePath,
  regions,
  regionText,
  qr,
  existingRegionNames,
  onAddRegion,
  onRegionTextChange,
  onRegionPositionChange,
  onDeleteRegion,
  onAddQr,
  onQrUrlChange,
  onQrPositionChange,
  onDeleteQr,
}: PostcardFaceEditorProps) {
  // Click-to-edit popup state: which region is being edited, and its draft.
  const [editingRegion, setEditingRegion] = useState<PostcardRegion | null>(null);
  const [draftText, setDraftText] = useState('');
  // QR popup state: is it open, and its in-flight URL draft.
  const [editingQr, setEditingQr] = useState(false);
  const [draftQrUrl, setDraftQrUrl] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  // Move/resize-a-box state: one shared drag mechanism for both a text
  // region and the QR overlay, and both the move/resize actions.
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
  // Chrome-box DOM nodes, keyed `region:<name>` / `qr` -- read only by the
  // alignment-guide overlay, to measure a height-less region's real
  // rendered height while it's being moved.
  const boxElRefs = useRef<Record<string, HTMLElement | null>>({});

  // Coordinate-scaling fix (OOP, 2026-07-15): the canvas became responsive
  // (`w-full max-w-[800px]`, `aspect-ratio: 6/4`) instead of a fixed 6in
  // (576px), but boxes were still positioned via `regionBoxStyle(position)`
  // with NO `widthPx` -- i.e. at fixed CSS `in` units (96px/in) -- while the
  // drag math and alignment guides computed px/in off the *measured* canvas
  // width. At any canvas width other than 576px those two scales disagree,
  // so a drag's grab point jumps and the guide lines don't sit on the box
  // edges. The fix: measure the canvas ONCE (the same `useMeasuredWidth`
  // hook `OutputPane`/`PostcardOverlay` already use) and thread that single
  // `widthPx` through EVERY box-positioning call (base layers, chrome
  // buttons, font-size scaling) AND the drag/guide px-per-inch math, so
  // rendering and interaction always agree. `measuredWidthPx` is `0` before
  // layout (and always in jsdom, which reports a zero rect) -- falling back
  // to `REFERENCE_WIDTH_PX` (576 = 6in * 96 CSS px/in) reproduces the exact
  // 96px/in the tests, and the old fixed-576px canvas, always used.
  const { widthPx: measuredWidthPx } = useMeasuredWidth(previewRef, imagePath);
  const widthPx = measuredWidthPx > 0 ? measuredWidthPx : REFERENCE_WIDTH_PX;

  const qrGraphic = qr && qr.url.trim() ? buildQrGraphic(normalizeQrUrl(qr.url)) : null;

  let dragGuide: { top: number; left: number; width: number; height: number } | null = null;
  if (moving) {
    const ppi = pxPerInch();
    const draggingRegion = moving.kind === 'region' ? regions.find((r) => r.name === moving.name) : undefined;
    const draggingQr = moving.kind === 'qr' ? qr : undefined;
    if (draggingRegion) {
      const explicit = hasExplicitHeight(draggingRegion.position);
      const heightPx = explicit
        ? inToPx(draggingRegion.position.height, ppi)
        : (boxElRefs.current[`region:${draggingRegion.name}`]?.offsetHeight ?? 0);
      dragGuide = boxEdgesPx(draggingRegion.position, ppi, heightPx);
    } else if (draggingQr) {
      dragGuide = boxEdgesPx(draggingQr.position, ppi, inToPx(draggingQr.position.height, ppi));
    }
  }

  function openRegionEditor(region: PostcardRegion) {
    setEditingRegion(region);
    setDraftText(regionText[region.name] ?? '');
  }

  function commitRegionEditor() {
    if (editingRegion) onRegionTextChange(editingRegion.name, draftText);
    setEditingRegion(null);
  }

  function deleteEditingRegion() {
    if (!editingRegion) return;
    onDeleteRegion(editingRegion.name);
    setEditingRegion(null);
  }

  function previewPoint(event: React.MouseEvent): { x: number; y: number } {
    const rect = previewRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  // Same measured `widthPx` used to render every box (below) and the
  // gallery's read-only `PostcardOverlay` -- NOT an independent
  // `getBoundingClientRect` read, so drag math and alignment guides can
  // never disagree with where the boxes are actually drawn.
  function pxPerInch(): number {
    return widthPx / CANVAS_WIDTH_IN;
  }

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
          const region = regions.find((r) => r.name === moving.name);
          if (region) onRegionPositionChange(region.name, { ...region.position, right: undefined, left: newLeft, top: newTop });
        } else if (qr) {
          onQrPositionChange({ ...qr.position, right: undefined, left: newLeft, top: newTop });
        }
      } else {
        const widthIn = Math.max((moving.startWidth + (p.x - moving.startX)) / ppi, MIN_BOX_WIDTH_IN);
        const heightIn = Math.max((moving.startHeight + (p.y - moving.startY)) / ppi, MIN_BOX_HEIGHT_IN);
        const newWidth = `${widthIn.toFixed(2)}in`;
        const newHeight = `${heightIn.toFixed(2)}in`;
        if (moving.kind === 'region') {
          const region = regions.find((r) => r.name === moving.name);
          if (region) onRegionPositionChange(region.name, { ...region.position, width: newWidth, height: newHeight });
        } else if (qr) {
          onQrPositionChange({ ...qr.position, width: newWidth, height: newHeight });
        }
      }
    }
  }

  function handlePreviewMouseUp() {
    if (moving) {
      setMoving(null);
    }
  }

  function handleAddText() {
    const region = createDefaultTextRegion(side, existingRegionNames);
    onAddRegion(region, '');
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* Add-Text/Add-QR tools sit ABOVE the postcard (outside it) so they
          never shrink the image -- the accepted postcard stays the same
          size as the read-only iteration rows (max-w-[800px]). */}
      <div className="flex w-full max-w-[800px] items-center justify-end gap-2" aria-label="Tools" role="toolbar">
        <button
          type="button"
          onClick={handleAddText}
          aria-label="Add text box"
          title="Add a text box to this face"
          className="flex h-8 items-center justify-center rounded border border-slate-300 bg-white px-3 text-xs font-bold uppercase leading-none text-slate-600 hover:bg-slate-50"
        >
          + Text
        </button>
        <button
          type="button"
          onClick={onAddQr}
          disabled={!!qr}
          aria-label="Add QR code"
          title={qr ? 'This face already has a QR code' : 'Add a QR code to this face'}
          className="flex h-8 items-center justify-center rounded border border-slate-300 bg-white px-3 text-xs font-bold uppercase leading-none text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + QR code
        </button>
      </div>

      <div
        ref={previewRef}
        data-testid="postcard-preview"
        onMouseMove={handlePreviewMouseMove}
        onMouseUp={handlePreviewMouseUp}
        className="relative mx-auto w-full max-w-[800px] border-2 border-slate-300 bg-white shadow-sm"
        style={{ aspectRatio: '6 / 4' }}
      >
        <img
          src={fileUrl(imagePath)}
          alt={`${side} preview`}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />

        {regions.map((region) => {
          const explicitHeight = hasExplicitHeight(region.position);
          const text = regionText[region.name] ?? '';
          return (
            <Fragment key={region.name}>
              <PostcardRegionBaseLayer
                boxTestId={`postcard-region-textbox-${region.name}`}
                textTestId={`postcard-region-text-${region.name}`}
                position={region.position}
                text={text}
                font={region.font}
                style={region.style}
                widthPx={widthPx}
              />
              <button
                type="button"
                ref={(el) => {
                  boxElRefs.current[`region:${region.name}`] = el;
                }}
                data-testid={`postcard-region-box-${region.name}`}
                aria-label={`Edit ${region.label}`}
                onClick={() => {
                  if (movedRef.current) {
                    movedRef.current = false;
                    return;
                  }
                  openRegionEditor(region);
                }}
                className="absolute cursor-pointer border border-dashed border-indigo-400 bg-indigo-50/60 text-left text-[9px] leading-tight hover:bg-indigo-100"
                style={regionBoxStyle(region.position, widthPx)}
              >
                {!explicitHeight && (
                  <PostcardRegionContent
                    aria-hidden
                    className="invisible block whitespace-pre-wrap"
                    text={text}
                    font={region.font}
                    style={region.style}
                    widthPx={widthPx}
                  />
                )}
                <span
                  data-testid={`region-move-${region.name}`}
                  onMouseDown={(event) => handleMoveStart(event, 'region', 'move', region.name)}
                  className="absolute left-1 top-0 -translate-y-1/2 cursor-move rounded-sm border border-solid border-indigo-500 bg-white px-1 font-semibold text-indigo-700"
                >
                  {region.label}
                </span>
                <span
                  data-testid={`move-handle-br-${region.name}`}
                  onMouseDown={(event) => handleMoveStart(event, 'region', 'resize', region.name)}
                  className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-white bg-indigo-600"
                />
              </button>
            </Fragment>
          );
        })}

        {qr && (
          <>
            <PostcardQrBaseLayer
              graphicTestId="postcard-qr-graphic"
              urlTestId="postcard-qr-url"
              position={qr.position}
              qrGraphic={qrGraphic}
              url={qr.url}
              widthPx={widthPx}
            />
            <button
              type="button"
              ref={(el) => {
                boxElRefs.current.qr = el;
              }}
              data-testid="postcard-qr-box"
              aria-label="QR code — edit or move"
              onClick={() => {
                if (movedRef.current) {
                  movedRef.current = false;
                  return;
                }
                setDraftQrUrl(qr.url);
                setEditingQr(true);
              }}
              className="absolute cursor-pointer border border-dashed border-slate-300 bg-white/80 p-0 text-left hover:border-indigo-400"
              style={regionBoxStyle(qr.position, widthPx)}
            >
              {!qrGraphic && (
                <span className="flex h-full w-full flex-col items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/70 p-1 text-center text-[9px] font-semibold text-amber-700">
                  Click to set a QR URL
                </span>
              )}
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
          </>
        )}

        {dragGuide && (
          <>
            <div
              data-testid="align-guide-top"
              className="pointer-events-none absolute left-0 h-px w-full bg-slate-400"
              style={{ top: dragGuide.top }}
            />
            <div
              data-testid="align-guide-bottom"
              className="pointer-events-none absolute left-0 h-px w-full bg-slate-400"
              style={{ top: dragGuide.top + dragGuide.height }}
            />
            <div
              data-testid="align-guide-left"
              className="pointer-events-none absolute top-0 h-full w-px bg-slate-400"
              style={{ left: dragGuide.left }}
            />
            <div
              data-testid="align-guide-right"
              className="pointer-events-none absolute top-0 h-full w-px bg-slate-400"
              style={{ left: dragGuide.left + dragGuide.width }}
            />
          </>
        )}
      </div>

      {/* Click-to-edit popup: edit the text, or delete the box. */}
      {editingRegion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={() => setEditingRegion(null)}>
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
                  {summarizePositionAndFont(editingRegion)} — Return applies, Shift+Return for a new line, Esc cancels
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

      {/* QR popup: enter the URL the current face's QR code should encode. */}
      {editingQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={() => setEditingQr(false)}>
          <div
            role="dialog"
            aria-label="QR code"
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">QR code</h3>
                <p className="mb-3 mt-0.5 text-xs text-slate-500">The QR code encodes this URL — Return applies, Esc cancels</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onDeleteQr();
                  setEditingQr(false);
                }}
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
                if (event.key === 'Escape') setEditingQr(false);
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onQrUrlChange(normalizeQrUrl(draftQrUrl));
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
