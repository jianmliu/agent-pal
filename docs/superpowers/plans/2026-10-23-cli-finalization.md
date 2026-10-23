# External CLI finalization implementation plan

Goal: preserve server-end evidence, append source-bound client accounting, verify both, and backfill Astra without model inference.

- [x] Reproduce accounting mismatch with fixture tests; cover known/unknown usage, tampering, missing/duplicate receipts, timeout, idempotency and recovery after receipt append.
- [x] Add shared client finalization/parser with append-only event, end/source hashes and atomic result projection. Integrate Claude, Codex and Argon exit paths.
- [x] Extend verification to validate the receipt and projected accounting separately from unchanged gameplay end/replay; retain legacy checks.
- [x] Run benchmark regressions, preserve original Astra runs and frozen runtime, append migrated receipts from existing CLI logs, reverify against the original runtime, and retain first failures.
- [x] Update evaluation documentation with accounting repair and scope. No model calls and no gameplay changes.
