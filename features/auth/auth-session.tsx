import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import type { RoleIntent } from './role-selection.logic';
import { getFirebaseAuth } from './firebase';
import {
  hydrateProfileFromSource,
  lockRoleInSource,
  setAcceptedTermsVersionInSource,
} from './profile-source';
import { resolveTermsConfigFromExpo } from './terms-config';
import { needsTermsAcceptance } from './terms.logic';

type AuthSessionContextValue = {
  isHydrated: boolean;
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  currentUser: User | null;
  termsRequiredVersion: string;
  acceptedTermsVersion: string | null;
  termsUrl: string;
  privacyPolicyUrl: string;
  needsTermsAcceptance: boolean;
  lockRole: (role: RoleIntent) => Promise<void>;
  acceptTerms: () => Promise<void>;
  clearSession: () => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const termsConfig = resolveTermsConfigFromExpo();
  const termsRequiredVersion = termsConfig.requiredVersion;
  const lastAuthUidRef = useRef<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lockedRole, setLockedRole] = useState<RoleIntent | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [acceptedTermsVersion, setAcceptedTermsVersion] = useState<string | null>(null);
  const [requiresTermsAcceptance, setRequiresTermsAcceptance] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    try {
      const auth = getFirebaseAuth();
      unsubscribe = onAuthStateChanged(auth, (user) => {
        const nextUid = user?.uid ?? null;
        const authUidChanged = lastAuthUidRef.current !== nextUid;
        lastAuthUidRef.current = nextUid;

        setIsHydrated(false);
        setCurrentUser(user);
        setIsAuthenticated(Boolean(user));

        // Always reset role/terms state before profile hydration so account switching
        // never reuses stale role-lock information from a previous session.
        if (authUidChanged) {
          setLockedRole(null);
          setAcceptedTermsVersion(null);
          setRequiresTermsAcceptance(false);
        }

        if (__DEV__) {
          console.info('[auth][session] auth state changed', {
            uid: nextUid,
            authUidChanged,
            isAuthenticated: Boolean(user),
          });
        }

        if (!user) {
          setLockedRole(null);
          setAcceptedTermsVersion(null);
          setRequiresTermsAcceptance(false);
          setIsHydrated(true);
          return;
        }

        void hydrateProfileFromSource(user)
          .then((profile) => {
            if (!cancelled) {
              setLockedRole(profile.lockedRole);
              setAcceptedTermsVersion(profile.acceptedTermsVersion);
              setRequiresTermsAcceptance(
                needsTermsAcceptance({
                  requiredVersion: termsRequiredVersion,
                  acceptedVersion: profile.acceptedTermsVersion,
                })
              );
              if (__DEV__) {
                console.info('[auth][session] profile hydrated', {
                  uid: user.uid,
                  lockedRole: profile.lockedRole,
                  acceptedTermsVersion: profile.acceptedTermsVersion,
                });
              }
            }
          })
          .catch(() => {
            if (!cancelled) {
              setLockedRole(null);
              setAcceptedTermsVersion(null);
              setRequiresTermsAcceptance(true);
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
  }, [termsRequiredVersion]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      isAuthenticated,
      lockedRole,
      currentUser,
      termsRequiredVersion: termsConfig.requiredVersion,
      acceptedTermsVersion,
      termsUrl: termsConfig.termsUrl,
      privacyPolicyUrl: termsConfig.privacyPolicyUrl,
      needsTermsAcceptance: requiresTermsAcceptance,
      lockRole: async (role: RoleIntent) => {
        const activeUser = currentUser ?? getFirebaseAuth().currentUser;
        if (!activeUser) {
          throw new Error('No authenticated user found.');
        }

        const profile = await lockRoleInSource(role);
        setLockedRole(profile.lockedRole);
      },
      acceptTerms: async () => {
        const activeUser = currentUser ?? getFirebaseAuth().currentUser;
        if (!activeUser) {
          throw new Error('No authenticated user found.');
        }

        await setAcceptedTermsVersionInSource(termsConfig.requiredVersion);
        setAcceptedTermsVersion(termsConfig.requiredVersion);
        setRequiresTermsAcceptance(false);
      },
      clearSession: () => {
        setIsAuthenticated(false);
        setLockedRole(null);
        setAcceptedTermsVersion(null);
        setRequiresTermsAcceptance(false);
      },
    }),
    [
      acceptedTermsVersion,
      currentUser,
      isAuthenticated,
      isHydrated,
      lockedRole,
      requiresTermsAcceptance,
      termsConfig.requiredVersion,
      termsConfig.termsUrl,
      termsConfig.privacyPolicyUrl,
    ]
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
