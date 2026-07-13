# Retired AI Provider Abstraction Plan

> **Status:** Historical / superseded by the local MyChampions server migration.
> Do not execute this plan as current Firebase implementation guidance.

This plan previously described provider-abstraction work for the former mobile
provider-function path.

The current implementation path is server-owned:

- meal-photo analysis route in `../../../server/src/app.ts`
- analyzer contract and local unconfigured analyzer in `../../../server/src/nutrition/`
- route tests in `../../../server/tests/meal-photo-analysis.test.ts`
- mobile analyzer source contracts under `../../features/nutrition/`
- current acceptance evidence in
  `../../../../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md`

Current work in this area should update the root MyChampions server analyzer
boundary and focused mobile source tests. Do not revive mobile-owned provider
function code, legacy provider helper modules, or retired provider-project
secret/env instructions from this historical plan.
