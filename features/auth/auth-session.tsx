import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import type { RoleIntent } from './role-selection.logic';
import { getFirebaseAuth } from './firebase';
import { hydrateProfileFromSource, lockRoleInSource } from './profile-source';
import { resolveTermsConfigFromExpo } from './terms-config';
import { getAcceptedTermsVersion, setAcceptedTermsVersion as persistAcceptedTermsVersion } from './terms-storage';
import { needsTermsAcceptance } from './terms.logic';

type AuthSessionContextValue = {
  isHydrated: boolean;
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  currentUser: User | null;
  termsRequiredVersion: string;
  acceptedTermsVersion: string | null;
  termsUrl: string;
  needsTermsAcceptance: boolean;
  lockRole: (role: RoleIntent) => Promise<void>;
  acceptTerms: () => Promise<void>;
  clearSession: () => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const termsConfig = resolveTermsConfigFromExpo();
  const termsRequiredVersion = termsConfig.requiredVersion;
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
        setIsHydrated(false);
        setCurrentUser(user);
        setIsAuthenticated(Boolean(user));
        if (!user) {
          setLockedRole(null);
          setAcceptedTermsVersion(null);
          setRequiresTermsAcceptance(false);
          setIsHydrated(true);
          return;
        }

        void Promise.all([hydrateProfileFromSource(user), getAcceptedTermsVersion(user.uid)])
          .then(([profile, acceptedVersion]) => {
            if (!cancelled) {
              setLockedRole(profile.lockedRole);
              setAcceptedTermsVersion(acceptedVersion);
              setRequiresTermsAcceptance(
                needsTermsAcceptance({
                  requiredVersion: termsRequiredVersion,
                  acceptedVersion,
                })
              );
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
      needsTermsAcceptance: requiresTermsAcceptance,
      lockRole: async (role: RoleIntent) => {
        if (!currentUser) {
          throw new Error('No authenticated user found.');
        }

        const profile = await lockRoleInSource(role);
        setLockedRole(profile.lockedRole);
      },
      acceptTerms: async () => {
        if (!currentUser) {
          throw new Error('No authenticated user found.');
        }

        await persistAcceptedTermsVersion(currentUser.uid, termsConfig.requiredVersion);
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
