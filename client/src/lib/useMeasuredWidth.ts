import { useEffect, useState, type RefObject } from 'react';

/**
 * Shared "measure this element's on-screen pixel width" hook (OOP change,
 * 2026-07-15) -- extracted from `ProjectDetail/OutputPane.tsx`'s
 * `IterationImage` (the iteration-gallery's per-row image) so it and
 * `ProjectList.tsx`'s new hero-card image (both scaling a `PostcardOverlay`
 * to an `<img>`'s actual rendered pixel width) share ONE implementation of
 * the ref/`getBoundingClientRect`/`ResizeObserver` dance, instead of two
 * independently-maintained hand copies that could silently drift.
 *
 * Measures `ref.current`'s rendered pixel width via `getBoundingClientRect`
 * -- both on mount/`dep` change and via a `ResizeObserver` (an image's
 * on-screen size can change with the viewport, e.g. the gallery's 800px cap
 * or the list's aspect-ratio box) -- so callers always get the actual
 * displayed size, never an assumed one. Returns `0` until the first
 * successful measurement; callers should treat `0` as "not ready to overlay
 * yet", matching `PostcardOverlay`'s own `widthPx === 0` -> renders nothing
 * contract.
 *
 * `dep` should be whatever value changes when the measured element's
 * content changes (e.g. an `<img>`'s `src`) -- the `ResizeObserver` is
 * re-attached whenever it changes. The returned `measure` function is meant
 * to be wired to the element's own `onLoad` (an `<img>` has no intrinsic
 * size, and thus reports `width: 0`, until it finishes loading -- waiting
 * only on the `ResizeObserver` firing after that layout shift works in a
 * real browser, but is unreliable/slow in jsdom's approximate layout model,
 * which is why `OutputPane.tsx`'s original implementation -- and this
 * extraction -- always call `measure()` explicitly from `onLoad` too).
 */
export function useMeasuredWidth<T extends HTMLElement>(
  ref: RefObject<T | null>,
  dep: unknown,
): { widthPx: number; measure: () => void } {
  const [widthPx, setWidthPx] = useState(0);

  function measure() {
    const el = ref.current;
    if (el) setWidthPx(el.getBoundingClientRect().width);
  }

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return { widthPx, measure };
}
