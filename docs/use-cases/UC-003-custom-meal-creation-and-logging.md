# UC-003 Custom Meal Creation And Logging (Proposed)

## UC-003.1 Create Custom Meal
- Primary actor: User (student or professional account context).
- Trigger: User chooses to create a custom meal.
- Preconditions: User authenticated.
- Main flow:
  1. User enters meal details: name, total weight in grams, calories, carbs, proteins, fats.
  2. User optionally enters ingredient cost.
  3. User saves custom meal.
- Expected result: Meal is stored in the user's custom meal library.
  - Stored meal record uses UUID identifier.

## UC-003.2 Log Portion From Saved Custom Meal
- Primary actor: User.
- Trigger: User wants to log food consumption.
- Preconditions: At least one custom meal exists.
- Main flow:
  1. User selects a saved custom meal.
  2. User enters consumed grams (for example, 100g).
  3. System calculates consumed calories/macros proportionally.
  4. System stores log entry and updates daily totals.
- Expected result: Daily nutrition tracking reflects proportional values from the custom meal.

## UC-003.3 Edit Custom Meal Without Corrupting History
- Primary actor: User.
- Trigger: User updates a custom meal.
- Preconditions: Existing custom meal exists.
- Main flow:
  1. User edits custom meal values.
  2. User saves changes.
  3. System applies changes only to future logs.
  4. System keeps historical log snapshots unchanged.
- Expected result: Historical integrity is preserved while meal definitions remain maintainable.

## UC-003.4 Share Custom Meal By Link
- Primary actor: Meal owner.
- Trigger: User chooses to share a custom meal.
- Preconditions: User owns at least one custom meal.
- Main flow:
  1. User opens a saved custom meal.
  2. User taps share action.
  3. System generates a non-expiring shareable link for that meal.
  4. User sends link to another person.
- Expected result: Recipient can open link and start save-to-account flow.
- Alternate flow:
  - If sharing endpoint rate limit is exceeded, system blocks request temporarily and shows retry guidance.

## UC-003.5 Save Shared Recipe Into Recipient Account
- Primary actor: Recipient user.
- Trigger: Recipient opens shared recipe link.
- Preconditions: Link is valid (non-expiring; creator cannot revoke).
- Main flow:
  1. Recipient opens shared link.
  2. If recipient is not authenticated, system requests login and resumes the exact shared-link flow after authentication.
  3. System shows recipe preview and confirmation screen using immutable nutrition snapshot fields.
  4. Recipient confirms save.
  5. If recipient already saved this same link before, system returns existing saved copy (idempotent import).
  6. Otherwise, system creates recipient-owned recipe copy.
- Expected result: Recipient can reuse recipe in tracking as account-owned meal, without duplicate imports from repeated saves on same link.
  - Recipient-owned copy uses UUID identifier distinct from source recipe UUID.

## UC-003.6 Source Deletion Does Not Remove Recipient Copies
- Primary actor: Recipe creator and recipient.
- Trigger: Creator deletes original recipe after sharing.
- Preconditions: Recipient already saved shared recipe.
- Main flow:
  1. Creator deletes source recipe from own library.
  2. Recipient opens own recipe library.
  3. Recipient accesses previously saved copy.
- Expected result: Recipient copy remains available and usable.

## UC-003.7 Source Deletion Before Save Still Preserves Shared Import
- Primary actor: Recipe creator and recipient.
- Trigger: Creator deletes original recipe before recipient saves.
- Preconditions: Share link was generated before deletion.
- Main flow:
  1. Creator shares link, then deletes source recipe.
  2. Recipient opens shared link.
  3. Recipient confirms save.
- Expected result: Import succeeds using immutable shared snapshot and recipient receives independent account-owned copy.

## UC-003.8 Recipe Image Upload Progress And Retry
- Primary actor: User.
- Trigger: User uploads/updates recipe image for a custom meal.
- Preconditions: User is authenticated and has a create/edit recipe context.
- Main flow:
  1. User selects image from device.
  2. App compresses image and validates upload constraints.
  3. UI shows upload progress indicator.
  4. On recoverable failure, app shows reason and retry action.
  5. User retries and upload completes without losing meal draft fields.
- Expected result: Media upload behavior is transparent and recoverable.
