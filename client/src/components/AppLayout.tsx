import { useState, useRef, useEffect } from 'react';
import { NavLink, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasAdminAccess, roleShortLabel, roleBadgeStyle } from '../lib/roles';

/* ------------------------------------------------------------------ */
/*  Navigation data                                                    */
/* ------------------------------------------------------------------ */

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Projects', end: true },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/env', label: 'Environment' },
  { to: '/admin/db', label: 'Database' },
  { to: '/admin/config', label: 'Configuration' },
  { to: '/admin/logs', label: 'Logs' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/scheduler', label: 'Scheduled Jobs' },
  { to: '/admin/import-export', label: 'Import/Export' },
];

const BOTTOM_NAV: NavItem[] = [
  { to: '/about', label: 'About' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * App shell: a top bar with a hamburger menu (nav entries) and an account
 * dropdown, replacing the template's fixed left sidebar. Follows the
 * pattern established by the `/mockups/main` wireframe (stakeholder,
 * 2026-07-14, wireframe review round 5) — the hamburger collapses the nav
 * on every viewport width rather than branching desktop/mobile behavior,
 * which frees the left edge of the screen for Sprint 005's asset-browser
 * overlay.
 */
export default function AppLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdminSection = location.pathname.startsWith('/admin/');
  // The two-pane app (project detail, postcard editor) is h-screen-based
  // with its own internal scroll regions and an absolute-positioned asset
  // drawer, so it needs a zero-padding, non-scrolling <main> ancestor —
  // unlike every other route, which keeps the padded/scrolling default.
  // See architecture-update.md Design Rationale R2.
  const isProjectsSection = location.pathname.startsWith('/projects/');

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [appName, setAppName] = useState(import.meta.env.VITE_APP_NAME ?? 'Flyerbot');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch app name from health endpoint
  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.appName) setAppName(data.appName); })
      .catch(() => {});
  }, []);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Redirect to login if not authenticated
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const displayName = user.displayName ?? 'User';
  const role = user.role;
  const badge = roleBadgeStyle(role);
  const isAdmin = hasAdminAccess(role);
  const avatarInitial = displayName.charAt(0).toUpperCase();

  async function handleLogout() {
    setDropdownOpen(false);
    await logout();
    navigate('/login');
  }

  async function handleStopImpersonating() {
    setDropdownOpen(false);
    await fetch('/api/admin/stop-impersonating', { method: 'POST' });
    window.location.reload();
  }

  const primaryNav = isAdminSection ? ADMIN_NAV : MAIN_NAV;

  const navTabClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
      isActive
        ? 'border-indigo-600 font-semibold text-slate-900'
        : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
    }`;

  const mainClassName = isProjectsSection
    ? 'relative min-w-0 flex-1 overflow-hidden'
    : 'min-w-0 flex-1 overflow-auto p-6';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      {/* Top bar: app name + account menu. Primary nav is the horizontal
          tab bar below (replaces the old hamburger dropdown). */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <span className="font-semibold text-slate-700">{isAdminSection ? 'Admin' : appName}</span>

        <div className="flex-1" />

        {/* Account menu */}
        <div className="relative" ref={dropdownRef}>
          <div
            data-testid="user-menu-trigger"
            className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1 hover:bg-slate-50"
            onClick={() => setDropdownOpen((v) => !v)}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={displayName}
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                {avatarInitial}
              </div>
            )}
            <span className="text-sm font-medium text-slate-700">{displayName}</span>
            <span
              style={{ background: badge.background, color: badge.color }}
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              {roleShortLabel(role)}
            </span>
          </div>

          {dropdownOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded border border-slate-200 bg-white shadow-lg">
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setDropdownOpen(false);
                  navigate('/account');
                }}
              >
                Account
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="block w-full border-t border-slate-100 px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setDropdownOpen(false);
                    navigate('/admin/users');
                  }}
                >
                  Admin console
                </button>
              )}
              {user.impersonating ? (
                <button
                  type="button"
                  className="block w-full border-t border-slate-100 px-3.5 py-2 text-left text-sm text-amber-800 hover:bg-slate-50"
                  onClick={() => void handleStopImpersonating()}
                >
                  Stop impersonating
                </button>
              ) : (
                <button
                  type="button"
                  className="block w-full border-t border-slate-100 px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => void handleLogout()}
                >
                  Log out
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Horizontal tab nav, directly below the header (replaces the old
          hamburger menu). Admin section swaps in the admin tabs. */}
      <nav
        aria-label="Primary"
        className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4"
      >
        {isAdminSection && (
          <NavLink to="/" className={navTabClass}>
            &larr; Back to App
          </NavLink>
        )}
        {primaryNav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navTabClass}>
            {item.label}
          </NavLink>
        ))}
        {BOTTOM_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={navTabClass}>
            {item.label}
          </NavLink>
        ))}
        {isAdmin && !isAdminSection && (
          <NavLink to="/admin/users" className={navTabClass}>
            Admin
          </NavLink>
        )}
      </nav>

      {user.impersonating && user.realAdmin && (
        <div className="flex flex-shrink-0 items-center gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-900">
          <span>
            Viewing as {user.displayName ?? 'unknown'} — real admin: {user.realAdmin.displayName}
          </span>
        </div>
      )}

      <main className={mainClassName}>
        <Outlet />
      </main>
    </div>
  );
}
