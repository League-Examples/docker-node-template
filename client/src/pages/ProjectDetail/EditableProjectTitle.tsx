import { useEffect, useRef, useState } from 'react';

/**
 * Inline, click-to-edit project title control (ticket 013-003, SUC-026;
 * `edit-project-title-inline.md`). Replaces `index.tsx`'s former static
 * `<h1>{project.title}</h1>` header-row render (line 265 pre-ticket) --
 * the issue's stated file, `ProjectDetailsHeader.tsx`, never renders
 * `project.title` at all (sprint.md's Codebase Alignment), so this new
 * component lives alongside it in `ProjectDetail/`, not inside it.
 *
 * Owns its own local edit-mode/draft-text state; `index.tsx` owns the
 * source-of-truth `project.title`/`project.version` and is only told about
 * a successful save via `onSaved` (mirroring the existing
 * `handleIterationsChange`/`handleReferenceAdded` local-state-update
 * pattern already used elsewhere in that file). Reverting to the
 * last-known-good title on cancel/error requires no extra state here: the
 * `title` prop itself IS the last-known-good value, since a failed or
 * cancelled edit never calls `onSaved`.
 */

interface EditableProjectTitleProps {
  projectId: number;
  title: string;
  version: number;
  onSaved: (next: { title: string; version: number }) => void;
}

export default function EditableProjectTitle({ projectId, title, version, onSaved }: EditableProjectTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Enter and Escape both end the edit session synchronously (setEditing
  // false), which unmounts the input -- in some browsers/jsdom that also
  // fires a native `blur` event on the way out. `handledRef` guards against
  // that blur then re-running (or double-running) the commit/cancel logic
  // a second time for the same edit session.
  const handledRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEditing() {
    setDraft(title);
    setError('');
    handledRef.current = false;
    setEditing(true);
  }

  function cancel() {
    if (handledRef.current) return;
    handledRef.current = true;
    setDraft(title);
    setEditing(false);
  }

  function commit() {
    if (handledRef.current) return;
    handledRef.current = true;

    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === title) {
      // Nothing to save -- treat like a cancel, no network call.
      setDraft(title);
      return;
    }

    setError('');
    void save(trimmed);
  }

  async function save(newTitle: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, version }),
      });
      if (!res.ok) {
        // Reverting to the last-known-good title needs no action here --
        // `title`/`version` props are untouched, since `onSaved` is only
        // called below, on success.
        setError(
          res.status === 409
            ? 'Someone else edited this project -- reverted to the latest title.'
            : 'Failed to save the title -- please try again.',
        );
        return;
      }
      const updated = await res.json();
      onSaved({ title: updated.title, version: updated.version });
    } catch {
      setError('Failed to save the title -- please try again.');
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        aria-label="Project title"
        data-testid="project-title-input"
        className="rounded border border-indigo-300 px-2 py-1 text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <h1
        role="button"
        tabIndex={0}
        onClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            startEditing();
          }
        }}
        title="Click to edit project title"
        data-testid="project-title"
        className="cursor-pointer truncate rounded px-2 py-1 text-lg font-semibold text-slate-800 hover:bg-slate-100"
      >
        {title}
      </h1>
      {error && (
        <span data-testid="project-title-error" className="px-2 text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
