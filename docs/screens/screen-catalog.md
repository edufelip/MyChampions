# Screen Catalog And Planning

## V2 Specification Set
- `docs/screens/v2/` contains detailed per-screen specs for all planned product journey screens.

## Current Implemented Screens

| Screen | Route | Type | Purpose | Status |
|---|---|---|---|---|
| Home | `/` | Tab | Entry screen with starter content and modal entry point | Implemented |
| Explore | `/explore` | Tab | Starter examples and links | Implemented |
| Modal | `/modal` | Modal | Demonstrates modal flow and return action | Implemented |

## Planned Screens Backlog

Use one line per future screen.

| Screen Name | Route (proposed) | Owner Feature | Problem Solved | Key Data Needed | Primary Actions | Dependencies | Status |
|---|---|---|---|---|---|---|---|
| Auth Sign-In | `/auth/sign-in` | Identity And Access | Authenticate existing accounts and link social providers | Credentials and provider tokens | Sign in via email/password, Google, Apple | Auth provider | Specified (V2) |
| Auth Create Account | `/auth/create-account` | Identity And Access | Register new accounts with password policy enforcement | Name/email/password fields and provider tokens | Create account and social auth | Auth provider | Specified (V2) |
| Auth / Role Selection | `/auth/role-selection` | Identity And Access | Branch user into correct journey with self-guided shortcut | Account and role choice | Choose Student or Professional, quick self-guided start | Auth provider | Specified (V2) |
| Professional Specialty Setup | `/onboarding/professional-specialty`, `/professional/settings/specialties` | Identity And Access | Capture/manage professional capabilities | Specialty choices and optional credentials | Select/add/remove specialties | Role onboarding | Specified (V2) |
| Student Home Dashboard | `/student/home` | Student Journey | Central access to assigned/self plans | Assignment and progress summary | View plans, log progress | Assignment service | Specified (V2) |
| Professional Dashboard | `/professional/home` | Professional Journey | Manage multiple students | Client roster and statuses | Open student profile, assign plans | Assignment service | Specified (V2) |
| Student Roster | `/professional/students` | Professional Journey | Browse/manage client base | Student list data | Filter, search, open student | Data API | Specified (V2) |
| Student Profile (Professional View) | `/professional/students/:studentId` | Professional Journey | Configure plans per student | Student metrics and current plans | Create/edit/assign plans | Plan services | Specified (V2) |
| Nutrition Plan Builder | `/professional/nutrition/plans/:planId` | Nutrition Management | Author reusable/custom meal plans | Food database, macro targets | Add foods, set macros/calories | Food calorie API | Specified (V2) |
| Custom Meal Builder | `/nutrition/custom-meals/:mealId` | Nutrition Tracking | Create/edit reusable custom meals | Meal totals, weight, optional ingredient cost | Save meal definition | Nutrition tracking model | Specified (V2) |
| Custom Meal Library And Quick Log | `/nutrition/custom-meals` | Nutrition Tracking | Reuse saved meals and log consumed grams quickly | Saved custom meals and grams input | Select meal, log grams | Nutrition tracking model | Specified (V2) |
| Shared Recipe Save Confirmation | `/shared/recipes/:shareToken` | Recipe Sharing | Save shared recipe as account-owned copy | Share token and source recipe snapshot | Confirm save to account | Sharing service and auth | Specified (V2) |
| Training Plan Builder | `/professional/training/plans/:planId` | Training Management | Author reusable/custom sessions | Exercise model data | Add sessions/exercises | Training schema model | Specified (V2) |
| Student Nutrition Tracking | `/student/nutrition/today` | Student Journey | Track daily calories/macros | Assigned or self plan targets | Log meals, monitor totals | Food calorie API | Specified (V2) |
| Student Training Tracking | `/student/training/today` | Student Journey | Track workout execution | Assigned or self sessions | Mark complete, log performance | Training schema model | Specified (V2) |
| Relationship Management | `/student/professionals` | Assignment Lifecycle | Connect/replace professionals | Professional lookup and assignment state | Manual invite entry, QR scan, accept, replace, remove | Assignment lifecycle rules | Specified (V2) |
| Professional Subscription Gate | `/professional/subscription` | Monetization | Unlock management beyond 10 active students | Entitlement and product data | Purchase, restore, view plan | RevenueCat + store billing | Specified (V2) |
| Account And Privacy Settings | `/settings/account` | Compliance | Give users account deletion and policy access | Account state and legal links | Delete account, view privacy policy | Store policy requirements | Specified (V2) |

## Per-Screen Planning Checklist
- Screen objective and user value.
- Primary and secondary actions.
- Inputs and outputs.
- Empty/loading/error/success states.
- Accessibility and platform-specific behavior.
- Analytics events.
- Linked use cases, ACs, rules, and test cases.
