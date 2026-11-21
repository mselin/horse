# Motion notes: analysis, references and checklist

How the horse's motion is built, what was measured, what changed, and what
reference material to compare it against.

## How the motion is built

| Layer | File | What it does |
| --- | --- | --- |
| Gait data | `src/horse/gaits.js` | For each gait: footfall phase of each leg, duty factor, stride frequency against speed, swing height, joint-flexion amplitudes, trunk and neck amplitudes, surge. Values from the literature in `RESOURCES.md` |
| Leg timing | `Locomotion.js` | Each leg runs its own cycle. The current gait sets where each leg *should* be, and a leg only catches up or waits while it is in the air, so gaits change within about a stride, leg by leg, instead of cross-fading two footfall patterns |
| Stance | `Locomotion.js` | The hoof is planted in world space; breakover pivots it about the toe at the end of stance. Stance length adapts to speed so the stance never needs more reach than the leg has (stance time shortens with speed, swing time stays about constant, as in real horses) |
| Swing | `Locomotion.js` | Planned in the horse's heading frame, from lift-off to the planned landing. The fore-aft path is a cubic Hermite curve: the hoof follows through backward, swings forward, overshoots a little and **retracts** onto the landing spot. Lift is a C2-smooth bump |
| Legs | `Locomotion.js` | Planar two-bone IK (shoulder–elbow, hip–stifle) with the distal joints (carpus, hock, fetlock, coffin) folding on C2-smooth curves. Near full extension the reach is softened so a leg eases straight instead of snapping |
| Trunk | `Locomotion.js` | The loads on the legs drive second-order springs for bounce, pitch, roll and sway, so the trunk behaves like a sprung mass with lag and overshoot. A small forward surge happens within each stride, plus lumbosacral flexion and lateral bending in turns |
| Neck and head | `Locomotion.js` | Five neck segments form a cascade of springs: each follows the one before with a little more lag, so a wave travels down the neck. The neck reacts to the trunk's vertical acceleration. The head is stabilised: it counter-rotates most of the neck and trunk pitch |
| Tail | `Locomotion.js` | A cascade of springs in pitch and yaw: carried higher with speed, kicked by trunk bounce, swaying with the walk, swishing at rest |
| Soft tissue | `coat.js` (vertex shader) | The belly and flanks lag the trunk's vertical motion through a fast underdamped spring |
| Breathing | `Locomotion.js` | Free at rest and at slow gaits; at canter and gallop, locked to one breath per stride |
| Mane and tail hair | `Hair.js` | Verlet guide strands with shape matching, air drag from the horse's own speed, gusts and flutter, and collision spheres. Thousands of GPU-expanded strands follow the guides |

## Measurements (`npm run test:motion`)

`tools/motion-check.mjs` drives the locomotion headless on the real
skeleton through:

1. walk, trot, canter and gallop
2. turns both ways
3. a halt

CI fails if any limit is exceeded.

Before and after this pass, over the same sequence:

| Measure | Before | After |
| --- | --- | --- |
| Hoof vs its target, mean | 4.8 cm | ~1 cm (walk 0.3, trot 1.3, canter 1.3, gallop 2.2) |
| Hoof vs its target, worst | 90 cm (mid-swing at canter: the swing path was planned in world space and its predicted landing jumped) | 15 cm (gallop, at the soft reach limit) |
| Planted hoof slip, worst per frame | 8.5 cm | 3.6 cm (gallop, end of stance) |
| Trunk vertical acceleration, peak | 90 m/s² (kinked load signal) | 43 m/s² |
| Hoof angle acceleration, peak | ~5,500 rad/s² (piecewise blends; swing curves with infinite slope at lift-off) | ~1,600 rad/s² |

Causes found and fixed:

- **Swing bumps of the form `sin(π·w^p)` with p < 1** have infinite slope
  at lift-off. They were replaced by C2 smootherstep bumps.
