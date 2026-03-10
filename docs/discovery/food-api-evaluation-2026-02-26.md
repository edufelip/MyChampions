# Food API Evaluation (Historical Note)

## Status
- Deprecated on 2026-03-09.

## Context
- This document captured the original provider evaluation performed on 2026-02-26.
- The selected provider at that time is no longer active in the mobile app codebase.

## Current Decision
- Active provider contract is the VPS food-search microservice endpoint:
  - `https://foodservice.eduwaldo.com/searchFoods`
- Client contract:
  - `POST` with `Authorization: Bearer <Firebase ID token>`
  - body `{ "query": string, "maxResults": number, "region": string, "language": string }`
  - success shape `200 { "results": [{ "id", "name", "carbohydrate", "protein", "fat", "serving": 100 }] }`
  - handles `200 { "error": "quota_exceeded" }`, `429`, `401`, `400`, `500`, and `502` (`upstream_ip_not_allowlisted`/`upstream_error`)

## Migration Note
- Legacy Firebase `searchFoods` Cloud Function and related provider-specific helper code were removed from this repository during the migration to the VPS microservice.
