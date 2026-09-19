# BR-004 Support and Compliance

## Feature
In-App Support Messaging.

## Business Rules
- `BR-401`: Support messages are submitted to the MyChampions server and stored in the server PostgreSQL `support_messages` table for auditability and later processing.
- `BR-402`: Character limits are enforced both in UI and logic layers (50 for subject, 500 for body).
- `BR-403`: Messages are trimmed before storage to ensure data consistency.
- `BR-404`: Every support message must be associated with the authenticated user's metadata (UID, Email, Name) at the time of submission.
- `BR-405`: Default status for new support messages is `pending`.
- `BR-406`: Support messages are write-only for the end-user (app client can create but not list or update).
- `BR-407`: Offline support submission is blocked by the standard write-lock notice; messages are submitted only when the app can reach the server.
- `BR-408`: The server must atomically limit accepted messages to three per authenticated user in any rolling fifteen-minute window and ten in any rolling twenty-four-hour window. A limit rejection creates no `support_messages` row and returns `429 support_rate_limited` with the whole-second `Retry-After` until all active windows have capacity, including enough expirations when historical traffic exceeds a threshold. Acceptance timestamps and rolling windows use the shared database clock after the per-user lock is acquired.
- `BR-409`: The current client must attach a valid idempotency key to each logical support draft. The server checks an existing `(auth_uid, idempotency_key)` result before quota evaluation; a replay returns the original message identifier without creating a row or consuming quota. For rollout compatibility, older clients without the header use a server-generated per-request key and the same quota; lost-response retry deduplication requires an upgraded client. Malformed supplied keys remain rejected.
- `BR-410`: The production Nginx ingress applies a higher coarse per-IP guard only to `POST /support/messages`, keyed from the trusted edge socket address (`$binary_remote_addr`), never from client-supplied forwarding headers. This guard complements rather than replaces the authenticated server limit.
- `BR-411`: Support submission observability records only the outcome (`accepted`, `replayed`, `limited`, or `failed`); it must not log raw message content, account identifiers, or idempotency keys.
