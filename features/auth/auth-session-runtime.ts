export type AuthSessionRuntime = {
  sessionMode: 'bearer' | 'cookie';
  credentials: RequestCredentials;
  persistsSession: boolean;
  refreshPath: string;
  sessionRequestFields: Record<string, string>;
  refreshRequestBody: (refreshToken: string | null) => Record<string, string>;
};

export const authSessionRuntime: AuthSessionRuntime = {
  sessionMode: 'bearer',
  credentials: 'same-origin',
  persistsSession: true,
  refreshPath: '/auth/session/refresh',
  sessionRequestFields: {},
  refreshRequestBody: (refreshToken) => {
    const body: Record<string, string> = { sessionMode: 'bearer' };
    if (refreshToken) body.refreshToken = refreshToken;
    return body;
  },
};
