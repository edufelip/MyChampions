# Mobile Stack High-Level Diagram (V1)

> Historical mobile-focused view. The current Android/iOS/web architecture is documented in `cross-platform-stack-v1.md`.

```mermaid
flowchart LR
  U[Student / Professional User] --> A[Expo React Native App]

  A --> B[MyChampions Server]
  A --> G[RevenueCat]

  B --> C[(Local Postgres)]
  B --> D[Local Meal Image Storage]
  B --> E[Food Catalog Integration]
  B --> F[Exercise Catalog Integration]
  B --> H[Future Auth / Storage Provider Bridge]

  E --> I[(Mirrored Food Catalog DB)]
  F --> J[(Mirrored Exercise Catalog DB)]

  subgraph Mobile Runtime
    A
  end

  subgraph Local Backend
    B
    C
    D
    E
    F
    H
    I
    J
  end

  subgraph External Services
    G
  end
```

## Notes

- The local MyChampions server is the active app-domain backend during the migration.
- Food and exercise catalog reads route through server endpoints backed by mirrored local catalog databases.
- Remote auth/storage provider wiring is future work; mobile source modules must not depend on a mobile-owned Firebase runtime path.
- NFR baseline assumes no hard dependency on EAS for build/release.
- Native iOS and Android pipelines are owned in CI/CD with native toolchains.
- PR CI resolves changed paths through feature ownership, declared dependencies,
  and reverse import consumers before executing focused Detox and Playwright
  suites. Shared-global or unknown runtime changes fail closed to the complete
  registered matrix, and D-193 makes the exact-head selective workflow the
  authoritative pull-request gate.
- The iOS lane reserves dedicated non-ephemeral Metro port `18081`, compiles it
  as the debug fallback, and routes every launch plus freshly owned phase
  through it. Android keeps fixed port `8081` coordinated with its
  instrumentation and ADB reverse tunnel.
