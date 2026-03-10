# BR-004 Support and Compliance

## Feature
In-App Support Messaging.

## Business Rules
- `BR-401`: Support messages are stored in Firestore for auditability and later processing.
- `BR-402`: Character limits are enforced both in UI and logic layers (50 for subject, 500 for body).
- `BR-403`: Messages are trimmed before storage to ensure data consistency.
- `BR-404`: Every support message must be associated with the authenticated user's metadata (UID, Email, Name) at the time of submission.
- `BR-405`: Default status for new support messages is `pending`.
- `BR-406`: Support messages are write-only for the end-user (app client can create but not list or update).
- `BR-407`: Offline messages follow the project's optimistic write policy (BL-008). They are persisted locally and synced by Firestore when connectivity returns.
