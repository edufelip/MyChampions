# TC-002 Role And Assignment Controls (Proposed)

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-201 | Role Onboarding | New account | Select Student role | Student journey/dashboard is shown |
| TC-202 | Role Onboarding | New account | Select Professional and choose nutritionist only | Nutritionist professional journey is shown |
| TC-203 | Role Onboarding | New account | Select Professional and choose both specialties | Dual-specialty dashboard is shown |
| TC-204 | Assignment Rule | Student has one active nutritionist | Attempt to activate second nutritionist | System blocks action and explains rule |
| TC-205 | Assignment Rule | Student has one active fitness coach | Attempt to activate second fitness coach | System blocks action and explains rule |
| TC-206 | Multi-Client Dashboard | Professional linked to multiple students | Open professional dashboard | All linked students are visible |
| TC-207 | Nutrition Planning | Nutritionist linked to student | Create meal plan with calorie/macro targets | Plan saves and links to student |
| TC-208 | Training Planning | Fitness coach linked to student | Create training schema and assign | Plan saves and links to student |
| TC-209 | Student Tracking | Student with assigned meal plan | Log daily meals/macros | Daily totals and progress are updated |
| TC-210 | Self-Managed Fallback | Student has no active coach | Create own training plan | Student self-managed plan is accepted |
| TC-211 | Role Governance | Existing Student account | Attempt to switch role to Professional | Action blocked and user instructed to create a new account |
| TC-212 | Professional Onboarding | New Professional account | Skip optional credential submission | Onboarding completes successfully |
| TC-213 | Invite Flow | Professional and student accounts exist | Professional sends invite code, student submits code | Assignment enters pending confirmation |
| TC-214 | Invite Confirmation | Pending assignment exists | Professional confirms assignment | Assignment becomes active |
| TC-215 | History Retention | Active assignment with existing plans | End assignment | Relationship and plans remain in history |
| TC-216 | Assigned Plan Access | Student has professional-assigned plan | Attempt to edit assigned plan | Editing is blocked; view remains allowed |
| TC-217 | Self-Plan Archive | Student has self-managed nutrition plan | Activate nutritionist assignment | Self-managed plan becomes archived |
| TC-218 | Archived Plan Privacy | Archived self-plan exists | Professional attempts to view without consent | Access denied |
| TC-219 | Archived Plan Consent | Archived self-plan exists | Student grants access and professional opens history | Access is granted |
| TC-220 | Subscription Model | Student account exists | Access app features | No subscription charge/paywall is shown for student role |
| TC-221 | Professional Cap | Professional has 10 active students and no entitlement | Try to activate 11th student | Operation blocked and subscription prompt displayed |
| TC-222 | Entitlement Unlock | Professional at cap purchases or restores subscription | Retry activation of 11th student | Operation succeeds |
| TC-223 | Unbind Flexibility | Active assignment exists | Student unbinds OR professional unbinds | Assignment ends immediately and history is retained |
| TC-224 | Training Flexibility | Professional creates training schema | Save schema with custom field set | Plan is saved without fixed field validation errors |
| TC-225 | Onboarding Copy Clarity | First-time user opens role selection | Read role options and helper text | Copy explicitly states self-guided usage is allowed without professional |
| TC-226 | Student Empty-State Clarity | Student has no connected professionals | Open dashboard, relationship, and tracking screens | Empty states provide clear self-guided next action and non-blocking messaging |
| TC-227 | Credential Visibility Controls | Professionals with and without credential submission exist | Open student-facing connection screens | No verification badge/filter is shown to student |
| TC-228 | Auth Methods | Auth entry open | Inspect available auth methods | Email/password, Google, and Apple are shown |
| TC-229 | Signup Required Fields | Create-account form open | Omit one required field and submit | Submission blocked with validation message |
| TC-230 | Password Policy | Create-account form open | Provide passwords violating complexity/no-emoji policy | Submission blocked with specific password-policy feedback |
| TC-231 | Password Confirmation | Create-account form open | Provide non-matching password and confirmation | Submission blocked until exact match |
| TC-232 | Password Reveal Toggle | Password field visible | Toggle reveal/hide on both password fields | Value visibility toggles without value mutation |
| TC-233 | Email Uniqueness | Existing account email present | Attempt second account creation with same email | Duplicate account creation is blocked |
| TC-234 | Social Account Linking | Existing email/password account exists | Sign in with Google/Apple using same email | Provider is linked to existing account, not new account |
| TC-235 | Role Selection Redirect | Account already has locked role | Navigate to role-selection route | User is auto-redirected to role home |
| TC-236 | Specialty Add Post-Onboarding | Professional with one specialty | Add second specialty | Specialty is added successfully |
| TC-237 | Specialty Remove Active/Pending Guard | Professional has active or pending students in specialty | Attempt to remove that specialty | Removal is blocked with rule explanation |
| TC-238 | Specialty Remove Last-Role Guard | Professional has single specialty and no students | Attempt to remove specialty | Removal is blocked because at least one specialty is required |
| TC-239 | Credential Per Specialty | Professional edits specialty settings | Submit one professional_registry credential per specialty | Credential accepted; second credential in same specialty is blocked |
| TC-240 | Invite Code Regeneration | Professional has active invite code and pending requests created from it | Regenerate code and share new one | Old code invalidated; pending requests created from old code are auto-canceled; new code accepted for future requests |
| TC-241 | Pending Cap | Professional already has 10 pending requests | Student submits invite code | New pending request is blocked until queue decreases |
| TC-242 | Wrong-Role Route Guard | Authenticated user in one role | Open route owned by opposite role | Access blocked and redirected to role home |
| TC-243 | Student Credential Visibility Scope | Student has one active assigned professional and other non-assigned professionals exist | Open professional info surfaces | Credential info only shown for assigned professional and field scope is limited to registry_id, authority, and country |
| TC-244 | Student Home Priority | Student home has nutrition and training sections | Open home screen | Nutrition appears above training and pending-connection status is prominent |
| TC-245 | Offline Read-Only | Cached content available and device offline | Open dashboard and attempt write action | Read-only data visible; write action blocked with connectivity feedback |
| TC-246 | Role Bottom Navigation Model | Authenticated student and professional accounts | Open app shell in each role | Student and professional see their respective 5-tab navigation models |
| TC-247 | Password Special Charset | Create-account form open | Enter password that satisfies length/uppercase/number but uses only non-ASCII symbols as special chars and submit | Submission is blocked with password-policy error; adding ASCII punctuation passes policy |
| TC-248 | Offline Stale Cache Indicator | Cached data exists with last sync older than 24 hours and device offline | Open student home/dashboard | Stale indicator + last-sync timestamp are visible, cached content is readable, and write actions remain blocked |
| TC-249 | Quick Self-Guided Start | Authenticated user with unlocked role | Tap quick self-guided start | Account is locked as student and user is routed to self-managed tracking setup without professional connection |
| TC-250 | QR Invite Scan Success | Student has camera permission and valid invite QR | Scan QR in relationship flow and submit | Assignment enters pending_confirmation with same result as manual code entry |
| TC-251 | QR Invite Scan Invalid Payload | Student opens QR scanner with malformed/unsupported code | Scan invalid QR | Actionable error is shown and user can retry or switch to manual entry |
| TC-252 | Contextual Auth Error Copy | Sign-in or sign-up submission fails with known reason | Trigger failure (invalid credentials/duplicate email) | UI shows reason-specific copy with recommended next action |
| TC-253 | Contextual Invite Error Copy | Invite submission fails with known reason | Trigger failure (invalid code/pending cap reached/canceled by code rotation) | UI shows reason-specific copy with recommended next action |
| TC-254 | Milestone A Event Emission Coverage | Analytics enabled | Execute auth entry, role selection, quick self-guided start, invite submit/outcome | Expected events are emitted for all milestone steps |
| TC-255 | Milestone A Event Redaction | Analytics/observability enabled | Execute auth/invite flows and inspect payloads | Payloads include structured context fields and exclude raw credentials/tokens/full invite code/full email |
| TC-256 | Pending Request Canceled Notification | Student has pending request created from invite code and professional regenerates invite code | Refresh relationship screen after code rotation | Pending request shows canceled reason and reconnect CTA |
| TC-257 | Pending Queue Search/Filter | Professional has high-volume pending queue | Search by student identifier and filter by request state | Queue list narrows correctly and preserves valid actions |
| TC-258 | Pending Queue Bulk Deny | Professional has multiple pending requests | Select multiple pending items and run bulk deny | Selected requests transition to denied/closed and pending counters update |
| TC-259 | Student Plan Change Request | Student has assigned nutrition or training plan | Open assigned plan and submit change request | Request is stored and visible to assigned professional while plan remains read-only |
| TC-260 | Starter Template Clone Flow | Professional opens nutrition/training plan builder | Select starter template and begin editing | Editable cloned draft is created and original starter template remains unchanged |
| TC-261 | Offline Banner + Write-Lock Reason | Device offline with cached content | Open core screen and attempt a write action | Persistent offline/read-only banner is shown and blocked action shows explicit reason |
| TC-262 | Specialty Removal Assist Guidance | Specialty removal is blocked by active/pending records | Attempt specialty removal in settings | UI shows direct actions to resolve blockers (view active/pending and queue actions) |
| TC-263 | Specialty Removal After Assisted Resolution | Specialty previously blocked for removal | Resolve blockers using assist actions and retry removal | Specialty removal succeeds when constraints are satisfied |
| TC-264 | Water Tracking Scope Boundaries | Habit tracking surfaces enabled | Inspect available habit modules | Water tracker is available and sleep/steps are absent from BL-104 scope |
| TC-265 | Student Personal Water Goal | Student has no nutritionist goal override | Set personal daily water goal, log intake across days | Completion and streak values are computed from student personal goal |
| TC-266 | Nutritionist Water Goal Assignment | Active nutritionist-student assignment exists | Nutritionist sets/updates student water goal | Student effective hydration target updates to nutritionist-defined goal |
| TC-267 | Water Goal Precedence Fallback | Student has personal goal and receives nutritionist goal, then assignment ends | Track intake with active assignment, then after unbind | Active assignment uses nutritionist goal; post-unbind uses stored personal goal |
| TC-268 | Named Predefined Plan Creation | Professional has specialty access | Create predefined plan with custom name (for example `Caloric Deficit A`) | Predefined plan appears in professional private library with saved name |
| TC-269 | Predefined Plan Bulk Assignment With Fine-Tuning | Professional has predefined plan and multiple target students | Bulk assign plan to selected students and adjust each student draft | Assignment succeeds and per-student customizations are preserved |
| TC-270 | Assigned Copy Independence | Predefined plan already assigned to students | Edit source predefined plan after assignment | Existing assigned student plans remain unchanged |

## Notes
- API contract tests are required once food/calorie provider is selected.
- Add negative-path tests for invalid macro totals and incomplete plan assignments.
