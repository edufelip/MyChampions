# TC-004 Custom Meals And Portion Logging (Proposed)

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-401 | Meal Creation | Authenticated user | Create custom meal with name, grams, calories, carbs, proteins, fats | Meal saved in user library |
| TC-402 | Optional Cost | Meal creation form open | Provide ingredient cost and save meal | Cost saved successfully |
| TC-403 | Required Validation | Meal creation form open | Omit total grams or set 0 grams | Save blocked with validation message |
| TC-404 | Portion Logging | Existing custom meal | Log consumed grams (e.g., 100g) | Entry saved and daily totals updated |
| TC-405 | Proportional Math | Meal totals known | Log custom portion grams | Stored calories/macros match proportional formula |
| TC-406 | Reusability | At least one custom meal exists | Reopen tracker on later day | Same meal available for new logs |
| TC-407 | History Integrity | Custom meal has historical logs | Edit meal nutrient values | Historical logs unchanged, future logs use new values |
| TC-408 | Self-Guided Access | Student without professional | Open custom meal creation and logging | Feature fully usable without professional connection |
| TC-409 | Share Link Generation | User owns custom meal | Trigger share action | Valid share link generated |
| TC-410 | Shared Link Confirmation | Valid shared link opened by authenticated recipient | Open link | Confirmation screen is shown before saving |
| TC-411 | Save Shared Copy | Recipient on confirmation screen | Confirm save | Recipient-owned copy is created in recipient library |
| TC-412 | Source Delete Isolation | Recipient saved shared copy and creator has source recipe | Creator deletes source | Recipient copy remains available |
| TC-413 | Source Edit Isolation | Recipient saved shared copy and creator edits source recipe | Creator updates source nutrients/name | Recipient copy remains unchanged |
| TC-414 | Recipient Reuse | Recipient saved shared copy | Log consumed grams from saved copy | Tracking works normally with proportional calculations |
| TC-415 | Role Access Matrix | Authenticated accounts in different roles | Open create/edit/share/save-from-link flows | All roles can access custom meal sharing features |
| TC-416 | Non-Expiring Link | Creator generated a shared link at an earlier date | Open link after extended time window | Link remains valid (no expiration behavior) |
| TC-417 | Non-Revocable Link | Creator generated shared link | Creator attempts to revoke/invalidate link | Revoke action unavailable and link remains usable |
| TC-418 | Idempotent Same-Recipient Import | Recipient already saved recipe from link | Recipient opens same link and confirms save again | No duplicate copy is created; existing saved copy is returned |
| TC-419 | Auth Resume From Shared Link | Recipient logged out | Open valid shared link, then authenticate | App resumes exact shared-link confirmation flow post-login |
| TC-420 | Shared Snapshot Payload Scope | Shared link exists | Inspect import payload fields used for save | Payload includes nutrition fields and excludes ingredient cost |
| TC-421 | Source Deleted Before Recipient Save | Creator generated shared link but deleted source recipe before recipient save | Recipient opens link and confirms save | Import still succeeds using immutable shared snapshot |
| TC-422 | Recipe UUID Identifier | Create source recipe, then import shared copy as recipient | Inspect identifiers of source and imported records | Both IDs are valid UUIDs and imported copy UUID differs from source UUID |
| TC-423 | Sharing Endpoint Rate Limit | Client prepared to issue high-frequency requests | Burst calls to share generate/open/import endpoints | Requests above threshold are rate-limited with retryable response |
| TC-424 | Shared-Link Telemetry Redaction | Shared-link operations executed with analytics enabled | Inspect analytics/observability payloads | Full shared-link values/raw tokens are absent or redacted |
| TC-425 | Recipe UUID Version | Source and imported recipe records exist | Validate ID format/version bits | IDs conform to UUIDv7 |
| TC-426 | Recipe Image Upload Progress | User uploads recipe image in custom meal create/edit flow | Start upload and observe UI state | Visible upload progress is displayed until completion/failure |
| TC-427 | Recipe Image Upload Retry | Recoverable upload failure occurs while recipe draft has unsaved form values | Trigger retry action after failure | Retry path is available, failure reason is visible, and draft fields are preserved |
