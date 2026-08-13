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
| TC-428 | Native Image Upload Fixture Isolation | Authenticated native E2E profile and fresh Metro phases are available | Run `custom-meal-image-upload` once with `E2E_IMAGE_UPLOAD_SCENARIO=sheet` and the success fixture cleared, then once with scenario/fixture `success` | The sheet phase proves the localized native source selector and skips the synthetic upload assertion; the success phase proves the uploaded preview and skips the sheet assertion; missing or invalid authenticated scenarios fail before both assertions can be skipped |
| TC-436 | Native Quick-Log Numeric Input | Authenticated native E2E custom-meal fixture is available on iOS and Android | Open quick log, prove empty validation, atomically replace grams with `150`, assert the exact controlled value, dismiss Android through native Back or wait for the iOS accessory animation to settle before tapping Done, and submit by the stable confirm identifier | No Android key-event, moving iOS accessory, or obscured-coordinate tap can alter the intended grams; the exact portion is logged and the quick-log panel unmounts |
| TC-440 | Library Load Error Retry and Recovery (ET-103, SC-215) | Authenticated user opens `/nutrition/custom-meals` and the custom-meal library read fails | Inspect the rendered error state at 390x844 and 412x915, tap Retry, then tap the Create meal fallback | The screen renders `meal.library.error` with localized copy plus a semantic Retry action (`meal.library.error.retry`) and a Create meal fallback (`meal.library.error.cta.create`); no stale meal rows are interactive and bottom navigation remains visible; Retry re-runs the load through the existing loading state and settles into `ready` or `error`; the fallback opens a usable create flow |
