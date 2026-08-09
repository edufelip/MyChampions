import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';

import type { AuthSessionUser } from './auth-user';
import type { RoleIntent } from './role-selection.logic';
import {
  hydrateProfileFromSource,
  lockRoleInSource,
  ProfileSourceError,
  setAcceptedTermsVersionInSource,
} from './profile-source';
import { resolveProfileHydrationFailure } from './profile-hydration.logic';
import { resolveTermsConfigFromExpo } from './terms-config';
import { needsTermsAcceptance } from './terms.logic';
import {
  resolveE2EAuthSessionOverride,
  resolveE2EEmailPasswordCreateAccountOverride,
  resolveE2EEmailPasswordSignInOverride,
  resolveE2EPhaseConfigValue,
  resolveE2ESocialAuthOverride,
  type E2EAuthSessionOverride,
  type E2ESocialAuthProvider,
  persistE2ELockedRole,
  readPersistedE2ELockedRole,
} from './e2e-auth-session';
import {
  clearPersistedServerAuthSession,
  getCurrentServerProfile,
  getCurrentServerUser,
  restoreServerAuthSession,
  startLocalServerSocialSession,
  subscribeServerAuthSession,
} from './server-auth-source';

type AuthSessionContextValue = {
  isHydrated: boolean;
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  pendingRoleSelectionRole: RoleIntent | null;
  currentUser: AuthSessionUser | null;
  termsRequiredVersion: string;
  acceptedTermsVersion: string | null;
  termsUrl: string;
  privacyPolicyUrl: string;
  needsTermsAcceptance: boolean;
  lastProfileSyncedAtIso: string | null;
  createAccountWithE2EEmailPassword: (input: {
    email: string;
    name: string;
    password: string;
  }) => Promise<boolean>;
  canUseE2ESocialAuth: boolean;
  signInWithE2EEmailPassword: (email: string, password: string) => Promise<boolean>;
  signInWithE2ESocialAuth: (provider: E2ESocialAuthProvider) => Promise<boolean>;
  signInWithServerSocialAuth: (provider: E2ESocialAuthProvider) => Promise<boolean>;
  adoptCurrentServerSession: () => boolean;
  beginRoleSelectionNavigation: (role: RoleIntent) => void;
  completeRoleSelectionNavigation: () => void;
  lockRole: (role: RoleIntent) => Promise<void>;
  acceptTerms: () => Promise<void>;
  clearSession: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

function createE2EUser(session: E2EAuthSessionOverride): AuthSessionUser {
  const authProviderId = session.authProviderId ?? 'email_password';

  return {
    authProviderIds: [authProviderId],
    delete: async () => {},
    displayName: session.displayName,
    email: session.email,
    emailVerified: true,
    getAccessToken: async () => 'e2e-auth-session-token',
    isAnonymous: false,
    metadata: {
      creationTime: new Date(0).toISOString(),
      lastSignInTime: new Date(0).toISOString(),
    },
    phoneNumber: null,
    photoURL: null,
    reload: async () => {},
    tenantId: null,
    toJSON: () => ({
      displayName: session.displayName,
      email: session.email,
      uid: session.uid,
    }),
    uid: session.uid,
  } as AuthSessionUser;
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const termsConfig = resolveTermsConfigFromExpo();
  const termsRequiredVersion = termsConfig.requiredVersion;
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as {
    appVariant?: string;
    e2e?: {
      acceptedTermsVersion?: string;
      authSession?: string;
      createAccount?: string;
      emailPasswordSignIn?: string;
      socialAuth?: string;
    };
  };
  const appVariant = expoExtra.appVariant ?? process.env.APP_VARIANT;
  const e2eAcceptedTermsVersion = resolveE2EPhaseConfigValue(
    process.env.EXPO_PUBLIC_E2E_ACCEPTED_TERMS_VERSION,
    expoExtra.e2e?.acceptedTermsVersion,
  );
  const e2eAuthSession = resolveE2EPhaseConfigValue(
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    expoExtra.e2e?.authSession,
  );
  const e2eCreateAccount = resolveE2EPhaseConfigValue(
    process.env.EXPO_PUBLIC_E2E_CREATE_ACCOUNT,
    expoExtra.e2e?.createAccount,
  );
  const e2eEmailPasswordSignIn = resolveE2EPhaseConfigValue(
    process.env.EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN,
    expoExtra.e2e?.emailPasswordSignIn,
  );
  const e2eSocialAuth = resolveE2EPhaseConfigValue(
    process.env.EXPO_PUBLIC_E2E_SOCIAL_AUTH,
    expoExtra.e2e?.socialAuth,
  );
  const e2eSession = useMemo(
    () =>
      resolveE2EAuthSessionOverride({
        acceptedTermsVersion: e2eAcceptedTermsVersion,
        appVariant,
        enabledFlag: e2eAuthSession,
        isDev: __DEV__,
        requiredTermsVersion: termsRequiredVersion,
      }),
    [appVariant, e2eAcceptedTermsVersion, e2eAuthSession, termsRequiredVersion],
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lockedRole, setLockedRole] = useState<RoleIntent | null>(null);
  const [pendingRoleSelectionRole, setPendingRoleSelectionRole] = useState<RoleIntent | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthSessionUser | null>(null);
  const [acceptedTermsVersion, setAcceptedTermsVersion] = useState<string | null>(null);
  const [requiresTermsAcceptance, setRequiresTermsAcceptance] = useState(false);
  const [lastProfileSyncedAtIso, setLastProfileSyncedAtIso] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (e2eSession) {
      void (async () => {
        const persistedRole = await readPersistedE2ELockedRole();
        if (cancelled) return;
        setCurrentUser(createE2EUser(e2eSession));
        setIsAuthenticated(true);
        setLockedRole(persistedRole ?? e2eSession.lockedRole);
        setAcceptedTermsVersion(e2eSession.acceptedTermsVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsRequiredVersion,
            acceptedVersion: e2eSession.acceptedTermsVersion,
          }),
        );
        setIsHydrated(true);
      })();
      return () => {
        cancelled = true;
      };
    }

    async function hydrateServerUser(
      serverUser: ReturnType<typeof getCurrentServerUser>,
    ): Promise<void> {
      if (!serverUser) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setLockedRole(null);
        setPendingRoleSelectionRole(null);
        setAcceptedTermsVersion(null);
        setRequiresTermsAcceptance(false);
        setLastProfileSyncedAtIso(null);
        setIsHydrated(true);
        return;
      }

      setCurrentUser(serverUser as AuthSessionUser);
      setIsAuthenticated(true);
      setIsHydrated(false);
      const hydrationAuthUid = serverUser.uid;

      try {
        const profile = await hydrateProfileFromSource(serverUser);
        if (!cancelled && getCurrentServerUser()?.uid === hydrationAuthUid) {
          setLockedRole(profile.lockedRole);
          setAcceptedTermsVersion(profile.acceptedTermsVersion);
          setLastProfileSyncedAtIso(new Date().toISOString());
          setRequiresTermsAcceptance(
            needsTermsAcceptance({
              requiredVersion: termsRequiredVersion,
              acceptedVersion: profile.acceptedTermsVersion,
            }),
          );
        }
      } catch (error) {
        const activeAuthUid = getCurrentServerUser()?.uid ?? null;
        if (cancelled || activeAuthUid !== hydrationAuthUid) {
          return;
        }

        const resolution = resolveProfileHydrationFailure({
          hydrationAuthUid,
          activeAuthUid,
          errorCode: error instanceof ProfileSourceError ? error.code : null,
          cachedProfile: getCurrentServerProfile(),
          requiredTermsVersion: termsRequiredVersion,
        });
        setLockedRole(resolution.lockedRole);
        setAcceptedTermsVersion(resolution.acceptedTermsVersion);
        setLastProfileSyncedAtIso(resolution.lastProfileSyncedAtIso);
        setRequiresTermsAcceptance(resolution.requiresTermsAcceptance);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void (async () => {
      const serverUser = getCurrentServerUser();
      if (serverUser) {
        await hydrateServerUser(serverUser);
        return;
      }

      const restoredSession = await restoreServerAuthSession();
      if (cancelled) return;
      await hydrateServerUser(restoredSession?.user ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [termsRequiredVersion]);

  useEffect(() => {
    if (e2eSession) return;

    return subscribeServerAuthSession((session) => {
      if (!session) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setLockedRole(null);
        setPendingRoleSelectionRole(null);
        setAcceptedTermsVersion(null);
        setLastProfileSyncedAtIso(null);
        setRequiresTermsAcceptance(false);
        return;
      }

      setCurrentUser(session.user as AuthSessionUser);
      setIsAuthenticated(true);
      setLockedRole(session.profile.lockedRole);
      setAcceptedTermsVersion(session.profile.acceptedTermsVersion);
      setLastProfileSyncedAtIso(new Date().toISOString());
      setRequiresTermsAcceptance(
        needsTermsAcceptance({
          requiredVersion: termsRequiredVersion,
          acceptedVersion: session.profile.acceptedTermsVersion,
        }),
      );
    });
  }, [e2eSession, termsRequiredVersion]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      isAuthenticated,
      lockedRole,
      pendingRoleSelectionRole,
      currentUser,
      termsRequiredVersion: termsConfig.requiredVersion,
      acceptedTermsVersion,
      termsUrl: termsConfig.termsUrl,
      privacyPolicyUrl: termsConfig.privacyPolicyUrl,
      needsTermsAcceptance: requiresTermsAcceptance,
      lastProfileSyncedAtIso,
      createAccountWithE2EEmailPassword: async ({ email, name, password }) => {
        const session = resolveE2EEmailPasswordCreateAccountOverride({
          acceptedTermsVersion: e2eAcceptedTermsVersion,
          appVariant,
          email,
          enabledFlag: e2eCreateAccount,
          isDev: __DEV__,
          name,
          password,
          requiredTermsVersion: termsConfig.requiredVersion,
        });

        if (!session) {
          return false;
        }

        setCurrentUser(createE2EUser(session));
        setIsAuthenticated(true);
        setLockedRole(session.lockedRole);
        setAcceptedTermsVersion(session.acceptedTermsVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsConfig.requiredVersion,
            acceptedVersion: session.acceptedTermsVersion,
          }),
        );
        setIsHydrated(true);
        return true;
      },
      canUseE2ESocialAuth: Boolean(
        resolveE2ESocialAuthOverride({
          acceptedTermsVersion: e2eAcceptedTermsVersion,
          appVariant,
          enabledFlag: e2eSocialAuth,
          isDev: __DEV__,
          provider: 'google',
          requiredTermsVersion: termsConfig.requiredVersion,
        }),
      ),
      signInWithE2EEmailPassword: async (email: string, password: string) => {
        const session = resolveE2EEmailPasswordSignInOverride({
          acceptedTermsVersion: e2eAcceptedTermsVersion,
          appVariant,
          email,
          enabledFlag: e2eEmailPasswordSignIn,
          isDev: __DEV__,
          password,
          requiredTermsVersion: termsConfig.requiredVersion,
        });

        if (!session) {
          return false;
        }

        setCurrentUser(createE2EUser(session));
        setIsAuthenticated(true);
        setLockedRole(session.lockedRole);
        setAcceptedTermsVersion(session.acceptedTermsVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsConfig.requiredVersion,
            acceptedVersion: session.acceptedTermsVersion,
          }),
        );
        setIsHydrated(true);
        return true;
      },
      signInWithE2ESocialAuth: async (provider: E2ESocialAuthProvider) => {
        const session = resolveE2ESocialAuthOverride({
          acceptedTermsVersion: e2eAcceptedTermsVersion,
          appVariant,
          enabledFlag: e2eSocialAuth,
          isDev: __DEV__,
          provider,
          requiredTermsVersion: termsConfig.requiredVersion,
        });

        if (!session) {
          return false;
        }

        setCurrentUser(createE2EUser(session));
        setIsAuthenticated(true);
        setLockedRole(session.lockedRole);
        setAcceptedTermsVersion(session.acceptedTermsVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsConfig.requiredVersion,
            acceptedVersion: session.acceptedTermsVersion,
          }),
        );
        setIsHydrated(true);
        return true;
      },
      signInWithServerSocialAuth: async (provider: E2ESocialAuthProvider) => {
        const session = await startLocalServerSocialSession(provider);
        if (!session) return false;

        setCurrentUser(session.user as AuthSessionUser);
        setIsAuthenticated(true);
        setLockedRole(session.profile.lockedRole);
        setAcceptedTermsVersion(session.profile.acceptedTermsVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsConfig.requiredVersion,
            acceptedVersion: session.profile.acceptedTermsVersion,
          }),
        );
        setIsHydrated(true);
        return true;
      },
      adoptCurrentServerSession: () => {
        const serverUser = getCurrentServerUser();
        const serverProfile = getCurrentServerProfile();
        if (!serverUser || !serverProfile) return false;
        setCurrentUser(serverUser as AuthSessionUser);
        setIsAuthenticated(true);
        setLockedRole(serverProfile.lockedRole);
        setAcceptedTermsVersion(serverProfile.acceptedTermsVersion);
        setRequiresTermsAcceptance(
          needsTermsAcceptance({
            requiredVersion: termsConfig.requiredVersion,
            acceptedVersion: serverProfile.acceptedTermsVersion,
          }),
        );
        setLastProfileSyncedAtIso(new Date().toISOString());
        setIsHydrated(true);
        return true;
      },
      beginRoleSelectionNavigation: (role: RoleIntent) => {
        setPendingRoleSelectionRole(role);
      },
      completeRoleSelectionNavigation: () => {
        setPendingRoleSelectionRole(null);
      },
      lockRole: async (role: RoleIntent) => {
        if (!currentUser) {
          throw new Error('No authenticated user found.');
        }

        if (e2eSession) {
          await persistE2ELockedRole(role);
          setLockedRole(role);
          setLastProfileSyncedAtIso(new Date().toISOString());
          return;
        }

        const profile = await lockRoleInSource(role);
        setLockedRole(profile.lockedRole);
        setLastProfileSyncedAtIso(new Date().toISOString());
      },
      acceptTerms: async () => {
        if (!currentUser) {
          throw new Error('No authenticated user found.');
        }

        if (e2eSession) {
          setAcceptedTermsVersion(termsConfig.requiredVersion);
          setLastProfileSyncedAtIso(new Date().toISOString());
          setRequiresTermsAcceptance(false);
          return;
        }

        await setAcceptedTermsVersionInSource(termsConfig.requiredVersion);
        setAcceptedTermsVersion(termsConfig.requiredVersion);
        setLastProfileSyncedAtIso(new Date().toISOString());
        setRequiresTermsAcceptance(false);
      },
      clearSession: async () => {
        if (e2eSession) await persistE2ELockedRole(null);
        await clearPersistedServerAuthSession();
        setIsAuthenticated(false);
        setCurrentUser(null);
        setLockedRole(null);
        setPendingRoleSelectionRole(null);
        setAcceptedTermsVersion(null);
        setLastProfileSyncedAtIso(null);
        setRequiresTermsAcceptance(false);
      },
    }),
    [
      acceptedTermsVersion,
      appVariant,
      currentUser,
      e2eSession,
      e2eAcceptedTermsVersion,
      e2eCreateAccount,
      e2eEmailPasswordSignIn,
      e2eSocialAuth,
      isAuthenticated,
      isHydrated,
      lockedRole,
      lastProfileSyncedAtIso,
      pendingRoleSelectionRole,
      requiresTermsAcceptance,
      termsConfig.requiredVersion,
      termsConfig.termsUrl,
      termsConfig.privacyPolicyUrl,
    ],
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
