# D-114: Retired Starter Template Persistence Note

**Status**: Retired during the local MyChampions server migration
**Superseded By**: Root-level MyChampions server with local Postgres/Drizzle persistence

## Summary

This note previously tracked mobile-owned provider and Cloud SQL exploration for starter templates. That path is not part of the active runtime.

## Current Baseline

- App-domain persistence now runs through the root-level MyChampions server.
- Local development uses Docker Postgres plus Drizzle migrations.
- Mobile source modules call MyChampions server endpoints with provider-neutral bearer access tokens.
- The old Data Connect runtime artifacts remain removed from the app.

## Validation

Use the local server and source-module checks:

```bash
cd ../server && bun test
cd ../server && bunx tsc --noEmit
cd ../mychampions && yarn tsx --test features/auth/firebase-config-removal-scan.test.ts
cd ../mychampions && yarn tsc --noEmit
```

## Historical Note

Any retired provider persistence references in older commits are legacy context only. New app-domain persistence work should update the local server route/repository tests and the relevant current product docs.
