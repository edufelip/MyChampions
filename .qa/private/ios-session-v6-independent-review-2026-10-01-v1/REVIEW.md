# iOS session v6 independent review

Verdict: **blocked before canonical integration**.

This read-only review used the frozen candidate manifest `dce4d5e5acd2946502714afb29a775027b7a4314c3ea3b1a5f5c2162e408863c`. It inspected the cumulative and v4-incremental capture patches, the auth reader patch, the candidate loader/tests, the canonical shared comparator, declaration generation, and the CI helper-closure tests. No simulator, backend, native resource, ADB, hosted call, or public receipt was used.

The profile/domain acquisition and comparator wiring are substantially present: all four checkpoints have distinct profile and domain files, readback receipts bind run/scope/API/fixture metadata, the comparator enforces the full declared projection and bounded coach timestamp exception, and the source performs actual frame/tree and sign-out checks. The following defects still block transfer:

1. After cancel, the source checks only `sessionPresent`; it does not require the persisted profile hash to remain the verified coach hash.
2. The generic finalizer rewrites the transport sidecar after the session ledger has been marked complete, without a final hash/readback/comparator pass.
3. The signed-out relaunch window starts after terminate and has no closed request-id boundary.
4. Declaration generation and `tests/ci` helper closure omit a session entry point; the frozen session inventory also omits the imported `native-view-evidence.ts` path. Candidate tests only inspect patch text.
5. Frozen negative controls do not cover wrong-actor storage, cancel hash mismatch, late transport mutation, signed-out-window leakage, abort publication boundaries, or cumulative/incremental transfer equivalence.
6. The session abort wrapper does not pass a signal into device verification or the initial screenshots, so strict deadline/cancellation closure is incomplete.

The candidate loader's `loaded` status is intentionally narrow profile/domain input validation and must not be read as behavior, runtime, cleanup, or public qualification.

See `REVIEW.json` for exact source paths, line references, impacts, and required corrections.
