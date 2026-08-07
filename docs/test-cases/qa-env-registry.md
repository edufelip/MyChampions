# QA Environment Registry

## Purpose

Name the environments a manual QA Skill run may target. The Skill defaults to `local` until a dedicated VM `dev` API exists.

## Environments

| Id | Status | App identity | API / web target | Skill policy |
|---|---|---|---|---|
| `local` | **Active (default)** | `APP_VARIANT=dev` local Expo web / fixture lane | Playwright smoke: `http://127.0.0.1:8081` with E2E fixtures. Optional real-server lane: `http://127.0.0.1:8082` + sibling server when scope explicitly requires server-auth TCs. Local API template: `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://localhost:3400`. | Allowed without confirmation. |
| `dev` | **Placeholder** | Intended: `MyChampions Dev` (`com.edufelip.mychampions.dev`) pointed at a non-prod VM API | **Not configured.** Sibling server VM today has one production stack only (`https://api.mychampions.eduwaldo.com`) and one production DB. A separate VM development database/API host is Pending. | Skill **refuses** `env=dev` until this row has a real base URL and test-account policy. |
| `prod` | **Confirm-gated** | `MyChampions` (`com.edufelip.mychampions`) | API: `https://api.mychampions.eduwaldo.com`. Web production origin is not a Skill default target. | Skill runs only after the user types an explicit confirmation phrase (see playbook). Never implied by `smoke`. |

## Notes

- Native app variant (`APP_VARIANT=dev|prod`) is **not** the same as QA env id. Variant selects binary identity/RevenueCat keys; `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL` selects the API.
- `EXPO_PUBLIC_ENV` in scripts/CI is a release-guard label; it is not a third runtime environment selector in `app.config.ts`.
- Filling `dev` requires infra work outside this registry (second VM DB + API host or path). Tracked in `docs/discovery/pending-wiring-checklist-v1.md`.

## Related

- Playbook: `docs/test-cases/qa-manual-run-playbook.md`
- Smoke pack: `docs/test-cases/qa-smoke-pack.md`
- Server deploy baseline: sibling `server/README.md`
