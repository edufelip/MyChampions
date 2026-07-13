# Retired Nutritionist Experience Governance Plan

> **Status:** Historical / superseded by the local MyChampions server migration.
> Do not execute this plan as current Firebase implementation guidance.

This plan previously described nutritionist planning, assignment, tracking
review, invite-code, and custom-meal governance for the former mobile-owned
backend baseline.

The current implementation path is server-owned:

- root server routes in `../../../server/src/app.ts`
- Drizzle/Postgres migrations in `../../../server/drizzle/`
- route and repository tests in `../../../server/tests/`
- mobile source contracts under `../../features/**`
- current acceptance evidence in
  `../../../../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md`

Current work in this area should update the MyChampions server route/repository
tests and the focused mobile source tests for connections, professional
specialties, plans, water logs, custom meals, portion logs, and tracking review.
Do not revive mobile-owned provider rules, emulator harnesses, or legacy
provider project files from this retired plan.
