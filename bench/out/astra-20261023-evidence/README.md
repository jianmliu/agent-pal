# Astra evaluation and accounting provenance (23 October 2026)

The three sibling `astra-20261023-{rain,baihe,baiyue}` directories contain current results, raw client output, original game logs with appended accounting receipts, and successful verification reports. `originals/` preserves the pre-repair records, including the first failed `verify.json` files. Raw client output and original game-log prefixes are byte-identical to those records. `inventory.json` hashes the archived evidence files.

`protocol.json` records the original source commit, runtime/build/assets hashes, and run settings. `preservation-and-final-verification.json` records the append-only and unchanged-result checks. `original-evaluation-index.json` preserves the earlier evidence index; current hashes and repository-relative original paths are in `docs/astra-three-scenario-evaluation-2026-10-23.evidence.json`.

Receipt migration fields and successful verification reports retain historical absolute paths for provenance. Their archived original files are also available here through repository-relative paths. Those historical path strings were not rewritten inside immutable log evidence.

The original execution snapshot was retained locally at `/Volumes/T7-Data/pal/reviews/astra-20261023/frozen-runtime`. It is not part of this archive. Full game replay needs the exact fingerprint-matching execution build plus separately supplied, legally obtained game assets; neither game assets nor a claim of independently reproduced builds is included. The runtime-root option checks fingerprints and rejects a different build. Source commit `896e955938fea8bace2782d405788c48cb32d3a6` identifies the original source basis. No model was rerun during backfill or verification.

Client logs and accounting can be checked without starting a game or invoking a model:

```bash
node --input-type=module -e 'import {readClientFinalization} from "./bench/client-finalization.mjs"; console.log(readClientFinalization("bench/out/astra-20261023-rain/episodes/classic48-rain-orbs__s42.jsonl").result.accountingStatus)'
```

The complete-game playthroughs, other model records, videos, and no-cheese ablations are separate evidence; none was added to the Astra three-episode sample.
