import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import type { RoleIntent } from './role-selection.logic';
import { getFirebaseAuth } from './firebase';
import { hydrateProfileFromSource, lockRoleInSource } from './profile-source';

type AuthSessionContextValue = {
  isHydrated: boolean;
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  currentUser: User | null;
  lockRole: (role: RoleIntent) => Promise<void>;
  clearSession: () => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lockedRole, setLockedRole] = useState<RoleIntent | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    try {
      const auth = getFirebaseAuth();
      unsubscribe = onAuthStateChanged(auth, (user) => {
        setCurrentUser(user);
        setIsAuthenticated(Boolean(user));
        if (!user) {
          setLockedRole(null);
          setIsHydrated(true);
          return;
        }

        void hydrateProfileFromSource(user)
          .then((profile) => {
            if (!cancelled) {
              setLockedRole(profile.lockedRole);
            }
          })
          .finally(() => {
            if (!cancelled) {
              setIsHydrated(true);
            }
          });
      });
    } catch {
      setIsAuthenticated(false);
      setIsHydrated(true);
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      isAuthenticated,
      lockedRole,
      currentUser,
      lockRole: async (role: RoleIntent) => {
        if (!currentUser) {
          throw new Error('No authenticated user found.');
        }

        const profile = await lockRoleInSource(currentUser, role);
        setLockedRole(profile.lockedRole);
      },
      clearSession: () => {
        setIsAuthenticated(false);
        setLockedRole(null);
      },
    }),
    [currentUser, isAuthenticated, isHydrated, lockedRole]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error('useAuthSession must be used within AuthSessionProvider');
  }

  return context;
}
