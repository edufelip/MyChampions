import { authSessionRuntime } from './auth-session-runtime';
import { CreateAccountFailure, type CreateAccountRequest } from './create-account.logic';
import {
  persistServerAuthSessionFromPayload,
  type ServerAuthStorage,
  waitForPendingServerAuthSignOut,
} from './server-auth-source';
import { SignInFailure, type SignInRequest } from './sign-in.logic';

export type EmailAuthSourceDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getServerBaseUrl: () => string | undefined;
  storage?: ServerAuthStorage;
};

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    expoExtra = (Constants.default ?? Constants).expoConfig?.extra;
  } catch {
    expoExtra = undefined;
  }

  const extra = (expoExtra ?? {}) as {
    server?: {
      baseUrl?: string;
    };
  };
  return extra.server?.baseUrl?.trim() || process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim();
}

function makeDeps(): EmailAuthSourceDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getServerBaseUrl: resolveServerBaseUrl,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeServerErrorCode(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }
  const maybeError = payload as { error?: { code?: unknown }; code?: unknown };
  if (typeof maybeError.error?.code === 'string') {
    return maybeError.error.code;
  }
  if (typeof maybeError.code === 'string') {
    return maybeError.code;
  }
  return '';
}

function signInReasonForResponse(status: number, payload: unknown) {
  const code = normalizeServerErrorCode(payload);
  if (code === 'configuration') return 'configuration';
  if (code === 'invalid_credentials' || status === 401) return 'invalid_credentials';
  if (code === 'provider_conflict' || status === 409) return 'provider_conflict';
  return status >= 500 ? 'network' : 'unknown';
}

function createAccountReasonForResponse(status: number, payload: unknown) {
  const code = normalizeServerErrorCode(payload);
  if (code === 'configuration') return 'configuration';
  if (code === 'provider_conflict' || status === 409) return 'provider_conflict';
  return status >= 500 ? 'network' : 'unknown';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function signInWithEmailPasswordFromSource(
  input: SignInRequest,
  deps: EmailAuthSourceDeps = makeDeps(),
): Promise<void> {
  await waitForPendingServerAuthSignOut();
  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch {
    throw new SignInFailure('configuration');
  }
  if (!baseUrl) {
    throw new SignInFailure('configuration');
  }

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/auth/email/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: authSessionRuntime.credentials,
      body: JSON.stringify({
        email: normalizeEmail(input.email),
        password: input.password,
        ...authSessionRuntime.sessionRequestFields,
      }),
    });
  } catch {
    throw new SignInFailure('network');
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new SignInFailure(signInReasonForResponse(response.status, payload));
  }

  const session = await persistServerAuthSessionFromPayload(payload, deps);
  if (!session) {
    throw new SignInFailure('unknown');
  }
}

export async function createAccountWithEmailPasswordFromSource(
  input: CreateAccountRequest,
  deps: EmailAuthSourceDeps = makeDeps(),
): Promise<void> {
  await waitForPendingServerAuthSignOut();
  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch {
    throw new CreateAccountFailure('configuration');
  }
  if (!baseUrl) {
    throw new CreateAccountFailure('configuration');
  }

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/auth/email/create-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: authSessionRuntime.credentials,
      body: JSON.stringify({
        displayName: input.name.trim(),
        email: normalizeEmail(input.email),
        password: input.password,
        ...authSessionRuntime.sessionRequestFields,
      }),
    });
  } catch {
    throw new CreateAccountFailure('network');
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new CreateAccountFailure(createAccountReasonForResponse(response.status, payload));
  }

  const session = await persistServerAuthSessionFromPayload(payload, deps);
  if (session) {
    return;
  }

  if (response.status !== 202) {
    throw new CreateAccountFailure('unknown');
  }

  // The server intentionally returns a session-less 202 for both successful and
  // duplicate account creation so the create endpoint cannot be used to enumerate
  // registered emails. Complete the authenticated flow through the existing email
  // sign-in route instead of treating that privacy-preserving acknowledgement as
  // an invalid session.
  try {
    await signInWithEmailPasswordFromSource(
      { email: input.email, password: input.password },
      deps,
    );
  } catch {
    throw new CreateAccountFailure('requires_sign_in');
  }
}
