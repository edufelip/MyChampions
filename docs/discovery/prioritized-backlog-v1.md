# Prioritized Backlog V1

## Purpose
Convert current brainstorming into an execution-ready product backlog with clear priority tiers.

## Priority Model
- `P0 Must`: high impact for core adoption, reliability, and trust; target before broad beta.
- `P1 Should`: strong value-add after P0 is stable.
- `P2 Later`: strategic improvements for scale and differentiation.

## P0 Must
| ID | Item | Problem Addressed | Acceptance Checkpoint |
|---|---|---|---|
| BL-001 | Quick self-guided start path | New users may drop if onboarding feels heavy before value. | User can start calorie/workout tracking without full professional setup. |
| BL-002 | Invite code QR scan | Manual code typing is error-prone and slow. | Student can scan QR and land in same validation flow as manual code. |
| BL-003 | Pending canceled notification on code rotation | Students can be confused when pending requests silently disappear. | Student sees clear canceled reason and CTA to request new code. |
| BL-004 | Professional pending queue tools (search/filter/bulk deny) | Pending list can become operationally hard to manage. | Professional can filter queue and process multiple requests quickly. |
| BL-005 | Student plan change request flow | Assigned plans are read-only, which can feel blocking. | Student can submit change request tied to specific plan/day/session. |
| BL-006 | Professional starter template library | Blank authoring creates friction and inconsistent quality. | Professional can create from starter templates and customize before assign. |
| BL-007 | Image upload progress and retry UX | Failed uploads feel broken and opaque. | Upload UI shows progress, failure reason, and retry action. |
| BL-008 | Explicit offline banner and write-lock explanations | Read-only offline mode can be mistaken for app bugs. | Offline state and disabled write actions are clearly explained in UI. |
| BL-009 | Subscription pre-lapse warning | Hard lock above cap can feel abrupt and punitive. | Professional receives warning before lock and clear recovery steps. |
| BL-010 | Auth/invite error copy hardening | Generic errors increase abandonment. | Top auth/invite failures have specific user-facing recovery messages. |
| BL-011 | Specialty removal assist flow | Blocking removal due to pending/active can feel unclear. | When blocked, UI offers direct action to resolve blocking records. |
| BL-012 | Product analytics event taxonomy | Without telemetry, UX issues are hard to diagnose. | Funnel and error events are defined and emitted for auth/invite/core flows. |
| BL-013 | Accessibility baseline for MVP | Basic accessibility gaps harm usability and store readiness. | Core screens pass baseline checks for contrast, labels, and text scaling. |

## P1 Should
| ID | Item | Problem Addressed | Acceptance Checkpoint |
|---|---|---|---|
| BL-101 | In-app chat per student-professional link | Communication currently requires external channels. | Student and professional can exchange messages in assignment context. |
| BL-102 | Weekly check-in form | Professionals lack structured feedback signals. | Student submits weekly check-in; professional can review trend history. |
| BL-103 | Progress trend dashboard | Progress is hard to interpret from raw daily logs. | User sees weekly/monthly trends for adherence and key metrics. |
| BL-104 | Water tracker with personal/professional goals | Hydration adherence is not explicitly tracked in daily routines. | Student can track daily water intake and streaks, define personal water goal, and nutritionist can set/update water goal for assigned students. |
| BL-105 | Shared notes/comments on plans | Feedback loops are fragmented. | Notes/comments can be added per plan block and viewed by both sides. |
| BL-106 | Named predefined plans + clone/bulk assignment | Manual repetitive setup wastes professional time and reduces consistency. | Professional can create named predefined plans (for example, `Caloric Deficit A/B`), clone and bulk-assign them, then fine-tune each student plan before finalizing. |
| BL-107 | Smart reminders for meals/workouts | Users may forget scheduled actions and drop adherence. | Configurable reminders trigger at configured windows with deep links. |

## P2 Later
| ID | Item | Problem Addressed | Acceptance Checkpoint |
|---|---|---|---|
| BL-201 | Team mode for professionals | Solo account model limits larger practices. | Professional can invite assistants with scoped permissions. |
| BL-202 | Exportable progress reports (PDF) | Data sharing with clients/clinics is manual. | User can export period report with key nutrition/training summaries. |
| BL-203 | Program calendar with training cycles | Long-term planning is fragmented across screens. | Professional can schedule cycle phases and student sees dated calendar plan. |
| BL-204 | Professional discoverability and trust profile enhancements | Student trust context is minimal at connection stage. | Assigned professional profile can show richer non-verified context fields. |

## Recommended Delivery Sequence
1. `Milestone A`: BL-001, BL-002, BL-010, BL-012.
2. `Milestone B`: BL-003, BL-004, BL-011.
3. `Milestone C`: BL-005, BL-006, BL-007, BL-008, BL-009, BL-013.
4. `Milestone D`: P1 backlog.

