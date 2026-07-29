# Web pending items and future improvements

## Scope

This is the complete follow-up register for the web-support work introduced on 2026-07-15. It covers browser readiness only. The broader app wiring backlog remains in `docs/discovery/pending-wiring-checklist-v1.md`.

Code structure, fixture-based Playwright coverage, responsive navigation,
platform adapters, cookie-session contracts, and the feature-selective workflow
contract are implemented. The legacy `web-pr.yml` workflow is manual-only.
The combined WSL web/Android runner is registered with its shared-host lock.
The promotion pull request must still supply a green remote exact-head matrix.
Nothing in this document authorizes deployment, provider-console changes,
production origins, browser billing, secrets, or infrastructure mutation.

## Status legend

- `Required before release`: release-blocking evidence or configuration.
- `Quality follow-up`: valuable hardening that can be scheduled independently.
- `Explicitly deferred`: outside the code-structure phase and requires a separately approved task.

## Required before release

| Area | Pending work | Completion evidence | Approval boundary |
|---|---|---|---|
| Browser auth | Extend the implemented local real-server create/sign-in/refresh/logout lane with invalid credentials, expired-cookie timing, network interruption, and a production-like HTTPS environment. | Existing three-engine Playwright server-auth flow plus the additional failure matrix, HTTPS cookie proof, and cleanup record. | Test accounts and non-production HTTPS environment approved. |
| Google web auth | Register the final web origin/client configuration and validate success, cancellation, expired token, blocked popup, and missing-config behavior with Google Identity Services. | Provider-neutral automated fixture tests plus an approved provider-live smoke report. | Provider-console mutation and credentials require approval. |
| Apple web auth | Register the Services ID, redirect URI, and origin; validate success, cancellation, nonce handling, callback errors, and missing configuration. | Automated fixtures plus approved provider-live smoke evidence. | Apple console/profile work requires approval. |
| Production browser origin | Set the exact production `WEB_ALLOWED_ORIGINS` value only when the site origin is approved. Confirm credentialed preflight, rejected foreign origins, and cookie behavior. | Production-like environment contract test and security review. | Production config mutation requires approval. |
| Student workflows | Test plans, nutrition/training tracking, hydration, custom meals, shared recipes, professional connections, support, settings, localization, and logout with deterministic server data. | Scenario-level Playwright assertions, screenshots for visual checkpoints, and cleanup evidence. | Non-production seed data approved. |
| Professional workflows | Test onboarding/specialty, dashboard, students, pending requests, plan authoring, tracking review, support, settings, entitlement gates, and logout with deterministic server data. | Scenario-level Playwright assertions, screenshots, and cleanup evidence. | Non-production seed data approved. |
| Browser media | Validate real file selection, camera permission states, QR scan, image compression, upload progress, retry, and AI meal analysis against safe fixtures. | Browser/device matrix report with sample files, camera notes, network assertions, and quota-safe cleanup. | Provider-live AI or camera/device use may need approval. |
| Subscription gates | Verify server entitlement snapshots for active, inactive, unknown, stale, and network-error states. Add an authoritative expiry-risk/renewal-date signal before enabling pre-lapse warnings; never infer billing expiry from student count. Confirm web never exposes purchase/restore and handoff works when configured. | Playwright plus server contract evidence for every state, expiry-signal contract tests, and a green bundle scan. | No browser purchase. Handoff target/provider configuration requires approval. |
| Accessibility | Complete keyboard-only journeys, zoom/reflow, reduced motion, high contrast, screen-reader smoke, dialog announcements, and error announcements. | Manual assistive-technology checklist plus automated focus/overflow assertions. | Human review required for manual evidence acceptance. |
| Security headers | Define and validate TLS, CSP, frame policy, referrer policy, permissions policy, cache headers, and SPA fallback without weakening auth or provider scripts. | Header scan and browser smoke in a production-like environment. | Deployment/infrastructure approval required. |
| Privacy/compliance | Review browser cookies, analytics, uploads, local caches, external links, consent copy, retention, and account deletion behavior. | Updated compliance docs and signed review record. | Human legal/product review. |
| Observability | Add browser error/performance monitoring, release correlation, source-map handling, and alert ownership without exposing secrets or health data. | Staging event capture and redaction review. | Provider selection/configuration requires approval. |
| Performance | Establish browser bundle, startup, interaction, and image-processing budgets; investigate the current single-bundle size before release. | Repeatable bundle report and browser performance trace at all three breakpoints. | No deployment required for local profiling. |
| Session resilience | Avoid consuming a rotating refresh session before downstream profile/token response assembly succeeds, or add a recovery design for transient post-rotation failures. | Fault-injection tests around profile/token failures during refresh, with replay protection preserved. | Auth/security behavior changes require review. |

## Quality follow-ups

| Area | Improvement | Suggested evidence |
|---|---|---|
| E2E data | Expand the deterministic in-memory auth server used by `test:e2e:web:server` to student/professional domain repositories and scenario seeds. | Idempotent parallel-safe seed/reset behavior for plans, connections, tracking, media, and entitlements. |
| Test batches | Expand the current smoke, functional, accessibility, and evidence batches using the flow matrix in `docs/test-cases/web-playwright-batches-and-manual-validation.md`. | Per-batch pass counts and artifact manifest. |
| Visual review | Capture dark mode, all supported locales, long copy, loading, empty, error, offline, read-only, and entitlement states. | Reviewer-approved screenshot checklist. |
| Visual regression | Consider approved Playwright snapshot baselines after the responsive design stabilizes. Do not create or refresh tracked baselines without explicit approval. | Baseline owner, review record, and documented refresh policy. |
| Browser/device matrix | Add real mobile Safari and Android Chrome smoke in addition to desktop engine emulation. | Device/OS/browser versions and screenshots. |
| Offline behavior | Use browser context network controls and a server-backed cache fixture to verify read continuity and write locks. | Online-to-offline transition assertions and recovery trace. |
| Localization | Run every core flow in `en-US`, `pt-BR`, and `es-ES`, including narrow widths and long strings. | Locale matrix with overflow assertions and screenshots. |
| Native regression | Run the existing iOS/Android Detox smoke suites after shared web changes when devices are available. | Device, build variant, Detox report, screenshots/video. |
| Expo compatibility | Review the Expo package patch-version recommendations reported during export and upgrade in a separate dependency task. | Clean install, unit/lint/typecheck, web/native exports, and device smoke. |
| CI duration | Split selected browser batches or shard the scheduled/full safety matrix if the authoritative web lane becomes too slow. | Timing report that preserves the same assertions and the zero-success-artifact/failure-only diagnostics policy. |
| Report retention | Define how long local evidence is retained and where accepted manual review decisions are recorded. | Team-owned retention policy; generated local artifacts remain ignored and are not uploaded by CI. |

## Explicitly deferred

- Deploying or publishing `dist/web`.
- DNS, nginx, VM, TLS, CSP, cache, or production `WEB_ALLOWED_ORIGINS` activation.
- Google/Apple provider-console registration and secret changes.
- Browser purchases, RevenueCat web billing, or restore-purchase behavior.
- PWA installation, service worker, offline asset caching, and web push notifications.
- Production monitoring/provider activation.
- Tracked visual baselines. Local screenshots and reports remain ignored until a separate baseline policy is approved.

## Release exit rule

Web release readiness requires every `Required before release` row to be either completed with cited evidence or explicitly accepted as a residual risk by the required human approver. Passing fixture-based Playwright tests alone is not a release approval.
