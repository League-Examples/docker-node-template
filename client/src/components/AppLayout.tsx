import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasAdminAccess, roleShortLabel, roleBadgeStyle } from '../lib/roles';

/* ------------------------------------------------------------------ */
/*  Navigation data                                                    */
/* ------------------------------------------------------------------ */

interface NavItem {
  to: string;
  label: string;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Home' },
  { to: '/chat', label: 'Chat' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Users' },
  { to: '/admin/env', label: 'Environment' },
  { to: '/admin/config', label: 'Configuration' },
  { to: '/admin/db', label: 'Database' },
  { to: '/admin/logs', label: 'Logs' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/permissions', label: 'Permissions' },
  { to: '/admin/import-export', label: 'Import/Export' },
  { to: '/admin/scheduler', label: 'Scheduled Jobs' },
  { to: '/admin/channels', label: 'Channels' },
];

const BOTTOM_NAV: NavItem[] = [
  { to: '/mcp-setup', label: 'MCP Setup' },
  { to: '/about', label: 'About' },
];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const SIDEBAR_WIDTH = 240;
const TOPBAR_HEIGHT = 52;

const styles = {
  wrapper: {
    display: 'flex',
    minHeight: '100vh',
  } as const,

  sidebar: (open: boolean) =>
    ({
      position: 'fixed' as const,
      top: 0,
      left: 0,
      bottom: 0,
      width: SIDEBAR_WIDTH,
      flexShrink: 0,
      background: '#1a1a2e',
      color: '#eee',
      display: 'flex',
      flexDirection: 'column' as const,
      zIndex: 100,
      transform: open ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
      transition: 'transform 0.2s ease',
    }),

  sidebarDesktop: {
    transform: 'translateX(0)',
  } as const,

  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 99,
  } as const,

  logo: {
    padding: '16px 16px 12px',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '-0.01em',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid #2a2a4e',
  } as const,

  sectionLabel: {
    padding: '14px 16px 4px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: '#666',
    letterSpacing: '0.05em',
  } as const,

  navLink: (isActive: boolean) =>
    ({
      display: 'block',
      padding: '9px 16px',
      color: isActive ? '#fff' : '#aaa',
      background: isActive ? '#16213e' : 'transparent',
      textDecoration: 'none',
      fontSize: 14,
    }),

  topbar: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    height: TOPBAR_HEIGHT,
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: 12,
    zIndex: 50,
  } as const,

  hamburger: {
    background: 'none',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#333',
    lineHeight: 1,
  } as const,

  searchInput: {
    flex: 1,
    maxWidth: 400,
    padding: '6px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    outline: 'none',
  } as const,

  userArea: {
    position: 'relative' as const,
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    userSelect: 'none' as const,
  } as const,

  roleBadge: (bg: string, fg: string) =>
    ({
      fontSize: 11,
      padding: '2px 7px',
      borderRadius: 9999,
      fontWeight: 600,
      background: bg,
      color: fg,
    }),

  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    minWidth: 140,
    zIndex: 200,
    overflow: 'hidden',
  } as const,

  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontSize: 14,
    cursor: 'pointer',
    color: '#333',
  } as const,

  content: {
    flex: 1,
    padding: 24,
    minWidth: 0,
    overflow: 'auto',
  } as const,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  useEffect(() => {
    function onResize() {
      setMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return mobile;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayName = user?.displayName ?? 'Guest';
  const role = user?.role;
  const badge = roleBadgeStyle(role);
  const isAdmin = hasAdminAccess(role);

  function closeSidebarIfMobile() {
    if (isMobile) setSidebarOpen(false);
  }

  async function handleLogout() {
    setDropdownOpen(false);
    await logout();
    navigate('/');
  }

  /* ---------- Sidebar ---------- */

  const sidebarStyle = isMobile
    ? styles.sidebar(sidebarOpen)
    : { ...styles.sidebar(true), ...styles.sidebarDesktop };

  const sidebar = (
    <nav style={sidebarStyle}>
      {/* Logo */}
      <div style={styles.logo}>
        <span style={{ fontSize: 20 }} role="img" aria-label="graduation cap">
          &#x1F393;
        </span>
        College App Navigator
      </div>

      {/* Main nav */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={closeSidebarIfMobile}
            style={({ isActive }) => styles.navLink(isActive)}
          >
            {item.label}
          </NavLink>
        ))}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div style={styles.sectionLabel}>Admin</div>
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                onClick={closeSidebarIfMobile}
                style={({ isActive }) => styles.navLink(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ borderTop: '1px solid #2a2a4e', paddingTop: 4, paddingBottom: 8 }}>
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={closeSidebarIfMobile}
            style={({ isActive }) => styles.navLink(isActive)}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );

  /* ---------- Topbar ---------- */

  const topbarLeftOffset = isMobile ? 0 : SIDEBAR_WIDTH;

  const topbar = (
    <header style={{ ...styles.topbar, left: topbarLeftOffset }}>
      {isMobile && (
        <button
          style={styles.hamburger}
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle sidebar"
        >
          &#9776;
        </button>
      )}

      <input
        type="text"
        placeholder="Search..."
        style={styles.searchInput}
      />

      {/* User area with dropdown */}
      <div
        ref={dropdownRef}
        style={styles.userArea}
        onClick={() => setDropdownOpen((v) => !v)}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: '#333' }}>
          {displayName}
        </span>
        <span style={styles.roleBadge(badge.background, badge.color)}>
          {roleShortLabel(role)}
        </span>

        {dropdownOpen && (
          <div style={styles.dropdown}>
            <button
              style={styles.dropdownItem}
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen(false);
                navigate('/account');
              }}
            >
              Account
            </button>
            <button
              style={{ ...styles.dropdownItem, borderTop: '1px solid #e2e8f0' }}
              onClick={(e) => {
                e.stopPropagation();
                void handleLogout();
              }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );

  /* ---------- Render ---------- */

  return (
    <div style={styles.wrapper}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {sidebar}

      <div
        style={{
          flex: 1,
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          paddingTop: TOPBAR_HEIGHT,
        }}
      >
        {topbar}
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
