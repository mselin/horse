# Reference footage: what was measured and what changed

The gaits were checked frame by frame against footage of real horses:

- 18 clips from the documentary *Wild Horses of Australia*, the owner's pick of
  reference footage (YouTube `lgV1CB8Zhf4`).
- 4 green-screen stock clips (YouTube `UR_3cgjCnBA`).

The footage is third-party material used as motion reference only. It is
**not** part of this repository's code or assets and is not covered by its
licence. The clips sit on the separate `video-snippets` branch and are never
merged into `main`. That branch's `video/README.md` labels every clip:

- its shots with time ranges
- gait, view and camera
- whether it plays in real time or in slow motion
- what it is good for

Only the measurements below come into the project.

## Method

1. **Labelling.** Cuts were found with ffmpeg scene detection, then every
   shot was checked by eye from timestamped contact sheets.
2. **Tracking.** In side-on shots, a bay or chestnut horse is found by colour
   in each frame and cropped around its centre, so a camera that tracks
   imperfectly doesn't matter.
3. **Stride period.** The period comes from how closely the horse's
   silhouette matches itself a given number of frames later (the first clear
   minimum).
   - Walk at 1.0 Hz and trot at about 1.56 Hz are real time.
   - Canters at 1.0–1.15 Hz can only be slow motion, about 2×.
   - In slow-motion shots only *phases* (fractions of a stride) are used,
     never absolute times.
4. **Footfalls.** Touchdown and lift-off of each leg were read by eye from
   enlarged consecutive frames of one stride.
5. **Rocking.** The heights of the nose, withers and croup were taken from
   the silhouette in every frame over about 5 strides, then averaged by stride
   phase.
6. **Our horse, same way.** `tools/gait-timing.mjs` gives the procedural
   gaits' footfalls, pitch and head motion. `preview.html?gait=…` with
   `window.__step(dt)` captures frames that go through the same silhouette
   measurement.

All phases below run from the **trailing hind's touchdown** (0) through one
stride (1). The leading leg is called right, so the footfall order is LH, RH,
LF, RF.

## Canter: working canter, young brumby, side-on (`wha-02m25s…`)

| | Footage | Before | After (5.0 m/s) |
| --- | --- | --- | --- |
| Footfalls: RH, LF, RF touchdown | 0.13, 0.17, 0.38 | 0.15, 0.19, 0.35 | 0.13, 0.17, 0.38 |
| Duty factor (share of the stride a hoof is down) | ≈ 0.46 (leading fore 0.38 → 0.86) | 0.24–0.26 at the app's 6.8 m/s: the leg-reach limit cut it far below the 0.36 asked for | 0.39–0.41 (0.42–0.45 at 4.6 m/s) |
| All four hooves off the ground | ≈ 0.14–0.16 of the stride | 0.39 | 0.22 (0.18 at 4.6 m/s) |
| Forehand highest | ≈ 0.7, late in the leading fore's stance | ≈ 0.2: opposite phase | 0.72 |
| Forehand lowest | ≈ 0.05, as the trailing hind lands | ≈ 0.65 | ≈ 0.2 |
| Head lowest relative to the withers | ≈ 0.7 | ≈ 0.25 | ≈ 0.7 |
| Croup height | nearly level: the trunk rocks about the hindquarters | large bounce | bounce reduced |

The old canter spent about 40% of every stride in the air with short,
stabbing stances. It looked floaty and bouncy next to the real horse, and its
rocking ran backwards.

## Gallop: bay, side-on, long lens over red desert (`wha-00m57s…`)

The bay is tracked by darkness, because its coat colour matches the sand;
the silhouette's upper part keeps its own shadow out. Identical gathered
poses come every 11 frames: **2.27 strides per second, real time**, a
typical gallop rate.

| | Footage | Before | After (13.5 m/s) |
| --- | --- | --- | --- |
| Stride frequency | 2.27 Hz | 2.25 Hz | 2.25 Hz |
| Suspension | one, legs gathered under the body; short, ≈ 0.15–0.25 of the stride (11 frames a stride limit the precision) | 0.35 | 0.32 (0.25 at 10 m/s) |
| Duty factor | — (published at race speed: ≈ 0.2–0.25) | 0.19–0.20 | 0.22–0.23 (0.28–0.29 at 10 m/s) |
| Forehand highest | ≈ 0.8 | 0.68 (set by analogy with the canter) | 0.78 |
| Head lowest relative to the withers | ≈ 0.8 | 0.78 | 0.83 |
| Neck and head | neck long and low, nose pushed out in front, face well off vertical | neck lowered but the head tucked, face near vertical | neck long and low, head opened, nose out |

Changes:

- **More reach at the gallop.** The trunk settles 12 cm (was 9 cm), the
  legs' natural compression at speed, and the fast-end duty factor is
  0.23–0.24.
- **Rocking timing.** The rocking and the neck swing are aimed later in the
  stride (`rockPeak` 0.58, `nodPeak` 0.5), so both peak at about 0.8, as
  measured.
- **Head and neck.**
  - Neck carriage is lower at the gallop, and the nod is larger.
  - The head now cancels the neck's static lowering in full and opens at
    speed. Before, lowering the neck dragged the face toward vertical.

