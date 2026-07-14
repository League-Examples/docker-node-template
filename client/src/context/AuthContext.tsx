import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/** Shape returned by GET /api/auth/me. */
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
  // Impersonation fields (populated by Sprint 018 impersonation middleware)
  impersonating?: boolean;
  realAdmin?: { id: string; displayName: string } | null;
  // OAuth-linked providers (populated by /api/auth/me, Sprint 018 social login)
  linkedProviders?: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data: AuthUser = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    fetchMe().finally(() => setLoading(false));
  }, []);

  function login(authedUser: AuthUser) {
    setUser(authedUser);
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
  }

  async function refresh() {
    await fetchMe();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
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
