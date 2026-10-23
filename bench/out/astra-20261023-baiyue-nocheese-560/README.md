# Astra final-boss resource ablation, seed 42

Recorded result: victory on attempt 2, 220 cumulative tool calls, 54 winning battle rounds. Jiushen, Qian Kun Yi Zhi and Yingu were removed on load and automatic reload. The complete action JSONL, raw external-client JSONL, stderr, final result and summary are retained in this directory.

- `ablation-protocol.json`: prespecified model, seed, budgets, removals and runtime fingerprints.
- `ablation-validation.json`: inventory/skill-prompt invariant audit and per-attempt summary.
- `verify.json` and `verification-output.txt`: successful full gameplay/accounting verification.
- `negative-control-without-stripping.txt`: expected verification failure when the stripping flag is disabled, without replacing the successful record.
- `artifact-inventory.json`: SHA-256/size inventory for these artifacts.

The source basis is commit `12fd2687fd761556ef02f2578c6eadf1c628de40`. The original fingerprint-matching execution snapshot remains local at the path recorded in the protocol; it is not part of this repository artifact. Full game replay requires that matching build and separately supplied, legally obtained assets. Historical absolute paths inside provenance are preserved rather than rewritten. No model rerun is required for verification.

From the repository root:

```bash
BENCH_STRIP_CHEESE=1 BENCH_BUDGET_TOOL_CALLS=560 PAL_ASSET_DIR=/path/to/owned/assets node bench/bench.mjs verify bench/out/astra-20261023-baiyue-nocheese-560 --runtime-root /path/to/matching/runtime
```

Source-bound client accounting can be checked without game execution:

```bash
node --input-type=module -e 'import {readClientFinalization} from "./bench/client-finalization.mjs"; console.log(readClientFinalization("bench/out/astra-20261023-baiyue-nocheese-560/episodes/baiyue-single-origin__s42.jsonl").result.accountingStatus)'
```

See `docs/astra-baiyue-ablation-2026-10-23.md` and its evidence JSON for comparator sources, budget/version differences, and scope. The three historical models were not rerun or freshly verified against reconstructed historical builds in this experiment.
