# SC-205 Student Roster (V2)

## Route
- `/professional/students`

## Objective
- Allow professionals to browse and select managed students for follow-up and plan actions.

## Design Structure (D-134)
- Screen shell uses `DsScreen` with blob background and themed canvas.
- Search/filter controls are grouped in a top `DsCard` with pill-style filter chips.
- Roster rows are rendered inside a dedicated `DsCard` list container using DS spacing/radius/typography tokens.
- Offline state uses `DsOfflineBanner`; all copy remains localization-key driven.

## User Actions
- Primary:
  - Browse linked student list.
  - Filter/search roster.
  - Filter/search pending requests queue.
  - Select multiple pending requests and run bulk deny.
  - Select multiple active students and start predefined-plan bulk assignment flow.
  - Open student profile.
- Secondary:
  - View assignment state badges (pending/active/ended).

## States
- Loading: fetch paginated roster data.
- Empty: no students linked.
- Error: fetch/search failure.
- Success: roster list with actionable entries.

## Validation Rules
- Only students linked to professional should be visible.
- Ended relationships remain in history view but not in active roster default filter.
- Pending-queue filtering/search cannot expose records outside professional scope.
- Bulk deny can operate only on `pending_confirmation` requests and must preserve lifecycle audit metadata.
- Bulk assignment target list must include only active students eligible for selected plan domain.

## Data Contract
- Inputs:
  - Professional id.
  - Assignment state records.
  - Search/filter query.
- Outputs:
  - Selected student context for detail screen.
  - Bulk deny result summary and updated pending counters.
  - Bulk assignment target selection payload.

## Edge Cases
- Large client list should support paging/virtualization.
- Concurrent unbind can remove student from active list in-session.

## Links
- Functional requirement: FR-105, FR-122, FR-210, FR-224, FR-225
- Use case: UC-002.2, UC-002.5, UC-002.12, UC-002.20
- Acceptance criteria: AC-206, AC-215, AC-254, AC-265
- Business rules: BR-206, BR-214, BR-268, BR-283
- Test cases: TC-206, TC-215, TC-257, TC-258, TC-269
- Diagram: docs/diagrams/domain-relationships.md
