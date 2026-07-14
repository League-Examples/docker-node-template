import MockupLeftBrowser from './MockupLeftBrowser';
import MockupOutputPane from './MockupOutputPane';
import MockupChatPanel from './MockupChatPanel';

/**
 * /mockups/main — the two-pane main layout wireframe (spec §2).
 *
 * Left pane (~half the screen): a browser for assets, examples, styles,
 * and previous projects. Right pane (the other half): the project-output
 * view occupying the top three-quarters, with the chat window below it.
 * This is the layout that
 * is expected to replace most of AppLayout's sidebar role (see
 * architecture-update.md, Decision 4) — it deliberately renders outside
 * AppLayout, with no sidebar/topbar of its own.
 */
export default function MockupMain() {
  return (
    <div className="flex h-screen bg-slate-50 text-slate-800">
      <MockupLeftBrowser />
      <div className="flex min-w-0 flex-1 flex-col">
        <MockupOutputPane />
        <MockupChatPanel />
      </div>
    </div>
  );
}
