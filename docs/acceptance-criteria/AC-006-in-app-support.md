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
```
