import { Link } from 'react-router-dom';

interface MockupLink {
  to: string;
  label: string;
  description: string;
  ticket: string;
  available: boolean;
}

const MOCKUP_LINKS: MockupLink[] = [
  {
    to: '/mockups/projects',
    label: 'Project list (home)',
    description: 'All projects as cards; hero = most recently accepted iteration (postcards: the front).',
    ticket: 'oop',
    available: true,
  },
  {
    to: '/mockups/main',
    label: 'Two-pane main layout',
    description: 'Left asset/style/project browser; right project output view and chat.',
    ticket: '003',
    available: true,
  },
  {
    to: '/mockups/new-project',
    label: 'New-project flow',
    description: 'Project-details header, empty output area, chat box at the bottom.',
    ticket: '004',
    available: true,
  },
  {
    to: '/mockups/postcard-edit',
    label: 'Postcard text-region edit form',
    description: 'Agent-generated form for entering text into JSON-defined bounding-box regions.',
    ticket: '005',
    available: true,
  },
  {
    to: '/mockups/login',
    label: 'Google-only login',
    description: 'Single Google sign-in affordance, replacing the multi-provider login.',
    ticket: '006',
    available: true,
  },
];

/**
 * /mockups — index page linking the wireframe mockups (architecture-update.md
 * §"Wireframe Mockup Module"). This page, and everything under /mockups/*,
 * is a static preview outside AppLayout and is not auth-gated (Decision 4).
 */
export default function MockupsIndex() {
  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold text-slate-800">
          Flyerbot wireframe mockups
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Structural wireframes only — no visual design, no backend calls.
        </p>

        <ul className="space-y-3">
          {MOCKUP_LINKS.map((mockup) => (
            <li
              key={mockup.to}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              {mockup.available ? (
                <Link
                  to={mockup.to}
                  className="font-semibold text-indigo-600 hover:underline"
                >
                  {mockup.label}
                </Link>
              ) : (
                <span className="font-semibold text-slate-400">
                  {mockup.label} (not yet built — ticket {mockup.ticket})
                </span>
              )}
              <p className="mt-1 text-sm text-slate-500">{mockup.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
