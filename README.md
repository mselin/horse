# Horse

A realistic Thoroughbred, **sculpted, rigged, groomed and animated entirely in
code**, running in the browser with three.js / WebGL2. No external meshes,
textures or motion capture are used.

**Live: https://mselin.github.io/horse/**

![Gallop, side tracking shot](docs/screenshots/gallop-side.jpg)

| | |
| --- | --- |
| ![Standing](docs/screenshots/standing.jpg) | ![Gallop toward camera](docs/screenshots/gallop-front.jpg) |

![Eye and muzzle close-ups](docs/screenshots/head.jpg)

Gallop cycle (gathered → extended), procedural:

![Gallop cycle](docs/screenshots/gallop-cycle.jpg)

*Screenshots come from a headless software renderer (SwiftShader), with no
GPU anti-aliasing for the hair. A real GPU renders cleaner hair edges.*

## Run

```bash
npm install
npm run dev
```

Open the printed URL. The first load bakes the mesh in a Web Worker (a few
seconds). The result is cached in IndexedDB, so later loads are instant until
the sculpt changes.

`npm run build` produces a static site in `dist/`.

### Controls

| Key | Action |
| --- | --- |
| W / S (↑ / ↓) | Next / previous gait |
| 1 – 5 | Stand, walk, trot, canter, gallop |
| A / D (← / →) | Steer |
| Space | Halt |
| C | Camera: orbit / cinematic / side tracking |
| H | Hide UI |

A demo tour cycles through the gaits until you press a key. The panel has
coat colours, white markings, time of day, mesh detail and a skeleton view.

URL options: `?quality=low|medium|high`, `?coat=bay`, `?cam=cinematic`, `?nodemo`,
`?dirt=0..1`, `?sweat=0..1`. Close-up camera shots: `?cam=cinematic&shot=5` (eye),
`6` (shoulder), `7` (fore legs), `8` (hindquarters), `9` (muzzle). The orbit
camera zooms in to 30 cm.

## How it works

1. **Rig** (`src/horse/rig.js`): about 40 bones placed on anatomical landmarks
   for a 1.63 m Thoroughbred, using conformation proportions and measured
   standing joint angles.
2. **Sculpt** (`src/horse/anatomy.js`, `sdf.js`): a signed-distance sculpt
   made of
   - a lofted trunk through measured cross-sections (topline, underline,
     width), so the outline stays exact
   - about 150 anatomical forms layered on top: shoulder blade, triceps,
     pectorals, forearm extensors, biceps femoris, semitendinosus, gaskin,
     tendons, sesamoids, ergots, chestnuts, jowl, facial crest, ears with a
     hollow cup, and more
   - a detailed face: comma-shaped nostrils with an inner passage, the false
     nostril and a rolled alar fold laid onto the muzzle surface; upper and
     lower lips, mouth corners and chin; an almond eye opening cut from a
     skin shell around the globe, with rolled lid margins and a soft upper
     lid fold
   - smooth CSG to combine them

   Each form carries the bones it follows, its hair-flow direction and its
   material region.
3. **Bake** (`bake.js`, `mesher.js`, `stitch.js`): Surface Nets over a
   sparse grid (7.5–12 mm), with vertices projected back onto the surface.
   The head is meshed separately with a cell about a third of that size
   (3–4.3 mm), so the nostrils, lips and eyelids keep their shape, and zipped
   to the body across the upper neck into one watertight mesh. Skin weights
   come from how much each anatomical form contributes at a vertex, then
   diffused across the whole-body mesh; the head's finer vertices take theirs
   from it, so every joint bends the same at any quality level. Hair-flow
   tangents, ambient occlusion and curvature are baked from the distance
   field.
4. **Coat** (`coat.js`, `FacialHairs.js`): physical material with
   - colour presets based on coat genetics, black points and white markings
     painted on the rest-pose skin
   - **hair micro-detail**: tapered hair strands, overlapping like shingles,
     scattered triplanar in skin space and oriented by the baked hair-flow
     field. Gaps between strands are darker, each strand varies in colour and
     reflects light like a cylinder. A coarser clump layer covers mid
     distances. Both fade out with distance so they never shimmer. A whorl
     sits on the forehead.
   - **veins**: the facial, jugular, spur, cephalic and saphenous veins are
     snapped onto the skin at bake time; a fine noise network covers the
     belly, inner legs and face. Both are bump-mapped and stand out more with
     exertion
   - **condition**: dust builds up on the lower legs and belly with distance
     travelled, with splatter. Sustained canter or gallop brings sweat, which
     darkens and glosses the coat and clumps the hair, plus lather between
     the hind legs, at the girth and along the neck. Sweat dries at rest
   - eyelashes, muzzle whiskers, tactile hairs over the eyes and pale tufts
     inside the ears, rooted on the lid margins, lip skin and ear cups
   - **eyes** (`Eyes.js`): an eyeball with a horizontal pupil and
     *corpora nigra*, kept level with the ground; a separate clear cornea
     that carries the reflections a little above the iris; and the third
     eyelid in the inner corner
   - anisotropic highlights across the hair, sheen, baked occlusion and
     curvature
