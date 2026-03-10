# AC-002 Role Journeys And Plan Ownership (Proposed)

## Feature
Role-based onboarding and dual journey model for Students and Professionals.

## Acceptance Criteria
- `AC-201`: New users must select Student or Professional before accessing the main product journey.
- `AC-202`: Professional users must choose at least one specialty (nutritionist or fitness coach).
- `AC-203`: Students cannot have more than one active nutritionist at any time.
- `AC-204`: Students cannot have more than one active fitness coach at any time.
- `AC-205`: A professional with both specialties can be assigned to a student in both roles.
- `AC-206`: Professionals can view and manage multiple student profiles.
- `AC-207`: Nutritionists can create templates and customized plans with calorie and macro targets.
- `AC-208`: Fitness coaches can create templates and customized training plans.
- `AC-209`: Students can track daily calories and macronutrients.
- `AC-210`: Students without an active professional in a specialty can create their own plan for that specialty.
- `AC-211`: Role cannot be changed after account creation; role switch requires a new account.
- `AC-212`: Professional onboarding allows optional credential submission and does not require verification workflow in MVP.
- `AC-213`: Assignment initiation must happen through professional invite code.
- `AC-214`: Assignment only becomes active after professional confirmation.
- `AC-215`: Ended assignments and linked plans remain in history.
- `AC-216`: Students can only read professionally assigned plans; editing is blocked.
- `AC-217`: Student self-managed plans are archived when professional assignment activates for the same specialty.
- `AC-218`: Professional can view archived self-managed plan only when student grants access.
- `AC-219`: Students are not charged subscriptions.
- `AC-220`: Professionals can manage up to 10 active students without subscription.
- `AC-221`: Actions that exceed 10 active students are blocked until professional subscription is active.
- `AC-222`: Assignment can be unbound by student or professional at any time.
- `AC-223`: Training plan creation supports professional-defined schema without fixed mandatory workout fields.
- `AC-224`: Role-selection copy clearly states users can continue without a professional and start self-guided tracking.
- `AC-225`: Student dashboard, relationship, and tracking empty states include explicit self-guided continuation messaging and direct actions.
- `AC-226`: Student-facing connection flows do not display professional credential/verification status as badge/filter.
- `AC-227`: Auth entry supports email/password, Google, and Apple login methods.
- `AC-228`: Create-account form requires `name`, `email`, `password`, and `password_confirmation`.
- `AC-229`: Password validation enforces minimum 8 characters, at least one uppercase letter, one number, one special character, and no emojis.
- `AC-230`: Password and password-confirmation values must match before account creation.
- `AC-231`: Email addresses are unique per account and cannot create duplicates.
- `AC-232`: Social login with email matching existing account links provider identity into existing account.
- `AC-233`: Users with locked role are auto-redirected away from role-selection to role home.
- `AC-234`: Professionals can add specialties after onboarding.
- `AC-235`: Specialty removal is blocked when specialty has active or pending students, or removal would leave zero specialties.
- `AC-236`: Professional credential data is optional, specialty-scoped, and limited to one `professional_registry` record per specialty in MVP.
- `AC-237`: Invite code is persistent by default, revocable/regenerable by professional, with only one active code at a time; regenerating code invalidates old code and auto-cancels pending requests created from that old code.
- `AC-238`: Pending professional connection requests are capped at 10.
- `AC-239`: Wrong-role route access is hard-blocked and redirected to role home.
- `AC-240`: Student-visible credential info is available only for currently assigned professionals and includes only `registry_id`, `authority`, and `country`.
- `AC-241`: Professional dashboard shows active and pending student counts separately.
- `AC-242`: Student home prioritizes nutrition content above training content and highlights pending-connection status.
- `AC-243`: Offline mode exposes read-only cached content while blocking write actions.
- `AC-244`: Auth password fields provide reveal/hide controls on sign-in and create-account screens.
- `AC-245`: Role-specific bottom navigation areas are enforced:
  - Professional: dashboard, students, nutrition, training, account/settings.
  - Student: home, nutrition, training, recipes, account/settings.
