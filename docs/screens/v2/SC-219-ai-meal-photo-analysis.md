# SC-219 AI Meal Photo Analysis (V2)

## Route
- No standalone route. SC-219 is a modal/inline surface embedded in:
  - SC-214 Custom Meal Builder (`app/(tabs)/nutrition/custom-meals/[mealId].tsx`) — camera icon adjacent to image upload stub; analysis pre-fills the meal creation form.
  - SC-215 Custom Meal Library Quick Log (`app/(tabs)/nutrition/custom-meals/index.tsx`) — camera icon in the quick-log panel header; analysis pre-fills the nutrition preview panel.

## Objective
Allow users to capture or select a photo of their meal and receive AI-estimated macronutrients (calories, carbs, proteins, fats, totalGrams) that pre-fill the meal form or quick-log panel for review and confirmation before saving.

AI estimates are always advisory — all fields remain editable after pre-fill (BR-286, D-108).

**Paywall gate (D-132):** The AI analysis CTA is only accessible to users with an active `professional_pro` OR `student_pro` RevenueCat entitlement. When neither entitlement is `'active'`, the CTA is replaced by a locked paywall banner with an "Upgrade to unlock" CTA that presents the native RevenueCat paywall (`default_student` offering, `AI_OFFERING_ID`). Status `'unknown'` (loading/error) is treated as locked (strict policy).

## User Actions
- When entitlement is active: tap "Analyze with AI" CTA to initiate capture.
- When entitlement is not active: tap "Upgrade to unlock" CTA to open the native RevenueCat paywall for the `default_student` offering (`AI_OFFERING_ID`); after purchase/dismissal, entitlement status is refreshed.
- Action sheet presents "Take Photo" / "Choose from Library" / "Cancel".
- On capture: image is compressed client-side via `expo-image-manipulator`, then sent to Cloud Function.
- Review AI-estimated macros pre-filled into form fields.
- Edit any field before confirming save.
- Tap retry to dismiss error and attempt a new capture.
- In SC-214 only: optionally attach the captured photo to the meal image record (D-109).

## States

| State | Trigger | UI |
|---|---|---|
| `paywall_locked` | `hasAiAccess === false` while `analysisState.kind === 'idle'` | Locked banner (`meal.photo_analysis.paywall.locked`) + "Upgrade to unlock" CTA; no analysis interaction available |
| `paywall_loading` | `isSubscriptionLoading === true` and `hasAiAccess === false` | `ActivityIndicator` with `meal.photo_analysis.paywall.loading` label |
| `idle` | `hasAiAccess === true` + initial / after reset | "Analyze with AI" CTA visible |
| `capturing` | `startCapture()` called | Native camera/picker open via `expo-image-picker` |
| `compressing` | Capture complete | Brief loading indicator; `expo-image-manipulator` resizes + compresses JPEG |
| `analyzing` | `analyze(base64Image)` called | Full-width loading indicator with `meal.photo_analysis.analyzing` |
| `done` | Cloud Function returns valid estimate | Pre-filled form fields + disclaimer banner + optional low-confidence warning |
| `error` | Cloud Function or network failure | Reason-specific error message + retry CTA; form remains editable |

## Error Reasons

| `reason` | Trigger | Copy key |
|---|---|---|
| `unrecognizable_image` | Cloud Function returns `{ error: 'unrecognizable_image' }` | `meal.photo_analysis.error.unrecognizable` |
| `quota_exceeded` | HTTP 429 or body `{ error: 'quota_exceeded' }` | `meal.photo_analysis.error.quota` |
| `network` | Network-level fetch failure | `meal.photo_analysis.error.network` |
| `invalid_response` | Cloud Function returned malformed/non-JSON body | `meal.photo_analysis.error.generic` |
| `configuration` | `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` not set | `meal.photo_analysis.error.generic` |
| `unauthenticated` | HTTP 401 or 403 — Firebase ID token rejected | `meal.photo_analysis.error.generic` |
| `unknown` | Any other failure | `meal.photo_analysis.error.generic` |

All errors are recoverable — user can dismiss and fill fields manually (D-110).

## Validation Rules
- MacroEstimate is considered valid only when all fields are finite non-negative numbers and `totalGrams > 0` (BR-286).
- All macro values are rounded to 1 decimal place before form pre-fill.
- Confidence defaults to `'low'` when Cloud Function returns an unrecognized confidence value.
- Analysis failure is never a hard blocker for meal creation (D-110).

## Cloud Function Contract
```
POST /analyzeMealPhoto
Headers:
  Authorization: Bearer <Firebase Auth ID token>
  Content-Type: application/json
Body:   { image: string (base64, JPEG), mimeType: 'image/jpeg' }
Response 200: { calories: number, carbs: number, proteins: number, fats: number, totalGrams: number, confidence: 'high' | 'medium' | 'low' }
Response 400: { error: 'unrecognizable_image' }
Response 429: { error: 'quota_exceeded' }
Response 401: { error: 'unauthenticated' }
Response 500: { error: 'unknown' }
```

- Cloud Function must validate Firebase Auth ID token before proxying to OpenAI (BR-288).
- OpenAI API key is server-side only; never shipped in client binary (D-106, BR-289).
- Function URL provided via `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` env var.

## Localization Keys

