# MyChampions — Bounded Context Glossary

This file is the canonical domain language for MyChampions.
No implementation details. No specs. Pure terminology.

---

## Roles

**Student**
A user who receives nutrition and/or training plans and tracks daily adherence. Can operate in self-managed mode (no professional attached) or under one or two active professional assignments simultaneously. Role is set at onboarding and is immutable — switching requires a new account.

**Professional**
A user who authors and assigns plans to students. Holds one or both Specialties. Role is set at onboarding and is immutable.

**Specialty**
A domain of care a Professional is certified to provide. Values: `nutritionist`, `fitness_coach`. A Professional must always hold at least one Specialty. A second Specialty can be added post-onboarding via settings. A Specialty can only be removed when it has no active or pending students and at least one Specialty remains.

---

## Connections

**Connection**
A relationship between one Professional and one Student scoped to a single Specialty. Lifecycle: `invited → pending_confirmation → active → ended`. A Student can hold at most one active Connection per Specialty at a time. A Professional with both Specialties can hold two simultaneous Connections with the same Student (one per Specialty).

**InviteCode**
A persistent, scoped code issued by a Professional for a specific Specialty (`nutritionist` or `fitness_coach`). A Professional with both Specialties holds two separate InviteCodes — one per Specialty. Each code has its own lifecycle (active/rotated/revoked) and is rotated independently. A Student submits a code to request a Connection for the Specialty that code represents. To connect under both Specialties, the Professional shares two codes and the Student submits both.

**Current implementation gap (2026-05-30):** `inviteCodes/{professionalUid}` is a single Firestore document with no `specialty` field. Decided storage shape: subcollection `professionals/{professionalUid}/inviteCodes/{specialty}` — one document per Specialty, keyed by the specialty string for direct `doc('nutritionist')` / `doc('fitness_coach')` access without queries. Each document has its own independent lifecycle.

**PendingRequest**
A Connection request submitted by a Student using an InviteCode, awaiting Professional confirmation. Scoped to the Specialty of the InviteCode used. Cap: 10 unique pending Students per Professional — a Student with two simultaneous PendingRequests (one per Specialty) counts as one toward the cap. Rotation of an InviteCode cancels only PendingRequests tied to that code's Specialty — cross-specialty PendingRequests from the same Student are unaffected.

---

## Plans

**NutritionPlan**
Authored by a Professional (assigned plan) or by the Student themselves (self-managed plan). Assigned plans are read-only to the Student. Self-managed plans are archived immediately when a professional connection becomes active for the same Specialty. When a Connection ends (by either party), the assigned plan for that Specialty is automatically archived and the Student's self-managed plan (if one exists) is restored as the Effective Plan.

**TrainingPlan**
Same governance as NutritionPlan. No fixed domain workout fields enforced by the app beyond storage metadata.

**Draft Assigned Plan**
An assigned plan document (`sourceKind: 'assigned'`) created in a draft state (`isDraft: true`). Scoped to a specific student connection, owned by the professional, and invisible to the student until published (`isDraft` updated to `false`).

**Effective Plan**
The plan that governs a Student's active tracking for a given Specialty. Assigned plan takes precedence over self-managed plan while the Connection is active. Draft assigned plans are invisible to the Student and cannot be the Effective Plan. When a Connection ends, the assigned plan is archived and the most recent self-managed plan (if one exists) becomes the Effective Plan. If no self-managed plan exists, the Student enters the empty-state for that Specialty — no scaffold is auto-generated.

**PlanChangeRequest**
An advisory request authored by a Student asking their Professional to change something in an assigned plan. Does not grant the Student edit rights. Lifecycle: `pending → reviewed | dismissed`. The Professional resolves the request separately by editing the plan directly. A PlanChangeRequest survives Connection end — it remains `pending` until the Professional explicitly reviews or dismisses it.

**CustomMeal**
A user-owned, reusable meal record with proportional macro scaling per portion. Shareable via copy-on-save link — the recipient gets an independent copy at save time, owned by them. The sharer's original is unaffected. Sharing is identity-agnostic: a Professional sharing a meal with a Student follows the same model as any user sharing with any other user. Connection end has no effect on already-copied meals.

---

## Tracking & Visibility

**TrackingLog**
Daily adherence records authored by the Student (meal logs, workout logs). Owned by the Student — not scoped to any plan or Connection. A Professional's read access is scoped by Specialty: an active `nutritionist` Connection grants read access to `mealLogs` only; an active `fitness_coach` Connection grants read access to `workoutLogs` only. Read access expires when the Connection for that Specialty ends. A dual-specialty Professional with both Connections active can read both log types, but each access path is independently revoked when its Specialty Connection ends.

**StudentRosterSummary**
Aggregate counts shown on the Professional dashboard. Counts are by unique Students, not by Connection records. A Student with two active Connections (one per Specialty) counts as one active student. Fields: `activeCount`, `pendingCount`. No Specialty breakdown on the dashboard — the roster view handles per-specialty filtering.

**Professional Subscription**
RevenueCat-managed entitlement. Free tier: up to 10 active students. Paid tier (`professional_pro`): unlimited. Cap enforcement is by unique active student accounts per Professional, regardless of how many Specialties they share with each student. Adding a second Specialty Connection to an already-active student does not increment the cap count — the student is already on the roster.

**Student Subscription**
Free tier covers all core tracking. `student_pro` unlocks AI meal photo analysis.

---

## Notifications

**Notification rules**
- Student submits invite code → Professional is notified (pending request arrived).
- Professional confirms or dismisses a PendingRequest → Student is notified, scoped to that Specialty.
- Student submits a PlanChangeRequest after a Connection ends → Professional is still notified. The professional still owes a review regardless of connection state.
- Each Connection confirmation is an independent notification event — a Professional confirming two pending requests from the same Student (one per Specialty) produces two separate notifications to the Student, one per Specialty.
