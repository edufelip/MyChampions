# Cross-Platform Stack (V1)

```mermaid
flowchart LR
  U["Student / Professional"] --> E["Expo Router application"]

  E --> N["Native runtime: iOS / Android"]
  E --> W["Web runtime: responsive SPA"]

  N --> NA["Native adapters"]
  W --> WA["Browser adapters"]

  NA --> S["MyChampions Bun / Elysia server"]
  WA -->|"access token + rotating HttpOnly refresh cookie"| S

  NA --> RC["RevenueCat native purchase runtime"]
  WA --> EH["Server entitlement snapshot + mobile handoff"]

  S --> P[("Postgres")]
  S --> C["Food / exercise catalogs"]
  S --> M["Meal media / analyzer"]

  subgraph "Deferred deployment boundary"
    D["DNS / nginx / TLS / CSP / provider origins"]
  end

  D -. "not activated" .-> W
```

## Invariants

- Screens consume platform contracts; native SDK imports do not control browser access.
- Native bearer responses remain compatible while browser refresh tokens remain HttpOnly.
- Browser sign-out is a single-flight barrier: local identity clears immediately, while replacement authentication requests wait for the sign-out request to settle before establishing a new cookie session.
- The web build workflow exports an artifact only and has no publishing or infrastructure permissions.
