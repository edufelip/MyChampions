# Complete flow screenshot atlas

## Scope and artifact contract

This atlas maps the implemented client flows and every documented use case to deterministic browser evidence. Each visual checkpoint is captured at three responsive platform modes:

- `mobile`: 390 × 844 browser viewport with bottom navigation.
- `tablet`: 820 × 1000 browser viewport with the compact navigation rail.
- `web`: 1440 × 1000 browser viewport with the labeled sidebar.

These are responsive web captures, not iOS/Android simulator screenshots. Native device validation remains a separate manual/Detox activity.

The ignored local artifact hierarchy is:

```text
.artifacts/web-e2e/complete-flow-atlas-verified/<run-id>/
├── screenshots/
│   └── <flow>/
│       ├── mobile/*.png
│       ├── tablet/*.png
│       └── web/*.png
├── flow-coverage.json
├── manual-validation.md
├── html-report-auth/index.html
├── html-report-app/index.html
├── results-auth.json
└── results-app.json
```

Run `yarn test:e2e:web:flow-atlas`. Each invocation creates a unique run ID, clears only
that guarded run directory before either Playwright capture starts, and prints the final
artifact path. The command fails before capture if the directory cannot be prepared. The
verifier requires the exact manifest filename set from that run; matching only the total
image count is insufficient.

## Flow inventory

| Flow folder | Checkpoints per platform | Primary surfaces |
|---|---:|---|
| `00-authentication-and-terms` | 14 mobile / 10 tablet / 10 web | Sign in, create account, validation, Google, Apple, terms, narrow mobile auth layout |
| `01-role-onboarding` | 2 | Role selection and student first value |
| `02-professional-onboarding` | 4 | Specialty selection, optional credential, professional home |
| `03-student-daily-care` | 10 | Home, nutrition, hydration, plan-change request, meals, training |
| `04-student-connections` | 4 | Active relationships, end confirmation, QR/manual fallback, pending invite |
| `05-custom-meals` | 6 | Library, portion logging, AI result, edit/create, image upload |
| `06-shared-recipes` | 2 | Shared preview and saved recipient copy |
| `07-professional-care-management` | 7 | Workbench, roster, bulk selection/picker, profile, pending queue |
| `08-professional-plan-authoring` | 6 | Plan libraries/builders and exercise search/detail |
| `09-professional-account-controls` | 3 | Specialty management/removal assist and entitlement state |
| `10-account-and-compliance` | 7 | Account, language, support, deletion, sign-out |
| `11-offline-read-only` | 2 | Offline home and nutrition write lock |
| `12-app-shell-modal` | 2 | Modal open and role-home return |

Total: 13 flow folders, 65 base checkpoints per platform plus 4 mobile-only auth checkpoints, 199 screenshots.

## Documented use-case mapping

“Visual” means the named state has a screenshot. “Hybrid” means screenshots cover the user-visible state while unit/server tests prove data retention, analytics, or idempotency that cannot be seen in a still image. “Specified gap” means the documentation describes a state that the current client cannot reach truthfully.

