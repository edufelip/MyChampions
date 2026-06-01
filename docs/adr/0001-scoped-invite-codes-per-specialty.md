# Scoped InviteCodes per Specialty

A Professional with two Specialties must be able to invite a Student to one Specialty only, to both, or let the Student choose. We decided that the Professional creates scoped codes — one InviteCode per Specialty — rather than one neutral code where the Student picks the scope at submission time. A Student submits each code independently; submitting both results in two separate PendingRequests and ultimately two Connections.

**Storage shape:** subcollection `professionals/{professionalUid}/inviteCodes/{specialty}` — one document per Specialty, keyed by the specialty string (`nutritionist` | `fitness_coach`) for direct doc access without a query. Each document has its own independent lifecycle (active / rotated / revoked).

**Considered options:**
- Option A (rejected): one neutral code, Student chooses specialty at submission. Simpler code management for the Professional but loses the Professional's intent — they should control which specialties a Student can connect under.

**Consequences:**
- `inviteCodes/{professionalUid}` top-level single-document model must be replaced by the subcollection shape before release; no compatibility migration is required because the app is not live.
- `rotateInviteCode` must be scoped to a single Specialty — it currently cancels all pending connections for the Professional regardless of specialty (bug).
- `isPendingCapReached` counts raw PendingRequest documents; must be rewritten to count unique pending Students instead (cap is 10 unique students, not 10 documents).
- Firestore security rules that read from `inviteCodes` must be updated to query the subcollection path.
