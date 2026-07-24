import type { AuthSessionRuntime } from './auth-session-runtime';

export const authSessionRuntime: AuthSessionRuntime = {
  sessionMode: 'cookie',
  credentials: 'include',
  persistsSession: false,
  refreshPath: '/auth/session/refresh',
  sessionRequestFields: { sessionMode: 'cookie' },
  refreshRequestBody: () => ({ sessionMode: 'cookie' }),
};
