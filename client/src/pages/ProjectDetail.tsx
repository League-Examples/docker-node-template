import { useParams } from 'react-router-dom';

/**
 * Placeholder for the real two-pane project view (asset/style browser on
 * the left, outputs/chat on the right — see architecture-update.md's Web
 * App Structure section and the `/mockups/main` wireframe). Ticket 005-007
 * only wires up the route and `AppLayout`'s route-conditional full-bleed
 * `<main>` mode (R2) that this page needs; the real content lands in
 * tickets 005-009/010/011.
 */
export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <p>Project {id}</p>
    </div>
  );
}
