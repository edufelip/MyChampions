# SC-216 Shared Recipe Save Confirmation (V2)

## Route
- `/shared/recipes/:shareToken`

## Objective
- Let any recipient open a shared recipe link, then authenticate (if needed), review details, and confirm saving an account-owned copy.

## Design Structure (D-134)
- Route uses `DsScreen` shell with shared DS background/theme tokens.
- Offline state in preview mode uses `DsOfflineBanner` with BL-008 write-lock semantics.
- Preview, error, and success sections follow DS spacing/typography hierarchy with localization-key copy only.
- Primary/secondary confirmation actions keep existing business flow while matching DS action styling.

## UX Copy Intent
- Make ownership outcome explicit: saving creates a personal copy.
- Keep flow safe with a clear confirmation step before import.

## User Actions
- Primary:
  - Open shared recipe link.
  - Review recipe preview details.
  - Confirm save to own account.
- Secondary:
  - Cancel and return.

## States
- Loading: resolve share token and fetch immutable shared snapshot.
- Empty: invalid or unknown link state.
- Error: token validation or save failure.
- Success: recipient-owned copy is created or existing idempotent copy is resolved and available in custom meal library.

## Validation Rules
- Save action requires authenticated recipient; unauthenticated users are redirected to login and then resumed back to same share token route.
- Confirmation step is required before importing.
- Import creates recipient-owned copy, not mutable source reference.
- Re-import from same link by same recipient must be idempotent (no duplicate copy creation).
- Shared-link import payload contains nutrition fields only (`name`, `total_grams`, `calories`, `carbs`, `proteins`, `fats`) and excludes ingredient cost.
- Shared links do not expire and cannot be revoked by creator.
- Share generate/open/import endpoint interactions are rate-limited by abuse-control policy.
- Analytics/observability from this flow must exclude full shared-link values/raw share tokens.

## Data Contract
- Inputs:
  - Share token.
  - Immutable shared recipe snapshot payload (nutrition-only fields).
  - Recipient account context.
- Outputs:
  - Recipient-owned custom meal copy (or previously saved idempotent copy), always with UUIDv7 identifier.
  - Optional lineage metadata for audit/reference.

## Edge Cases
- If source recipe is deleted before recipient save, import still succeeds using immutable shared snapshot.
- If source recipe is deleted after recipient save, recipient copy remains available.
- Re-opening same link can allow multiple recipients to save independent copies.
- Re-opening same link by same recipient must resolve to already-saved copy state.

## Copy Draft (Initial)
- Title: `Save shared recipe`
- Helper: `Save this recipe to your account to use it in your daily tracking.`
- Ownership note: `After saving, this copy is yours even if the original creator deletes theirs.`
- CTA confirm: `Save to my account`
- Existing-copy note: `You already saved this recipe in your account.`
- Auth helper: `Sign in to save this recipe. We'll bring you back here right after login.`

## Links
- Functional requirement: FR-145, FR-146, FR-147, FR-148, FR-149, FR-150, FR-151, FR-152, FR-153, FR-154, FR-155, FR-159, FR-160, FR-161, FR-162
- Use case: UC-003.5, UC-003.6, UC-003.7
- Acceptance criteria: AC-409, AC-410, AC-411, AC-412, AC-413, AC-414, AC-415, AC-416, AC-417, AC-418, AC-419, AC-420, AC-421, AC-422, AC-423
- Business rules: BR-311, BR-312, BR-313, BR-314, BR-315, BR-316, BR-317, BR-318, BR-320, BR-321, BR-322, BR-323, BR-324, BR-325, BR-326, BR-327
- Test cases: TC-410, TC-411, TC-412, TC-413, TC-415, TC-416, TC-417, TC-418, TC-419, TC-420, TC-421, TC-422, TC-423, TC-424, TC-425
- Diagram: docs/diagrams/role-journey-flow.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