| Use case | Evidence flow/checkpoint | Coverage |
|---|---|---|
| UC-001.1 Open Home | `01-role-onboarding/02-student-first-value-home` | Visual |
| UC-001.2 Role-aware navigation | `03-student-daily-care/02-nutrition-tracking`, `07-professional-care-management/02-student-roster-and-bulk-assignment` | Visual |
| UC-001.3 Modal and return | `12-app-shell-modal/*` | Visual |
| UC-002.0 Sign in/create account | `00-authentication-and-terms/*` | Visual |
| UC-002.1 Select role | `01-role-onboarding/*`, `02-professional-onboarding/*` | Visual |
| UC-002.1b Optional professional verification | `02-professional-onboarding/02-optional-credential-verification` | Visual |
| UC-002.1c Manage specialties | `09-professional-account-controls/01-specialty-management` | Visual |
| UC-002.2 Manage multiple students | `07-professional-care-management/02-student-roster-and-bulk-assignment` through `05-student-profile-and-tracking-review` | Visual |
| UC-002.3 Connect to professionals | `04-student-connections/01-active-professionals`, `04-invite-pending-confirmation` | Visual |
| UC-002.4 Self-managed planning | Plan builder checkpoints in `03-student-daily-care` and `08-professional-plan-authoring`; ownership rules remain unit-tested | Hybrid |
| UC-002.5 End relationship/history retention | `04-student-connections/02-end-relationship-confirmation`; archival/history retention is source/server evidence | Hybrid |
| UC-002.6 Student-cap subscription gate | `09-professional-account-controls/03-subscription-entitlement` | Visual |
| UC-002.7 Custom training authoring | `08-professional-plan-authoring/04-new-training-plan-builder` through `06-exercise-search-detail` | Visual |
| UC-002.8 Quick self-guided start | `01-role-onboarding/*` | Visual |
| UC-002.9 QR invite scan | `04-student-connections/03-camera-unavailable-manual-fallback`, `04-invite-pending-confirmation` | Visual |
| UC-002.10 Contextual auth/invite errors | `00-authentication-and-terms/02-sign-in-validation`, `06-create-account-validation`; `04-student-connections/03-camera-unavailable-manual-fallback` | Visual |
| UC-002.11 Analytics emission | Screenshot-adjacent actions execute in the atlas; event payload/redaction requires analytics tests | Hybrid, non-visual invariant |
| UC-002.12 Pending queue operations | `07-professional-care-management/06-pending-request-queue`, `07-pending-bulk-deny-selection` | Visual |
| UC-002.13 Plan-change requests | `03-student-daily-care/04-plan-change-request-ready`, `05-plan-change-request-submitted`; professional review in `07/.../05-student-profile-and-tracking-review` | Visual |
| UC-002.14 Starter templates | Current UI exposes predefined plan libraries/builders in `08-professional-plan-authoring/01`–`04`; server starter-template cloning has no dedicated client selection surface | Specified gap |
| UC-002.15 Pre-lapse warning | Subscription screen is captured, but the current subscription hook supplies no explicit expiry-risk signal to `resolveSubscriptionState` | Specified gap |
| UC-002.16 Specialty removal assist | `09-professional-account-controls/02-specialty-removal-assist` | Visual |
| UC-002.17 Offline read-only | `11-offline-read-only/*` | Visual |
| UC-002.18 Accessibility baseline | Every checkpoint asserts no horizontal overflow; keyboard/dialog behavior is covered by the accessibility Playwright batch | Hybrid |
| UC-002.19 Hydration | `03-student-daily-care/02-nutrition-tracking`, `03-water-intake-logged` | Visual |
| UC-002.20 Predefined plans/bulk assignment | `07-professional-care-management/02`–`04`, `08-professional-plan-authoring/01` and `03` | Visual |
| UC-002.20b Tracking review | `07-professional-care-management/05-student-profile-and-tracking-review` | Visual |
| UC-002.21 Terms acceptance | `00-authentication-and-terms/03-required-terms`, `04-terms-ready-to-accept` | Visual |
| UC-002.22 Exercise search | `08-professional-plan-authoring/05-exercise-search`, `06-exercise-search-detail` | Visual |
| UC-003.1 Create custom meal | `05-custom-meals/06-create-custom-meal` | Visual |
| UC-003.2 Log portion | `05-custom-meals/02-quick-log-portion` | Visual |
| UC-003.3 Edit without corrupting history | `05-custom-meals/04-edit-custom-meal`; immutable historical snapshots require source/server tests | Hybrid |
| UC-003.4 Share custom meal | Share action is present on `05-custom-meals/04-edit-custom-meal`; link creation/share fallback requires adapter/source tests | Hybrid |
| UC-003.5 Save shared recipe | `06-shared-recipes/*` | Visual |
| UC-003.6 Source deletion preserves copies | `06-shared-recipes/02-recipient-owned-copy-saved`; persistence after deletion is a server invariant | Hybrid |
| UC-003.7 Deletion before save preserves import | `06-shared-recipes/*`; immutable snapshot behavior is a server invariant | Hybrid |
| UC-003.8 Image upload | `05-custom-meals/05-image-upload-complete`; error/retry behavior remains adapter/unit evidence | Hybrid |
| UC-003.9 AI meal photo analysis | `05-custom-meals/03-ai-photo-analysis-result`, `05-image-upload-complete` | Visual |

## Completion boundary

The screenshot atlas is complete for currently reachable visual states listed in the manifest. It intentionally does not manufacture screenshots for non-visual persistence/analytics invariants or for specified states that the current client cannot truthfully reach. Those gaps remain visible in this mapping instead of being mislabeled as screenshot coverage.
