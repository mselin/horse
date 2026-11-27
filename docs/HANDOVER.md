# Handover

Working state for the next session. Rules: [`HANDOVER-PROTOCOL.md`](HANDOVER-PROTOCOL.md).
This repository has no separate design doc or roadmap: the design is
`README.md` → "How it works" (README.md:73) plus the "How the motion is
built" table in `docs/MOTION-NOTES.md`; the roadmap is the realism checklist
and "Known gaps" at the end of `docs/MOTION-NOTES.md`.

## Task

Bootstrap only: create the handover docs in horse from the design doc, roadmap and git log. No code changes. Open a PR.

## Plan

1. Create `docs/HANDOVER-PROTOCOL.md` from sections 2–5 of the short-context skill. Check: file exists, text matches the skill. **Done.**
2. Create `docs/HANDOVER.md` from README, MOTION-NOTES and `git log`. Check: all eight sections, under 150 lines. **Done.**
3. Commit on `docs/handover`, push, open a PR. Check: PR open, **All checks passed** green. **PR open; checks running.**

## Established

- **Project:** a procedurally sculpted, rigged and animated horse in three.js/WebGL2, built entirely in code. GPL-3.0-or-later. Live at https://mselin.github.io/horse/ (README.md:1, LICENSE).
- **Pipeline** (README.md:73–197): rig on anatomical landmarks (`src/horse/rig.js`) → SDF sculpt (`anatomy.js`, `sdf.js`) → Surface Nets bake in a worker (`bake.js`, `mesher.js`), head meshed finer and zipped to the body (`stitch.js`; `HEAD_CUT_X` bake.js:17, `HEAD_CELL_SCALE` bake.js:20) → coat shader (`coat.js`) → locomotion (`gaits.js`, `Locomotion.js`) → hair (`Hair.js`) → world (`main.js`).
- **Bake cache:** IndexedDB, keyed by the sculpt; bump `v` (src/horse/cache.js:16, now 6) whenever bake output changes.
- **Gaits:** parameter tables in `src/horse/gaits.js` (canter :84, gallop :132, thresholds :171). Duty falls from `duty` to `dutyFast` across each gait's speed range. Canter/gallop are defined for the right lead; `rockPeak`, `nodPeak`, `rockPivot`, `hindLag`, `headOpen`, `leadReach` drive the asymmetric gaits.
- **Locomotion** (`src/horse/Locomotion.js`): per-leg cycles with catch-up in swing; leads via `role()` :204 (left lead = mirror table), strike-off anchor :283, flying change in a suspension :327, rocking pivot :470, hind follow-through :558, leg IK `solveLeg` :587 (hind hock opens with the stifle in stance).
- **Checks** (README.md:205): CI jobs Site checks (html-validate), Build and browser smoke test (`npm run test:motion`, `npm run build`, `npm run test:smoke`), All checks passed (required to merge), Publish the horse (Pages, `main` only). `main` is protected: PR only, no direct push.
- **Motion check limits** (tools/motion-check.mjs:14) and plan (:27); it also fails if a left-turn canter is not on the left lead.
- **Measuring tools in the repo:** `npm run gait-timing` (footfalls, duty, airborne share, pitch and head phase, tracking-up); `preview.html` with `?gait=…&speed=…`, `window.__step(dt)`, `?nohair`, `?gp=key:value,…` (README.md:220).
- **Reference footage:** 18 documentary clips + 4 green-screen clips on the `video-snippets` branch, labelled in its `video/README.md`. Third-party material: never merge into `main`; only measurements go into `docs/VIDEO-REFERENCE.md`. The repo is public; the owner was advised to move or delete that branch when done.
- **Working agreement in practice:** open a PR, wait for green, merge (merge commit) when the owner says "merge it". PRs are created with `gh api repos/mselin/horse/pulls` (GraphQL is blocked here) and merged with `gh api -X PUT …/pulls/N/merge -f merge_method=merge -f sha=<head>`. No model names in commits, PRs or code.
- **History** (`git log --first-parent main`):
  - #1 procedural Thoroughbred (sculpt, rig, gaits, mane/tail, scene)
  - #2 GPL licence
  - #3 flowing motion (sprung trunk, swing retraction, leg-by-leg gait changes)
  - #4 head and face (separate fine head mesh, nostrils, lips, eyes, blinks)
  - #5 footage-measured gaits (canter timing and rocking)
  - #6 slow motion (1–16×), gallop from footage, performance overlay
  - #7 trot tracks up, hind-leg artefact removed
  - #8 hock opens with the stifle in stance; longer walk stride
  - #9 canter rocking about the hindquarters, low neck, hind follow-through, leads and flying changes; gait-timing head-position fix

## Changes

- `horse`, branch `docs/handover`: adds `docs/HANDOVER-PROTOCOL.md` and `docs/HANDOVER.md`. Docs only, no code changes. PR: https://github.com/mselin/horse/pull/10 (awaiting the owner's "merge it").

## Verification

- Docs-only change; CI (html-validate, motion check, build, smoke test) to run on the PR.
- PR #9's deploy to Pages was still running when this branch was cut; check the `main` run if it matters.

## Dead ends

- Refining the whole grid around the head doubled vertices and bake time; a separate head mesh stitched to the body replaced it.
- Zipping head and body by shortest rung diverged at the throat; merging the two boundary loops by angle works.
- A carved eyelid crease pitted the surface; removed.
- The green-screen clips are AI-generated (legs merge and multiply, no stride period): never measure them.
- The silhouette "head vs neck" measure swings with the face angle, so it is unreliable for tuning the canter nod; use the skeleton measure from `npm run gait-timing`. Its head window must exclude pixels below the chest, or a reaching fore hoof gets counted.
- "Lower the hip joint": the hip height (1.27 m) and segment lengths agree with published hindlimb data; the real cause was the hock being fixed in stance.
- Vite's dev server hot-reloads open pages on every edit, which kills Playwright captures; capture from a server with `hmr: false` and file watching off.
- Journal hosts (pmc.ncbi.nlm.nih.gov, research-portal.uu.nl, pub.epsilon.slu.se) cannot be fetched from this environment; papers are cited from search summaries and marked as such.
- The footage-analysis scripts (colour tracking, stride period, silhouette heights, phase-aligned pairs) lived in a session scratchpad and are not in the repo; recreate them if a measurement pass needs them.

## Next

Gallop neck swing (roadmap item in `docs/MOTION-NOTES.md`: the head swings against the neck about a third as much as in the gallop footage, 4.4% against 12.6% of body length, lowest at 0.6–0.7 against 0.7–0.9). Start in `src/horse/gaits.js` gallop entry (`nod` 0.2, `nodPeak` 0.5), check with `npm run gait-timing -- gallop 13.5` and side-by-side against `wha-00m57s…` on `video-snippets`, keep `npm run test:motion` passing.

Other candidates from the roadmap:
- Quantise speed changes to the stride cycle.
- Pastern approaching horizontal at the gallop.
- Turn on the forehand (pivot about the forefeet) when turning on the spot.
- Chewing, lip movement, skin twitches at rest, muscle bulging under load.
- Dual-quaternion skinning or corrective shapes for volume loss at stifle and elbow.
- Forelimb and pelvis in the reach model, so fast-end duty factors reach published values.

## Subagent files

None.
