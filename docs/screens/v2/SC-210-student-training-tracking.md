# SC-210 Student Training Tracking (V2)

## Route
- `/student/training/today`

## Objective
- Let students track daily workout completion and session progress for assigned or self-managed plans.

## User Actions
- Primary:
  - Open current session plan.
  - Mark session/task completion.
  - Submit training plan-change request for assigned plans.
- Secondary:
  - Review prior session history and adherence trend.

## States
- Loading: fetch training plan context and today progress data.
- Empty: no active training assignment; show illustrated acquisition empty state with direct coach-hiring CTA and secondary self-guided continuation action.
- Error: tracking update failure.
- Success: completion state and progress summary updated.

## Validation Rules
- If training plan is professionally assigned, student cannot edit plan structure.
- If no active fitness coach, self-managed training plan is allowed.
- Student may submit change request while assigned-plan structure remains locked.
- Offline mode must show persistent banner and explicit write-lock reasons for blocked mutations.

## Data Contract
- Inputs:
  - Active training plan context (assigned or self-managed).
  - Student completion/progress events.
- Outputs:
  - Persisted tracking events.
  - Updated progress indicators.

## Edge Cases
- If assignment ends, assigned plan history remains accessible per retention policy.
- If no plan exists, primary CTA routes to professional connection management and secondary CTA preserves self-guided continuation.

## Copy Draft (Current)
- Screen title: `Workouts`
- Calendar action: `Open calendar`
- Assigned-plan summary title: `Today's guided plan`
- Assigned-plan summary helper: `Your coach assigned a training structure. Track completion and request adjustments below.`
- Empty state title: `No workouts found`
- Empty state helper: `You don't have a personalized workout plan yet. Hire a personal trainer to receive a routine tailored to your goals.`
- Empty-state CTA: `Hire a trainer`
- Secondary empty-state CTA: `Continue self-guided`

## Links
- Functional requirement: FR-113, FR-116, FR-123, FR-135, FR-211, FR-214
- Use case: UC-002.4, UC-002.5, UC-002.13, UC-002.17
- Acceptance criteria: AC-210, AC-216, AC-222, AC-225, AC-255, AC-257
- Business rules: BR-208, BR-215, BR-222, BR-226, BR-269, BR-272
- Test cases: TC-210, TC-216, TC-223, TC-226, TC-259, TC-261
- Diagram: docs/diagrams/role-journey-flow.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
