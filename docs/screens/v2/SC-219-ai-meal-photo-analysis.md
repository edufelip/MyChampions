# SC-219 AI Meal Photo Analysis (V2)

## Route
- No standalone route. SC-219 is a modal/inline surface embedded in:
  - SC-214 Custom Meal Builder (`app/nutrition/custom-meals/[mealId].tsx`) — camera icon adjacent to image upload stub; analysis pre-fills the meal creation form.
  - SC-215 Custom Meal Library Quick Log (`app/nutrition/custom-meals/index.tsx`) — camera icon in the quick-log panel header; analysis pre-fills the nutrition preview panel.

## Objective
Allow users to capture or select a photo of their meal and receive AI-estimated macronutrients (calories, carbs, proteins, fats, totalGrams) that pre-fill the meal form or quick-log panel for review and confirmation before saving.

AI estimates are always advisory — all fields remain editable after pre-fill (BR-286, D-108).

## User Actions
- Tap the "Analyze with AI" CTA to initiate capture.
- Camera or image picker opens (stub — deferred wiring).
- On capture: image is compressed client-side (stub), then sent to Cloud Function.
- Review AI-estimated macros pre-filled into form fields.
- Edit any field before confirming save.
- Tap retry to dismiss error and attempt a new capture.
- In SC-214 only: optionally attach the captured photo to the meal image record (D-109).

## States

| State (`kind`) | Trigger | UI |
|---|---|---|
| `idle` | Initial / after reset | "Analyze with AI" CTA visible |
| `capturing` | `startCapture()` called | Native camera/picker open (stub) |
| `compressing` | Capture complete | Brief loading indicator (stub — no-op currently) |
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
| `common.error.retry` | Retry CTA (shared) |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Accessibility
- Camera CTA: `accessibilityLabel` = `meal.photo_analysis.cta`.
- Loading `ActivityIndicator`: `accessibilityLabel` = `meal.photo_analysis.analyzing`.
- Disclaimer banner: `accessibilityRole="alert"`.
- Error container: `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"`.

## Implementation Files
| File | Purpose |
|---|---|
| `features/nutrition/meal-photo-analysis.logic.ts` | Pure functions: `isValidMacroEstimate`, `parseMacroEstimateFromResponse`, `mapMacroEstimateToMealInput`, `normalizePhotoAnalysisError`, `buildAnalysisSystemPrompt`, `buildAnalysisUserPrompt` |
| `features/nutrition/meal-photo-analysis.logic.test.ts` | Unit tests (included in 301-test suite; TC-271–TC-274) |
| `features/nutrition/meal-photo-analysis-source.ts` | HTTP source: `analyzeMealPhoto` — fetches Cloud Function with Firebase ID token; typed error surface via `PhotoAnalysisSourceError` |
| `features/nutrition/use-meal-photo-analysis.ts` | React hook `useMealPhotoAnalysis` with state machine: `idle/capturing/compressing/analyzing/done/error`; `startCapture` (stub), `analyze`, `reset`, `preFillMealInput` |
| `app/nutrition/custom-meals/[mealId].tsx` | SC-214 entry point — camera CTA, result pre-fill, attach-photo toggle |
| `app/nutrition/custom-meals/index.tsx` | SC-215 entry point — camera CTA in quick-log panel, result pre-fill |

## Edge Cases
- Camera/picker cancellation: state returns to `idle`; no form field changes.
- Confidence `'low'`: low-confidence warning shown alongside results; fields remain editable.
- Cloud Function responds `401`: treated as `configuration` error (token retrieval failure or misconfigured function auth).
- Compression stub is a no-op: image is sent uncompressed until `expo-image-manipulator` wiring is complete (D-107).
- In SC-214: photo attachment after analysis is optional and independent of the analysis result (D-109).

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-229, FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-237, FR-238, FR-239 |
| Use case | UC-003.9 |
| Acceptance criteria | AC-513, AC-514, AC-515, AC-516, AC-517, AC-518, AC-519 |
| Business rules | BR-286, BR-287, BR-288, BR-289, BR-290 |
| Test cases | TC-271, TC-272, TC-273, TC-274 |
| Decisions | D-106, D-107, D-108, D-109, D-110 |
| Backlog | BL-108 |
