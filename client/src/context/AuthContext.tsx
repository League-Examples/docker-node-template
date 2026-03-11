import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/** Shape returned by GET /api/auth/me (mirrors Prisma User model). */
export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  avatarUrl: string | null;
  provider: string | null;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Default placeholder user shown when no session exists (demo mode). */
const PLACEHOLDER_USER: AuthUser = {
  id: 0,
  email: 'eric@example.com',
  displayName: 'Eric Busboom',
  role: 'USER',
  avatarUrl: null,
  provider: null,
  providerId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => {
        if (res.ok) return res.json();
        // Not authenticated — use placeholder for demo
        return null;
      })
      .then((data: AuthUser | null) => {
        setUser(data ?? PLACEHOLDER_USER);
      })
      .catch(() => {
        // Network error — fall back to placeholder
        setUser(PLACEHOLDER_USER);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
