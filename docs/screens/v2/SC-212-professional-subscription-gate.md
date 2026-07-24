# SC-212 Professional Subscription Gate (V2)

## Route
- `/professional/subscription`

## Objective
- Enforce and manage monetization for professional accounts exceeding 10 active students.

## Design Structure (D-134)
- Screen shell uses `DsScreen` with shared background treatment and semantic DS colors.
- Entitlement verification, student capacity, purchase capability, warning, and lock states are presented as distinct concepts.
- Loading uses progress copy; a settled unknown/error state says `Status unavailable` and never remains labeled `Checking...`.
- Student capacity uses a labeled progress bar and displays an em dash instead of a fabricated zero when no authoritative count is available.
- Purchase/restore actions use DS pill buttons; refresh stays as a lightweight text action.
- On web, purchase/restore is replaced by a localized mobile handoff when configured. If it is unavailable, no dead purchase CTA is rendered; the screen keeps status refresh available.
- Offline messaging uses `DsOfflineBanner` and keeps BL-008 write-lock gating.
- Native toolbar is disabled; this pushed route uses an in-content icon-only back button.

## User Actions
- Primary:
  - View current entitlement status.
  - Purchase subscription — tapping "Purchase" opens the native RevenueCat paywall via `openProPaywall()`, which presents the `default_professional` offering (professional products). Plan selection (monthly vs annual) is handled within the native paywall UI (D-152).
  - Restore subscription.
- Secondary:
  - Refresh entitlement status.
  - Review feature unlock details.

## States
- Loading: fetch entitlement and student-count usage.
- Empty: no active entitlement.
- Warning: entitlement is active and an authoritative billing-expiry signal says it is near lapse.
- Error: purchase/restore/sync failure.
- Success: entitlement active and cap-gated actions unlocked.

## Validation Rules
- Students are never routed to this paywall context.
- Professional cap above 10 active students requires active entitlement.
- Active student count is computed by unique active student accounts (one student counts once even with dual specialty assignment).
- Entitlement state must align with RevenueCat + store billing.
- Browser entitlement state comes only from the authoritative server snapshot; RevenueCat browser preview APIs are not initialized.
- Unknown entitlement fails closed for cap-sensitive writes above the free tier.
- After native RevenueCat customer info is read, the app best-effort syncs the latest professional and AI entitlement snapshot to the MyChampions server at `POST /subscription/entitlements/snapshot`.
- The snapshot carries normalized professional entitlement expiration and renewal-risk metadata. Production privileges are refreshed from the server-side canonical RevenueCat subscriber after a signed webhook, not trusted from a client write.
- Server-side pending confirmation enforces the activation cap: activating a new 11th unique active student requires an active professional entitlement snapshot, while a second specialty for an already-active student does not increase the count.
- If entitlement is inactive while over cap, new activations and professional writes to assigned student plans are locked until an active professional entitlement snapshot is synced.
- Pre-lapse warning must appear before lock state with clear renew/restore path, but it must never be inferred from active-student count.
- Entitlement-based plan locks must not disable purchase, restore, or configured mobile-handoff recovery actions.
- Accessibility baseline applies for readable warnings/CTAs with proper labels and focus order.

## RevenueCat Wiring (D-152)
- Entitlement ID: `professional_pro`
- Products: `professional_annual` (App Store annual), `professional_monthly` (App Store monthly), and `professional_test` (development App Store test product). Android and dedicated Test Store products remain a provider-release gate until configured.
- Paywall: RevenueCat offering **`default_professional`** (`PRO_OFFERING_ID`) — presented via `openProPaywall()` → `Purchases.getOfferings().all['default_professional']` → `RevenueCatUI.presentPaywall({ offering })`.
- Entitlement refresh happens automatically after the native paywall closes.
- Paywall outcome is explicit: purchase/restore success refreshes access; user cancellation closes without a system-error banner; network and store/provider failures remain actionable after the follow-up refresh.
- SDK key mapping is variant-aware (D-156):
  - `APP_VARIANT=dev` -> `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV`
  - `APP_VARIANT=prod` -> `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD`
  - Explicit dev-only Test Store verification -> `EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED=true` and `EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE=test_*`; production ignores this gate.
  - Legacy fallback remains temporarily available through `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID`

## Browser Handoff

- `purchaseCapability` is `mobile_handoff` only when `EXPO_PUBLIC_SUBSCRIPTION_HANDOFF_URL` is configured; otherwise it is `unavailable`.
- The primary CTA opens the configured mobile destination in a separate browser context. No browser purchase or restore API is called.
- Missing handoff configuration renders an informational unavailable card and omits purchase/restore controls instead of presenting a disabled primary action.
- The status refresh action remains available and re-reads the server snapshot.

## Data Contract
- Inputs:
  - Professional id.
  - Active student count from `getActiveProfessionalStudentCount`, computed as unique `studentAuthUid` values across active connections.
  - RevenueCat entitlement and storefront purchase state.
  - Optional canonical professional entitlement expiry and renewal-risk state.
- Outputs:
  - Updated entitlement state.
  - Unlock signal for cap-sensitive operations.
  - Local MyChampions server entitlement snapshot in `subscription_entitlement_snapshots`.

## Edge Cases
- Entitlement active but stale local cache should reconcile on refresh.
- Purchase canceled should preserve blocked state with clear retry path.
- Pre-lapse warning may clear automatically after entitlement refresh confirms healthy state.
- Malformed or missing expiry-risk data fails closed to no warning; it never becomes a warning from student capacity.
- A transferred purchase is reconciled for both source and destination App User IDs by the server webhook boundary before the delivery is acknowledged.

## Links
- Functional requirement: FR-126, FR-127, FR-128, FR-129, FR-156, FR-185, FR-215, FR-217
- Use case: UC-002.6, UC-002.15, UC-002.18
- Acceptance criteria: AC-219, AC-220, AC-221, AC-301, AC-302, AC-303, AC-304, AC-309, AC-311, AC-312, AC-512
- Business rules: BR-218, BR-219, BR-220, BR-221, BR-228, BR-247, BR-273, BR-275
- Test cases: TC-220, TC-221, TC-222, TC-301, TC-302, TC-303, TC-308, TC-310, TC-311, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
