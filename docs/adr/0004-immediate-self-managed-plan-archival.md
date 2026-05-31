# ADR 0004: Immediate Self-Managed Plan Archival on Connection Active

## Context & Status
- **Date**: 2026-05-31
- **Status**: Accepted
- **Deciders**: Antigravity, USER

When a Connection between a Student and a Professional becomes active (e.g. at the confirmation time when the Professional accepts the Student's invite code), there is a transition from self-managed care to professional care. 

In `CONTEXT.md` and the existing design, we had two potential approaches for when a Student's self-managed plan should be archived:
- **Option A (Immediate Archival)**: Archive the self-managed plan immediately when the connection status transitions to `active`.
- **Option B (Archival on Publish)**: Archive the self-managed plan only after the professional publishes their first assigned plan (`isDraft: false`), allowing the student to use their own plan as a bridge.

## Decision
We chose **Option A: Immediate Archival**.

The moment a Connection transitions to `active` (`confirmPendingConnection` in `connection-source.ts`), the student's active self-managed plan for that Specialty is immediately marked as archived (`isArchived: false` -> `isArchived: true` in Firestore). 

## Rationale & Trade-offs
- **Strict Governance Boundary**: Immediate archival enforces a clear boundary. Once a student is actively connected to a professional for a specialty, they are strictly under that professional's care. Following a self-managed plan during the professional's drafting phase is disallowed to prevent conflicting routines.
- **Temporary Empty State**: If the professional takes time to publish the first custom assigned plan, the student temporarily enters the "connection active, no active plan assigned yet" state. This acts as a clear visual signal to the student that they are awaiting their professional's plan.
- **Transactional Consistency**: Archiving the self-managed plan inside the connection confirmation transaction prevents any race conditions or inconsistent states where a student is simultaneously connected to a professional but actively executing their own self-guided plan.

## Consequences
- `confirmPendingConnection` in `connection-source.ts` must query for non-archived `self_managed` plans for that student and specialty, and set `isArchived: true` inside the confirmation transaction.
- The student's tracking tabs (`SC-209` / `SC-210`) will transition to show the pending plan assignment empty-state/notice if no published assigned plan exists yet.