## Trot: brumbies along a skyline, side-on (`wha-50m48s…`), real time

The horses overlap in most frames, so only one horse's near hind reads
cleanly for about one stride. It lands, stays down about 7 of the 16 frames
of the stride (duty ≈ 0.4) and lifts. That timing already matched ours
(duty 0.40–0.42, 1.57 strides a second, 13% airborne). The close trot in
`wha-17m30s…` is framed too tight: the hooves are out of shot.

Two things went beyond timing, so they were checked against published trot
kinematics and the footage's overall look, and measured on ours with
`npm run gait-timing`.

| At 3.8 m/s | Real working trot | Before | After |
| --- | --- | --- | --- |
| Hind hoof vs the print the fore on the same side just left | in it or a little past ("tracking up") | 18 cm short | in it (0.7 cm short); 8 cm past at 4.6 m/s |
| Withers travel per diagonal | ≈ 6–9 cm | 13 cm | 7.7 cm |
| Nose relative to the withers | small | 11.5 cm | 6.6 cm |

Changes:

- **Tracking up.** At the trot the hind stance sits further under the
  body and the fore stance a little further back. The trunk settles 6 cm
  (was 3 cm) to give the hind leg the reach.
- **Bounce.** Less vertical bounce at the trot.
- **Walk.** Tracking at the walk improved in two steps.
  - The same stance changes as the trot.
  - Later, slower and longer walk strides: 0.94 per second at 1.8 m/s, against
    1.0 for the smaller brumbies in the footage. The hind leg's stifle and hock
    now also open together in stance.
  - Result: at a medium walk (1.8 m/s) the hind hoof lands 12 cm past the fore
    print (published: 10–30 cm), and from about 1.6 m/s it lands in it or past.
  - An earlier note blamed a high hip joint in the rig. The rig's hip height
    and segment lengths agree with published hindlimb measurements, so it was
    left as it is (see `MOTION-NOTES.md`).

## Walk and trot

| | Footage | Model |
| --- | --- | --- |
| Walk stride frequency (`wha-03m50s…`, close dark bay, real time) | 1.0 Hz (smaller horses) | was 1.01 Hz at 1.6 m/s; now 0.94 Hz at the app's 1.8 m/s, a Thoroughbred's longer stride |
| Walk duty | — (published: ≈ 0.6) | was 0.54 front, 0.46 hind (reach-limited); now 0.59 / 0.56 at 1.6 m/s and 0.55 / 0.52 at 1.8 m/s (the longer stride trades a little stance for the over-track) |
| Trot stride frequency (`wha-17m30s…`, `wha-50m48s…`, real time) | ≈ 1.56 Hz | 1.57 Hz at 3.8 m/s: unchanged |
| Trot duty, airborne share | — (published: ≈ 0.4–0.45, short suspension) | was 0.41 front, 0.37 hind, 0.15 airborne; now 0.42 front, 0.40 hind, 0.13 airborne |

## What changed in the animation

- **Duty factor falls with speed within each gait.** `duty` holds at the
  slow end of the gait's speed range and `dutyFast` at the fast end.
- **The legs can sweep further in stance.**
  - The trunk settles lower as soon as the horse moves, which is how a
    loaded leg compresses. Before, this only grew with speed up to 10 m/s.
  - The reach model credits the shoulder blade's rotation and the pelvis
    rocking more: fore +13 cm, hind +9 cm, up from +10 and +2.
  - The motion check still passes: planted hooves slip at most 3.8 cm (3.6
    before), and peak vertical trunk acceleration is 39 m/s² (43 before).
- **Canter timing comes from the footage.**
  - Footfall offsets as measured.
  - The canter's speed range is now 4.2–8.5 m/s, and the app's canter
    speed is 5.0 m/s, a working canter (it was 6.8 m/s).
  - Gait thresholds moved to match: trot to canter at 4.8 m/s, canter
    back to trot at 4.3 m/s, canter to gallop at 9.0 m/s, and back at
    8.0 m/s.
- **Canter and gallop rock with the stride.**
  - The pitch and the neck swing are locked to the stride phase (`rockPeak`
    and `nodPeak` in `gaits.js`), so the forehand rises through the leading
    fore's stance and the head counter-swings.
  - Symmetric gaits keep the load-driven pitch.
  - The gallop uses the same rule, later measured from the desert gallop
    (below).
- **Smaller adjustments.** Lower neck carriage and a higher tail at the
  canter, as in the footage. Less vertical bounce at the canter, so the
  rocking dominates.

## The green-screen clips

The four green-screen clips were looked at frame by frame and **left out**.
They show the artefacts of generated video:

- legs merge, multiply and change length from one frame to the next
- hooves appear and vanish
- the horse never travels
- the leg motion has no regular stride period: the silhouette measurement
  finds none

Footfalls taken from them would not be a real horse's.

## Not yet measured

- Individual gallop footfall times: at 25 fps the gallop gives only 11
  frames a stride, and motion blur hides the contacts; high-speed footage
  would settle them.
- Hoof contact detail from the close-up hooves in `wha-18m32s…`: fetlock
  sink, heel-first landing.
- Behaviour: the alert stance in `wha-23m57s…`, sparring in `wha-00m18s…`, a
  foal lying down in `wha-22m55s…`.
