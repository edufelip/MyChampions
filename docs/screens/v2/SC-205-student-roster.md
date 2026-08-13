# SC-205 Student Roster (V2)

## Route
- `/professional/students`

## Objective
- Allow professionals to browse and select managed students for follow-up and plan actions.

## Design Structure (D-134)
- Screen shell uses `DsScreen` with blob background and themed canvas.
- SC-205 adopts the SC-204 professional surface baseline with a top hero header and stronger vertical hierarchy.
- Hero header is rendered as an elevated card with contextual `groups` icon and compact helper copy.
- Because roster rows use `FlatList`, SC-205 sets `DsScreen scrollable={false}` so VirtualizedList windowing remains valid (no nested ScrollView).
- Empty roster state uses a centered hero illustration (soft glow + group-add icon), headline/body copy, and two stacked CTAs.
- Search/filter controls are grouped in an elevated `DsCard` with search icon input and pill-style filter chips.
- Roster rows are rendered inside a dedicated `DsCard` list container using DS spacing/radius/typography tokens, initial-avatar chips, status pills, and trailing chevrons.
- Offline state uses `DsOfflineBanner`; all copy remains localization-key driven.
- `/professional/pending` queue follows the same shell, card, and pill-action structure for search, selection, and bulk deny flows.
- Selection mode uses an inset elevated action tray with horizontal and bottom clearance around the plan-type chips and assignment CTA.
- The pending queue begins with an informative summary card that explains the decision, exposes the pending count, and keeps search and request actions in separate task groups.

## User Actions
- Primary:
  - Browse linked student list.
  - In empty state, start the first-student flow via CTA to `/professional/home`.
  - In empty state, share invite link directly from SC-205 when invite code is available.
  - Filter/search roster.
  - Filter/search pending requests queue.
  - Select multiple pending requests and run bulk deny.
  - Select multiple active students and start predefined-plan bulk assignment flow.
  - Open student profile.
- Secondary:
  - View assignment state badges (pending/active/ended).

## States
- Loading: first roster fetch is in progress; list shell stays mounted with spinner.
- Empty: shown only after first fetch settles with zero visible students (no loading overlap).
- Error: a settled roster-read failure renders a dedicated error card (Retry + Back to dashboard) in place of the search/filter/bulk-assign shell. Search, filters, and Bulk assign plan are not mounted while this state is showing, so there is no dead control surface around the error copy. Retry re-invokes the roster load and shows the loading indicator before settling into error, empty, or the roster list. Preserved via `resolveStudentRosterViewState` in `features/professional/students-screen.logic.ts`, which is exclusive with the empty hero state — a stale roster is not shown read-only behind an error (open question, see below).
- Success: roster list with actionable entries.

## Validation Rules
- Only students linked to professional should be visible.
- Ended relationships remain in history view but not in active roster default filter.
- Pending-queue filtering/search cannot expose records outside professional scope.
- Bulk deny can operate only on `pending_confirmation` requests and must preserve lifecycle audit metadata.
- Bulk assignment target list must include only active students eligible for selected plan domain.
- Each plan-picker row exposes a stable semantic assignment control for native
  interaction. Native automation waits for the modal's presentation-complete
  signal before activating that control; viewport coordinates and fixed delays
  are not part of the selection contract.

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
- If invite code is missing/loading/error in empty state, share CTA falls back to `/professional/home` (no modal error copy).
- Transient auth/profile re-hydration must not remount the tab shell for the same authenticated UID.
- Open question (not yet resolved): whether a roster read error should fall back to a cached read-only roster when one exists, following the same stale-data policy as the professional dashboard, instead of always showing the error card. Currently any settled error hides the roster shell regardless of prior successful data.

## Links
- Functional requirement: FR-105, FR-122, FR-210, FR-224, FR-225
- Use case: UC-002.2, UC-002.5, UC-002.12, UC-002.20
- Acceptance criteria: AC-206, AC-215, AC-254, AC-265
- Business rules: BR-206, BR-214, BR-268, BR-283
- Test cases: TC-206, TC-215, TC-257, TC-258, TC-269, TC-269A, TC-301, TC-302
- Diagram: docs/diagrams/domain-relationships.md
