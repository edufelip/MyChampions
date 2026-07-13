# Scoped InviteCodes per Specialty

A Professional with two Specialties must be able to invite a Student to one Specialty only, to both, or let the Student choose. We decided that the Professional creates scoped codes — one InviteCode per Specialty — rather than one neutral code where the Student picks the scope at submission time. A Student submits each code independently; submitting both results in two separate PendingRequests and ultimately two Connections.

**Storage shape:** server-owned `invite_codes` rows scoped by `professionalUid` + `specialty` — one active code per Professional Specialty, keyed by the specialty string (`nutritionist` | `fitness_coach`) through repository lookup helpers. Each row has its own independent lifecycle (active / rotated / revoked).

**Considered options:**
- Option A (rejected): one neutral code, Student chooses specialty at submission. Simpler code management for the Professional but loses the Professional's intent — they should control which specialties a Student can connect under.

**Consequences:**
- The old one-code-per-professional model must be replaced by the scoped row model before release; no compatibility migration is required because the app is not live.
- `rotateInviteCode` must be scoped to a single Specialty and the server repository must cancel only pending connections created from the rotated Specialty code.
- Pending-cap checks count unique pending Students for the Professional/Specialty scope, not raw request rows.
- MyChampions server routes must authorize invite-code reads, creation, rotation, and submission before repository mutation.
