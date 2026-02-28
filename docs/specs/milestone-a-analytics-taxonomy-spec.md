# Milestone A Analytics Taxonomy Spec (Draft)

## Purpose
Define implementation-ready analytics taxonomy for Milestone A flows:
- BL-001 quick self-guided start
- BL-002 invite QR scan
- BL-010 contextual error copy
- BL-012 event taxonomy baseline

## Scope
- Auth entry and outcomes.
- Role selection and self-guided shortcut.
- Invite submission channels (manual vs QR) and outcomes.
- Error reason instrumentation for auth and invite surfaces.

## Event Naming
- Canonical format: `domain.action.result`
- Domains in Milestone A:
  - `auth`
  - `onboarding`
  - `invite`

## Required Event Properties
- `surface`: screen or feature surface id (for example `auth_sign_in`, `role_selection`, `relationship_management`)
- `step`: logical funnel step name
- `result`: `success` or `failure`
- `reason_code`: optional on failures (for example `invalid_credentials`, `email_exists`, `invalid_invite_code`, `pending_cap_reached`, `code_rotated_canceled`)
- `channel`: optional where relevant (`manual`, `qr`, `google`, `apple`, `email_password`)
- `role_context`: `student` or `professional` when known

## Event Catalog (Milestone A)
| Event | Trigger | Minimum Properties |
|---|---|---|
| `auth.entry.viewed` | User opens sign-in/create-account entry | `surface`, `step`, `result=success` |
| `auth.sign_in.submitted` | User submits sign-in | `surface`, `step`, `channel`, `result` |
| `auth.sign_in.failed` | Sign-in fails | `surface`, `step`, `channel`, `result=failure`, `reason_code` |
| `auth.sign_up.submitted` | User submits create-account | `surface`, `step`, `channel`, `result` |
| `auth.sign_up.failed` | Create-account fails | `surface`, `step`, `channel`, `result=failure`, `reason_code` |
| `onboarding.role.selected` | User selects Student/Professional | `surface`, `step`, `role_context`, `result=success` |
| `onboarding.self_guided_start.clicked` | User taps quick self-guided start | `surface`, `step`, `role_context=student`, `result=success` |
| `invite.submit.requested` | Student submits invite code | `surface`, `step`, `channel`, `result` |
| `invite.submit.failed` | Invite submission fails | `surface`, `step`, `channel`, `result=failure`, `reason_code` |
| `invite.pending.created` | Invite accepted to pending state | `surface`, `step`, `channel`, `result=success` |
| `invite.pending.canceled` | Pending request is canceled by code rotation | `surface`, `step`, `result=success`, `reason_code=code_rotated_canceled` |

## Redaction Requirements
- Never include raw:
  - password values
  - auth tokens
  - full invite code
  - full email
- Allowed alternatives:
  - boolean flags (`email_present=true`)
  - masked email domain only (if needed for debugging policy)
  - hashed invite fingerprint (non-reversible) if strictly necessary

## Validation Checklist
- Each Milestone A screen emits the required view/submit/outcome events.
- Failure reasons map to controlled `reason_code` values.
- Sensitive fields are absent from client and server telemetry payloads.

## Traceability Links
- Functional requirements: `FR-206`, `FR-207`, `FR-208`.
- Business rules: `BR-264`, `BR-265`, `BR-266`.
- Acceptance criteria: `AC-251`, `AC-252`.
- Test cases: `TC-254`, `TC-255`.
