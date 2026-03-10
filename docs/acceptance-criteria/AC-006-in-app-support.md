# AC-006 In-App Support

## Feature
Contact support dialog in settings screen.

## Acceptance Criteria
- `AC-601`: Tapping "Contact support" in settings opens a modal dialog.
- `AC-602`: Dialog includes a clear disclaimer about messaging the support team.
- `AC-603`: Subject field is mandatory and limited to 50 characters.
- `AC-604`: Message field is mandatory and limited to 500 characters.
- `AC-605`: Submitting a valid message saves it to the `supportMessages` Firestore collection.
- `AC-606`: Successfully submitted messages include metadata: `userId`, `userEmail`, `userName`, `appVersion`, `platform`, `createdAt`, `updatedAt`, and `status='pending'`.
- `AC-607`: If offline, the submission is persisted locally by Firestore and a notice informs the user it will be sent when connection returns.
- `AC-608`: Character counters provide real-time feedback on input length.
- `AC-609`: Input fields and close button are disabled while submission is in progress.
- `AC-610`: Modal can be dismissed after success or by tapping the close button (when not submitting).

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
    And the message is saved to Firestore

  Scenario: Validation errors
    Given the support modal is open
    When the user taps "Send message" without filling fields
    Then validation errors are shown for subject and message
    And the submit button is enabled for retry

  Scenario: Offline submission
    Given the device is offline
    And the support modal is open
    When the user submits a valid message
    Then a success message is displayed
    And an offline notice informs the user that the message will sync later
```
