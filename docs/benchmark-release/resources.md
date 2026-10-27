# Resource contract for ed-v1

The artifact release and model inference remain blocked. `bench/releases/ed-v1/resources.json` records a locally observed data profile, all 15 tracked starting files and unresolved rights/access gates. These hashes identify bytes; they grant no license. No original game assets, executables, dialogue logs or new copied saves are added by this work.

## Local preflight

Provide legally obtained original DOS traditional-Chinese game data in a private directory, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build:engine
PAL_ASSET_DIR=/your/private/game-data node --input-type=module -e 'import fs from "node:fs"; import {preflightResources} from "./bench/resource-contract.mjs"; const expected=JSON.parse(fs.readFileSync("bench/releases/ed-v1/resources.json")); console.log(JSON.stringify(preflightResources({expected}),null,2));'
```

This is a local validation command, not a tested independent acquisition procedure. The supported commercial distribution/version has not been independently identified. Reviewer access without a personal author request, acquisition instructions and two independent fresh installations/replays remain required. Do not claim independent executability or start paid inference while those gates are unresolved.

`resolveAssetsDir({env})` follows the engine's ordered candidates and PAT marker: `PAL_ASSET_DIR`, repository `pal-assets/`, then adjacent `pal-playground/public/pal-assets` and `dist/pal-assets`. A directory containing PAT alone cannot pass preflight. As in the engine, an environment candidate without PAT can fall through to a later valid candidate. Inspect the chosen path using `resolveAssetsDir` when diagnosing configuration.

`resolveClassicSave(taskOrFilename,{env})` returns the absolute file actually loaded: `AGENT_PAL_CLASSIC_SAVES/<basename>` when supplied, otherwise `bench/saves/classic/<basename>`. The same resolver is used by loading and task fingerprinting. Bundled saves remain in `bench/saves/`; their fingerprint is SHA-256 of the gunzipped JSON bytes. The inventory additionally records compressed hashes and hashes/sizes of each embedded save-slot byte array, without reproducing that content.

`auditResources(options)` returns `{ok,assets,startingFiles,build,errors}`; `preflightResources(options)` (alias `preflight`) throws actionable diagnostics when validation fails. Options are `assetsDir`, `buildDir`, `env`, and `expected` (an earlier report or resources manifest). Expected asset and starting-state digests fail on change. Build existence/nonempty content is required; a supplied expected build digest is also enforced. This technical check does not clear the manifest's separate rights and independent-access gates.

## Loader-derived inputs

Required archives: `ABC.MKF`, `BALL.MKF`, `DATA.MKF`, `F.MKF`, `FBP.MKF`, `FIRE.MKF`, `GOP.MKF`, `MAP.MKF`, `MGO.MKF`, `PAT.MKF`, `RGM.MKF`, `SSS.MKF`. Required text/font files: `M.MSG`, `WORD.DAT`, `WOR16.ASC`, `WOR16.FON`.

These come from `packages/game-engine/src/js/pal/main.ts` (startup and scene archive sets), `battle.ts`/`fight.ts` (battle archives), `text.ts` and `font.ts` (text/font initialization). They support the candidate exploration and battle suite without requiring original executables, installers, batch files, setup data or drivers. `DESC.DAT` has a loader fallback in `services/resource-service.ts`; the profile records it when present because descriptions may affect observations. `VOC.MKF`/`SOUNDS.MKF` are optional sound inputs; MIDI/MUS/RNG are recorded optional audiovisual/extension resources. Their absence does not certify audiovisual extensions. Case aliases must contain identical bytes so server lookup order cannot conceal a conflicting file. The profile lists exact observed sizes and SHA-256 for supported inputs; no asset bytes are distributed.

## Provenance and distribution limits

The source and vendored engine require a documented license/attribution lineage; no new license is asserted. Dependencies are pinned by `pnpm-lock.yaml`, with upstream license review still required. Eight classic RPG files and seven compressed save containers are already tracked. Their authoring/generation histories and redistribution bases are not independently cleared. Decoded saves contain original game state/tables, so an authored filename does not establish ownership of all embedded bytes. Hash inventory is inspection evidence, not a content-rights conclusion.

Walkthroughs, atlas material and static data dumps are excluded from Tier-B model access and require separate documentation for extensions. Trajectories can contain original dialogue and identifiers; review rights, secrets, anonymity and hosting scope before distribution. Decide whether published tasks and trajectories are submitted datasets and, if applicable, provide validated Croissant/RAI metadata and durable hosting for the distributable portion.

After the consolidated build, record its actual digest in acceptance evidence. Do not replace the local resource profile or enable inference merely because technical preflight passes. A different original-data version requires a reviewed new profile and behavior validation.
