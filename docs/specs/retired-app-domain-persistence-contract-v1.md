# Retired App-Domain Persistence Contract V1

## Status

Retired during the local MyChampions server migration. This file remains only as a pointer for older discovery notes and decision references that named the former mobile-owned provider contract.

Current app-domain persistence is implemented through the root-level MyChampions server. Local development uses Bun/Elysia routes, local bearer sessions, Drizzle migrations, and the Docker Postgres database `mychampions_server_local`. Food and exercise catalog integrations read mirrored local catalog Postgres databases through server endpoints.

## Superseded Runtime Baseline

The active mobile source-layer contract is now:

1. Mobile auth/session code resolves an explicit E2E session or a local MyChampions server session.
2. Mobile source modules call MyChampions server endpoints with provider-neutral bearer access tokens.
3. The server owns profile, support, connection, professional, training, nutrition, custom-meal, image, plan, and tracking persistence in local Postgres or local filesystem storage.
4. Missing local server URL or bearer auth fails closed outside explicit E2E fixtures.

## Retired Contract

The retired contract used a mobile-owned Firebase project for identity, document persistence, media storage, and selected callable backend behavior. Those project files, rules harnesses, native config files, package dependencies, and runtime wrappers have been removed from the mobile package.

Do not add new implementation requirements to this file. New storage and authorization requirements belong in the current product docs and in the server route/repository tests that exercise the local MyChampions server.

## Current Validation

Use the local server and mobile source tests instead of the old rules smoke harness:

- `cd ../server && bun test`
- `cd ../server && bunx tsc --noEmit`
- `cd . && yarn tsx --test features/auth/firebase-config-removal-scan.test.ts`
- `cd . && yarn tsc --noEmit`

When a source module migrates additional app-domain behavior, update:

- `docs/discovery/pending-wiring-checklist-v1.md`
- relevant `docs/business-rules/**`, `docs/functional-requirements/**`, `docs/use-cases/**`, `docs/test-cases/**`, and `docs/acceptance-criteria/**`
- the parent Firebase-removal task card under `../docs/superpowers/plans/`

## Traceability

This retired spec previously covered role/profile, connection lifecycle, plans, meals, hydration, support, and tracking behavior. Current authoritative behavior is covered by the server tests and focused mobile source tests recorded in the Firebase-removal task card.
