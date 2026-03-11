# UC-002 Role Onboarding And Care Management (Proposed)

## UC-002.0 Sign In And Create Account
- Primary actor: New or returning user.
- Trigger: User opens auth entry.
- Preconditions: App launched.
- Main flow:
  1. User chooses sign in or create account.
  2. User authenticates with email/password, Google, or Apple.
  3. If create-account via email/password, user provides name, email, password, and password confirmation.
  4. System validates password policy and confirmation match.
  5. If social email matches existing account, system links provider to existing account.
- Expected result: Authenticated session is created without duplicate-account creation for same email.

## UC-002.1 Select Role During Onboarding
- Primary actor: New user.
- Trigger: User completes sign-up and enters onboarding.
- Preconditions: Account created.
- Main flow:
  1. App asks user to choose Student or Professional.
  2. If Professional is selected, app asks for specialty: nutritionist, fitness coach, or both.
  3. App stores role profile and routes to corresponding journey.
  4. Role becomes immutable for that account.
- Expected result: User lands in role-appropriate home/dashboard.
- Alternate flow:
  - If account already has locked role, app auto-redirects to role-appropriate home and bypasses role-selection.

## UC-002.1b Optional Professional Verification
- Primary actor: New professional user.
- Trigger: Professional onboarding flow.
- Preconditions: User selected Professional role.
- Main flow:
  1. App requests optional `professional_registry` credential data per selected specialty.
  2. User can submit credential data or skip it.
  3. App allows onboarding completion in both cases.
- Expected result: Professional account is created even if credential data is skipped, and credential info visibility remains internal/assignment-scoped by policy.

## UC-002.1c Manage Professional Specialties After Onboarding
- Primary actor: Professional.
- Trigger: Professional updates specialty configuration.
- Preconditions: Professional account active.
- Main flow:
  1. Professional adds nutritionist and/or fitness-coach specialty as needed.
  2. Professional may remove a specialty only when no active or pending students exist for that specialty.
  3. System blocks any remove action that would leave the account with zero specialties.
- Expected result: Specialty set is updated without violating student-management constraints.

## UC-002.2 Professional Manages Multiple Students
- Primary actor: Professional.
- Trigger: Professional opens dashboard.
- Preconditions: Professional account active.
- Main flow:
  1. Professional views list of linked students.
  2. Professional selects one student.
  3. Professional assigns or customizes nutrition/training plan based on specialty.
  4. Student receives updated plan.
- Expected result: Student-specific plan is created or updated.

## UC-002.3 Student Connects To Professionals
- Primary actor: Student.
- Trigger: Student requests or accepts professional connection.
- Preconditions: Student authenticated.
- Main flow:
  1. Professional generates and shares invite code with student.
  2. Student enters invite code in app.
  3. System validates one-active-professional-per-specialty rule.
  4. System validates pending-request capacity (<= 10 pending for professional).
  5. System transitions assignment from `invited` to `pending_confirmation`.
  6. Professional confirms assignment.
  7. System transitions assignment from `pending_confirmation` to `active` when valid.
- Expected result: Student is linked to one active professional per specialty.
- Alternate flow:
  - Professional can revoke/regenerate invite code when leakage is suspected.
  - When invite code is regenerated, pending requests created from superseded code are auto-canceled.
- Additional result:
  - Student-facing professional credential snippet for active assignments exposes only `registry_id`, `authority`, and `country`.

## UC-002.4 Student Self-Managed Planning
- Primary actor: Student.
- Trigger: Student has no professional for one or both specialties.
- Preconditions: No active assignment for that specialty.
- Main flow:
  1. Student opens self-plan flow.
  2. Student defines macro/calorie targets and meals or training sessions.
  3. Student tracks daily adherence.
- Alternate flow:
  - If a professional assignment becomes active for that specialty, system archives the self-managed plan.
  - Professional can review archived self-managed plan only when student allows access.
