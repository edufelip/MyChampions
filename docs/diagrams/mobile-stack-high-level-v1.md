# Mobile Stack High-Level Diagram (V1)

```mermaid
flowchart LR
  U[Student / Professional User] --> A[Expo React Native App]

  A --> B[Supabase Auth]
  A --> C[Supabase Postgres + RLS]
  A --> D[Supabase Storage]
  A --> E[fatsecret API]
  A --> F[RevenueCat]
  A --> G[Firebase Crashlytics]

  B --> C
  C --> D

  subgraph Mobile Runtime
    A
  end

  subgraph Backend Services
    B
    C
    D
    E
    F
    G
  end
```

## Notes
- NFR baseline assumes no hard dependency on EAS for build/release.
- Native iOS and Android pipelines are owned in CI/CD with native toolchains.
