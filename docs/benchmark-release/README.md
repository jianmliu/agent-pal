# E&D benchmark release candidate

This branch prepares technical resource/protocol blockers for a formal benchmark. It does not publish a release or authorize model inference. The requested model labels and 288 trial identities in `bench/releases/ed-v1/campaign.json` are a draft schedule, not 288 results.

## Reproduce local checks

Use Node **22.16.0** and pnpm **9.15.9**. From a fresh checkout:

```sh
pnpm install --frozen-lockfile
pnpm run build:engine
pnpm run test:bench
node bench/release.mjs validate-campaign bench/releases/ed-v1/campaign.json
PAL_ASSET_DIR=/path/to/owned/supported-data node bench/release.mjs preflight
```

The preflight output separates `technicalReady` from `releaseReady` and always reports `inferenceEnabled: false`. Exit 0 means local technical resources match the checked profile, not rights clearance, independent access, scientific validity or permission to run models. Missing/changed assets or missing builds exit 1. `--out file.json` writes evidence exclusively and refuses to replace a file.

The [resource contract](resources.md) describes the 16 required asset inputs, optional media, all 15 existing starting files, hash checks and unresolved acquisition/license questions. Do not copy game executables or proprietary asset bundles into this repository. Hashes identify the local observed profile; they do not grant redistribution rights.

## Complete scientific accounting

The existing public leaderboard remains a **successful-run showcase**, with its existing success-only policy. It is not the denominator of a scientific result. Formal campaigns retain every scheduled trial, failure, launch fault and explicitly explained rerun.

```sh
node bench/release.mjs report bench/releases/ed-v1/campaign.json
```

Until all planned trials have evidence, the report exits 1, lists missing cells and gives no success-rate ranking. An infra failure remains in the scheduled denominator, with no fabricated engine replay. Unknown costs/tokens remain null. Independent repetitions have distinct output directories and identities; a winning rerun cannot replace an earlier failure.

The append-only ledger is `trials.jsonl` next to its campaign. Records have `trial` (exact entry from the campaign), `outcome` (`game-success`, `game-failure` or `infra-failure`), optional full `result`, and relative `evidence` paths. For gameplay, evidence names `resultFile`, `runFile`, `logFile`, `verifyFile`; these must live inside the trial's `runDir`. The importer checks result identity, formal repetition/condition fields, current episode/run digests and explicit engine-replay provenance. Infrastructure records require `reason` and `evidence.failureFile` binding the actual failure result. Do not create assertions of replay as a substitute for those artifacts. `appendTrialRecord` refuses duplicate identities and unexplained retries; retries are retained but do not silently enter the original scheduled report.

File-backed reports additionally require a **frozen** campaign with one `protocolPins` entry per condition/model/task/version, binding the expected protocol content hash before evaluation. Changed budgets, prompts, adapters or runtime hashes cannot be pooled. The shipped draft is deliberately unfrozen with no protocol pins: it can be inspected but cannot yield a certified completed result. Infrastructure evidence must bind the exact trial and directory too; gameplay budget failures cannot be relabeled as startup faults. A built-in provider error or missing usage preserves its measured prefix separately and leaves whole-trial consumption unknown.

`campaignReport` is a low-level pure aggregation API used with validated inputs; it is not an evidence authenticator. Use the file-backed release command for a report from disk. It supplies completeness and accounting, not the later prespecified statistical intervals or a model-only capability ranking.

## Verification levels

- `engine-replay`: launch the actual pinned engine and compare recorded states/outcomes. Formal certification requires this explicit backend and matching digests.
- `log-consistency`: inspect existing log/result/raw-client consistency without engine resources. It does not overwrite a genuine replay cache and cannot grant engine certification.
- `not-replayed`: no engine replay, including missing/malformed evidence. A launch failure can still be retained as an infrastructure observation.

Unlabeled historical cached checks retain compatibility but have **legacy-unknown** provenance. They are not automatically promoted into the formal campaign. Public CI builds and checks the contract without proprietary resources; no remote resource-equipped replay job or secret distribution is enabled here.

## Protocol changes

New runs bind actual task/save/runtime fingerprints, effective action/token/virtual budgets, prompt/tool-schema source identities, adapter identity, context policy, overrides, effort and engine execution profile. Existing token/virtual multipliers are serialized, not silently normalized; CLI tokens remain measured at exit. Formal runs forbid undeclared ambient overrides and replay prefixes and reject paid-model starts while inference is disabled. Startup, post-ready model wall, terminal drain and termination escalation have bounded lifecycles. Gameplay end events stay intact; client accounting remains appended from raw CLI evidence.

Current supported formal entry is the programmatic `runBench({... , formal:{releaseId,condition,repetition,attempt,inferenceEnabled:false,overrides:{}}})` for free `replay:` acceptance only. A fresh repetition/attempt uses a fresh `out` directory; the exclusive claim protects an existing trial. The release inspection command has **no `run` subcommand**. No model scheduler is being enabled in this stage.

Remaining publication gates are tracked in [acceptance](acceptance.md). In particular, CLI restrictions are not a certified filesystem/network sandbox, human-independent acquisition and licensing are unresolved, task negative controls and independent installations need validation, and no paid experiment or formal model ranking has been produced.
