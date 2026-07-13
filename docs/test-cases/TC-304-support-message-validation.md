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
