export type AuthProviderId = 'email_password' | 'google' | 'apple' | (string & {});

export type AuthUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  getAccessToken: () => Promise<string>;
};

export type AuthSessionUser = Omit<AuthUser, 'email' | 'displayName'> & {
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  metadata?: {
    creationTime?: string;
    lastSignInTime?: string;
  };
  phoneNumber?: string | null;
  photoURL?: string | null;
  authProviderIds: AuthProviderId[];
  reload: () => Promise<void>;
  tenantId?: string | null;
  delete: () => Promise<void>;
  toJSON: () => unknown;
};
