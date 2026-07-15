import { useParams } from 'react-router-dom';

/**
 * Placeholder for the real postcard text-region editor (front/back preview
 * with labeled text regions and a live-updating form — see
 * architecture-update.md's Web App Structure section and the
 * `/mockups/postcard-edit` wireframe). Ticket 005-007 only wires up the
 * route and `AppLayout`'s route-conditional full-bleed `<main>` mode (R2)
 * that this page needs; the real content lands in ticket 005-012.
 */
export default function PostcardEdit() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <p>Postcard editor — project {id}</p>
    </div>
  );
}
