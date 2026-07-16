import type { PostcardSide } from '../../lib/postcardFaceEditing';

/**
 * Front/Back stream-tab bar (Sprint 005 OOP change, 2026-07-15): picks
 * which stream of iterations `OutputPane.tsx` shows (`iterations.filter(i
 * => i.role === activeTab)`), replacing the per-iteration side `<select>`
 * this same change removes. Rendered by `ProjectDetail/index.tsx` in the
 * page's FIXED top area (title row / tabs / PDF button), between the
 * project title and the PDF button -- not inside the scrolling stream.
 */

const FACES: PostcardSide[] = ['front', 'back'];
const FACE_LABELS: Record<PostcardSide, string> = { front: 'Front', back: 'Back' };

export interface FaceTabsProps {
  active: PostcardSide;
  onChange: (face: PostcardSide) => void;
}

export default function FaceTabs({ active, onChange }: FaceTabsProps) {
  return (
    <div role="group" aria-label="Postcard face" className="inline-flex flex-shrink-0 overflow-hidden rounded border border-slate-300">
      {FACES.map((face) => (
        <button
          key={face}
          type="button"
          aria-pressed={active === face}
          onClick={() => onChange(face)}
          className={
            active === face
              ? 'bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white'
              : 'bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50'
          }
        >
          {FACE_LABELS[face]}
        </button>
      ))}
    </div>
  );
}
