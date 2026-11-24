import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { readHasSessionHint, writeHasSessionHint } from '../core/sessionHint';
import type { SystemAiConfig, UserProfile } from '../core/types';

const DEFAULT_SUPER_ADMIN_EMAILS = new Set([
  'tuankhang2011pm@gmail.com',
  'tuankhangnek@gmail.com',
  'honghainhi2k14@gmail.com',
]);

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  isSuperAdmin: boolean;
  loading: boolean;
  systemStatus: SystemAiConfig | null;
  refreshSystemStatus: (force?: boolean) => Promise<void>;
  refreshProfile: (u?: User | null) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<{ needsVerification: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadFirebaseAuthModules() {
  const [authSdk, { auth }] = await Promise.all([
    import('firebase/auth'),
    import('../firebaseAuth'),
  ]);
  return { authSdk, auth };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialHasSession = readHasSessionHint();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState<boolean>(initialHasSession);
  const [systemStatus, setSystemStatus] = useState<SystemAiConfig | null>(null);

  const statusFetchInFlight = useRef<Promise<void> | null>(null);
  const lastStatusFetchAt = useRef<number>(0);

  const refreshSystemStatus = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && lastStatusFetchAt.current > 0 && now - lastStatusFetchAt.current < 30_000) {
      return;
    }
    if (statusFetchInFlight.current) {
      return statusFetchInFlight.current;
    }
    const run = (async () => {
      try {
        const { authorizedFetch } = await import('../services/apiClient');
        const res = await authorizedFetch('/api/system/status');
        if (res.ok) {
          const data = (await res.json()) as SystemAiConfig;
          setSystemStatus(data);
          lastStatusFetchAt.current = Date.now();
        }
      } catch {
        // Ignore transient offline error
      } finally {
        statusFetchInFlight.current = null;
      }
    })();
    statusFetchInFlight.current = run;
    return run;
  }, []);

  const syncUserSession = useCallback(
    async (firebaseUser: User | null, forceTokenRefresh = false) => {
      if (!firebaseUser) {
        writeHasSessionHint(false);
        setProfile(null);
        setIsSuperAdmin(false);
        return;
      }

      writeHasSessionHint(true);

      let resolvedAdmin = false;
      const lowerEmail = (firebaseUser.email || '').trim().toLowerCase();
      if (firebaseUser.emailVerified && DEFAULT_SUPER_ADMIN_EMAILS.has(lowerEmail)) {
        resolvedAdmin = true;
      }

      const [
        { doc, getDoc },
        { db },
        { upsertUserProfile },
        { resolveApiUrl },
      ] = await Promise.all([
        import('firebase/firestore'),
        import('../firebase'),
        import('../services/firestoreService'),
        import('../services/apiClient'),
      ]);

      try {
        const token = await firebaseUser.getIdToken(forceTokenRefresh);
        const tokenResult = await firebaseUser.getIdTokenResult(false);
        if (
          tokenResult.claims?.superAdmin === true ||
          tokenResult.claims?.role === 'super_admin'
        ) {
          resolvedAdmin = true;
        }

        const [sessionRes, adminSnap] = await Promise.all([
          fetch(resolveApiUrl('/api/auth/session'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
          firebaseUser.emailVerified
            ? getDoc(doc(db, 'admins', firebaseUser.uid)).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (adminSnap?.exists() && adminSnap.data()?.role === 'super_admin') {
          resolvedAdmin = true;
        }

        if (sessionRes && sessionRes.ok) {
          const session = (await sessionRes.json()) as {
            isSuperAdmin?: boolean;
          };
          if (session.isSuperAdmin) {
            resolvedAdmin = true;
          }
        }
      } catch {
        // Keep resolvedAdmin from verified default email / token claims if network call fails
      }

      setIsSuperAdmin(resolvedAdmin);

      if (firebaseUser.emailVerified) {
        try {
          const prof = await upsertUserProfile({
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Học sinh',
            email: firebaseUser.email || '',
            avatarUrl: firebaseUser.photoURL || undefined,
          });
          setProfile(prof);
        } catch (err) {
          console.error('Failed to sync profile:', err);
        }
      }

      // Fetch system status in the background so it never delays interactive workspace paint
      void refreshSystemStatus();
    },
    [refreshSystemStatus]
  );

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;

    const attachAuthListener = async () => {
      try {
        const { authSdk, auth } = await loadFirebaseAuthModules();
        if (cancelled) return;
        unsubscribe = authSdk.onAuthStateChanged(auth, async (u) => {
          if (cancelled) return;
          setUser(u);
          await syncUserSession(u);
          if (!cancelled) {
            setLoading(false);
          }
        });
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const idleApi = globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (initialHasSession) {
      // Returning signed-in user: restore session immediately with zero landing flicker
      void attachAuthListener();
    } else if (typeof idleApi.requestIdleCallback === 'function') {
      // First-time / signed-out visitor: keep main thread free for LCP, then hydrate auth silently
      idleHandle = idleApi.requestIdleCallback(() => {
        void attachAuthListener();
      }, { timeout: 2200 });
    } else {
      timerHandle = globalThis.setTimeout(() => {
        void attachAuthListener();
      }, 1200) as unknown as number;
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (idleHandle !== null && typeof idleApi.cancelIdleCallback === 'function') {
        idleApi.cancelIdleCallback(idleHandle);
      }
      if (timerHandle !== null) {
        globalThis.clearTimeout(timerHandle);
      }
    };
  }, [initialHasSession, syncUserSession]);

  const signInWithGoogle = async () => {
    const { authSdk, auth } = await loadFirebaseAuthModules();
    const provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await authSdk.signInWithPopup(auth, provider);
    if (cred.user) {
      setUser(cred.user);
      await syncUserSession(cred.user);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { authSdk, auth } = await loadFirebaseAuthModules();
    const cred = await authSdk.signInWithEmailAndPassword(auth, email, password);
    if (cred.user) {
      setUser(cred.user);
      await syncUserSession(cred.user);
    }
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    const { authSdk, auth } = await loadFirebaseAuthModules();
    const cred = await authSdk.createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim()) {
      await authSdk.updateProfile(cred.user, { displayName: displayName.trim() });
    }
    setUser(cred.user);
    writeHasSessionHint(true);
    if (!cred.user.emailVerified) {
      await authSdk.sendEmailVerification(cred.user);
      return { needsVerification: true };
    }
    await syncUserSession(cred.user);
    return { needsVerification: false };
  };

  const resetPassword = async (email: string) => {
    const { authSdk, auth } = await loadFirebaseAuthModules();
    await authSdk.sendPasswordResetEmail(auth, email);
  };

  const logout = async () => {
    const { authSdk, auth } = await loadFirebaseAuthModules();
    await authSdk.signOut(auth);
    writeHasSessionHint(false);
    setUser(null);
    setProfile(null);
    setIsSuperAdmin(false);
  };

  const refreshProfile = async (u = user) => {
    await syncUserSession(u, true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isSuperAdmin,
        loading,
        systemStatus,
        refreshSystemStatus,
        refreshProfile,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