- `AC-246`: Password special-character validation accepts only ASCII punctuation symbols; emoji and non-ASCII symbols are rejected.
- `AC-247`: Cached data older than 24 hours is shown as stale with last-sync metadata while remaining readable and write-blocked until connectivity returns.
- `AC-248`: Student onboarding includes a self-guided start path (Student selection + Continue) that commits `student` role and routes directly to self-managed tracking setup.
- `AC-249`: Relationship flow supports QR invite scanning and produces the same validation outcomes as manual invite entry.
- `AC-250`: Auth and invite failures render reason-specific actionable copy rather than generic error messaging.
- `AC-251`: Milestone A analytics events are emitted for auth entry, role selection, self-guided start, invite submit, and invite outcome transitions.
- `AC-252`: Milestone A analytics payloads include structured context fields (`surface`, `step`, `result`, optional `reason_code`) and redact sensitive values.
- `AC-253`: Students with pending requests canceled by invite-code regeneration see explicit canceled reason and a direct reconnect CTA.
- `AC-254`: Professional pending-request queue supports search/filter and bulk deny operations.
- `AC-255`: Students with assigned plans can submit change requests tied to specific plan context while assigned plans remain read-only.
- `AC-256`: Nutrition and training plan builders provide starter templates that are cloned into editable drafts before assignment.
- `AC-257`: Offline mode surfaces persistent offline/read-only banner and explicit write-lock reason on blocked actions.
- `AC-258`: Specialty-removal blocked state includes direct assist actions to resolve active/pending blockers.
- `AC-259`: Habit tracking scope under BL-104 includes water tracking only; sleep and steps are excluded from this item.
- `AC-260`: Students can set personal daily water goals and log daily water intake.
- `AC-261`: Nutritionists can set/update daily water goals for actively assigned students.
- `AC-262`: When nutritionist water goal exists in active assignment context, it becomes effective target; otherwise student personal water goal is effective target.
- `AC-263`: Hydration tracker provides visible daily completion status and streak progression based on effective water goal.
- `AC-264`: Professionals can create named predefined nutrition/training plans in a reusable private library.
- `AC-265`: Professionals can bulk assign predefined plans to multiple students and fine-tune each student copy before finalization; assigned copies remain independent.
- `AC-266`: After successful sign-in or create-account, users are routed to a terms-acceptance gate and cannot proceed to role-selection or role-home until the required terms version is accepted.
- `AC-513`: Camera/AI analysis entry point is visible and accessible in SC-214 (Custom Meal Builder) and SC-215 (Custom Meal Library Quick Log).
- `AC-514`: Captured meal image is compressed client-side to ≤1.5 MB and ≤1600 px on longest side before base64 encoding and transmission.
- `AC-515`: In SC-214, AI macro estimates pre-fill all form fields (calories, carbs, proteins, fats, totalGrams) for user review and editing before saving.
- `AC-516`: In SC-215, AI macro estimates pre-fill the quick-log grams/nutrition panel for user review and editing before logging.
- `AC-517`: User can edit all AI-pre-filled fields before confirming; no field is locked or auto-saved after analysis.
- `AC-518`: AI analysis failure (network, quota, unrecognizable image) surfaces a reason-specific recoverable error; form fields remain available for manual entry.
- `AC-519`: OpenAI API key is not present in client binary or any client-accessible environment variable; analysis calls route through Firebase Cloud Function proxy with Auth ID token validation.
- `AC-520`: When an email/password account user taps "Change password" in account settings, a confirmation alert is shown before any email is dispatched.
- `AC-521`: After confirming the password reset request, the app calls `sendPasswordResetEmail` and the "Change password" row enters a loading state for the duration of the request.
- `AC-522`: On successful dispatch of the password reset email, the "Change password" row is replaced by an inline success banner confirming the email was sent; the banner persists for the remainder of the session.
- `AC-523`: On failure to dispatch the password reset email, an inline error message is displayed below the "Change password" row; the row remains actionable so the user can retry.
- `AC-524`: When an OAuth account user (Google or Apple) taps "Change password", an informational alert is shown noting that the password is managed by the provider; no reset email is sent.

