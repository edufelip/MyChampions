# SC-203 Student Home Dashboard (V2)

## Route
- `/student/home`

## Objective
- Provide the student a unified view of active assignments, assigned/self-managed plans, and daily progress.

## UX Copy Intent
- Reinforce that self-guided tracking is valid with or without professional connection.
- Avoid presenting no-professional states as blocked states.
- Lead with a personalized return cue and the student's day; relationship management is an explicit secondary action, not the page title.

## User Actions
- Primary:
  - Open nutrition and training daily tracking flows.
  - Open hydration tracking summary card.
  - Open custom meal library and builder.
  - View assigned plans (read-only).
  - Open professional relationship management.
- Secondary:
  - View archived self-managed plans (if applicable).
  - Open account/privacy settings.

## States
- Loading: wait for assignments, plans, and current-day tracking sources to settle on the initial load.
- Empty: no active plans in one or both specialties; present self-guided quick-start actions.
- Partial error: identify the failed source and offer a source-specific retry while keeping successful dashboard sections usable.
- Success: dashboard cards, hydration status, and progress indicators available.

## Validation Rules
- If professional-assigned plan exists, student edits are blocked.
- If no active professional for specialty, student can start self-managed flow.
- Empty-state copy must include explicit non-blocking message and direct CTA to self-guided tracking.
- Nutrition section is rendered above training section in home layout priority.
- Pending connection state is displayed prominently near top summary area.
- Offline state must show persistent read-only banner and explicit write-lock reason for blocked actions.
- Hydration summary reflects effective water-goal ownership rules (nutritionist override when applicable).
- A connection, plan, or hydration failure must not replace independently loaded content with a full-screen generic error.
- Training and nutrition action cards stack below 768px and share one equal-width row at tablet and desktop widths.

## Copy Draft (Initial)
- No-professional card title: `No professional connected yet`
- No-professional card body: `You can still start tracking today on your own.`
- Nutrition CTA: `View Plan` (active) / `Start on my own` (empty)
- Training CTA: `Start Training` (active) / `Start on my own` (empty)
- Hydration card title: `Hydration`
- Pending status pill: `Pending Connection`
- Return cue: `Welcome back`
- Dashboard heading: `Your day`
- Dashboard helper: `Your plans and progress at a glance.`
- Offline mode title: `Offline Mode`
- Hydration progress helper: `{consumed} / {goal} ml`
- Offline stale badge: `Data may be outdated`
- Offline last-sync meta: `Last updated: {datetime}`
- Offline banner: `You're offline. You can view cached data, but updates are locked until connection returns.`
- Write-lock helper: `Connect to the internet to save changes.`

## Implementation Snapshot (2026-03-05)
- `app/student/home.tsx` now follows the dashboard-style composition from the provided visual reference:
  - Profile return cue plus a labeled relationship-management action; no fabricated notification indicator.
  - Horizontal weekly stats cards.
  - Highlighted workout hero card.
  - Next-meal preview card.
  - Persistent manage-professionals action at the bottom.
- Mocked dashboard values were removed:
  - Stats cards now derive from live hook state (`usePlans`, `useWaterTracking`) instead of fixed placeholders.
  - Training and nutrition cards now render helper/tag copy conditionally based on actual active-plan availability.
  - Source-specific error cards preserve successful plan, hydration, and relationship content and retry only the failed source.
  - The full-dashboard loading gate applies only until every source completes its first attempt. Later source-specific retries may return that source to `loading`, but keep independently successful dashboard sections visible.
  - Compact phone layouts use a two-column plan summary plus full-width hydration summary instead of squeezing three cards into one row.
  - Tablet and desktop layouts place the training and nutrition action cards in one equal-width row so image-led actions remain scannable without stretching excessively.
  - A no-professional empty-state card is rendered when no active professional connection exists.
- Existing behavior constraints remain preserved:
  - Offline banner/write-lock behavior is still applied (BL-008).
  - Pending connection state remains prominent near the top.
  - Hydration stat still reflects effective-goal ownership rules (D-081).
  - Workout and nutrition hero-card taps switch to their bottom-tab routes (`/(tabs)/training`, `/(tabs)/nutrition`) so the tab shell remains visible.
  - The labeled `My coaches` action routes to Relationship Management (`/student/professionals`).
  - Navigation intents still route to training, nutrition, professionals, and account/settings.

## Data Contract
- Inputs:
  - Student account id.
  - Active assignments by specialty.
  - Pending assignment requests and statuses.
  - Assigned/self plan summaries.
  - Hydration daily logs + effective goal metadata.
  - Daily intake/workout logs.
- Outputs:
  - Navigation intents to tracking, relationships, and settings screens.
  - Hydration card status (`on_track`, `goal_met`, `below_goal`) and streak preview.
  - Bottom-navigation routing intents: home, nutrition, training, recipes, account/settings.

## Edge Cases
- Assignment ended recently: history remains visible per policy.
- Pending assignment should not be treated as active for plan ownership.
- Offline mode allows cached read-only summary; write CTAs display connectivity-required messaging.
- Cached data older than 24 hours must show stale indicator and last-sync timestamp.
- If nutritionist goal override is removed, dashboard hydration card reverts to student personal goal baseline.
- If a tab wrapper is rendered while role hydration is temporarily unavailable, shell fallback redirects to `/auth/role-selection` and avoids blank tab content.
- Deterministic native validation launches a fresh unsynchronized app instance for each dashboard case so fixture state and Detox idling resources cannot leak across reloads.

## Links
- Functional requirement: FR-113, FR-114, FR-115, FR-116, FR-123, FR-130, FR-135, FR-141, FR-183, FR-186, FR-187, FR-189, FR-191, FR-214, FR-217, FR-218, FR-219, FR-220, FR-221, FR-222
- Use case: UC-002.3, UC-002.4, UC-002.5, UC-002.17, UC-002.18, UC-002.19
- Acceptance criteria: AC-209, AC-210, AC-216, AC-222, AC-225, AC-242, AC-243, AC-245, AC-247, AC-257, AC-259, AC-260, AC-261, AC-262, AC-263, AC-405, AC-512
- Business rules: BR-207, BR-208, BR-215, BR-222, BR-226, BR-245, BR-248, BR-250, BR-252, BR-272, BR-275, BR-276, BR-277, BR-278, BR-279, BR-280, BR-307
- Test cases: TC-209, TC-210, TC-216, TC-223, TC-226, TC-244, TC-245, TC-246, TC-248, TC-261, TC-264, TC-265, TC-266, TC-267, TC-300, TC-406, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
