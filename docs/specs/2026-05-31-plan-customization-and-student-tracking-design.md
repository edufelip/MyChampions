# Retired Plan Customization and Student Tracking Design

> **Status:** Historical / superseded by the local MyChampions server migration.
> Do not execute this document as current Firebase implementation guidance.

This design previously described draft assigned plans, connection lifecycle
archival, student check-off logs, and professional tracking review for the
former mobile-owned backend baseline.

The current design source is the server-backed implementation:

- root server routes in `../../server/src/app.ts`
- Drizzle/Postgres schema and migrations in `../../server/drizzle/`
- route and repository behavior in `../../server/tests/`
- mobile source contracts in `../../features/**`
- migration acceptance evidence in
  `../../../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md`

Current terminology for this area should use server-owned plans, connections,
water logs, workout logs, custom meals, portion logs, and tracking-review
routes backed by local Postgres. Do not reintroduce mobile-owned provider
schemas or rules from this retired design.
