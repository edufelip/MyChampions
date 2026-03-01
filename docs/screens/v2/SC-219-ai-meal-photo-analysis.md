# SC-219 AI Meal Photo Analysis

## Purpose
Allow users to capture or select a photo of their meal and receive AI-estimated macronutrients (calories, carbs, proteins, fats, totalGrams) that pre-fill the meal form or quick-log panel for review and confirmation.

## Entry Points
- SC-214 Custom Meal Builder: camera icon adjacent to the image upload stub. Analysis pre-fills the meal creation form.
- SC-215 Custom Meal Library Quick Log: camera icon in the quick-log panel header. Analysis pre-fills the grams/nutrition preview panel.

## Screen States

### Idle
- Camera CTA button visible.
- Tapping CTA opens device camera (or image picker if camera unavailable).

### Capturing
- Native camera/picker UI is active.
- On cancel: state returns to idle; no change to form fields.

### Compressing
- Brief loading indicator shown.
- Image is compressed client-side to ≤1.5 MB / ≤1600 px longest side before encoding.

### Analyzing
- Full-width loading indicator with copy `meal.photo_analysis.analyzing`.
- Cancel not supported during in-flight request (user may navigate away).

### Done — Result Shown
- All pre-filled fields display estimated values.
- AI disclaimer banner shows `meal.photo_analysis.disclaimer`.
- Confidence indicator shown when confidence is `low`: `meal.photo_analysis.confidence.low`.
- All fields remain editable.
- In SC-214 only: optional attach-photo toggle shows `meal.photo_analysis.attach_photo.label`.

### Error
- Reason-specific error message replaces loading indicator:
  - Unrecognizable image: `meal.photo_analysis.error.unrecognizable`
  - Quota exceeded: `meal.photo_analysis.error.quota`
  - Network failure: `meal.photo_analysis.error.network`
  - Any other: `meal.photo_analysis.error.generic`
- "Try again" CTA returns to idle.
- Form fields remain editable for manual entry.

## Localization Keys Used
| Key | Purpose |
|---|---|
| `meal.photo_analysis.cta` | Camera/AI CTA button label |
| `meal.photo_analysis.analyzing` | In-progress loading text |
| `meal.photo_analysis.disclaimer` | Estimate disclaimer shown with results |
| `meal.photo_analysis.error.unrecognizable` | Unrecognizable image error |
| `meal.photo_analysis.error.quota` | Quota exceeded error |
| `meal.photo_analysis.error.network` | Network error |
| `meal.photo_analysis.error.generic` | Generic fallback error |
| `meal.photo_analysis.attach_photo.label` | Optional photo attachment toggle (SC-214 only) |
| `meal.photo_analysis.confidence.low` | Low-confidence estimate warning |
| `common.error.retry` | Retry CTA (shared) |

## Cloud Function Contract
```
POST /analyzeMealPhoto
Headers:
  Authorization: Bearer <Firebase Auth ID token>
Body:   { image: string (base64, JPEG), mimeType: 'image/jpeg' }
Response 200: { calories: number, carbs: number, proteins: number, fats: number, totalGrams: number, confidence: 'high' | 'medium' | 'low' }
Response 400: { error: 'unrecognizable_image' }
Response 429: { error: 'quota_exceeded' }
Response 401: { error: 'unauthenticated' }
Response 500: { error: 'unknown' }
```

## Accessibility
- Camera CTA button: `accessibilityLabel` = `meal.photo_analysis.cta`.
- Loading state: `ActivityIndicator` `accessibilityLabel` = `meal.photo_analysis.analyzing`.
- Disclaimer: `accessibilityRole="alert"`.
- Error container: `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"`.

## Business Rules
- BR-286: AI result is advisory; all fields remain editable.
- BR-287: Image compressed client-side before transmission.
- BR-288: Cloud Function validates Firebase Auth ID token.
- BR-289: OpenAI API key never in client binary.
- BR-290: AI disclaimer always shown alongside results.

## Traceability
- BL-108
- FR-229, FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-237, FR-238, FR-239
- UC-003.9
- AC-513, AC-514, AC-515, AC-516, AC-517, AC-518, AC-519
- BR-286, BR-287, BR-288, BR-289, BR-290
- TC-271, TC-272, TC-273, TC-274
- D-106, D-107, D-108, D-109, D-110
