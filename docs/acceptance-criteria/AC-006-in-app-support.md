# AC-006 In-App Support

## Feature
Contact support dialog in settings screen.

## Acceptance Criteria
- `AC-601`: Tapping "Contact support" in settings opens a modal dialog.
- `AC-602`: Dialog includes a clear disclaimer about messaging the support team.
- `AC-603`: Subject field is mandatory and limited to 50 characters.
- `AC-604`: Message field is mandatory and limited to 500 characters.
- `AC-605`: Submitting a valid message sends it to the MyChampions server and saves it to the PostgreSQL `support_messages` table.
- `AC-606`: Successfully submitted messages include metadata: `userId`, `userEmail`, `userName`, `appVersion`, `platform`, `createdAt`, `updatedAt`, and `status='pending'`.
- `AC-607`: If offline, support submission is blocked and the modal shows the standard offline write-lock notice.
- `AC-608`: Character counters provide real-time feedback on input length.
- `AC-609`: Input fields and close button are disabled while submission is in progress.
- `AC-610`: Modal can be dismissed after success or by tapping the close button (when not submitting).
- `AC-611`: On web, the visible support sheet exposes `role="dialog"`, `aria-modal="true"`, and an accessible name derived from the localized dialog title.
- `AC-612`: The icon close control and form Cancel action expose distinct localized accessible names; focus remains contained while open and returns to the Contact support trigger after dismissal.
- `AC-614`: The MyChampions server atomically accepts at most three support messages per authenticated user in fifteen minutes and ten in twenty-four hours across concurrent workers, restarts, and blue/green slots. An over-limit request creates no support row and returns `429` with `error.code='support_rate_limited'` and an accurate `Retry-After` header.
- `AC-615`: A valid idempotency key identifies one logical support draft. A replay returns the original result without inserting another support row or consuming quota, and this check occurs before rate-limit evaluation. Older clients without this header remain quota-controlled through a per-request server key; malformed supplied keys are rejected.
- `AC-616`: On a typed support-rate-limit response, the app retains both field values, presents a localized countdown, disables Send message until the server-provided cooldown expires, and never automatically retries the request. Temporarily closing and reopening the dialog during that cooldown retains the draft, countdown, and idempotency key. The submit path rejects immediate duplicate presses before React state renders the loading state.
- `AC-617`: The production ingress applies a trusted-edge per-IP support-message guard that is deliberately higher than the authenticated per-user limit and does not trust spoofable forwarding headers.
- `AC-613`: On compact viewports, the support sheet uses a neutral grey backdrop and a restrained Send message CTA with no extended glow. A deliberate downward drag from the visible sheet handle dismisses the sheet; short drags spring back without losing entered content.

## Gherkin Scenarios
```gherkin
Feature: Contact Support

  Scenario: Open support dialog
    Given the user is on the Settings screen
    When the user taps "Contact support"
    Then the support modal is displayed
    And the subject and message fields are empty
    And character counters show 0/50 and 0/500

  Scenario: Submit valid support message
    Given the support modal is open
    When the user enters a subject "Login issue"
    And the user enters a message "I cannot sign in."
    And the user taps "Send message"
    Then a success message is displayed
    And the message is saved by the MyChampions server

  Scenario: Validation errors
    Given the support modal is open
    When the user taps "Send message" without filling fields
    Then validation errors are shown for subject and message
    And the submit button is enabled for retry

  Scenario: Offline submission
    Given the device is offline
    And the support modal is open
    When the user enters a valid subject and message
    Then the offline write-lock notice is displayed
    And the message cannot be submitted until connectivity returns

  Scenario: Support submission is rate-limited
    Given the authenticated user has submitted three messages in the last fifteen minutes
    And the support dialog contains a new valid draft
    When the user taps "Send message"
    Then the server returns a typed rate-limit response with Retry-After
    And the dialog retains the draft and presents a localized cooldown
    And Send message remains disabled until that cooldown expires

  Scenario: Reopen support dialog during rate-limit cooldown
    Given the support dialog retains a draft during an active server-provided cooldown
    When the user closes and reopens the support dialog before the cooldown expires
    Then the draft and cooldown remain visible
    And Send message remains disabled
```
