# Web Platform Support Spec

## Status and scope

Implemented as a code-structure phase on 2026-07-15. MyChampions supports Android, iOS, and responsive browsers from one Expo Router application. Website deployment, DNS, nginx, TLS/CSP, provider-console mutations, production origins, secrets, and browser billing remain deferred and require a separate approved task.

## Runtime contract

- Expo web output is `single`, producing one SPA entry that can later be served with a history fallback.
- `yarn web:dev` starts the browser development runtime.
- `yarn web:export` creates `dist/web`; it does not deploy or publish.
- `yarn test:e2e:web` runs the full Playwright matrix in Chromium, Firefox, and WebKit. Focused smoke, functional, accessibility, and evidence commands are documented in `docs/test-cases/web-playwright-batches-and-manual-validation.md`.
- Playwright runs write timestamped, gitignored screenshot/report packages under `.artifacts/web-e2e`; screenshots are review evidence, not tracked visual baselines.
- Pull requests into `main`, `release/**`, and `hotfix/**` use
  `.github/workflows/pr-selective-tests.yml` only as a GitHub-hosted preflight.
  After it completes,
  `.github/workflows/trusted-selective-tests.yml` is loaded from protected
  default branch `main`, authorizes the triggering run against the live PR, and
  dispatches the selected web lane. That lane validates the export and runs the
  affected registered Playwright suites; it checks out the coordinated
  `mychampions-api` source only when a selected suite needs the server-backed
  configuration. D-195 promotion requires resolving that source once to a full
  commit SHA, checking out the detached SHA, and recording it with the mobile
  exact head. That configuration installs locked Bun dependencies, runs an
  in-memory auth server on `127.0.0.1:3401`, runs Expo on
  `127.0.0.1:8082`, and lets Playwright own and terminate both processes. It
  uses no provider or production secret.
  Release/hotfix PRs force the complete matrix through the same
  protected-`main` trusted workflow; that workflow is never loaded or triggered
  directly from the target branch.
- `.github/workflows/web-pr.yml` is a legacy manual-only validation path.
  Successful selective runs upload no web export, screenshots, reports, or
  GitHub Actions cache. Only bounded web failure diagnostics may be uploaded,
  with one-day retention. The combined WSL web/Android runner is registered and
  serialized by the shared physical-host lock. D-195's GitHub-hosted-only PR
  preflight, protected-`main` `workflow_run` provenance, GitHub-hosted
  triggering-run/live-PR authorization, isolated token permissions,
  action-policy gates, and remote exact-head proof remain required before
  authoritative promotion; the resource lock is not an authorization boundary.
  Static repository runner labels remain targetable by any approved workflow,
  so the public personal-repository operating contract keeps the owner as sole
  collaborator, requires approval for all external workflows, and never approves
  fork or untrusted workflow changes while persistent runners are enabled.

## Platform adapters

Platform behavior is selected by Metro's `.web` module resolution rather than screen-level `Platform.OS` billing/auth decisions:

- `auth-session-runtime`: bearer + persisted refresh session on native; in-memory access token + credentialed HttpOnly refresh cookie on web.
- Native proactive refresh distinguishes definitive authentication rejection from retryable transport/provider failure. Only rejection clears the persisted session; retryable failures preserve the refresh credential and any still-valid access token so cached offline/read-only state remains available and a later request can retry.
- Google and Apple social sources: native SDKs on mobile; Google Identity Services and Sign in with Apple JS on web. Both preserve the server ID-token exchange contract.
- `photo-picker-adapter`: native image picker/manipulator versus browser file/camera input and canvas JPEG compression.
- `qr-scanner-adapter`: native Expo camera permission versus browser media-device permission. Manual invite-code entry remains available when camera access is denied or unavailable.
- `share-adapter`: native Share/Linking versus Web Share, clipboard fallback, and safe external tabs.
- `haptics-adapter`: native feedback versus browser no-op.
- `subscription-runtime`: native purchase capability versus browser mobile handoff/unavailable capability.
- Every shared server-backed source uses the late-bound `defaultAppFetch` adapter (or an equivalent explicit receiver wrapper) so browser requests retain the global fetch receiver, including Firefox. Injected fetch dependencies remain standalone functions for deterministic tests. A production-source contract scan rejects raw `fetchFn: fetch`, `?? fetch`, and dependency-object method invocation in the migrated connection, workout, water, custom-meal, image-upload, meal-analysis, food-search, professional, student-tracking, and exercise boundaries.

## Browser authentication

- Email/password, Google, and Apple sign-in requests send `sessionMode: cookie` on web.
- The response exposes a short-lived access token for app memory and sets an HttpOnly rotating refresh cookie. Browser storage never receives refresh tokens or serialized auth sessions.
- Reload restoration calls `POST /auth/session/refresh` with `credentials: include` and rotates the refresh cookie.
- Sign-out calls `POST /auth/session/sign-out`, revokes the current refresh session, and clears both legacy access and browser refresh cookies. Local identity clears immediately, while every server-backed email/password, Google, Apple, or local-development authentication path waits on the still-running single-flight sign-out barrier before it may establish a replacement cookie session. A failed request still releases the barrier so later authentication cannot deadlock.
- Native requests omit cookie mode and retain response-body refresh tokens for backward compatibility.
- The server accepts credentialed browser requests only from exact `WEB_ALLOWED_ORIGINS` values. Development defaults are `http://localhost:8081` and `http://127.0.0.1:8081`; production defaults to no allowed browser origins.
- Google Identity Services dismissed prompt moments settle the active browser sign-in attempt as cancellation. Skipped or undisplayable moments fail closed through the configured fallback/error path because they may indicate that Google could not issue a credential. No terminal prompt moment may leave the sign-in request pending.

## Responsive and accessibility behavior

- `<768px`: existing single-column flow with bottom tabs.
- `768-1023px`: icon navigation rail and content constrained by `DsScreen`.
- `>=1024px`: labeled 220px sidebar with centered content and wider surfaces.
- `DsScreen` supports `form` (600px), `content` (680px on tablet / 880px on desktop), `wide` (680px on tablet / 1040px on desktop), and uncapped `full` width modes.
- Browser focus rings use `:focus-visible`; pointer hover is additive and reduced-motion preferences are respected.
- Shared dialogs close on Escape, trap Tab/Shift+Tab, focus their first control, and restore focus to the opener.
- Error/status surfaces continue using React Native live regions and accessibility roles.

## Subscription behavior

- Browser code never initializes or consults RevenueCat preview APIs.
- Web reads authoritative MyChampions server entitlement snapshots. RevenueCat
  SDK or signed webhook observations are materialized into the server's
  Postgres snapshot rows; the browser does not read a Firebase persistence or
  billing runtime. This follows the active baseline in
  `docs/discovery/backend-provider-migration-v1.md`.
- AI access and professional cap gates require an explicit active entitlement where applicable; unknown status fails closed.
- Browser purchase and restore controls are replaced by a localized mobile handoff from `EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL`. Missing handoff configuration yields `unavailable`; it never falls back to browser purchase.

## Future deployment checklist (not activated)

The deployment task should configure the intended `https://app.mychampions.eduwaldo.com` origin, SPA history fallback, TLS, CSP, provider origins/redirects, cache policy, production `WEB_ALLOWED_ORIGINS`, and monitoring. None of those mutations are part of this implementation.

The complete browser follow-up register is `docs/discovery/web-pending-items-and-future-improvements.md`.
