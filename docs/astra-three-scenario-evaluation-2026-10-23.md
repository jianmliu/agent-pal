# GPT-6 Astra: three-scenario evaluation against historical Opus, Sol, and Argon records

Date: 23 October 2026. This is an exploratory comparison of individual trajectories, not an estimate of model success probabilities or a matched leaderboard. The requested model was run as `codex-cli:gpt-6-astra`; no model substitution was made.

## Protocol and results

Three fresh, isolated Astra episodes used Tier B, standard hints, game seed 42, medium reasoning, original resources, and a 1,800-second wall limit per episode. The call caps were 80 for Rain Altar, 240 for Baihe Medicine, and 180 for Baiyue. The existing boss task allows automatic checkpoint reload after defeat. No tactical coaching or continuation was supplied during these episodes. Three independent runner processes ran concurrently; their wall times include shared-machine and service load.

Historical comparator results were extracted from episode files rather than copied from manuscript tables. Each entry below describes one selected episode. All four agents reached the goal on each selected trajectory, with retry/continuation differences shown explicitly.

| Scenario | GPT-6 Astra (new) | Claude Opus 5.5 (historical) | GPT-6.1 Sol (historical) | Gemini 4 Argon (historical) |
|---|---|---|---|---|
| Rain Altar | 13 calls | 10 calls, medium | 13 calls, medium | 11 calls |
| Baihe Medicine | 107 calls | 176 calls, continued beyond 120 | 117 calls | 90 calls |
| Baiyue | 28 calls; first attempt; 11 winning rounds | 157 calls; fourth attempt; 17 winning rounds | 33 calls; first attempt; 14 winning rounds | 42 calls; second attempt; 7 winning rounds |

Calls in the boss row are cumulative episode calls, whereas rounds describe only the winning battle. Argon's shorter winning battle followed an earlier loss. Opus's medicine record is a budget-expanded continuation, not a fresh independent sample at 240 calls. Astra completed medicine before the 120-call observation point despite receiving a 240-call cap; anticipation of a different budget can still affect policy.

## Astra trajectory observations

### Rain Altar

Astra activated the tablet at call 3, inspected the inscription and a pillar, then placed Wind, Fire, Thunder, Earth, and Water at calls 9–13 without a rejected placement. Its 13 calls equal the historical Sol record. This trajectory supports correct mapping and execution in this episode; it does not establish whether the mapping came from prior knowledge, inference, or both. No closed-book quiz was added in this run.

### Baihe Medicine

Milestones were ginkgo at call 17, carp at call 50, antler at call 101, and goal at call 107. The agent visited scenes 53, 52, 49, 51, and 48. It placed the trap three times (calls 70, 89, and 98), recovering from ineffective placements before catching the deer. It incurred four invalid calls and two expected interruption soft stops.

The selected trajectory used fewer calls than historical Sol (117) and continued Opus (176), and more than Argon (90). It demonstrates recovery within the chosen budget, not a stable model ordering or a causal effect of prior knowledge.

### Final boss

The authoritative battle outcome was `won`, including remaining enemies, at call 28. There were no auto-reload notes and one recorded battle, so this was a first-attempt win. The winning battle started 11 rounds and completed 10 before its terminal resolution, using the existing scorer's 11-round convention.

The call log contains one Yingu item action, three Jiushen actions, nine Qian Kun Yi Zhi actions, six Wuqi Chaoyuan actions, weapon throws, MP restoration, status recovery, and revival. These are issued actions; they are not independent damage measurements or proof that every queued action executed before battle termination. The final call reported 33,320 less cash. Revivals were used, so this is not reported as a zero-death victory.

Relative to the selected historical records, Astra won on its first attempt in fewer rounds than Sol (11 versus 14). Argon has a shorter winning attempt (7 rounds), with a preceding failed attempt. This evaluation did not run Astra's no-cheese ablation, so it cannot place Astra in that separate comparison.

## Usage and verification

| Astra scenario | Input tokens (including cache) | Cached input | Output tokens | CLI duration | Runner-estimated cost |
|---|---:|---:|---:|---:|---:|
| Rain Altar | 202,706 | 178,048 | 566 | 54.2 s | $0.452928 |
| Baihe Medicine | 2,043,753 | 1,973,888 | 2,592 | 208.5 s | $2.802138 |
| Baiyue | 507,847 | 470,912 | 1,515 | 82.5 s | $0.916012 |

Usage comes from the CLI's reported completion events. Cost is the existing runner's estimate, not an independently reconciled invoice. Cached input is included in input totals. All three durations were measured during concurrent execution and should not be used as a matched latency ranking.

The current reference trajectories pass on all nine task–seed combinations (42, 43, 44 across these three tasks). This is a focused reference check, not a revalidation of the full 23-task catalog.

All three Astra action/state replays have zero differences when compared with their original server-end events. Initially, **the standard full `bench verify` failed for all three**: `runCodexCli` adds tokens and cost to the result JSON after the server has finalized the JSONL end event with zero usage. The verifier correctly detects this result-versus-log discrepancy. The raw records were not edited to hide it. Separate gameplay replay checks established the recorded game outcomes. After the approved accounting fix, append-only `client_finalized` events were reconstructed from the same CLI logs, with original prefixes and first failed verifications archived. All three now pass full verification using the new verifier and the preserved, fingerprint-matching original execution runtime. No model inference was rerun; calls, milestones, outcomes, tokens, and costs are unchanged. See [CLI finalization and backfill instructions](../bench/README.md#外部-cli-收尾与历史记账补全).

Current `episode.mjs` also multiplies the task token limit by at least 500 and virtual-time limit by at least 20. External CLI usage is finalized at episode end. These were the actual existing policies for this run; the call and wall limits above remain the practical stopping controls. The per-turn API output cap for built-in providers is not a universal control over the external Codex CLI.

## Comparison limits and artifacts

Astra used source revision `896e955938fea8bace2782d405788c48cb32d3a6`, reported as `896e955-dirty` because the working tree had untracked videos. The explicit protocol records runtime/build/assets and task hashes. Historical comparator code labels are `3ccdd34`, `0884035`, or `0884035-dirty`; their exact runtime equality has not been established. CLI scaffolding, provider behavior, budget announcements, and continuation history differ. No contemporaneous reruns of the other models were conducted.

The defensible result is that Astra reached all three goals in the three observed episodes, with a first-attempt boss victory and medicine completion below 120 calls. Repeated independent samples and frozen matched conditions are needed before claiming a general advantage.

- [Machine-readable comparison, source hashes, and protocol](astra-three-scenario-evaluation-2026-10-23.evidence.json).
- Raw Astra runs: `bench/out/astra-20261023-rain`, `bench/out/astra-20261023-baihe`, and `bench/out/astra-20261023-baiyue`.
- Protocol and separate gameplay replay reports: `/Volumes/T7-Data/pal/reviews/astra-20261023/`.
- Current reference-check output: `/Volumes/T7-Data/pal/reviews/astra-20261023-reference-check.txt`.

Local run directories are evidence locations, not public archive URLs. The evaluation itself did not change game code or task definitions. The subsequent approved CLI accounting repair updates runner/verification code and appends derived accounting evidence; original records and their hashes remain archived.