- Expected result: Student can progress without a professional relationship.

## UC-002.5 End Relationship With History Retention
- Primary actor: Student or Professional.
- Trigger: Active assignment is ended.
- Preconditions: Active assignment exists.
- Main flow:
  1. User ends assignment per policy.
  2. System marks assignment inactive.
  3. System retains relationship and plan history.
- Expected result: Historical records remain accessible for auditing and continuity.

## UC-002.6 Professional Student-Cap Subscription Gate
- Primary actor: Professional.
- Trigger: Professional attempts to activate/manage an 11th active student.
- Preconditions: Professional has 10 active students and no active subscription entitlement.
- Main flow:
  1. Professional attempts operation that would exceed 10 active students (counted as unique active student accounts, regardless of specialties).
  2. System blocks the operation and presents subscription requirement.
  3. Professional purchases/restores subscription via store billing flow.
  4. RevenueCat entitlement is activated and synchronized.
  5. Professional retries operation and succeeds.
- Expected result: Student-cap policy is enforced and unlocks after valid subscription.
- Alternate flow:
  - If entitlement becomes inactive while professional is above cap, system blocks new activations and locks student-plan update actions until entitlement is restored.

## UC-002.7 Fully Custom Training Schema Authoring
- Primary actor: Fitness coach / professional.
- Trigger: Professional creates or edits a training template/plan.
- Preconditions: Professional authenticated and authorized for training management.
- Main flow:
  1. Professional defines structure and fields for sessions as desired.
  2. Professional saves template or assigns customized plan to a student.
  3. Student receives rendered plan in read-only mode if professionally assigned.
- Expected result: Training schema reflects professional-defined structure without hardcoded field restrictions.

## UC-002.8 Quick Self-Guided Start
- Primary actor: New or returning student-context user.
- Trigger: User chooses Student role in onboarding and proceeds.
- Preconditions: User authenticated and role not yet locked.
- Main flow:
  1. User selects Student role card and taps Continue.
  2. App commits `student` role for account.
  3. App routes user directly to self-managed tracking setup.
  4. User starts nutrition/training tracking without professional binding.
- Expected result: User reaches first-value tracking flow with minimum friction and no professional dependency.

## UC-002.9 Student Connects Via QR Invite Scan
- Primary actor: Student.
- Trigger: Student chooses QR scan in professional-connection flow.
- Preconditions: Camera permission granted and professional invite QR available.
- Main flow:
  1. Student opens QR scanner in relationship screen.
  2. App parses scanned invite payload.
  3. System runs same validation pipeline as manual invite entry.
  4. Assignment enters `pending_confirmation` when valid.
- Alternate flow:
  - If QR payload is invalid, app shows actionable error and allows retry/manual entry.
- Expected result: Student can initiate pending assignment with lower entry friction.

## UC-002.10 Contextual Error Recovery In Auth And Invite
- Primary actor: Student or professional user.
- Trigger: Auth or invite submission fails.
- Preconditions: User performs sign-in/sign-up/invite action.
- Main flow:
  1. System returns structured failure reason.
  2. UI resolves reason-specific copy and next action.
  3. User retries or takes recommended path (for example sign in, request new code, retry later).
- Expected result: Errors are understandable and actionable without ambiguous generic failure text.

## UC-002.11 Milestone A Analytics Emission
- Primary actor: System.
- Trigger: User executes Milestone A funnel actions.
- Preconditions: Analytics service enabled in environment.
- Main flow:
  1. System emits standardized events for auth entry, role selection, student self-guided start path, and invite submit/outcome.
  2. Events include required context properties (`surface`, `step`, `result`, optional `reason_code`).
  3. System redacts sensitive fields before transport/storage.
- Expected result: Product team can analyze conversion and failure funnels without leaking sensitive data.

