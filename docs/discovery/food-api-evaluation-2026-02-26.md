# Food API Evaluation (Historical Note)

## Status
- Deprecated on 2026-03-09.

## Context
- This document captured the original provider evaluation performed on 2026-02-26.
- The selected provider at that time is no longer active in the mobile app codebase.

## Historical Snapshot
- The deprecated provider contract used a public food-search microservice endpoint:
  - `https://foodservice.eduwaldo.com/searchFoods`
- The retired client contract sent a provider-owned bearer token to that endpoint and used the response shape:
  - body `{ "query": string, "maxResults": number, "region": string, "language": string }`
  - success shape `200 { "results": [{ "id", "name", "carbohydrate", "protein", "fat", "serving": 100 }] }`
  - handled `200 { "error": "quota_exceeded" }`, `429`, `401`, `400`, `500`, and `502` (`upstream_ip_not_allowlisted`/`upstream_error`)

## Current Direction
- Mobile food search now uses the MyChampions server `POST /integrations/food/search` route with the local server bearer-token boundary.
- The server owns food-service credentials and reads from the mirrored local catalog Postgres database during local development.

## Migration Note
- Legacy Firebase `searchFoods` Cloud Function and related provider-specific helper code were removed from this repository during the migration to the MyChampions server integration route.