## Milestone A Spec Coverage
| Backlog Item | Status | FR | UC | AC | BR | TC |
|---|---|---|---|---|---|---|
| BL-001 Quick self-guided start path | Implemented — quick self-guided CTA in role-selection, role-lock + routing to student home, empty states with self-guided CTAs in all student screens | FR-203 | UC-002.8 | AC-248 | BR-262 | TC-249 |
| BL-002 Invite code QR scan | Implemented — expo-camera wired, same submitCode pipeline as manual entry | FR-204 | UC-002.9 | AC-249 | BR-263 | TC-250, TC-251 |
| BL-010 Auth/invite error copy hardening | Spec-ready | FR-205 | UC-002.10 | AC-250 | BR-264 | TC-252, TC-253 |
| BL-012 Product analytics event taxonomy | Spec-ready | FR-206, FR-207, FR-208 | UC-002.11 | AC-251, AC-252 | BR-265, BR-266 | TC-254, TC-255 |

## Milestone B Spec Coverage
| Backlog Item | Status | FR | UC | AC | BR | TC |
|---|---|---|---|---|---|---|
| BL-003 Pending canceled notification on code rotation | Implemented — canceled_code_rotated state wired in connection logic and UI, locale keys for all 3 languages | FR-209 | UC-002.3 | AC-253 | BR-267 | TC-256 |
| BL-004 Professional pending queue tools | Implemented — search/filter/bulk deny UI wired in SC-204/SC-205, pure logic layer with 26 comprehensive tests | FR-210 | UC-002.12 | AC-254 | BR-268 | TC-257, TC-258 |
| BL-011 Specialty removal assist flow | Implemented — removal assist logic layer with blocker resolution actions, 34 comprehensive tests covering assist state resolution and action metadata | FR-216 | UC-002.16 | AC-258 | BR-274 | TC-262, TC-263 |

## Milestone C Spec Coverage
| Backlog Item | Status | FR | UC | AC | BR | TC |
|---|---|---|---|---|---|---|
| BL-005 Student plan change request flow | Screens implemented; Data Connect endpoint wiring deferred | FR-211 | UC-002.13 | AC-255 | BR-269 | TC-259 |
| BL-006 Professional starter template library | Implemented — pure logic layer (11 functions) with 35 comprehensive tests covering template detection, cloning, filtering, and immutability | FR-212 | UC-002.14 | AC-256 | BR-270 | TC-260 |
| BL-007 Image upload progress and retry UX | Spec-ready | FR-213 | UC-003.8 | AC-424, AC-425 | BR-271 | TC-426, TC-427 |
| BL-008 Explicit offline banner and write-lock explanations | Spec-ready | FR-214 | UC-002.17 | AC-257 | BR-272 | TC-261 |
| BL-009 Subscription pre-lapse warning | Spec-ready | FR-215 | UC-002.15 | AC-312 | BR-273 | TC-311 |
| BL-013 Accessibility baseline for MVP | Spec-ready | FR-217 | UC-002.18 | AC-512 | BR-275 | TC-512 |

All current `P0 Must` items are now documented as `Spec-ready` with FR/UC/AC/BR/TC traceability.

## P1 Selected Spec Coverage
| Backlog Item | Status | FR | UC | AC | BR | TC |
|---|---|---|---|---|---|---|
| BL-104 Water tracker with personal/professional goals | Screens implemented; Data Connect wiring deferred | FR-218, FR-219, FR-220, FR-221, FR-222 | UC-002.19 | AC-259, AC-260, AC-261, AC-262, AC-263 | BR-276, BR-277, BR-278, BR-279, BR-280 | TC-264, TC-265, TC-266, TC-267 |
| BL-106 Named predefined plans + clone/bulk assignment | Screens implemented; Data Connect + fatsecret wiring deferred | FR-223, FR-224, FR-225, FR-226 | UC-002.20 | AC-264, AC-265 | BR-281, BR-282, BR-283 | TC-268, TC-269, TC-270 |
| BL-108 AI meal photo macronutrient analysis | Logic/hook/source implemented; camera, compression, Cloud Function wiring deferred | FR-229, FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-237, FR-238, FR-239 | UC-003.9 | AC-513, AC-514, AC-515, AC-516, AC-517, AC-518, AC-519 | BR-286, BR-287, BR-288, BR-289, BR-290 | TC-271, TC-272, TC-273, TC-274 |

## Documentation Gate For Each Backlog Item
- Add or update FR, UC, AC, BR, and TC artifacts.
- Update impacted screen specs, copy tables, and diagrams.
- Record decision and scope in discovery log.
