# QA Smoke Pack

## Purpose

Define the default on-demand manual QA pack for MyChampions surfaces `mobile` / `web` when a chat QA run says `smoke` (or omits scope). Invoked by the global Skill `~/.cursor/skills/qa-manual-run` (adapter `families/mychampions.md`).

## Pack contents

| Layer | What runs | Notes |
|---|---|---|
| Playwright signal | `yarn test:e2e:web:smoke` | Chromium batch from `docs/test-cases/web-playwright-batches-and-manual-validation.md`. Artifacts under `.artifacts/web-e2e/<run-id>/`. |
| Browser UC walk | `UC-001` (navigation baseline) | Human-like browser pass over UC-001.1–UC-001.3 against the resolved env. |
| Browser TC slice | Thin `TC-001` | Launch + tab navigation + theme sanity from `docs/test-cases/TC-001-navigation-and-theme.md` (`TC-001`–`TC-006` as applicable on web). |

## Preconditions

- Environment resolved per `docs/test-cases/qa-env-registry.md` (default `local`).
- For `local`: Expo web fixture lane available (Playwright starts Expo on `127.0.0.1:8081` for the smoke batch).
- Linear MyChampions project available for the parent QA Run.

## Browser checkpoints (minimum)

1. App/web shell loads without blank/error crash.
2. Default home/role shell is visible after auth fixture or authenticated session as applicable.
3. Role-aware destinations are reachable from the navigation shell (mobile width and at least one wider viewport when practical).
4. Modal open/dismiss still returns to Home without restart (`UC-001.3` when the modal entry exists in the build under test).
5. Light/dark or tokenized shell does not obviously break canvas/surface/text contrast (`TC-005` / `TC-006` judgment pass).

## Out of pack

- Server-auth Playwright batch (`yarn test:e2e:web:server`) — only when scope explicitly includes those TCs.
- Complete flow atlas, Detox, native device/TestFlight.
- Store-live, provider-live, or production mutation paths.

## Related

- Playbook: `docs/test-cases/qa-manual-run-playbook.md`
- Env registry: `docs/test-cases/qa-env-registry.md`
- Playwright batches: `docs/test-cases/web-playwright-batches-and-manual-validation.md`
- UC: `docs/use-cases/UC-001-navigation-baseline.md`
- TC: `docs/test-cases/TC-001-navigation-and-theme.md`