5. **Locomotion** (`gaits.js`, `Locomotion.js`):
   - Footfall timing, duty factors and stride frequencies come from the
     literature.
   - Each leg runs its own cycle and re-times itself while in the air, so
     gaits change within about a stride.
   - Hooves plant in world space with breakover. Stance length adapts to
     speed, so the legs never have to reach past their length.
   - Swing is planned in the heading frame. The hoof follows through after
     lift-off, then reaches forward and retracts before landing.
   - Two-bone IK uses a soft limit near full extension. The joint curves
     are C2-smooth.
   - The trunk (bounce, pitch, roll, sway and surge) is a set of springs
     driven by the load on each leg. The neck and tail are spring
     cascades, so motion travels along them with lag and overshoot.
   - The head is stabilised. Breathing locks to the stride at canter and
     gallop, and the belly and flanks jiggle.
   - The face moves too: the upper lids blink, in full and half blinks at
     the rate measured in relaxed horses, with an extra blink on large gaze
     shifts, and droop a little at a long rest; the upper lashes ride the
     lid. The eyes make small saccades and lead the head into turns. The
     nostrils flare on each breath in, a little at rest and fully at the
     gallop or while blowing after work.
   - The canter's footfalls, duty factor, suspension and rocking were
     measured frame by frame from documentary footage of brumbies and the
     gait matched to them: see [docs/VIDEO-REFERENCE.md](docs/VIDEO-REFERENCE.md).
     `node tools/gait-timing.mjs` prints the same measures for the
     procedural gaits.
   - See [docs/MOTION-NOTES.md](docs/MOTION-NOTES.md) for the analysis,
     the reference footage, and a realism checklist.
6. **Mane and tail** (`Hair.js`):
   - Simulated guide strands use Verlet physics:
     - roots are skinned to the body, and the shape is held toward the rest
       pose
     - wind gusts, air drag from the horse's own speed, flutter at speed
       and collision spheres act on them
   - About 21,000 to 26,000 rendered strands are expanded into
     camera-facing ribbons on the GPU. They taper to the tip, and roots
     and lock interiors are darker.
   - Shading uses a hair model (after Kajiya-Kay and Marschner):
     - a white primary highlight shifted toward the root
     - a secondary highlight tinted by the hair colour
     - light transmitted through backlit strands
   - Strands thinner than a pixel are drawn one pixel wide with matching
     coverage, so the hair stays silky at any distance instead of
     flickering.
7. **World** (`src/world/World.js`):
   - physical sky with clouds and sky-based lighting
   - golden-hour sun with shadows following the horse
   - procedural ground and 70k wind-blown grass blades
   - distant hills and hoof dust
   - post-processing: bloom, warm grade, vignette and grain

See [docs/RESOURCES.md](docs/RESOURCES.md) for every reference used.

## Swapping in a professional model

The animation drives bones by name (`scap_L`, `radius_R`, `hcannon_L`, …),
using planar IK in the parent frames. A sculpted and textured horse rigged to
the same bone names and rest pose can replace the procedural mesh. The
locomotion, hair and world code stay as they are.

## Checks and publishing

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

| Job | What it checks |
| --- | --- |
| Site checks | HTML against the standard, with html-validate |
| Build and browser smoke test | `npm run test:motion`, then `npm run build` and `npm run test:smoke`. **The motion check** drives the locomotion headless through every gait, turns and a halt, and fails on reach error, planted-hoof slip, trunk acceleration spikes, NaNs, or a horse that doesn't settle. **The smoke test** loads the built site in headless Chromium with software WebGL, bakes the horse, canters, renders a frame, and fails on any page or console error |
| All checks passed | Succeeds only if every job above did. This is the check that merging requires |
| Publish the horse | On `main` only, after all checks pass: deploys `dist/` with GitHub Pages to https://mselin.github.io/horse/ |

`main` is protected by a ruleset. Every change goes in through a pull
request, and it can merge only once **All checks passed** is green. Pushing
straight to `main`, force-pushing and deleting the branch are blocked.

`preview.html` is a development page for inspecting the sculpt
(`?view=side|front|back|top|q34|head|eyeclose|muzzle|ear…`, `?gait=gallop&t=2`,
`?blink=0..1` to hold the lids part-closed, `?flare=0..1` to hold the nostrils
flared). With `?gait=…`, `window.__step(dt)` advances the animation one frame
and returns the image and each leg's stance, for comparing against footage.

## Licence

Copyright (C) 2026 Mika Selin.

The horse engine and everything else in this repository, including the code, the documentation and the
screenshots in `docs/`, are free software: you can redistribute them and/or modify them under the terms of
the **GNU General Public License** as published by the Free Software Foundation, either **version 3** of
the License, or (at your option) any later version. See [`LICENSE`](LICENSE). SPDX identifier:
`GPL-3.0-or-later`.

There are no third-party assets: the horse, its coat, mane and tail, the eyes, the sky, the ground and the
grass are all generated by this code at run time. The published site bundles three.js and lil-gui, both MIT
licensed; their notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and are published with the
site, alongside the GPL text, at `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`. The works listed in
[`docs/RESOURCES.md`](docs/RESOURCES.md) were consulted and are cited, not included.

