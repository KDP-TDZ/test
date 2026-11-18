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
import { auth } from '../firebase';
import { upsertUserProfile } from '../services/firestoreService';
import { authorizedFetch } from '../services/apiClient';
import type { SystemAiConfig, UserProfile } from '../core/types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  isSuperAdmin: boolean;
  loading: boolean;
  systemStatus: SystemAiConfig | null;
  refreshSystemStatus: () => Promise<void>;
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

  const refreshSystemStatus = async () => {
    try {
      const res = await authorizedFetch('/api/system/status');
      if (res.ok) {
        const data = (await res.json()) as SystemAiConfig;
        setSystemStatus(data);
      }
    } catch {
      // Ignore transient offline error
    }
  };

  const syncUserSession = async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setProfile(null);
      setIsSuperAdmin(false);
      await refreshSystemStatus();
      return;
    }

    try {
      const res = await authorizedFetch('/api/auth/session', { method: 'POST' });
      if (res.ok) {
        const session = (await res.json()) as {
          isSuperAdmin: boolean;
        };
        setIsSuperAdmin(Boolean(session.isSuperAdmin));
      }
    } catch {
      setIsSuperAdmin(false);
    }

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
    await syncUserSession(u);
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
