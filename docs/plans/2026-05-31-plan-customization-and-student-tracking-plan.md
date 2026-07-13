# Retired Plan Customization and Student Tracking Plan

> **Status:** Historical / superseded by the local MyChampions server migration.
> Do not execute this document as current Firebase implementation guidance.

This document used to hold the implementation plan for plan customization,
assigned-plan lifecycle, workout logging, hydration logging, custom meals, and
professional tracking review on the former mobile-owned backend baseline.

The current implementation path is the root-level MyChampions server:

- Bun/Elysia/TypeBox routes under `../../server/src/app.ts`
- Drizzle/Postgres migrations under `../../server/drizzle/`
- server route and repository tests under `../../server/tests/`
- mobile source tests under `../../features/**`
- current migration evidence under
  `../../../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md`

Current behavior for this area is covered by the server-backed plan, connection,
water-log, workout-log, custom-meal, portion-log, and professional tracking
review acceptance rows in that task card. New work should update those server
routes/repositories and the focused mobile source modules rather than reviving
this retired plan.
