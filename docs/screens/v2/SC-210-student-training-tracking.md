# SC-210 Student Training Tracking (V2)

## Route
- `/student/training/today`

## Objective
- Let students track daily workout completion and session progress for assigned or self-managed plans.

## User Actions
- Primary:
  - Open current session plan.
  - Mark session/task completion.
  - Expand or collapse each workout session's details with one dedicated control; it exposes a localized label and expanded state to assistive technology and provides a minimum 44×44 CSS px touch/focus target.
  - Submit training plan-change request for assigned plans.
- Secondary:
  - Review prior session history and adherence trend.

## States
- Loading: fetch training plan context and today progress data.
- Empty, no coach: no active fitness-coach Connection and no Self-Managed Plan; show illustrated acquisition empty state with direct coach-hiring CTA and secondary self-guided action that opens Self-Managed Plan creation.
- Waiting for coach plan: active fitness-coach Connection exists, but no published assigned training plan exists yet; show a non-editable waiting state that explains the coach is preparing the plan. Do not reveal draft plan title, sessions, or exercise items, and do not offer self-guided creation or editing while the active Connection exists.
- Error: tracking update failure.
- Success: completion state and progress summary updated.
- Plan context and plan-change request actions are consumed through centralized plans store via `usePlans`.
- On narrow phones, the assigned-session title and exercise count receive the full card width; completion/log controls move to a second aligned row so long session names never collapse into single-character wrapping.
- Tablet and desktop tracking content uses the centered `content` lane rather than the wide workbench lane.

## Validation Rules
- If training plan is professionally assigned, student cannot edit plan structure.
- If no active fitness coach, a Self-Managed Plan is allowed.
- If an active fitness-coach Connection exists, Self-Managed Plan creation/editing is not allowed even when no assigned plan has been published yet.
- Student may submit change request while assigned-plan structure remains locked.
- Offline mode must show persistent banner and explicit write-lock reasons for blocked mutations.

## Data Contract
- Inputs:
  - Active training plan context (assigned or self-managed).
  - Student completion/progress events.
- Outputs:
  - Persisted tracking events. Workout completion logs are written/read through the MyChampions server for local bearer-auth sessions; missing local server auth fails closed outside the assigned-training E2E fixture.
  - Updated progress indicators.

## Edge Cases
- If assignment ends, assigned plan history remains accessible per retention policy and the latest Self-Managed Plan is restored when one exists.
- If no plan exists and no active fitness-coach Connection exists, primary CTA routes to professional connection management and secondary CTA routes to Self-Managed Plan creation.
- If an active fitness-coach Connection exists but no published assigned plan exists yet, show a waiting-for-coach-plan state and hide the self-guided creation CTA.
- Empty-state self-guided CTA routes to `/student/training/plans/new` so students can start a personal workout plan without a coach.
- Student self-guided builder entry uses student-branded titles/actions (for example, `Create my workout plan`, `Save my plan`).

## Copy Draft (Current)
- Screen title: `Workouts`
- Calendar action: `Open calendar`
- Assigned-plan summary title: `Today's guided plan`
- Assigned-plan summary helper: `Your coach assigned a training structure. Track completion and request adjustments below.`
- Empty state title: `No workouts found`
- Empty state helper: `You don't have a personalized workout plan yet. Hire a personal trainer to receive a routine tailored to your goals.`
- Empty-state CTA: `Hire a trainer`
- Secondary empty-state CTA: `Create my workout plan`

## Links
- Functional requirement: FR-113, FR-116, FR-123, FR-135, FR-211, FR-214
- Use case: UC-002.4, UC-002.5, UC-002.13, UC-002.17
- Acceptance criteria: AC-210, AC-216, AC-222, AC-225, AC-255, AC-257
- Business rules: BR-208, BR-215, BR-222, BR-226, BR-269, BR-272
- Test cases: TC-210, TC-216, TC-223, TC-226, TC-259, TC-261
- Diagram: docs/diagrams/role-journey-flow.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
