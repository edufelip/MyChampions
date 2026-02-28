# SC-213 Account And Privacy Settings (V2)

## Route
- `/settings/account`

## Objective
- Provide compliance-critical user controls for privacy policy access and account deletion initiation.

## User Actions
- Primary:
  - View privacy policy link.
  - Initiate account deletion request.
- Secondary:
  - Review data retention/deletion notice.

## States
- Loading: fetch account status and legal config links.
- Empty: no optional settings configured.
- Error: deletion request submission failure or invalid legal URL.
- Success: deletion workflow started and confirmation shown.

## Validation Rules
- Privacy policy URL must be present and valid.
- Account deletion initiation must be available for accounts created in-app.
- Deletion flow should communicate retention timeline when immediate hard-delete is not possible.
- Deletion flow should disclose that retained history removes direct identifiers and keeps only minimum anonymized/pseudonymized records required by policy.

## Data Contract
- Inputs:
  - Authenticated account context.
  - Legal configuration links.
- Outputs:
  - Deletion request record.
  - User-visible compliance confirmation states.

## Edge Cases
- Deleted/deactivated accounts should block repeated deletion requests.
- Network failure during deletion initiation must preserve user state and allow retry.

## Links
- Functional requirement: FR-133, FR-157
- Use case: UC-002.5
- Acceptance criteria: AC-305, AC-306, AC-307, AC-308, AC-310
- Business rules: BR-225, BR-231
- Test cases: TC-304, TC-305, TC-306, TC-307, TC-309
- Diagram: docs/diagrams/documentation-lifecycle.md