- **Unreachable stance at canter and gallop.** Stance travel (`v · duty / f`)
  exceeded the leg's span, so legs snapped straight and hooves slid. The
  duty factor now adapts to the reach.
- **World-space swing paths** chased a predicted landing point, which jumped
  when speed or timing changed. Swing is now planned in the heading frame.
- **Velocity discontinuity at lift-off.** A planted hoof moves backward
  relative to the body at full speed, but the swing path started from rest.
  The Hermite swing path carries part of that velocity.
- **The trunk, neck and tail were computed directly**, with no inertia.
  They are now springs.
- **Gait changes cross-faded footfall patterns.** Legs now re-time
  themselves during their own swing.

## Reference material

Gathered by a research pass using web searches. **[V]** means confirmed in
search results; **[GK]** means general knowledge, not confirmed. Some hosts
could not be fetched from the build environment.

### Gait footage

- **Owner's pick:** horse motion footage chosen as a reference for this project: https://www.youtube.com/watch?v=lgV1CB8Zhf4. The build environment can't fetch YouTube, so the clip hasn't been reviewed against the animation yet.
- Britannica gallop clip, four-beat racing gallop: https://www.britannica.com/topic/gallop/images-videos [V]
- University of Nebraska slow-motion gaits with leg wraps, which make the footfall order easy to see: https://mediahub.unl.edu/media/24357 [V]
- American Museum of Natural History, walk, trot and gallop flipbooks: https://amnh.org/explore/ology/zoology/horse-gaits-flipbooks-walk-trot-and-gallop [V]
- Muybridge zoopraxiscope animations: https://archive.org/details/zoopraxiscope_animation. Plates on Wikimedia Commons: https://commons.wikimedia.org/wiki/Eadweard_Muybridge [V]
- Slow-motion racehorse footage (BBC Earth Unplugged): https://horseillustrated.com/horse-videos-editors-choice-videos-slow-mo-racehorse/amp [V]
- 1000 fps Phantom promo for ITV racing: https://eastcityfilms.com/champions-day [V]

### Games and research

- **Red Dead Redemption 2**, GDC 2021, "Making the Believable Horses of RDR II" (Tobias Kleanthous): https://gdcvault.com/play/1027230/AI-Summit-Making-the-Believable [V]
  - Turns pivot about the front feet with lateral adjustment.
  - Speed changes are synchronised to the stride cycle.
  - Stops are matched to the stride ("stop matching").
  - Euphoria drives physical reactions: https://gamingbolt.com/red-dead-redemption-2s-euphoria-engine-is-radically-overhauled-says-rockstar [V]
- **Kingdom Come: Deliverance II:** a real horse was motion-captured for the CGI trailer: https://www.gamesradar.com/games/rpg/if-you-liked-red-dead-redemption-2s-ultra-realistic-horses-kingdom-come-deliverance-2-devs-also-used-a-real-horse-in-the-motion-capture-studio [V]
- **The Witcher 3**, Roach's motion capture: https://www.techtimes.com/articles/146402/20160401/cd-projekt-red-explains-why-the-witcher-3s-horse-was-so-buggy.htm [V]
- **Zhang, Starke, Komura, Saito**, "Mode-Adaptive Neural Networks for Quadruped Motion Control", SIGGRAPH 2018, DOI 10.1145/3197517.3201366: learned quadruped locomotion from unlabelled motion capture [V]
- **Gwen Frey**, GDC 2017, quadruped foot sliding and blending: https://gamedeveloper.com/art/video-animating-pups-boars-other-quadrupeds-in-i-the-flame-in-the-flood-i- [V]
- **The Mane Quest**, critiques by an equestrian game developer:
  - resources: https://www.themanequest.com/blog/2024/9/6/horse-animation-guides-references-and-resources [V]
  - "8 common mistakes": https://themanequest.com/blog/2021/8/22/8-common-horse-mistakes-i-want-game-developers-to-stop-making [V]
  - Ghost of Tsushima: https://www.themanequest.com/blog/2023/5/1/the-horses-in-ghost-of-tsushima-wonderful-details-and-fundamental-problems [V]

