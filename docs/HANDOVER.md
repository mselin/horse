# Handover

Working state for the next session. Rules: [`HANDOVER-PROTOCOL.md`](HANDOVER-PROTOCOL.md).
This repository has no separate design doc or roadmap: the design is
`README.md` → "How it works" (README.md:73) plus the "How the motion is
built" table in `docs/MOTION-NOTES.md`; the roadmap is the realism checklist
and "Known gaps" at the end of `docs/MOTION-NOTES.md`.

## Task

Add to there to fix the gait dropdown

(Taken as: fix the side panel's Gait dropdown, which always shows "Standing", in the next PR, together with the handover update after #11.)

## Plan

1. Branch `gait-dropdown` from `main` c93f4fb, record task and plan. Check: this file committed on the branch. **Done.**
2. Smoke test: assert the Gait dropdown shows the gait the page runs (`?gait=3` → "Canter"). Check: `npm run test:smoke` fails on `main`'s code. **Not started.**
3. Fix: bind the dropdown to an object that `setGaitIndex` keeps current, and let lil-gui `listen()` for changes. Check: smoke test passes; keys, demo tour and the dropdown itself all update it. **Not started.**
4. Docs, push, PR. Check: PR open, All checks passed green; merge when the owner says "merge it". **Not started.**

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
- **Gallop baseline** (main a7041e6, 13.5 m/s), % of body length by stride phase 0.0–0.9 from the trailing hind's touchdown:
  - Footage (`seg03.webm` = `wha-00m57s…`, 1.4–4.9 s, `MASK=dark`, period 11, contact 17.5): head above withers `-0.6 +3.2 +5.0 +3.9 +2.7 +3.6 +3.0 -7.0 -6.1 -7.6` (p-p 12.6, lowest 0.7–0.9); withers `-1.1 -2.7 -0.9 -3.6 -1.8 -4.3 -0.5 +4.6 +6.4 +3.8` (p-p 10.7, highest 0.7–0.9). The head stays steadier in space than the withers.
  - Ours, silhouette (`?nohair`, mirrored with `hflip` so it faces left like the footage): head above withers p-p 4.1, lowest 0.6–0.7; withers p-p 6.5, highest 0.7–0.8.
  - Ours, skeleton (nose minus `neck0`): p-p 2.6. `npm run gait-timing -- gallop 13.5`: pitch up at 0.78 (±3.5°), head low at 0.48 (±3.3 cm).
  - Cause: at `nod` 0.2 the neck's stride swing nearly cancels the head lift that the trunk's pitch gives (nose ahead of the withers). Swing grows fast with `nod`: skeleton p-p 2.6 / 11.5 / 20.5 at 0.2 / 0.4 / 0.6; `nodPeak` 0.6 moves the low point to 0.8.
- **Scratch tools** (this session's scratchpad `/tmp/claude-0/-home-user/d50c5ecc-…/scratchpad`, not in the repo): `tools/gsil.sh name [gp] [speed]` captures our gallop at 25 fps (11 frames a stride, `?nohair`, mirrored) and runs `tools/headbob.py`; `heights.mjs gait speed key=val…` gives skeleton heights by phase; the no-reload Vite server is `vite.nohmr.mjs` on port 5174.
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
  - #10 handover docs
  - #11 gallop neck swings as far as in the footage (`nod` 0.45, `nodPeak` 0.6)

## Changes

- `horse`, branch `gait-dropdown` (from `main` c93f4fb): handover only so far.
- Merged before this task: #11 `gallop-neck` (merge commit c93f4fb): gallop `nod` 0.2 → 0.45, `nodPeak` 0.5 → 0.6 (src/horse/gaits.js:149, :163), with the "Gallop, second pass: neck swing" section in `docs/VIDEO-REFERENCE.md`.

## Verification

- `main` at c93f4fb (#11): Site checks, Build and browser smoke test, All checks passed and Publish the horse succeeded; the Pages deployment of c93f4fb is "success".
- Live site (headless Chromium, scratch `live-check.cjs`): served bundle has `rockPeak:.58,nodPeak:.6` and `nod:.45`; gallop at 13.5 m/s runs with no page or console errors, head low at 0.88, ±18 cm, 2.25 strides/s, matching `npm run gait-timing` before the merge.
- The same run showed the bug this task fixes: the panel's Gait dropdown read "Standing" while the horse galloped.

## Dead ends

- Refining the whole grid around the head doubled vertices and bake time; a separate head mesh stitched to the body replaced it.
- Zipping head and body by shortest rung diverged at the throat; merging the two boundary loops by angle works.
- A carved eyelid crease pitted the surface; removed.
- The green-screen clips are AI-generated (legs merge and multiply, no stride period): never measure them.
- Our captures face right and the footage faces left: mirror ours (`ffmpeg -vf hflip`) before `headbob.py`, or it measures the tail as the head.
- The no-reload Vite server (watching off) keeps serving the old modules after an edit: restart it before capturing, or pass the change with `?gp=`.
- The silhouette "head vs neck" measure swings with the face angle, so it is unreliable for tuning the canter nod; use the skeleton measure from `npm run gait-timing`. Its head window must exclude pixels below the chest, or a reaching fore hoof gets counted.
- "Lower the hip joint": the hip height (1.27 m) and segment lengths agree with published hindlimb data; the real cause was the hock being fixed in stance.
- Vite's dev server hot-reloads open pages on every edit, which kills Playwright captures; capture from a server with `hmr: false` and file watching off.
- Journal hosts (pmc.ncbi.nlm.nih.gov, research-portal.uu.nl, pub.epsilon.slu.se) cannot be fetched from this environment; papers are cited from search summaries and marked as such.
- The footage-analysis scripts (colour tracking, stride period, silhouette heights, phase-aligned pairs) lived in a session scratchpad and are not in the repo; recreate them if a measurement pass needs them.

## Next

Step 2 of the plan: add the dropdown assertion to `tests/smoke.mjs` and see it fail.

Candidates after this task, from the roadmap:
- Gallop trunk pitch: the footage's withers window rises about twice as much as ours (10.7% against 5.2%); needs a cleaner side-on gallop to separate trunk pitch from neck motion.
- Canter head swing against the neck by silhouette (4.2% against 9.1%).
- Quantise speed changes to the stride cycle.
- Pastern approaching horizontal at the gallop.
- Turn on the forehand (pivot about the forefeet) when turning on the spot.
- Chewing, lip movement, skin twitches at rest, muscle bulging under load.
- Dual-quaternion skinning or corrective shapes for volume loss at stifle and elbow.
- Forelimb and pelvis in the reach model, so fast-end duty factors reach published values.

## Subagent files

None.
