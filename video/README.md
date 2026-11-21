# Reference clips: labels

Third-party footage collected as **motion reference only**. It is not part of
the horse engine or its assets, is not covered by the repository's GPL licence,
and is kept on this branch only; nothing here is merged into `main`. The
measurements taken from it are in `docs/VIDEO-REFERENCE.md` on `main`.

Times are seconds within each clip (cuts found with ffmpeg scene detection and
checked by eye). **Speed** says whether the motion plays in real time, judged
from the stride frequency against what a horse of that size can do: canter
strides at 1.0–1.15 per second can only be slow motion (about 2×), walk at
1.0 and trot at about 1.55 per second are real time. "—" means not measured.

## *Wild Horses of Australia* (documentary, YouTube `lgV1CB8Zhf4`)

25 fps, 3840×2160, AV1. File names start with the documentary time code.

| File | Shots | Gait, view, camera | Speed | Good for |
| --- | --- | --- | --- | --- |
| `wha-00m18s-montage-gallop-through-water-stallions-sparring.webm` | 0–1.4 horses gallop through shallow water; 1.4–2.8 black and bay stallions shoving on sand; 2.8–3.2 bays moving through bush | gallop 3/4 front, long lens; sparring close, rear 3/4 | — | splash, sparring behaviour |
| `wha-00m26s-dingo-aerial-herd-gallop-bay-gallop-tracking.webm` | 0–1.1 dingo (no horses); 1.1–2.8 aerial, herd galloping on red sand; 2.8–4.8 bay galloping | gallop, aerial; bay tracked from rear 3/4 | — | herd spacing, gallop from behind |
| `wha-00m57s-bay-gallop-side-tracking-desert.webm` | 0–0.8 two heads close (bay, chestnut); 0.9–5.0 bay galloping; 5.0–5.4 two horses standing by rocks | gallop, side-on, long-lens tracking from above, shadow visible | — | gallop silhouette, limb folding |
| `wha-02m25s-young-bay-canter-side-tracking-slowmo.webm` | 0–5.8 young bay brumby cantering across grassland; 5.8–6.2 aerial of a snowy river | canter, side-on, tracking | slow motion ≈2× (stride 25 frames) | **canter footfall timing (measured)**, head and back motion |
| `wha-03m40s-four-horses-walk-side-static.webm` | 0–5.1 grey, bays and palomino walking along a slope; 5.1–5.5 another shot | walk, side-on, static | — | walk in a group, coat colours |
| `wha-03m50s-herd-in-valley-dark-bay-walk-side-closeup.webm` | 0.3–4.9 herd grazing in a valley, one horse walking toward camera; 4.9–10.0 dark bay walking against the sky | walk; close side-on, tracking | real time (stride 25 frames = 1.0 Hz) | walk head nod, neck, belly, tail swish |
| `wha-11m49s-mare-foal-standing-then-canter-in-bush.webm` | 0–0.6 mare's belly close; 0.6–4.2 chestnut mare standing, foal behind; 4.2–12.6 mare and foal cantering through bush; 12.6–13.0 dingo | standing side-on; canter side-on, tracking | — | foal proportions and gait, standing posture |
| `wha-17m30s-herd-hillside-chestnut-toward-camera-trot-side.webm` | 0–2.0 herd on a wooded hillside; 2.1–5.0 chestnuts walking and trotting, 3/4; 5.0–8.3 chestnut with a blaze coming toward camera; 8.3–11.3 chestnut trotting against the sky; 11.3–11.8 palomino head close | trot side-on (last long shot) | real time (stride ≈16 frames = 1.56 Hz) | trot timing, front view |
| `wha-18m00s-herd-canter-along-ridge-side-tracking.webm` | 0–5.8 herd (grey, black, bays, chestnuts) cantering along a ridge; 5.8–6.3 blurred pass through trees | canter, side-on against the sky, tracking | — | herd canter, mane and tail in the wind |
| `wha-18m24s-herd-toward-camera-chestnuts-canter-side-dusk.webm` | 0–1.6 herd running toward camera through bush; 1.6–6.2 chestnuts cantering behind a fallen log at dusk; 6.2–6.9 legs close | toward camera; canter side-on | — | front view of a running herd |
| `wha-18m32s-hooves-closeup-herd-canter-side-slowmo.webm` | 0–1.2 chestnuts cantering at dusk; 1.3–4.9 legs and hooves striking the ground, close; 4.9–12.2 herd of bays cantering, close | canter side-on, tracking | slow motion ≈2× (22-frame stride) | hoof contact, fetlock sink, close canter |
| `wha-22m49s-aerial-bush-grey-canter-side-forest.webm` | 0–4.6 aerial over bush (no horses); 4.6–10.0 grey cantering through forest; 10.0–10.5 grey and bay toward camera | canter side-on, tracking | — | grey coat, canter |
| `wha-22m55s-grey-canter-toward-camera-foal-lying.webm` | 0–4.2 grey cantering toward camera, bay beside; 4.2–4.7 foal lying in grass | canter, front view | — | front-view canter, lying foal |
| `wha-23m57s-mare-foal-hillside-walk-trot-alert.webm` | 0–0.6 dark horse close; 0.6–8.7 mare and foal on a hillside, walking and trotting, mare stops alert with her head high; 8.7–9.2 mare and foal close | walk and trot, side and 3/4 | — | alert posture, foal following its dam |
| `wha-25m27s-grey-mare-foal-canter-toward-camera.webm` | 0–0.9 chestnuts running in forest; 0.9–9.4 grey mare and chestnut foal cantering and trotting through open forest | toward camera, panning | — | mare and foal together |
| `wha-45m36s-herd-gallop-through-snow-gums-rider.webm` | 0–8.3 herd galloping through snow and snow gums, partly hidden by branches; a rider at the end | gallop, side and 3/4 | — | snow spray, herd in winter |
| `wha-46m32s-herd-gallop-alpine-plain-wide-trap-yard.webm` | 0–10.5 herd galloping across an alpine plain; 10.5–11.0 brumby trap yard | gallop, wide, long lens | — | herd formation at a distance |
| `wha-50m48s-herd-trot-along-skyline-side.webm` | 0–3.8 herd trotting along a skyline, close; 3.8–4.2 dark horse galloping close | trot side-on against the sky | real time (stride ≈16 frames = 1.56 Hz) | trot timing, tail carriage |

## Green-screen clips (stock, YouTube `UR_3cgjCnBA`)

29.97 fps, 1920×1070, H.264, about 5 s each. The horse runs in place against a
green backdrop.

| File | Content |
| --- | --- |
| `greenscreen-00m00s-bay-canter-in-place-synthetic.mkv` | bay, canter-like motion, 3/4 side |
| `greenscreen-00m05s-dark-heavy-horse-high-action-in-place-synthetic.mkv` | dark heavy horse, high knee action, 3/4 front |
| `greenscreen-00m10s-bay-canter-in-place-synthetic.mkv` | bay, canter-like motion, side |
| `greenscreen-00m15s-dark-bay-gallop-in-place-synthetic.mkv` | dark bay, gallop-like motion, 3/4 front |

**Not used for any measurement.** They look AI-generated: from one frame to
the next, legs merge, multiply and change length, hooves appear and vanish,
the body never travels, and the leg motion has no regular stride period
(pose self-similarity finds none). Their footfalls are not those of a real
horse.