## UC-002.12 Professional Pending Queue Operations
- Primary actor: Professional.
- Trigger: Professional opens pending requests queue.
- Preconditions: Professional has one or more pending student requests.
- Main flow:
  1. Professional opens pending queue view.
  2. Professional filters/searches pending entries.
  3. Professional selects multiple requests and executes bulk deny.
  4. System updates request states and refreshes pending counters.
- Expected result: Professional can operationally manage queue volume efficiently.

## UC-002.13 Student Requests Plan Changes
- Primary actor: Student.
- Trigger: Student identifies needed adjustment in assigned plan.
- Preconditions: Student has professional-assigned nutrition or training plan.
- Main flow:
  1. Student opens assigned plan.
  2. Student submits structured change request with reason/context.
  3. System stores request and notifies assigned professional.
  4. Professional reviews request in student-management context.
- Expected result: Student can request adjustments while assigned plan remains read-only.

## UC-002.14 Professional Starts From Starter Templates
- Primary actor: Professional.
- Trigger: Professional starts creating a nutrition or training plan.
- Preconditions: Professional is authenticated and has relevant specialty.
- Main flow:
  1. Professional opens starter template library.
  2. Professional selects a starter template.
  3. System clones starter into editable draft.
  4. Professional customizes and assigns template to student.
- Expected result: Professional plan authoring is accelerated with standardized starting points.

## UC-002.15 Subscription Pre-Lapse Warning
- Primary actor: Professional.
- Trigger: Entitlement risk window is detected before subscription lapse lock.
- Preconditions: Professional is near or above cap and entitlement is nearing inactive state.
- Main flow:
  1. System evaluates entitlement and cap state.
  2. System surfaces pre-lapse warning in professional surfaces.
  3. Professional is offered renew/restore path before lock.
- Expected result: Professional receives early warning and recovery path before write lock.

## UC-002.16 Specialty Removal Assist
- Primary actor: Professional.
- Trigger: Professional attempts to remove specialty blocked by active/pending links.
- Preconditions: Specialty removal action is blocked by policy.
- Main flow:
  1. System shows blocked-state explanation.
  2. System provides direct actions to view and resolve blocking records.
  3. Professional resolves blockers (for example deny pending, unbind active where allowed).
  4. Professional retries specialty removal.
- Expected result: Blocking rules remain enforced while resolution path is straightforward.

## UC-002.17 Offline Read-Only Clarity
- Primary actor: Student or professional.
- Trigger: User interacts with app while offline.
- Preconditions: Device is offline and cached session/content exists.
- Main flow:
  1. App shows persistent offline/read-only banner.
  2. User attempts a write action.
  3. App blocks write and displays explicit reason with retry guidance.
- Expected result: User understands offline state and blocked writes are not mistaken for app defects.

## UC-002.18 Accessibility Baseline Interaction
- Primary actor: Student or professional using accessibility features.
- Trigger: User navigates core journeys with screen reader, large text, or keyboard/focus navigation.
- Preconditions: Core screens are loaded in authenticated or onboarding contexts.
- Main flow:
  1. User enables larger text and opens core screens.
  2. UI scales without clipping critical controls/content.
  3. User navigates interactive elements in logical focus order.
  4. Screen reader announces meaningful labels for key controls and status text.
- Expected result: Core flows remain usable with baseline accessibility support.

## UC-002.19 Water Goal And Intake Tracking
- Primary actor: Student (and assigned nutritionist for goal authoring in plan builder).
- Trigger: Student tracks hydration or creates/edits nutrition plan.
- Preconditions: User authenticated; nutrition plan exists or is being created.
- Main flow:
  1. Student or nutritionist defines daily water goal during nutrition plan creation/edit.
  2. Student opens hydration tracker and logs daily water intake.
  3. App resolves effective goal from active nutrition plan context (assigned first, otherwise self-managed).
  4. App computes completion status and streak progression against effective target.
- Expected result: Hydration tracking and streaks reflect plan-defined water goals and active assignment precedence.

