# External CLI accounting repair and Astra evidence migration

The server's original `end` describes completed gameplay. External client token/cost reports arrive afterward. The former runner updated only result JSON, so strict result/log comparisons correctly rejected the three Astra episodes.

The shared finalizer now appends one `client_finalized` event after client output drains. It binds the original log prefix and raw sibling client log with SHA-256, records client exit metadata and known/unknown usage status, and atomically writes the derived result. The parser independently extracts Codex turn usage or Claude final usage; Argon's unstructured usage remains unknown. Interrupted or malformed usage is not converted to zero. Repeated finalization restores the same projection without adding usage again. All three external runner paths use it.

Verification preserves its gameplay checks and separately checks source hashes, source-derived usage, receipt/result consistency, and the required receipt marker for new runs. Altered raw client evidence also invalidates cached leaderboard verification. Legacy episodes without a new-version marker retain strict legacy behavior; there is no general exception for mismatched usage.

## Validation

- 16 focused regressions cover normal finalization, idempotency, recovery after a missing result, unknown/malformed/timed-out usage, interrupted turns, Claude and Argon parsing, missing/duplicate receipts, altered server prefixes, altered raw client evidence, altered accounting/result values, gameplay tampering, migration backups, and verification-cache invalidation.
- `pnpm run test:bench` passes, including the existing benchmark, battle, cancellation and task/quiz validation checks. These tests use fixtures/local test servers and invoke no model.
- The three Astra episodes pass full verification using the repaired verifier with `--runtime-root /Volumes/T7-Data/pal/reviews/astra-20261023/frozen-runtime`. This original execution snapshot's runtime fingerprint exactly matches the evaluation protocol. New verification results explicitly record the replay root.

## Preserved evidence

Original runs and first failed `verify.json` files are preserved under `/Volumes/T7-Data/pal/reviews/astra-20261023/originals/`. Migration-specific byte-identical backups and hash manifests are under `accounting-backups/` in that same review directory. Existing episode logs received only an appended receipt; their original prefixes and raw client logs remain byte-identical. Result JSON is now the projection of original gameplay end plus client accounting. Historical evaluation-index hashes are retained in `sourceHistory`, and the prior index itself is archived.

Astra outcomes and reported usage/cost did not change: Rain Altar 13 calls, Baihe 107 calls, Baiyue 28 calls and 11 rounds. There were no model reruns or gameplay continuation calls. Full verification reconstructs recorded actions using the original execution build; it does not regenerate model decisions or independently attest provider billing/model identity.

See [operating instructions](../bench/README.md#外部-cli-收尾与历史记账补全) and [updated evaluation](astra-three-scenario-evaluation-2026-10-23.md).
