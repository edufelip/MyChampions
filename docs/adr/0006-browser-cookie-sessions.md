# ADR 0006: Browser Cookie Sessions

## Status

Accepted — 2026-07-15

## Context

Persisting refresh tokens in browser storage would expose long-lived credentials to script access. Native clients already rely on response-body bearer/refresh sessions and must remain backward compatible.

## Decision

Browser auth requests explicitly select `sessionMode: cookie`. The server returns the access token in the response for in-memory use and writes only the rotating refresh token to an HttpOnly, SameSite=Lax cookie scoped to `/auth/session`. Refresh and sign-out are production-capable endpoints. Rotation consumes the prior session atomically; replay is rejected; sign-out revokes the current session and expires cookies.

Credentialed CORS uses exact `WEB_ALLOWED_ORIGINS`. Development has two exact localhost defaults; production has none unless configured. Requests and preflights with an unapproved Origin receive 403. Requests without Origin, including native clients, remain valid.

The client assigns a revision to each installed or cleared session. A refresh
may commit its response or clear storage only while that revision and session
are still current. Signing out or installing another account invalidates older
in-flight refresh work, preventing a stale response from restoring a cleared
session or overwriting the replacement account.

## Consequences

- Browser reload restoration requires the server and an allowed origin.
- Access tokens remain short-lived and in memory; no auth session is serialized to localStorage, sessionStorage, or AsyncStorage on web.
- Refresh calls may still finish after sign-out or account replacement, but
  their stale results are discarded.
- Native bearer response shapes remain unchanged.
- Production origin activation and cookie delivery over TLS are deployment work and remain unapproved here.