| Key | Purpose |
|---|---|
| `meal.photo_analysis.cta` | Camera/AI CTA button label |
| `meal.photo_analysis.analyzing` | In-progress loading text |
| `meal.photo_analysis.disclaimer` | Estimate disclaimer shown with results (always visible; BR-290) |
| `meal.photo_analysis.error.unrecognizable` | Unrecognizable image error |
| `meal.photo_analysis.error.quota` | Quota exceeded error |
| `meal.photo_analysis.error.network` | Network error |
| `meal.photo_analysis.error.generic` | Generic fallback error |
| `meal.photo_analysis.attach_photo.label` | Optional photo attachment toggle (SC-214 only) |
| `meal.photo_analysis.confidence.low` | Low-confidence estimate warning |
| `meal.photo_analysis.paywall.locked` | Paywall locked label (D-132) |
| `meal.photo_analysis.paywall.cta_upgrade` | Paywall upgrade CTA — opens RevenueCat native paywall (D-132) |
| `meal.photo_analysis.paywall.loading` | Subscription status loading indicator (D-132) |
| `common.error.retry` | Retry CTA (shared) |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Accessibility
- Camera CTA: `accessibilityLabel` = `meal.photo_analysis.cta`.
- Loading `ActivityIndicator`: `accessibilityLabel` = `meal.photo_analysis.analyzing`.
- Disclaimer banner: `accessibilityRole="alert"`.
- Error container: `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"`.
- Paywall locked banner: `accessibilityRole="alert"` (informs screen reader that the feature is locked).
- Paywall upgrade CTA: `accessibilityLabel` = `meal.photo_analysis.paywall.cta_upgrade`.
- Paywall loading `ActivityIndicator`: `accessibilityLabel` = `meal.photo_analysis.paywall.loading`.

## Implementation Files
| File | Purpose |
|---|---|
| `features/nutrition/meal-photo-analysis.logic.ts` | Pure functions: `isValidMacroEstimate`, `parseMacroEstimateFromResponse`, `mapMacroEstimateToMealInput`, `normalizePhotoAnalysisError`, `buildAnalysisSystemPrompt`, `buildAnalysisUserPrompt` |
| `features/nutrition/meal-photo-analysis.logic.test.ts` | Unit tests (included in 715-test suite; TC-271–TC-274) |
| `features/nutrition/meal-photo-analysis-source.ts` | HTTP source: `analyzeMealPhoto` with `MealPhotoAnalysisSourceDeps` injectable pattern; typed `PhotoAnalysisSourceError` with `PhotoAnalysisErrorReason` union |
| `features/nutrition/meal-photo-analysis-source.test.ts` | 21 unit tests (TC-285) |
| `features/nutrition/use-meal-photo-analysis.ts` | React hook `useMealPhotoAnalysis` — full pipeline: `startCapture` (expo-image-picker action sheet → expo-image-manipulator compress → Cloud Function), `analyze` (direct injection), `reset`, `preFillMealInput` |
| `features/subscription/subscription.logic.ts` | Pure entitlement logic — `AI_ENTITLEMENT_ID = 'student_pro'`, `hasAiAnalysisAccess()` (D-132) |
| `features/subscription/subscription-source.ts` | RevenueCat source layer — `AI_FEATURES_ENTITLEMENT_ID`, `mapCustomerInfoToAiEntitlementStatus`, `presentAiPaywall` (D-132) |
| `features/subscription/use-subscription.ts` | React hook — exposes `aiEntitlementStatus`, `hasAiAccess`, `openAiPaywall`; single `getCustomerInfo()` call maps both entitlements (D-132) |
| `app/(tabs)/nutrition/custom-meals/[mealId].tsx` | SC-214 entry point — camera CTA gated by `hasAiAccess`; paywall banner + loading indicator; result pre-fill, attach-photo toggle |
| `app/(tabs)/nutrition/custom-meals/index.tsx` | SC-215 entry point — camera CTA in quick-log panel gated by `hasAiAccess`; paywall banner + loading indicator; result pre-fill |

## Edge Cases
- Camera/picker cancellation: state returns to `idle`; no form field changes.
- Confidence `'low'`: low-confidence warning shown alongside results; fields remain editable.
- Cloud Function responds `401` or `403`: treated as `'unauthenticated'` error (D-128).
- Compression is applied via `expo-image-manipulator`: resizes to ≤ 1600 px longest side, compresses at 0.75 JPEG quality (FR-230, BR-287, D-107).
- In SC-214: photo attachment after analysis is optional and independent of the analysis result (D-109).
- Paywall dismissed without purchase: entitlement status is refreshed after `presentPaywall` resolves regardless of outcome; if user is still not entitled, paywall banner re-displays (D-132).
- Subscription loading (`isSubscriptionLoading === true` and `hasAiAccess === false`): `ActivityIndicator` shown instead of locked banner — avoids false paywall flash before entitlement is known.
- `aiEntitlementStatus === 'unknown'` (SDK not yet initialised or error): treated as locked — paywall banner shown (strict policy, D-132).

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-229, FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-237, FR-238, FR-239 |
| Use case | UC-003.9 |
| Acceptance criteria | AC-513, AC-514, AC-515, AC-516, AC-517, AC-518, AC-519 |
| Business rules | BR-286, BR-287, BR-288, BR-289, BR-290 |
| Test cases | TC-271, TC-272, TC-273, TC-274 |
| Decisions | D-106, D-107, D-108, D-109, D-110, D-128, D-132 |
| Backlog | BL-108 |