### Film

- **Spirit: Stallion of the Cimarron.** Deb Bennett consulted, a live mustang was kept at the studio, and 3D cycles were traced for volume. Sources: https://www.cgw.com/Publications/CGW/2002/Volume-25-Issue-5-May-2002-/Free-Spirits.aspx [V]
- **The Lord of the Rings.** Horse motion capture fed the Massive crowd agents: https://cgw.com/Publications/CGW/2004/Volume-27-Issue-1-Jan-2004-/The-Big-and-the-Sm-agol.aspx [V]
- **War Horse.** About 200 Framestore shots include digital horses: https://www.framestore.com/work/war-horse [V]
- **Seabiscuit.** Real racing shot from a camera car, good live-action reference: https://www.cgw.com/Publications/CGW/2003/Volume-26-Issue-10-Oct-2003-/Making-Tracks.aspx [V]

### Animation craft

- Muybridge, *Animals in Motion* (Dover). Scan: https://ia601401.us.archive.org/35/items/animalsmotion00muyb/animalsmotion00muyb.pdf [V]
- Cathy Feraday Miller, "Animating Four-Legged Beasts". It treats the walk as two offset human walks, with the hips and chest as offset bouncing balls: https://gamedeveloper.com/art/animating-four-legged-beasts [V]
- Richard Williams, *The Animator's Survival Kit*, horse walk [GK]

## Realism checklist

✓ done · ~ partly · ✗ not yet

**Gait timing**
- ✓ Gait thresholds: walk to trot happens at Froude ≈ 0.35, about 2 m/s.
- ✓ Gallop stride frequency is about 2.2–2.3 Hz.
- ✓ Stance shortens with speed while swing stays about constant.
- ~ Gait changes happen within about a stride, leg by leg. Nothing yet forces a canter to start from the outside hind.
- ✗ Speed changes are not yet quantised to the stride cycle, as RDR2 does.

**Head and neck**
- ✓ The neck runs as a spring cascade with a stabilised head.
- ✓ The head nods once per stride at canter and gallop.
- ~ Nod amplitude per gait is tuned by eye; the references give no numbers in centimetres.
- ✓ The trot nod is symmetric. An uneven nod reads as lameness.

**Trunk and back**
- ✓ The trunk is sprung.
- ✓ Trot bounces twice per stride, lowest at mid-stance.
- ✓ Pitch dominates at canter.
- ✓ Most flexion at the gallop is lumbosacral.
- ✓ Breathing locks to the stride at canter and gallop.

**Hooves and swing**
- ✓ Landing is flat to slightly heel-first, never toe-first.
- ✓ Breakover pivots about the toe.
- ✓ The fetlock sinks under load.
- ✓ The carpus folds in swing, then the leg reaches forward and retracts before landing.
- ~ The pastern does not yet approach horizontal at the gallop.

**Tail**
- ✓ Carried higher with speed and kicked by trunk bounce.
- ✓ Sways side to side at the walk.
- ✓ Swishes at rest.

**Mane, ears and skin**
- ✓ The mane is simulated, with air drag from the horse's speed and flutter.
- ✓ The ears swivel independently and pin back at speed.
- ✓ The belly and flanks jiggle after footfalls.
- ✗ No muscle bulging under load.
- ✗ No skin twitches at rest.

**Turning**
- ✓ The horse leans into turns with tan θ ≈ v·ω/g.
- ✓ The neck bends into the turn.
- ✗ No pivot about the forefeet when turning on the spot.
- ✗ No inside lead in canter turns.

**Known gaps**
- Planted hooves can still slide a few centimetres at the very end of stance at a full gallop, where the leg reaches its limit.
- Linear-blend skinning still loses some volume at the stifle and elbow in deep flexion. Dual-quaternion skinning or corrective shapes would help.
