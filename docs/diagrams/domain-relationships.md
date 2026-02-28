# Domain Relationships (Proposed)

```mermaid
erDiagram
  USER ||--|| ACCOUNT : has
  ACCOUNT ||--o{ PROFESSIONAL_SPECIALTY : declares
  ACCOUNT ||--o{ PROFESSIONAL_CREDENTIAL : owns
  ACCOUNT ||--o{ STUDENT_ASSIGNMENT : receives
  ACCOUNT ||--o{ PROFESSIONAL_CLIENT : manages

  STUDENT_ASSIGNMENT }o--|| ACCOUNT : student
  STUDENT_ASSIGNMENT }o--|| ACCOUNT : professional

  ACCOUNT ||--o{ NUTRITION_PLAN : owns_or_receives
  ACCOUNT ||--o{ TRAINING_PLAN : owns_or_receives
  ACCOUNT ||--o{ DAILY_TRACKING_ENTRY : logs
  ACCOUNT ||--o{ CUSTOM_MEAL : creates
  ACCOUNT ||--o{ CUSTOM_MEAL_LOG : logs
  ACCOUNT ||--o{ RECIPE_SHARE_LINK : generates
  ACCOUNT ||--o{ SHARED_RECIPE_SAVE : confirms
  CUSTOM_MEAL ||--o{ CUSTOM_MEAL_LOG : referenced_by
  CUSTOM_MEAL ||--o{ RECIPE_SHARE_LINK : source
  RECIPE_SHARE_LINK ||--o{ SHARED_RECIPE_SAVE : consumed_by
  PROFESSIONAL_SPECIALTY ||--o| PROFESSIONAL_CREDENTIAL : optional_registry
```

## Notes
- Student and Professional are role profiles under account context.
- Specialty-specific assignment constraints apply to active relationships.
- Custom meals are account-owned and produce snapshot-based portion logs.
- Shared recipe saves create recipient-owned copies independent from source lifecycle.
- Shared-recipe import is idempotent per `(share_link, recipient_account)` and share-link payload is immutable nutrition snapshot data.
- `CUSTOM_MEAL` records use UUIDv7 primary identifiers for source and imported copies.
- Professional credentials are optional, scoped per specialty, and capped to one `professional_registry` record per specialty in MVP.