## Gherkin Scenarios
```gherkin
Feature: Role-based onboarding and care assignments

  Scenario: Student cannot have two active nutritionists
    Given a student has an active nutritionist
    When the student attempts to activate another nutritionist
    Then the system blocks the second active nutritionist assignment

  Scenario: Dual-specialty professional assignment
    Given a professional has nutritionist and fitness coach specialties
    And the student has no active professional in either specialty
    When assignment is confirmed
    Then the same professional becomes active for both specialties

  Scenario: Self-managed flow without nutritionist
    Given a student has no active nutritionist
    When the student creates a nutrition plan
    Then the plan is saved as student self-managed

  Scenario: Connection requires professional confirmation
    Given a professional sends an invite code
    And a student enters the code
    When the professional has not confirmed yet
    Then the assignment remains pending
    When the professional confirms
    Then the assignment becomes active

  Scenario: Assigned plan is read-only to student
    Given a professional has assigned a nutrition plan
    When the student opens the plan
    Then the student can view it
    And plan editing actions are unavailable

  Scenario: Professional student cap requires subscription
    Given a professional has 10 active students
    And the professional has no active subscription
    When the professional tries to activate an additional student
    Then the system blocks activation
    And the system shows subscription requirement

  Scenario: Role selection explains self-guided path
    Given a first-time user opens role selection
    When the user reads onboarding copy
    Then the app clearly states professional connection is optional
    And the user sees a direct self-guided path to continue

  Scenario: Professional credential status not exposed as verification labels
    Given professionals may have credential records or none
    When a student opens connection-related screens
    Then credential/verification status is not shown as label or filter

  Scenario: Auth methods availability
    Given a user opens auth entry
    Then email/password, Google, and Apple actions are available

  Scenario: Email uniqueness and social-linking
    Given an existing account with email
    When user attempts new signup with same email
    Then account creation is blocked
    When user authenticates via Google or Apple with same email
    Then provider is linked to the existing account

  Scenario: Specialty lifecycle constraints
    Given a professional account
    When the professional adds a new specialty
    Then specialty is enabled successfully
    When the professional tries removing a specialty with active or pending students
    Then removal is blocked
    And removing the final remaining specialty is blocked

  Scenario: Invite code and pending-cap constraints
    Given a professional with an active invite code
    When professional regenerates invite code
    Then previous code becomes inactive and new code is active
    And pending requests created from previous code are auto-canceled
    And pending connection requests cannot exceed 10

  Scenario: Student credential field scope
    Given a student has an active professional assignment
    When student opens professional credential details
    Then only registry_id, authority, and country are shown
    And verification badge/filter is not shown

  Scenario: Wrong-role route guard
    Given a student attempts to open a professional-only route
    Then app blocks access and redirects to student home

  Scenario: Password special-character charset
    Given a user is creating an account
    When the password uses only non-ASCII symbols for special-character requirement
    Then the form rejects the password-policy validation
    When the password includes an ASCII punctuation symbol and satisfies all other rules
    Then the password-policy validation passes

  Scenario: Offline stale cache behavior
    Given cached dashboard content exists
    And the last successful sync is older than 24 hours
    When the student opens home while offline
    Then stale indicator and last-sync timestamp are shown
    And cached content remains readable
    And write actions remain blocked

  Scenario: Role-specific bottom navigation
    Given authenticated student and professional users
    When each user opens the app shell
    Then student sees home, nutrition, training, recipes, and account tabs
    And professional sees dashboard, students, nutrition, training, and account tabs

  Scenario: Quick self-guided start
    Given a user is in student role-selection context
    When user selects Student and taps Continue
    Then app routes directly to self-managed tracking setup
    And professional connection is not required

  Scenario: QR invite scan parity
    Given a professional invite code is available as QR and text
    When student submits invite via QR scan
    Then validation and pending-assignment behavior matches manual entry

  Scenario: Contextual auth and invite errors
    Given auth or invite action fails with known reason code
    When error is shown to user
    Then message is specific to that reason
    And user sees an actionable next step

  Scenario: Milestone A analytics payload quality
    Given user executes auth, onboarding, and invite funnel steps
    When analytics events are emitted
    Then required context fields are present
    And sensitive fields are redacted

  Scenario: Pending canceled notification after code rotation
    Given a student has a pending request created from an invite code
    When the professional regenerates the invite code
    Then the student sees canceled status with explicit reason
    And the student sees a reconnect CTA

  Scenario: Professional pending queue operations
    Given a professional has multiple pending requests
    When the professional searches/filters the queue and executes bulk deny
    Then selected requests are denied
    And pending counters update correctly

  Scenario: Student plan change request on assigned plan
    Given a student has a professionally assigned plan
    When the student submits a plan change request
    Then the request is stored and visible to assigned professional
    And assigned plan content remains read-only for the student

  Scenario: Professional starts from starter template
    Given a professional opens nutrition or training plan builder
    When the professional selects a starter template
    Then an editable cloned draft is created
    And original starter template remains unchanged

  Scenario: Offline banner and write-lock reasons
    Given the app is offline with cached content available
    When the user opens a core screen and attempts a write action
    Then a persistent offline/read-only banner is visible
    And blocked action shows explicit write-lock reason

  Scenario: Specialty-removal assist actions
    Given a specialty removal is blocked by active or pending relationships
    When the professional views blocked-state guidance
    Then direct actions to resolve blockers are provided

  Scenario: Water tracking scope
    Given BL-104 habit tracking is enabled
    Then hydration (water) tracking is available
    And sleep/steps tracking are not included in this scope

  Scenario: Student personal water goal
    Given a student without nutritionist goal override
    When the student sets a personal daily water goal and logs intake
    Then completion and streaks are evaluated against the personal goal

  Scenario: Nutritionist water goal override
    Given a student has an active nutritionist assignment
    When nutritionist sets student water goal
    Then hydration completion uses nutritionist goal as effective target
    And student personal goal remains stored as fallback

  Scenario: Named predefined plan library and bulk assignment
    Given a professional has a named predefined plan
    When professional bulk assigns the plan to multiple students
    And fine-tunes each student draft before confirm
    Then each student receives an independent assigned copy
    And later edits to predefined source do not mutate assigned student copies

  Scenario: Terms gate blocks onboarding continuation until acceptance
    Given a user has just authenticated
    And the required terms version has not been accepted by this user
    When the user tries to access role-selection or role-home routes
    Then the app redirects to the terms acceptance screen
    When the user accepts the required terms version
    Then the app continues to role-selection if role is unlocked
    And the app continues to role-home if role is already locked

  Scenario: AI meal photo analysis — success path
    Given user opens SC-214 or SC-215 and camera permission is granted
    When user captures a meal photo and analysis succeeds
    Then form fields are pre-filled with AI macro estimates
    And AI disclaimer is visible
    And all fields remain editable before save

  Scenario: AI meal photo analysis — failure path
    Given user opens SC-214 or SC-215 and captures a photo
    When analysis fails due to network error, quota limit, or unrecognizable image
    Then reason-specific recoverable error is shown
    And form fields remain available for manual entry

  Scenario: AI analysis photo attachment optional in SC-214
    Given user has completed AI analysis in SC-214
    When user declines to attach the captured photo to the meal
    Then meal saves without an image and no error is shown

  Scenario: OpenAI key never in client binary
    Given the app binary is inspected
    Then no OpenAI API key is present in client code or env config exposed to client

  Scenario: SC-207 Nutrition plan builder — create named plan
    Given a professional with nutrition specialty opens the plan builder
    When they enter a plan name, calorie target, and macro targets
    And save the plan
    Then the predefined plan appears in the professional private nutrition library

  Scenario: SC-207 Nutrition plan builder — add and remove item
    Given a professional is editing a nutrition plan
    When they add a food item with name, quantity, and notes
    And then remove it
    Then the item list updates accordingly

  Scenario: SC-207 Nutrition plan builder — starter template clone
    Given a professional opens a starter template in the nutrition plan builder
    When they begin editing
    Then an editable cloned draft is created
    And the original starter template remains unchanged

  Scenario: SC-207 Nutrition plan builder — bulk assign
    Given a professional has a saved predefined nutrition plan
    When they bulk assign it to multiple students
    Then each student receives an independent plan copy
    And later edits to the predefined source do not affect assigned copies

  Scenario: SC-208 Training plan builder — create named plan with sessions
    Given a professional with training specialty opens the training plan builder
    When they enter a plan name, add one or more sessions with custom items
    And save the plan
    Then the predefined plan appears in the professional private training library

  Scenario: SC-208 Training plan builder — starter template clone
    Given a professional opens a starter template in the training plan builder
    When they begin editing
    Then an editable cloned draft is created
    And the original starter template remains unchanged

  Scenario: Plan builder — validation guards
    Given a professional is on the nutrition plan builder
    When they attempt to save with no plan name entered
    Then a validation error is shown and save is blocked

  Scenario: Password reset — email/password account confirmation flow
    Given an email/password account user is on the account settings screen
    When the user taps "Change password"
    Then a confirmation alert is shown requesting consent before sending the email

  Scenario: Password reset — loading state during dispatch
    Given an email/password account user confirmed the password reset request
    When the reset email dispatch is in progress
    Then the "Change password" row shows a loading indicator

  Scenario: Password reset — success inline banner
    Given an email/password account user confirmed the password reset request
    When sendPasswordResetEmail succeeds
    Then the "Change password" row is replaced by an inline success banner
    And the banner remains visible for the rest of the session

  Scenario: Password reset — error inline message with retry
    Given an email/password account user confirmed the password reset request
    When sendPasswordResetEmail fails
    Then an inline error message is shown below the "Change password" row
    And the row remains actionable for retry

  Scenario: Password reset — OAuth account informational alert
    Given a Google or Apple OAuth account user is on the account settings screen
    When the user taps "Change password"
    Then an informational alert is shown naming the provider
    And no password reset email is dispatched
```
