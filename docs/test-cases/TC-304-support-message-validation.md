# TC-304 Support Message Validation

## Feature
In-App Support Dialog.

## Test Cases
- `TC-304.1`: **Empty Submission**
  - Given: Support modal is open.
  - When: User taps "Send message" with subject and body empty.
  - Then: Validation errors for both fields are shown.
  - And: Button returns to idle state.

- `TC-304.2`: **Subject Length Enforcement**
  - Given: Support modal is open.
  - When: User enters exactly 50 characters in subject.
  - Then: Counter shows 50/50.
  - And: Input stops accepting new characters (native maxLength).

- `TC-304.3`: **Message Body Length Enforcement**
  - Given: Support modal is open.
  - When: User enters 500 characters in message.
  - Then: Counter shows 500/500.
  - And: Input stops accepting new characters (native maxLength).

- `TC-304.4`: **Successful Submission (Online)**
  - Given: Device is online.
  - When: User submits valid subject and body.
  - Then: "Submitting..." indicator appears.
  - And: Success view is shown with "Message sent successfully!".
  - And: The MyChampions server stores a new row in `support_messages` with correct metadata.
  - E2E harness: With `EXPO_PUBLIC_E2E_AUTH_SESSION=true` in dev, the source layer returns a deterministic support id for the explicit E2E user so this case can verify modal success without mutating provider data.

- `TC-304.5`: **Offline Resilience**
  - Given: Device is offline.
  - When: User enters valid subject and body.
  - Then: Offline notice "Connect to the internet to save changes" is displayed.
  - And: Submit remains blocked until connectivity returns.
  - And: No support message is written.

- `TC-304.6`: **Dismissal Logic**
  - Given: User is on success screen.
  - When: User taps "Continue".
  - Then: Modal closes.
  - And: Fields are reset for next open.

- `TC-304.7`: **Mobile Web Dialog Accessibility**
  - Given: The authenticated Student opens the support modal at the 390x844 and 320x720 mobile viewport sizes (Chromium/Firefox/WebKit desktop engines resized, no touch-input emulation).
  - When: The browser accessibility tree is inspected while the modal is open.
  - Then: Exactly one visible named `role="dialog"` exposes `aria-modal="true"` and is labelled by the localized "Talk to support" heading.
  - And: The icon close control and form Cancel action have distinct localized accessible names.
  - And: Focus remains inside the dialog during Tab/Shift+Tab navigation and returns to the Contact support trigger after Escape dismissal.

- `TC-304.9`: **Server Rate-Limit Boundaries and Concurrency**
  - Given: One authenticated user submits support messages through the Postgres repository from concurrent server workers.
  - When: The fourth message in fifteen minutes or eleventh in twenty-four hours is attempted.
  - Then: Exactly three or ten rows respectively are accepted, the overflow creates no row, and the returned Retry-After waits until every limiting window has capacity, including historical traffic above the new thresholds.
  - And: Skewing an application worker clock does not bypass the database-clock quota.

- `TC-304.10`: **Idempotent Support Replay**
  - Given: A valid support draft has an idempotency key.
  - When: The request is repeated with the same authenticated user and key, including after a lost client response.
  - Then: The original message identifier is returned, no duplicate row is created, and no additional quota is consumed.
  - And: A legacy client without the key remains accepted within quota; malformed supplied keys remain rejected.

- `TC-304.11`: **Server CORS Contract**
  - Given: An approved browser origin prepares a support submission.
  - When: It preflights `Authorization` and `Idempotency-Key`.
  - Then: The server allows the configured origin and headers; an unapproved origin remains rejected.

- `TC-304.12`: **Client Rate-Limit Cooldown**
  - Given: The server responds `429 support_rate_limited` with `Retry-After`.
  - When: The app receives the response.
  - Then: It preserves the draft, exposes localized countdown copy, disables Send message, and makes no automatic retry.
  - When: The user temporarily closes and reopens the support dialog before the cooldown expires.
  - Then: The draft, countdown, and idempotency key remain in effect, and Send message remains disabled.

- `TC-304.13`: **Synchronous Duplicate Guard**
  - Given: A valid support draft is submitted.
  - When: A second tap arrives before the first state render.
  - Then: The in-memory submission gate accepts only the first request and releases after that request settles.

- `TC-304.14`: **Server-Backed Browser Cooldown**
  - Given: A browser creates a real server cookie session and submits three valid support drafts to the web E2E server.
  - When: It submits a fourth distinct draft.
  - Then: The first three server-route requests succeed and the fourth response preserves the draft, shows the localized cooldown, and disables Send message. The E2E auth-session bypass is disabled for this case.
