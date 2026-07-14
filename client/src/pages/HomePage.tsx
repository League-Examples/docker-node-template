import { Link } from 'react-router-dom';

/**
 * Post-login landing page. The counter demo that shipped with the app
 * template is gone; until the real two-pane app is built, home links
 * straight into the Flyerbot wireframes (see /mockups/*).
 */

const WIREFRAMES = [
  {
    to: '/mockups/main',
    title: 'Main two-pane layout',
    description:
      'Asset/style/project browser on the left; project outputs over chat on the right.',
  },
  {
    to: '/mockups/new-project',
    title: 'New-project flow',
    description:
      'Blank project: details header, empty outputs, opening AI exchange.',
  },
  {
    to: '/mockups/postcard-edit',
    title: 'Postcard text-region editor',
    description:
      'Front/back preview with labeled text regions and a live-updating form.',
  },
  {
    to: '/mockups/login',
    title: 'Google-only login',
    description: 'Wireframe of the sign-in page.',
  },
];

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Flyerbot</h1>
      <p className="text-slate-500 mb-8">
        A conversational AI studio for League marketing collateral. The real
        two-pane app will replace this page; for now, review the wireframes.
      </p>

      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
        Wireframes
      </h2>
      <div className="flex flex-col gap-3">
        {WIREFRAMES.map((wf) => (
          <Link
            key={wf.to}
            to={wf.to}
            className="block bg-white border border-slate-200 rounded-xl px-6 py-4 shadow-sm hover:border-indigo-400 transition-colors"
          >
            <p className="font-semibold text-indigo-600">{wf.title}</p>
            <p className="text-sm text-slate-500 mt-0.5">{wf.description}</p>
          </Link>
        ))}
      </div>

      <p className="text-sm text-slate-400 mt-6">
        Index of all wireframes:{' '}
        <Link to="/mockups" className="text-indigo-500 underline">
          /mockups
        </Link>
      </p>
    </div>
  );
}
