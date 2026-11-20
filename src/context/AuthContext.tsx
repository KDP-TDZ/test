import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { upsertUserProfile } from '../services/firestoreService';
import { authorizedFetch, resolveApiUrl } from '../services/apiClient';
import type { SystemAiConfig, UserProfile } from '../core/types';

const DEFAULT_SUPER_ADMIN_EMAILS = new Set([
  'tuankhang2011pm@gmail.com',
  'tuankhangnek@gmail.com',
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemAiConfig | null>(null);

  const statusFetchInFlight = React.useRef<Promise<void> | null>(null);
  const lastStatusFetchAt = React.useRef<number>(0);

  const refreshSystemStatus = async (force = false) => {
    const now = Date.now();
    if (!force && lastStatusFetchAt.current > 0 && now - lastStatusFetchAt.current < 30_000) {
      return;
    }
    if (statusFetchInFlight.current) {
      return statusFetchInFlight.current;
    }
    const run = (async () => {
      try {
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
  };

  const syncUserSession = async (firebaseUser: User | null, forceTokenRefresh = false) => {
    if (!firebaseUser) {
      setProfile(null);
      setIsSuperAdmin(false);
      await refreshSystemStatus();
      return;
    }

    let resolvedAdmin = false;
    const lowerEmail = (firebaseUser.email || '').trim().toLowerCase();
    if (firebaseUser.emailVerified && DEFAULT_SUPER_ADMIN_EMAILS.has(lowerEmail)) {
      resolvedAdmin = true;
    }

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
    await refreshSystemStatus();
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      await syncUserSession(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    if (!cred.user.emailVerified) {
      await sendEmailVerification(cred.user);
      return { needsVerification: true };
    }
    return { needsVerification: false };
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const logout = async () => {
    await signOut(auth);
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