## UC-002.20 Professional Predefined Plans And Bulk Assignment
- Primary actor: Professional.
- Trigger: Professional wants to reuse plan patterns across multiple students.
- Preconditions: Professional authenticated with relevant specialty; target students available.
- Main flow:
  1. Professional creates named predefined plan in private library (for example, `Caloric Deficit A`).
  2. Professional selects one predefined plan and chooses multiple students for assignment.
  3. System clones plan into per-student draft copies.
  4. Professional fine-tunes each student draft as needed.
  5. Professional confirms assignments.
- Expected result: Multiple students receive independent assigned plan copies with optional per-student adjustments.

## UC-002.22 SC-208 Exercise Search Via Proxy Service
- Primary actor: Professional.
- Trigger: Professional searches and previews exercises while editing a training plan.
- Preconditions: Professional authenticated and SC-208 is open.
- Main flow:
  1. Professional opens exercise search in SC-208.
  2. App calls `POST /proxy` on `https://exerciseservice.eduwaldo.com` with normalized `lang` and generated `x-request-id`.
  3. Proxy service translates search intent/fields as needed and calls upstream YMove endpoint.
  4. App renders localized search results and allows selecting one exercise.
  5. App stores only `exerciseId` in local draft/persistence; URLs are fetched on demand for display.
- Alternate flow:
  - If proxy returns non-success, UI shows search error state and allows retry.
  - If selected item thumbnail fetch fails, UI falls back to placeholder image.
- Expected result: Exercise search works without exposing upstream API key in client runtime.

## UC-002.21 Accept Terms Before Onboarding Continuation
- Primary actor: New or returning authenticated user.
- Trigger: User completes sign-in or create-account.
- Preconditions: Firebase Auth session is active.
- Main flow:
  1. App routes user to terms acceptance screen.
  2. User opens legal link and reviews terms.
  3. User checks acceptance box and confirms.
  4. System stores accepted terms version for this user.
  5. Route guard continues user to role-selection (if role unlocked) or role home (if role locked).
- Alternate flow:
  - If required terms version changes, user is re-routed to terms gate until new version is accepted.
- Expected result: Onboarding and role journeys only continue after required terms version acceptance.

## UC-003.9 Capture Meal Photo For AI Macronutrient Estimation
- Primary actor: Student (or professional).
- Trigger: User opens the camera entry point within SC-214 (Custom Meal Builder) or SC-215 (Custom Meal Library Quick Log).
- Preconditions: User is authenticated; camera permission granted or requested.
- Main flow:
  1. User taps the camera/AI analysis CTA in the meal form (SC-214) or quick-log panel (SC-215).
  2. App opens device camera (or image picker).
  3. User captures or selects a photo of the meal.
  4. App compresses the photo client-side (≤1.5 MB / ≤1600 px per FR-202 / FR-230).
  5. App sends compressed base64 image to Firebase Cloud Function proxy (`analyzeMealPhoto`).
  6. Cloud Function validates Firebase Auth ID token and calls OpenAI GPT-4o Vision.
  7. Cloud Function returns structured macro estimates (calories, carbs, proteins, fats, totalGrams, confidence).
  8. App pre-fills the relevant form fields with the returned estimates.
  9. App displays AI disclaimer: results are estimates and should be verified.
  10. User reviews and optionally edits the pre-filled values.
  11. In SC-214: user may optionally attach the captured photo to the meal image record.
  12. User confirms save (SC-214) or log (SC-215).
- Alternate flows:
  - If camera permission is denied, app shows permission guidance.
  - If Cloud Function returns an error (network/quota/unrecognizable), app shows reason-specific recoverable error; user can dismiss and fill fields manually.
  - If user declines photo attachment in SC-214, meal is saved without image.
- Expected result: Meal form or quick-log panel is pre-filled with AI-estimated macro values; user confirms and saves/logs.

(End of file - total 265 lines)
