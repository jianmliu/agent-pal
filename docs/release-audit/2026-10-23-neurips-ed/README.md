# NeurIPS E&D release reconnaissance — 23 October 2026

This directory preserves a local, no-model-cost audit used to write the [formal release plan](../../superpowers/plans/2026-10-23-neurips-ed-benchmark-release.md). It is not a frozen release or proof of independent reproduction. The open English manuscript, LaTeX and PDF were not changed.

- `audit.json`: observed commit, source hashes, check scope/results, unknown reference pairs and official policy links.
- `task-catalog.json`: all 23 tasks / 67 declared task-seed pairs, start files, budgets, tiers, available reference seeds and task hashes.
- `schema-validation.txt`: successful current schema/quiz validation.
- `bench-tests.txt`: successful `pnpm run test:bench` output; these are not full game-reference or resource-release checks.
- `reference-reconnaissance.txt`: `node bench/bench.mjs check --jobs 2` output under explicit repository asset/save directories. No `--write-par` was used.
- `reference-process-status.json`: the audit wrapper stopped the reference parent at its prespecified global 240-second limit. 62 success rows were observed; five pairs remain unknown. No remaining reference child process was observed in the subsequent process check. This is not an individual task timeout classification.
- `runtime-observed.json`: hash of the local runtime when observed during reconnaissance. The engine dist existed before the audit; its correspondence to a fresh build was not established. It is not a before/after immutable-runtime certificate.

The workspace contained an unrelated board edit and another evaluation directory. Their presence is recorded rather than cleaned up. Any in-progress model calls from another session are outside this audit; this audit itself invoked no model providers. Policy links describe the published 2026 E&D rules and must be checked again for a future submission year.

Do not use the successful-run showcase leaderboard to recover complete experimental denominators. The release plan requires a separate immutable all-trial ledger, explicit repetition IDs, evidence-backed replay labels, resource access/provenance and independent clean-build acceptance before a formal model campaign.
