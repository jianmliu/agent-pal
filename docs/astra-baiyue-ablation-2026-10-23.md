# GPT-6 Astra: Baiyue ablation without Jiushen, Qian Kun Yi Zhi, or Yingu

23 October 2026. One fresh Astra trajectory, compared with three selected historical trajectories. These results do not estimate model success probabilities or establish a matched model ranking.

## Result and comparison

GPT-6 Astra won on its second attempt, at cumulative call 220. The winning battle took 54 rounds, following a 27-round first-attempt defeat. There were zero invalid calls and one automatic checkpoint reload. The complete game trajectory and external-client accounting pass `bench verify` (1/1) using the preserved original execution snapshot.

| Model | Outcome in selected trajectory | Winning attempt | Cumulative calls | Winning battle rounds | Logged call cap |
|---|---|---|---|---|---|
| GPT-6 Astra (new) | Won; freshly verified | 2 | 220 | 54 | 560 |
| Claude Opus 5.5 (historical) | Won | 11 | 542 | 36 | 560 |
| GPT-6.1 Sol (historical) | Won | 2 | 176 | 37 | 180 |
| Gemini 4 Argon (historical) | Won | 2 | 114 | 39 | 360 |

Cumulative calls include failed attempts; winning rounds describe only the successful battle. Opus and Argon records come from historical expanded-budget runs, and Opus used continuation across client sessions. Equal winning-attempt counts therefore do not imply equal interaction or compute cost. Astra used more calls and winning rounds than the selected Sol and Argon records. Relative to Opus, it used fewer attempts and cumulative calls, while its winning battle was longer. All are individual observations under different budgets and execution versions.

## Prespecified protocol

- Task `baiyue-single-origin`, game seed 42, Tier B, standard hints, original task levels/items/cash except the stated removals.
- Model `codex-cli:gpt-6-astra`, medium reasoning, fresh isolated external CLI session.
- `BENCH_STRIP_CHEESE=1`: remove Jiushen (magic 370), Qian Kun Yi Zhi (magic 394), and Yingu (item 141) on initial handoff and after every automatic defeat reload.
- 560 total tool calls and 1,800 seconds wall time; stop at task victory or the existing failure/budget conditions. No extension, tactical coaching, or post-budget continuation.
- The runtime's existing enlarged token/virtual-time limits and external CLI usage-at-exit behavior remain in effect. Nominal task token caps are not strict incremental controls for this external client.
- The task's existing `par = 35` refers to an original-resource reference, not a no-cheese reference or an optimal ablation policy. Its printed reference-relative efficiency should not be interpreted as an ablation capability score.

The new execution basis was commit `12fd2687fd761556ef02f2578c6eadf1c628de40`, with code label `12fd268-dirty` and explicit runtime/build/asset fingerprints. Historical comparator labels are `0884035-dirty`; exact executable equivalence has not been established. A game seed does not fix cloud model sampling. No closed-book quiz, other game seed, or independent decoding replication was added.

## Trajectory observations

Attempt 1 comprises calls 1–68. It mixed weapon throws, attacks, and healing but lost in round 27. The minimum recorded Baiyue HP before reload was 11,966.

Attempt 2 comprises calls 69–220. The trajectory used repeated Zhenyuan Huti protection, Tiangang Zhanqi and Zuixian Wangyuebu attack buffs, healing/revival, and weapon or consumable throws. Across both attempts the log contains 24 Zhenyuan Huti, 49 Wuqi Chaoyuan, 27 Yuanling Guixin Shu, and 12 Jianshen action submissions. These counts describe submitted commands, not separately attributed executed damage. In the last round it submitted Jianshen and a Fire Silkworm Gu throw; the authoritative battle outcome was `won`. It also submitted Huashi Shui twice at calls 214 and 216 while the recorded boss HP was 791. Those accepted submissions did not immediately end the encounter; the record alone does not identify whether each queued action executed or isolate its effect.

The minimum *recorded* boss HP in the winning segment was 60; the terminal engine outcome, not an assumed zero in a cached enemy-HP snapshot, establishes victory over the whole encounter. It is not reported as a no-death victory.

Compared with Astra's original-resource episode (28 calls, first-attempt win, 11 rounds), this selected ablation required a reload, 220 cumulative calls, and 54 winning rounds. This is an observed paired-condition contrast with one trajectory per condition, not a causal effect estimate or proof that the removed actions alone explain the difference.

## Ablation and accounting validation

The initial inventory contains zero Yingu. Every one of the 220 recorded call states was audited for item 141, and 218 next-command spell-list prompts were inspected for the removed skills. No positive Yingu count, offered Jiushen/Qian Kun Yi Zhi, or successful removed-action invocation was found. The automatic reload at call 68 also preserves the removals. The source implementation applies the same stripping routine on initial load and reload.

Historical comparator first-call combat inventories also show zero Yingu and their logs contain no accepted removed-action invocation. Opus did attempt Yingu four times and received `no item matching` rejections. Some historical start snapshots still show the pre-strip item count; actual first-call and later combat records distinguish this from successful resource use. This inspection is not a new full execution/usage verification of those older builds: their selected directories have no saved `verify.json`, and no matching historical runtime was reconstructed in this task.

For Astra, the shared finalizer wrote a `client_finalized` event directly after the run, binding the original game-log prefix and raw client output with SHA-256. No backfill or rewritten game-end event was required. Accounting status is `complete`: 6,385,688 input tokens including 6,261,248 cached, and 10,087 output tokens; the runner estimates $8.009998. CLI duration was 512.436 seconds. These are client reports and a runner estimate, not independently authenticated provider billing or backend identity.

Full verification replays actions using the fingerprint-matching original runtime and checks the source-bound accounting. It does not regenerate model decisions. The raw JSONL, raw CLI output, stderr, protocol, invariant audit and successful verification are retained. No game logic or paper source was edited for this evaluation.

## Artifacts and reproduction

- [Machine-readable comparison and source hashes](astra-baiyue-ablation-2026-10-23.evidence.json).
- Run: `bench/out/astra-20261023-baiyue-nocheese-560/`.
- Full action log: `episodes/baiyue-single-origin__s42.jsonl`.
- Full CLI output: `episodes/baiyue-single-origin__s42.client.jsonl`.
- Explicit conditions: `ablation-protocol.json`; audit: `ablation-validation.json`; full result: `verify.json`.
- Original runtime retained locally at `/Volumes/T7-Data/pal/reviews/astra-ablation-20261023/frozen-runtime`. It is not a claim of a publicly archived runtime or redistributable game assets.

Reverification (no model inference) must preserve the ablation environment:

```bash
BENCH_STRIP_CHEESE=1 BENCH_BUDGET_TOOL_CALLS=560 PAL_ASSET_DIR=/path/to/owned/pal-assets node bench/bench.mjs verify bench/out/astra-20261023-baiyue-nocheese-560 --runtime-root /path/to/fingerprint-matching/original-runtime
```

A negative-control replay with `BENCH_STRIP_CHEESE=0` was also run: verification failed on the initial state and subsequent gameplay, as expected, while the original successful `verify.json` was retained. Its output is archived beside the trajectory. A different runtime fingerprint is also rejected. Existing records remain the evidence of the original outcomes; reproduction requires the matching build and separately supplied assets.
