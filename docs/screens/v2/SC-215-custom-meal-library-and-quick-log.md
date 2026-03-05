# SC-215 Custom Meal Library And Quick Log (V2)

## Route
- `/nutrition/custom-meals`

## Objective
- Let any authenticated user browse saved custom meals and log consumed grams quickly.
- The AI meal photo analysis CTA (SC-219) is embedded in the quick-log panel (`QuickLogAnalysisRow`) and is gated behind a RevenueCat paywall (D-132): only users with an active `professional_unlimited` OR `premium_student` entitlement can access the AI feature. Users without an active entitlement see a locked paywall banner with an "Upgrade to unlock" CTA.

## UX Copy Intent
- Emphasize fast logging from already-saved meals.
- Keep the grams-to-nutrients outcome clear before confirmation.

## Design Structure (D-134)
- Route uses `DsScreen` shell with shared background and semantic DS color tokens.
- Because meal library rows use `FlatList`, route uses `DsScreen scrollable={false}` to avoid nested VirtualizedList containers.
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock behavior.
- Primary action hierarchy follows DS pill-button patterns and shared spacing/typography tokens.
- AI/paywall and quick-log/builder sections keep existing business logic and localization keys, with DS visual structure.

## User Actions
- Primary:
  - View saved custom meal list.
  - Select a meal and enter consumed grams.
  - Confirm and save quick log entry.
  - Tap "Analyze with AI" in the quick-log panel to pre-fill nutrition via photo analysis (entitlement-gated, SC-219, D-132).
  - Tap "Upgrade to unlock" to open native RevenueCat paywall when entitlement is not active.
- Secondary:
  - Open meal builder to create/edit meal.
  - Open share action for owned recipes.

## States
- Loading: fetch custom meal library.
- Empty: no saved meals yet.
- Error: fetch/log save failure.
- Success: log saved and daily nutrition totals updated.

## Validation Rules
- Consumed grams must be greater than zero.
- Proportional nutrient calculation must execute before save confirmation.
- Share action is available for recipes owned by current account.

## Data Contract
- Inputs:
  - Custom meal definition.
  - Consumed grams.
- Outputs:
  - Portion log entry with nutrition snapshot.
  - Updated daily totals in nutrition tracking.
  - Deep link navigation target for shared recipe confirmation flow.

## Edge Cases
- Consumed grams greater than meal total grams should still calculate correctly.
- If meal is edited later, old logs keep previous nutrition snapshot.
- Imported shared recipes are treated as recipient-owned and remain after source deletion.

## Copy Draft (Initial)
- Empty title: `No custom meals yet`
- Empty helper: `Create your first custom meal to log portions in seconds.`
- Quick log helper: `Enter grams consumed. We calculate calories and macros automatically.`
- CTA log: `Log meal`
- CTA share: `Share recipe`

## Links
- Functional requirement: FR-139, FR-140, FR-141, FR-142, FR-143, FR-144, FR-147, FR-150
- Use case: UC-003.2, UC-003.3, UC-003.4, UC-003.6, UC-003.9
- Acceptance criteria: AC-403, AC-404, AC-405, AC-406, AC-407, AC-408, AC-411, AC-413
- Business rules: BR-304, BR-305, BR-306, BR-307, BR-308, BR-309, BR-310, BR-313, BR-316
- Test cases: TC-404, TC-405, TC-406, TC-407, TC-408, TC-409, TC-412, TC-414, TC-415
- Decisions: D-132 (AI paywall gate — `useSubscription` wired; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` threaded through `QuickLogPanel` → `QuickLogAnalysisRow`)
- Related screen: SC-219 (AI Meal Photo Analysis)
- Diagram: docs/diagrams/domain-relationships.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
