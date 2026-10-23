# GPT-6 Astra: Yangzhou Purple Gold Gourd evaluation

23 October 2026. One fresh seed-42 episode with selected historical comparator trajectories. No model was rerun during verification, and no paper source was edited for this evaluation.

## Result and comparison

Astra completed `classic19-yangzhou-gourd` in **146 calls**, under the task's original **230-call cap**. Progress reached 1.0, with 10 invalid calls and nine expected interruption soft stops. Complete gameplay replay and source-bound CLI accounting both pass verification (1/1).

| Model / recorded condition | Calls | Outcome | Call cap |
|---|---:|---|---:|
| GPT-6 Astra (new) | 146 | Goal reached; freshly verified | 230 |
| GPT-6.1 Sol (historical) | 218 | Goal reached | 230 |
| Claude Opus 5.5 (historical initial run) | 230 | Budget exhausted; progress 0.667 | 230 |
| Claude Opus 5.5 (historical continuation) | 280 | Goal reached | 320 |
| Gemini 4 Argon (historical) | 161 | Goal reached | 230 |

The selected Astra trajectory uses 15 fewer calls than Argon and 72 fewer than Sol. Opus's 280-call result is a continuation of the 230-call failure, not another independent sample. These records use different execution revisions and CLI scaffolds; a fixed game seed does not fix cloud sampling. The table is an individual-trajectory comparison, not a model success-rate estimate or a stable capability ordering. Calls are not retrospectively reduced by subtracting optional exploration or side-chest collection.

## Phase-level evidence

Numbers indicate the tool call at which the grader first recorded each milestone. A dash means the initial run did not reach that milestone within its cap.

| Model / condition | Night alarm | Bag recovered | Merchant accusation | Widow met | Well entered | Goal |
|---|---:|---:|---:|---:|---:|---:|
| Astra | 27 | 55 | 67 | 108 | 141 | 146 |
| Sol | 18 | 46 | 60 | 104 | 207 | 218 |
| Opus initial | 56 | 161 | 169 | 177 | — | — |
| Opus continued | 56 | 161 | 169 | 177 | 269 | 280 |
| Argon | 16 | 50 | 68 | 101 | 132 | 161 |

Astra's opening alarm is later than Sol's and Argon's. By the merchant accusation it is close to both, and its main late-phase difference from Sol is the widow-to-well segment: 33 calls (108→141), versus 103 (104→207). Argon's corresponding segment is 31 calls (101→132). Astra then reaches the final task criterion in five more calls. This locates the observed difference without attributing it to unmeasured prior knowledge.

No Astra closed-book quiz was added, so this run does not support claims of absent prior knowledge, memorized walkthroughs, or a false-memory mechanism. The historical quiz analyses are separate evidence. The task goal requires the specified discovery text and a visit to scene 81 (the court); it does not require completing all subsequent Yangzhou story events or the whole game.

The action mix is 59 `walk_to`, 32 `interact`, 32 `advance`, 17 `map`, five `battle`, and one `use_item` calls. The recorded five battles were won. No save/load tool calls were used. Expected battle/dialogue interruptions are counted as soft stops rather than invalid actions; the 10 invalid calls are reported separately.

## Protocol, usage and verification

- `codex-cli:gpt-6-astra`, medium reasoning; Tier B, standard hints; seed 42; classic save `19.rpg`.
- Original 230-call task cap, 1,800-second wall limit, no walkthrough/atlas access, no tactical coaching, no budget expansion or continuation. The boss-specific stripping flag was explicitly disabled.
- Source basis `ab9a7d5bf3d6021eeec42f0b97e213df595664eb`, code label `ab9a7d5-dirty`; task, starting-save and runtime/build/asset hashes are retained.
- The existing enlarged token/virtual-time limits and external usage-at-exit policy remain unchanged; nominal task token caps are not strict incremental limits for the CLI client.

Reported usage: 4,625,255 input tokens including 4,489,344 cached, 3,979 output tokens, 312.042 seconds client duration, and runner-estimated cost **$6.047404**. This is not an independently reconciled invoice or backend-model attestation.

The current task references pass on all three seeds (42, 43, 44), each in 74 calls. This focused check does not validate the full task catalog or imply an optimal reference policy.

The run's shared finalizer directly appended a `client_finalized` event binding the original game-log prefix and raw CLI output; accounting status is `complete`. Verification uses the preserved original execution snapshot with the same fingerprints as the pre-run protocol and reproduces the gameplay outcome. Starting save `19.rpg` also matches the frozen copy, and the task hash is unchanged.

The generic task runner does not automatically put runtime hashes in `run.json`. For this run, fingerprints captured **before model execution** in `evaluation-protocol.json` were attached to `run.json` after collection so the standard verifier can enforce them. The unaugmented final manifest is preserved as `original-run-final.json`; `original-run.json` retains the earlier manifest. These metadata attachments did not change task budgets, game commands, raw client output or game-end events.

All four selected historical comparator records have saved successful verification reports. Their recorded episode digests were checked against the current result/action-log files and match. They are labeled `66bf78d-dirty`; no matching historical execution build was reconstructed or model rerun for this comparison.

## Artifacts

- [Machine-readable comparison and source hashes](astra-yangzhou-gourd-2026-10-23.evidence.json).
- Complete run: `bench/out/astra-20261023-yangzhou-gourd/`.
- Game trajectory: `episodes/classic19-yangzhou-gourd__s42.jsonl`.
- Raw client output: `episodes/classic19-yangzhou-gourd__s42.client.jsonl`; stderr is retained alongside it.
- Protocol: `evaluation-protocol.json`; reference check: `reference-check.txt`; full verification: `verify.json` and `verification-output.txt`.
- Original execution snapshot: `/Volumes/T7-Data/pal/reviews/astra-yangzhou-20261023/frozen-runtime` (local, not a publicly archived build or redistributable game-asset bundle).

Reverification requires matching execution artifacts and separately supplied game assets, and performs no model inference:

```bash
BENCH_STRIP_CHEESE=0 BENCH_BUDGET_TOOL_CALLS=230 PAL_ASSET_DIR=/path/to/owned/assets node bench/bench.mjs verify bench/out/astra-20261023-yangzhou-gourd --runtime-root /path/to/fingerprint-matching/runtime
```
