# Agent-PAL-Bench NeurIPS E&D Formal Release Plan

> **For agentic workers:** Execute the work packages in this plan with `executing-plans`; delegation is optional and requires user authorization. Batch related repairs, then perform one integrated release-candidate acceptance. Do not start a full architecture review after every fix.

**Goal:** Publish a versioned, independently runnable RPG benchmark whose task scores retain all planned attempts, whose reported outcomes are backed by real engine replay, and whose scientific claims are supported by prespecified experiments.

**Architecture:** Reuse the existing task definitions, start/setup contract, episode runner, state predicates, accounting finalizer and verifier. Add a frozen release manifest, complete campaign ledger and scientific report alongside the existing success-showcase leaderboard. Keep proprietary assets separate and resolve reviewer access before inference starts.

**Tech Stack:** Node.js ESM, TypeScript game engine, pnpm workspace, JSON tasks/manifests, JSONL trajectories, CLI/API adapters, GitHub Actions, existing Markdown-to-LaTeX synchronization.

**Initial status (23 October 2026):** Audit and proposed execution plan; implementation and model evaluation had not started at that time. The open v0.7 manuscript is unchanged. Proposed sample counts and gates below are project choices, not NeurIPS minimum requirements.

**Execution update,27 October2026:** first-stage resource/protocol/complete-ledger implementation and consolidated technical acceptance are complete; see `../../benchmark-release/acceptance.md`. A single clean engine build, initial65/67 reference check, focused6/6 repair verification and final full67/67 rerun establish acceptance of all67 final pairs. This does not complete the broader publication plan: external rights/access, full task-validity curation, independent installations, permission canaries, statistical analysis and all model experiments remain gated. No paid model evaluation has started, and the draft campaign remains disabled.

## 1. Research framing and scope

Primary contribution: **Benchmark Design and Benchmark Analysis**. Secondary contributions: reproducible evaluation infrastructure and audits of measurement assumptions. Main question: which claims about long-horizon RPG agency remain supported when starting states, observations, tool interfaces, budgets and complete trial denominators are explicit?

Three possible releases were considered:

| Approach | Benefit | Limitation | Decision |
|---|---|---|---|
| Publish the current four-case study and historical scores | Least additional inference | Heterogeneous builds, scaffolds and continuations remain exploratory | Preserve as development evidence |
| Freeze an eight-task candidate suite and run a controlled campaign | Bounded scope across exploration, dialogue, causal chains and battle | Requires repair, access and repeated-run work | Recommended formal release |
| Evaluate all 23 tasks, all tiers and whole-game runs immediately | Broad coverage | Correlated variants, high cost and unresolved reliability dilute the main claim | Extension after release |

The release is text/structured-state **Tier B, standard hints**. No pixel-only capability, cultural advantage, zero prior knowledge, or population-wide RPG competence claim. `--pure` full-game runs, Tier C, quizzes and AIGC reskins remain separate artifacts; they are not additions to the formal Tier-B denominator. Do not create new small demos.

Rules basis: the latest checked **2026** E&D documents, not a confirmed 2027 call. Recheck the target year's requirements before submission. The 2026 deadline has passed.

