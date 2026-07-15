/**
 * Post-login landing page — the project list (SUC-001, "home"). Placeholder
 * until ticket 005-008 fills in the real hero-image grid described in
 * architecture-update.md's Web App Structure section; this ticket
 * (005-007) only wires up the route inside the `AppLayout` shell so later
 * tickets have somewhere to render into.
 */
export default function ProjectList() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Projects</h1>
      <p className="text-slate-500">Your projects will appear here.</p>
    </div>
  );
}
