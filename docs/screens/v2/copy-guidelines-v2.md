# V2 UX Copy Guidelines (Onboarding And Self-Guided Clarity)

## Goal
Prevent confusion for first-time users who do not know the Student/Professional domain model and may only want self-guided calorie/workout tracking.

## Core Messaging Rules
- Always clarify that users can continue without connecting to a professional.
- Use plain-language UI labels while keeping internal domain role names unchanged.
- In student-facing empty states, include a direct self-guided action.

## Recommended Role Card Copy (SC-201)
- Screen title: `How do you want to use the app?`
- Intro text: `You can start on your own now and connect with a professional later.`
- Student card title: `I want to track my own progress`
- Student card subtitle: `Log meals and workouts by yourself. No professional required.`
- Professional card title: `I’m a nutritionist or fitness coach`
- Professional card subtitle: `Manage clients, assign plans, and track student progress.`
- Role lock note: `Account type can’t be changed later. You can create another account with a different email if needed.`
- Quick self-guided CTA: `Start on my own now`

## Recommended Auth Copy (SC-217 / SC-218)
- Sign-in title: `Welcome back`
- Sign-in divider: `or continue with`
- Create-account title: `Create your account`
- Password helper: `Use at least 8 characters, including uppercase, number, and a symbol (e.g., ! @ #).`
- Password toggle labels: `Show password` / `Hide password`
- Invalid credentials helper: `Email or password is incorrect. Try again or reset your password.`
- Network helper: `Couldn't connect right now. Check your connection and try again.`

## Recommended Student Empty-State Copy
- Dashboard no-professional state: `No professional connected yet — you can still start tracking today.`
- Nutrition no-assignment state: `Start your own nutrition plan now. You can connect with a nutritionist anytime.`
- Training no-assignment state: `Start your own training plan now. You can connect with a coach anytime.`
- Offline stale indicator: `Data may be outdated`
- Offline last-sync meta: `Last updated: {datetime}`
- Offline banner: `You're offline. You can view cached data, but updates are locked until connection returns.`
- Offline write-lock helper: `Connect to the internet to save changes.`

## Recommended Relationship Screen Copy
- Intro: `Have a professional? Enter their invite code. Don’t have one yet? Keep using self-guided mode.`
- QR CTA: `Scan QR code`
- Pending confirmation helper: `Waiting for professional confirmation to activate this connection.`
- Invalid invite helper: `This invite code is invalid. Ask your professional for a new code.`
- Pending-cap helper: `This professional has too many pending requests right now. Try again later.`
- Rotated-code cancellation helper: `This request was canceled because the professional regenerated their invite code. Ask for the new code to reconnect.`
- Credential labels for assigned professionals only: `Registry ID`, `Authority`, `Country`.

## Recommended Professional Pending Queue Copy
- Search placeholder: `Search pending requests`
- Filter label: `Filter requests`
- Bulk deny CTA: `Deny selected`
- Bulk deny confirm title: `Deny selected requests?`
- Bulk deny confirm helper: `Selected students can request again later with your invite code.`
- Bulk deny success feedback: `Requests denied successfully.`

## Recommended Plan Change Request Copy
- Student CTA (assigned plan): `Request plan change`
- Request modal title: `What would you like to change?`
- Request input label: `Explain your request`
- Request submit CTA: `Send request`
- Request success feedback: `Request sent to your professional.`
- Professional section title: `Plan change requests`

## Recommended Hydration Copy (BL-104)
- Card title: `Water intake`
- Progress helper: `{consumed} / {goal} ml`
- Log CTA: `Log water`
- Set-goal CTA: `Set water goal`
- Student-goal helper: `Using your personal water goal`
- Nutritionist-goal helper: `Daily water goal defined by your nutritionist`
- Streak helper: `Current streak: {days} days`
- Professional section title: `Student water goal`
- Professional input label: `Daily water goal (ml)`
- Professional save CTA: `Save water goal`

## Recommended Starter Template Copy
- Section title: `Start from a template`
- Template badge: `Starter`
- Template CTA: `Use template`
- Clone helper: `We create an editable copy. The original template does not change.`

## Recommended Predefined Plan Bulk Assignment Copy (BL-106)
- Predefined plan name label: `Predefined plan name`
- Create predefined CTA: `Save predefined plan`
- Bulk-assign entry CTA: `Bulk assign plan`
- Bulk-assign title: `Assign this plan to multiple students`
- Select-students helper: `Select students to receive this plan`
- Fine-tune step title: `Fine-tune each student plan`
- Finalize CTA: `Confirm assignments`
- Copy-independence helper: `Each student gets an independent copy. Future library edits won't change assigned plans.`

## Recommended Custom Meal Copy
- Builder helper: `Add total meal weight and nutrients. We use this to calculate any portion you log.`
- Quick log helper: `Enter grams consumed. We calculate calories and macros automatically.`
- Share action: `Share recipe`
- Image upload progress: `Uploading image... {progress}%`
- Image upload failure: `We couldn't upload the image. Check your connection and try again.`
- Image upload retry CTA: `Retry upload`
- Shared import helper: `Save this recipe to your account to use it in your daily tracking.`
- Shared import ownership note: `After saving, this copy is yours even if the original creator deletes theirs.`
- Shared import auth helper: `Sign in to save this recipe. We'll bring you back here right after login.`
- Shared import idempotent helper: `You already saved this recipe in your account.`

## Recommended Subscription + Specialty Assist Copy
- Pre-lapse warning title: `Your subscription is close to expiring`
- Pre-lapse warning helper: `Renew now to avoid student management locks.`
- Pre-lapse warning CTA: `Renew subscription`
- Specialty blocked title: `You can't remove this specialty yet`
- Specialty blocked helper: `Resolve active or pending student links for this specialty first.`
- Specialty blocked CTAs: `View active students`, `Manage pending requests`

## Copy Constraints
- Avoid jargon like `alumni`, `assignment lifecycle`, and `specialty` in primary user-facing text.
- Prefer action-first CTAs (`Start tracking`, `Connect later`, `Enter invite code`).
- Keep legal/compliance text separate from onboarding value messaging.
- For known error states, avoid generic fallback text and always include a direct next step.
- Keep accessibility phrasing explicit for status states (for example `offline`, `pending`, `locked`) so assistive technologies convey state clearly.

## Source Of Truth
- Maintain translation-ready strings in `docs/screens/v2/localized-copy-table-v2.md`.
- Localization baseline for product strings is mandatory in `en-US`, `pt-BR`, and `es-ES`.
