# Plan archival on connection end

When a Connection ends (by either party), the assigned plan for that Specialty is automatically archived. The Student's most recent self-managed plan associated with that ended professional-care period (if one exists) becomes the Effective Plan. If no self-managed plan exists for that restoration boundary, the Student enters the empty-state — no scaffold is auto-generated.

We rejected Option A (plan stays active, read-only) because it leaves the Student following a stale plan the Professional can no longer update, with no clear signal that the plan is frozen. We rejected Option C (Student chooses at end time) because it adds friction to what should be a clean boundary — the professional relationship ended, the professional's plan should end with it.

**Consequences:**
- `endConnection` in `connection-source.ts` currently only sets `status: 'ended'`. It must be extended to also archive the assigned plan for the relevant Specialty and restore the most recent self-managed plan associated with the ending Connection.
- The archival + restore must run inside the same Firestore transaction as the connection end to avoid partial state.