- [Call and executable-artifact requirements](https://neurips.cc/Conferences/2026/CallForEvaluationsDatasets)
- [Contribution-specific review criteria](https://neurips.cc/Conferences/2026/EvaluationsDatasetsReviewerGuidelines)
- [FAQ: environment/code versus new dataset requirements](https://neurips.cc/Conferences/2026/EvaluationsDatasetsFAQ)

The track accepts evaluation environments and methodological analysis without a new model. Executable-artifact contributions require accessible, documented code at submission. New dataset contributions additionally require the applicable hosting and Croissant/RAI metadata. Determine this from the actual submitted tasks/trajectory collection, not merely the contribution label; do not label a new dataset as a tool to avoid requirements.

## 2. Audit baseline and evidence limits

See `../../release-audit/2026-10-23-neurips-ed/audit.json`, `task-catalog.json` and accompanying command outputs. The audit records the observed commit and source hashes. This is a reconnaissance of a shared workspace with an unrelated modified `bench/board.mjs` and an in-progress Gemini run; it is **not** a release build or an immutable full-runtime certification.

| Area | Observed condition | Consequence |
|---|---|---|
| Catalog | 23 tasks, 67 task-seed combinations; 11 classic-save, 8 bundled-save, 4 new-game starts | Historical manuscript counts still match static catalog |
| References and starts | All 23 reference files and all referenced starting files exist | Existence alone does not establish reachability or correct scoring |
| Start assertions | Only four owned-battle tasks have `start.expect` | Add assertions for every included release task |
| Runtime provenance | `runner.mjs` adds runtime and planned task fingerprints only when scoring metadata is present | General-task release runs need automatic pre-execution fingerprints |
| Classic-save hashing | `taskFingerprint()` gives a null save hash without `AGENT_PAL_CLASSIC_SAVES`, although loading falls back to `bench/saves/classic` | Unify path resolution and hash the actual loaded bytes |
| Effective budgets | `episode.mjs` expands token budgets by at least 500x and virtual time by at least 20x; tool caps can come from environment overrides | Manifest must bind effective limits, not just nominal task JSON |
| Context and adapters | Built-in loop retains six tool results; CLIs manage context differently; Argon CLI uses a command helper | CLI comparisons are model-plus-scaffold comparisons |
| Trial identity | Result paths are task plus seed; resume skips existing results; there is no explicit independent repetition dimension | Introduce campaign trial IDs and preserve attempts before formal repeats |
| Public leaderboard | `clearedOnly()` removes failures, chooses a showcase view; PR gate rejects non-success episodes | Never infer formal success rates or coverage from this board |
| PR verification | No-assets branch supplies `replay: readLog`; asset detection calls `engineOptions()` without a task and catches the resulting TypeError | Current CI success is not proof of fresh engine replay |
| Scoring | `score.mjs` can average only tasks with observed results and checks completion by counts | Bind exact planned identities; missing, duplicate and extra trials must block a formal table |
| Resources | Local ignored `pal-assets/` and prebuilt ignored engine exist; 15 save files tracked | Clean-clone runtime/resource availability is not demonstrated |
| Licensing | No tracked LICENSE/COPYING/NOTICE file found by filename scan | Establish code provenance/license and separate resource/save/derived-content rights; do not invent permission |
| Documentation | Bench README contains old monorepo paths; four historical paper-linked audit/spec files are absent locally | Replace broken paths and supply actual release documentation |

The source inspection confirms the above flow and the null-hash/asset-detection behavior with direct calls. It does not establish malicious activity or invalidate every historical replay. Existing Astra full replays remain separate historical evidence. Unit tests/schema validation are recorded separately from the bounded reference reconnaissance; the historical 59/67 figure must not be presented as a fresh result.

**Fresh reconnaissance result:** schema validation and `pnpm run test:bench` returned exit 0. The reference command reached the audit's global 240-second limit after emitting **62 successful task-seed rows**, with no failed row emitted. The five unobserved pairs are `pal-ch1-meet-linger-hardcore` seed 3, `pal-final-preboss-reserve` seed 42, and `wine-to-drunk-taoist` seeds 1/2/3. These are unknown, not five reference failures. All 24 pairs belonging to the eight candidates below appear among the successful rows. This used the local existing engine build; a clean-build repeat and terminal negative controls remain outstanding.

## 3. Candidate task suite and curation rule

Freeze the inclusion rule **before** seeing new model scores: coverage of distinct authored dependency chains, reachable references on every declared seed, correct initial/terminal predicates, feasible budget, explicit provenance and resource access. Fix or exclude tasks based on those criteria, never based on which model wins.

| Candidate task ID | Role in the suite | Seeds | Existing call cap |
|---|---|---|---:|
| `pal-ch1-island` | Map mechanisms and exploration | 1, 2, 3 | 105 |
| `classic10-baihe-medicine` | Multi-object collection and dialogue dependencies | 42, 43, 44 | 240 |
| `classic19-yangzhou-gourd` | Cross-scene detective chain | 42, 43, 44 | 230 |
| `classic28-tower-chain` | Long causal dialogue/item chain | 42, 43, 44 | 345 |
| `classic31-banana-monkeys` | Item-mediated passage | 42, 43, 44 | 80 |
| `classic40-water-orb` | Longer narrative exchange chain | 42, 43, 44 | 250 |
| `classic48-rain-orbs` | Spatial mechanism and item placement | 42, 43, 44 | 80 |
| `baiyue-single-origin` | Party battle and resource use | 42, 43, 44 | 180 |

Candidate does not mean accepted. Inventory all 23 tasks and retain a reason for each non-primary task: trivial traversal calibration (`classic08-leave-area`), shared-prefix variants (Yangzhou night, tower gate, phoenix handkerchief), starting-state gradients/hardcore variants, opening errands, battle resource variants, and the single-seed preboss reserve. These remain diagnostic/development tasks rather than independent extra votes in the primary macro score.

Every included task needs a task card: authored goal and scope; start scene/party/items/cash/flags; seed behavior; observations/tools; setup actions; full effective budgets; milestones; success/failure precedence; save/reload policy; known clues/priors; reference provenance; related-task family; resource identifiers; limitations. Test initial success is false, a full reference succeeds, and at least two targeted near-miss/shortcut trajectories do not succeed. For combat include simultaneous win/down, defeat/reload and guard-survival cases; for text predicates include visible text without the required world transition. Human inspection must agree with each terminal reference state.

**Curation acceptance:** 100% of included task-seed references succeed and stay within declared action/virtual limits on the release candidate; replay the set twice in fresh processes and once in a clean build on a second supported environment. All golden terminal predicates and targeted negative controls pass. If any task is removed, record its reason, recompute the campaign before model execution and narrow the paper's coverage claims.

## 4. Resource and independent-access gate

Produce `bench/releases/ed-v1/resources.json` plus `docs/benchmark-release/resources.md` with separate entries for:

1. Authored source, vendored engine code, dependencies and license/attribution lineage.
2. Proprietary original data/graphics/text/music bundles. List exact supported version, acquisition instructions that were actually tested, required file names/size/SHA-256, and optional files. A local PAT.MKF check is insufficient. Exclude original executables and unrelated files from the required set after dependency inspection.
3. Eight classic RPG starting files and seven bundled compressed saves: provenance, generation steps, redistribution basis and decoded-content inspection. A save may embed original game data; do not assume authored filenames establish rights.
4. Walkthrough/atlas and static data dumps: out of Tier-B model access; document separately for extensions. Logs can contain original dialogue and identifiers; review distribution scope and secrets before hosting.
5. Published tasks and collected trajectories: declare whether these are submitted datasets. If so, provide validated Croissant/RAI metadata, documentation and durable hosting for the distributable portion.

Preferred route: independently obtainable supported original game version plus a hash-validating local importer, with written license/provenance documentation. Reviewer access must be tested without a personal request to an author. If that route is unavailable or unsuitable, resolve permission/access with the rights holder or obtain clarification from track chairs before claiming the artifact is independently runnable. A hosted service is not an automatic substitute for executable access. Freely redistributable replacement assets may support installation smoke tests, but cannot replace original behavior validation without an equivalence study.

**Acceptance:** no unresolved required resource; no unsupported redistribution claim; two testers can obtain/provide the documented version, pass preflight and replay a task without access to this machine or an experimental worktree. If this fails, stop model spending and artifact-based release; changing to an analytical paper is a separately scoped decision.

## 5. Formal protocol and complete accounting

Create one immutable campaign manifest before model execution. Fields: release/task/asset/build/prompt/tool-schema hashes; Node/pnpm and OS; engine execution/speed/clock profile; model requested/resolved label and provider; CLI binary version/hash or API adapter; reasoning settings and context policy; tool/read/network permissions; trial schedule; budgets; failure rules; run order and parallelism; pricing provenance; declared analysis and exclusions.

Trial key: `(release, condition, model-scaffold, task, gameSeed, repetition, attempt)`. Repetition starts a fresh process/session with empty game/map memory. Use the same ordered task/seed blocks and randomized, recorded model order to reduce time/load confounding. Cloud sampling need not be deterministic. Failed attempts, launch failures, usage-unknown results and quota errors are retained. A model defeating/reloading a boss within one episode is not an independent repetition.

Main track protocol: Tier B, standard hints, existing task call caps, 1,800-second post-ready model wall limit; a separate 120-second startup watchdog is a proposed harness protection, not a gameplay limit. Bind these values before preflight and change them only with a new campaign revision before inference. Use the current effective token/virtual multipliers initially, but serialize their exact computed values and enforcement locations; CLI token usage remains an at-exit measurement, not a claimed incremental cap. Record monotonic startup/ready/model/end/drain timing. Add a bounded client drain (30 seconds) and hard-kill escalation (5 seconds); engine commands must stop at terminal state/budget irrespective of client drain.

Model-cohort rule: start with Astra, GPT-6.1 Sol, Opus 5.5 and Argon 4 using available adapters. Record their actually resolved labels; never silently replace an unavailable model or claim aliases attest backend identity. Prefer a shared API loop only if all intended models genuinely support it. Otherwise use the existing CLIs, audit each permission boundary and label the result **model + CLI scaffold**, not a model-only ranking. Match game-visible tools/observations and practical action/wall limits; do not call different vendors' `medium` settings equal compute.

No human tactical hints, web/walkthrough/atlas, source/task/reference inspection or prior run access during inference. CLI shell helpers may only reach the game service through the declared helper; verify filesystem/network restrictions with canary probes. Prompt-only restrictions are disclosures, not a sandbox. If adapter access cannot be sufficiently audited, retain that cohort as explicitly scaffolded/exploratory and do not claim closed-book isolation.

An infrastructure fault pauses the affected block. An exact rerun needs an append-only reason and a new attempt ID; never overwrite an attempted trial, pick the best attempt, or extend a failed game's budget. Game/tool/wall-budget failures remain outcomes; model/provider/infra failures get separate labels. Report scheduled-trial success and infrastructure availability; any valid-start conditional rate is secondary, with its explicit denominator. Missing trials never become zero-cost or silently disappear.

## 6. Experiments and cost gates

| ID | Question | Planned design | New inference ceiling | Acceptance/evidence |
|---|---|---|---:|---|
| E0 | Is the environment/score reliable? | All 23 references for reconnaissance; frozen included suite plus targeted negative controls | 0 | Per-step engine replay, initial/terminal state checks, mismatch and timeout classes |
| E1a | Does the campaign pipeline work? | Four models × four core cases (rain, medicine, Yangzhou, boss) × seed 42 × three fresh repetitions | 48 | Complete ledger, every attempted outcome retained, verified gameplay, bound usage or explicit unknown |
| E1b | What does the frozen suite measure? | Four models × eight accepted tasks × three declared game seeds × three repetitions | 288 total | Per-task and macro success, uncertainty, coverage and failures; see reuse rule |
| E2 | How sensitive is the reading to action cutoffs? | Re-score preserved longer-budget trajectories at prespecified prefix cutoffs: medicine 120/180/240; Yangzhou 120/180/230; boss 80/120/180 | 0 | Deterministic prefix outcomes; no claim that announced small-budget behavior is reproduced |
| E3 | Does resource removal change battle behavior? | Four models × three seeds × three repetitions × original/no-three-actions conditions, both with identical 560-call and 1,800-second caps | 72 | Original/treatment start invariants, removal after reload, positive replay and wrong-condition negative control |
| E4 | Can another team run it? | Two independent testers, fresh install, all accepted references, one small new evaluation per tester only after budget approval | 0 replay; at most 2 model runs | Command outputs and runtime checks; no local review/worktree dependencies |

E1a is a pipeline pilot, not a publication success-rate estimate. Its 48 trials can be part of E1b **only** if manifest, build, cohort, budgets and protocol remain identical and this inclusion rule was fixed in advance. Otherwise preserve and label them development trials and collect E1b afresh. With reuse, E1+E3 ceiling is 360 episodes; without reuse it is 408, plus up to two E4 trials. If fewer than eight tasks pass curation, recompute these counts mechanically before authorization. These are recommended designs, not an assertion that this sample size yields adequate statistical power.

No monetary total is approved here. Campaign starts with inference disabled. After free replay gates pass, prepare a cost sheet using existing raw client token/cache records at the selected pricing version, disclose subscription versus invoice versus estimated-price accounting, estimate the 48-trial pilot with an upper allowance, and obtain a numerical campaign spend/token/wall ceiling. Stop between blocks before any ceiling is exceeded. Approve E1b/E3 separately using pilot duration/usage estimates; do not automatically expand spending. An underfunded pilot must be reported as such rather than relabeled a completed formal benchmark.

E3 is required if the paper retains a central adaptation/resource-dependence claim. Its equal 560-call control is a separate experiment: the main boss's 180-call trajectory is not a matched control. The treatment removes the three resources jointly, so no attribution to each individual action. New prior-renaming, feedback redesign, memory and L0/L1 interventions are optional follow-up studies; do not implement all at once. Remove causal/zero-prior/“RL” claims unsupported by the chosen evidence.

## 7. Statistical analysis and reporting contract

- Prespecify task and family membership and report all planned cells. Macro success weights accepted tasks equally; also report a family-balanced sensitivity view if task dependencies justify it. Do not use a denominator defined by tasks anyone happened to clear.
- Unit is a fresh episode. Report per-task proportions with intervals, model differences blocked by task/seed, and 95% uncertainty using a documented hierarchical resampling procedure over independent repetitions and seed blocks. Report the exact resampling code/seed (10,000 draws), raw counts, and small-sample limitations. Correlated save variants and shared task seeds are not independent new problems; intervals are conditional on this fixed suite, not all RPGs. With three repetitions, avoid precise superiority claims when intervals are wide.
- Success is primary. Winning rounds, successful-call count and cost per success are conditional secondary metrics, always alongside failures/attempts. Failed winning-round values are undefined. Show all-trial token/cost totals, unknown coverage, timeouts and infra rates. Never subtract optional exploration from official calls or select the best repetition.
- E2 describes alternative cutoffs on the same large-budget behavior, not a randomized budget treatment. E3 estimates the observed paired-condition difference under its declared scaffold and suite; matching a game seed does not match model randomness.
- Add a task-by-capability table and a qualitative comparison with relevant interactive-game benchmarks using verified primary sources; make no cross-game numerical leaderboard claim. Failure annotations have a written rubric, two independent annotators on a prespecified sample, agreement statistics and disclosed disagreements. Closed-book quiz scores are auxiliary recall measurements, not a proof of uncontaminated training or no prior knowledge.

**Analysis acceptance:** a second command regenerates JSON/CSV tables and figures from immutable campaign records; deleting a failed trial, duplicating a seed, changing a prompt/budget, or adding an unscheduled trial makes scientific validation fail. Missing/unknown observations are explicit. Any gap between claims and evidence narrows the claims rather than being hidden in prose.

## 8. Work packages and concrete deliverables

Paths below are planned new files unless already present. Do not claim these commands/files currently exist. Keep fixes in existing modules, with targeted tests, instead of introducing another engine or save codec.

### WP1 — Freeze scope and resolve resources

**Files:** `bench/releases/ed-v1/manifest.json`, `task-catalog.json`, `resources.json`; `docs/benchmark-release/README.md`, `resources.md`; root licensing/NOTICE files only after provenance review. Update old paths in `bench/README.md` and paper links when their replacements exist.

- [ ] Review all 23 task cards and record reference/goal/budget/family inclusion decisions.
- [ ] Map resource fetches and save contents; establish rights/provenance and independent acquisition procedure.
- [ ] Produce the preliminary manifest and clean-build instructions with no machine-local absolute paths.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm run build:engine`, `node bench/bench.mjs validate` on a clean checkout. Success requires real builds, no skip-as-pass resource checks.

### WP2 — Consolidate protocol and verification repairs

**Modify:** `bench/start.mjs`, `runner.mjs`, `episode.mjs`, `verify.mjs`, `score.mjs`, `pr-check.mjs`; existing client finalizer only if needed. **Add tests:** `bench/test/release-contract.test.mjs`, `release-scoring.test.mjs`, `release-verification.test.mjs`.

- [ ] First add failing tests: default and explicit save paths hash the same loaded bytes; changed assets/prompt/effective budget/CLI version invalidate a formal manifest; repetition IDs cannot collide; results cannot overwrite existing attempts.
- [ ] Add tests for success, genuine gameplay failure, provider failure, startup timeout, terminal-state drain, usage-unknown and resume. Assert game commands stop after terminal state, and no original log is rewritten.
- [ ] Add a verification backend label (`engine-replay`, `log-consistency`, `not-replayed`) and preserve old evidence. Test no-assets CI never awards engine-replay status; call the real asset resolver rather than `engineOptions()` without a task.
- [ ] Unify pre-execution resource/task/prompt/tool/budget/runtime binding for every formal task. Make protocol-affecting environment overrides explicit and allowlisted; remove ambient `BENCH_RESUME_FROM`/strip flags unless in the manifest.
- [ ] Add exact planned-cell validation and a scientific result path that retains failures. Keep the user-requested successful-run public board as a showcase; give it an explicit label and link to the formal all-trial report. Do not reverse the showcase preference silently.
- [ ] Run the targeted tests red, implement related fixes together, then run `pnpm run test:bench` once as the integrated contract check. No per-fix full architecture review.

### WP3 — Campaign/analysis tooling

**Create:** `bench/release.mjs`, `bench/release-analysis.mjs`, `bench/releases/ed-v1/campaign.json`, `docs/benchmark-release/protocol.md`. **Tests:** `bench/test/release-analysis.test.mjs`.

- [ ] Define `preflight`, `validate-campaign`, `report` subcommands and immutable trial/result mapping. Export inputs, exclusions, hashes and explicit denominators.
- [ ] Test fixed fixtures: one success plus one failure gives 1/2; a missing cell blocks publication; duplicate repetitions and extra trials fail; unknown usage stays null; original/ablation budgets cannot mix; best-of selection is rejected.
- [ ] Generate per-task/model tables, intervals, prefix-budget sensitivity and the ledger completeness report deterministically. Add exact dependency versions for any statistical tooling.
- [ ] Dry-run every campaign entry with a no-inference stub to check identity, permissions, output isolation and manifests. Replay reference traces through the real runner/finalizer path before authorizing model use.

### WP4 — One release-candidate build and integrated acceptance

**Create:** `.github/workflows/benchmark-release.yml`, `docs/benchmark-release/acceptance.md`; produce immutable release archives/checksums after acceptance.

- [ ] Clean-build a pinned candidate commit on Node 22/pnpm 9, with lockfile and actual engine-dist digest recorded; no ignored precompiled cache from this machine.
- [ ] Separate public no-resource CI (schema/unit/hash/ledger checks) from an authorized resource-equipped engine-replay job. Restrict private-resource jobs to trusted revisions; never expose assets/secrets to arbitrary PR code.
- [ ] Check all included references, negative controls, failed-run handling, cross-episode isolation and tamper controls in one integrated run. Keep logs even when acceptance fails.
- [ ] Independent tester rebuilds with documented resources; compare relevant runtime/task hashes, intermediate grading states and terminal results. Across OSes explain expected platform/runtime differences rather than accepting an unexplained whole-runtime hash mismatch.
- [ ] Freeze the final candidate once acceptance passes. A functional change after model collection starts requires a new release/campaign or complete affected-block reruns with preserved originals.

### WP5 — Execute approved experiments and release manuscript evidence

**Artifacts:** `bench/releases/ed-v1/results/`, complete ledger, generated analysis, durable code/data archive, anonymized review bundle. **Later paper edits:** existing `docs/agent-pal-bench-draft.en.md`, `.tex`, `.pdf` via the established synchronizer.

- [ ] After explicit numerical budget authorization, execute E1a; audit all outcomes and model labels without tactical intervention.
- [ ] After capacity/cost decision, complete E1b and the prespecified E3 if its claim is retained; E2 is computed from preserved logs.
- [ ] Validate every started trial with real replay where a trace exists; a no-log launch failure remains an infra record, never a verified game episode. Publish exact accounting coverage, not a blanket “all billing verified” claim.
- [ ] Independent acceptance reproduces analysis, all included references, all unique terminal failure classes and the full set of formal outcome replays. No model rerun is needed to audit decisions.
- [ ] Archive distributable artifacts and source at stable URLs with version/checksums and metadata. Verify anonymous URLs, logs, video and PDF metadata for identity and secret leakage. Recheck target-year conference rules.
- [ ] Rewrite a concise submission around the release and supported findings, moving historical exploratory cases to appendices. Use the target year's official style/checklist, accurate AI-use disclosure, resource ethics/rights statement and reproducibility statement. Keep the currently open TeX document in place; use built-in compilation after subsequent edits.

## 9. Go/no-go checklist

| Gate | Pass condition | If it fails |
|---|---|---|
| G0 Scope | Included tasks/families and claims fixed without looking at new scores | Do not run models |
| G1 Resources | Documented rights/provenance and independently tested reviewer access | Stop artifact-release path; resolve access |
| G2 Contract | Effective protocol bound; complete ledger; actual replay distinguished from log consistency | Consolidated repair, no model spending |
| G3 Candidate | Clean build, 100% included references, negative controls and independent replay | Fix/exclude with version change before campaign |
| G4 Pilot | Every planned pilot cell accounted for; bounded execution and usable evidence | Retain pilot, stop and diagnose affected block |
| G5 Science | Planned formal matrix complete; prespecified analyses and uncertainty regenerate | No formal ranking; narrow to completed scope |
| G6 Release | Independent rebuild/replay/report, accessible artifacts, rights and anonymity checks | No submission-ready claim |

Maintain **one** `docs/benchmark-release/acceptance.md` issue checklist, with ID, blocking gate, evidence, owner, fix and retest result. Only resource/claim scope, numerical inference budget, and final publication require user decisions beyond routine reversible fixes. This plan authorizes none of those future external actions by itself. Completion means a usable release and evidence-backed paper, not repeated cycles of formal request review.
