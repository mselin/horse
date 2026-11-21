# Horse reference resources

The resources found and used to build the procedural horse. For each one: what
it is and what it was used for in the code. Licensing notes are included
because the model is built **entirely in code**. No third-party meshes,
textures or motion data are bundled; the sources below supplied *numbers and
shapes to aim for*, not assets.

> Note: this build environment blocks direct page fetches from NCBI/PMC,
> Wikipedia and some other hosts, so several papers were consulted through
> search-engine summaries rather than full text. Where a number could not be
> confirmed against the original page, it is marked as such.

## 1. Conformation and body proportions

| Resource | Used for |
| --- | --- |
| [Equine conformation, Wikipedia](https://en.wikipedia.org/wiki/Equine_conformation) | "Rule of thirds" (shoulder, back, hip roughly equal in side view); head length ≈ ⅔ of the neck topline; square body (withers height ≈ body length) |
| [Conformation of the horse, University of Minnesota Extension](https://extension.umn.edu/horse-care-and-management/conformation-horse) | Neck ≈ 1.5 head lengths (poll to muzzle); topline shorter than underline; back ≈ ⅓ of body length; hip and withers at about the same height |
| [Evaluating horse conformation, UGA Extension B1400](https://fieldreport.caes.uga.edu/publications/B1400/evaluating-horse-conformation/) | Same proportion checks; leg alignment / plumb lines (point of buttock → point of hock → back of cannon) |
| [Conformation: Form to Function, American Farriers Journal](https://www.americanfarriers.com/articles/8770-conformation-form-to-function) | Neck length ≈ ⅓ body length ≈ front-leg length; hoof–pastern axis |
| [*Normal Proportions of the Horse* (1843 French-school text), PMC10367726](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10367726/) | Head-length unit system: withers height ≈ 2.5 heads, poll ≈ 3 heads, shoulder → buttock ≈ 2.5 heads |
| [Skeletal system of the horse, Wikipedia](https://en.wikipedia.org/wiki/Skeletal_system_of_the_horse) and [WikiVet: limb bones](https://en.wikivet.net/Bones_and_Cartilages_-_Horse_Anatomy) | Bone list and joint placement for the rig (scapula, humerus, radius, third metacarpal, phalanges; femur, tibia, tarsus, third metatarsal) |
| [Large Animal Anatomy, thoracic limb (Univ. of Minnesota open textbook)](https://open.lib.umn.edu/largeanimalanatomy/chapter/thoracic-limb-forelimb/) | Forelimb segment layout, carpus and accessory carpal bone, flexor tendons behind the cannon |
| [Skeletal segment length study, PMC7316700](https://pmc.ncbi.nlm.nih.gov/articles/PMC7316700) | Which segments to proportion: neck, back, scapula, humerus, radius, pelvis, femur, tibia, fore and hind cannons (full tables not reachable from this environment) |
| Standing hind-limb joint angles in 50 horses: stifle 128.6 ± 4.1°, hock 160.4 ± 3.9°, fetlock 155.5 ± 2.7° | Rest angles of the hind-limb rig (`src/horse/rig.js`). These came from a search-result summary whose results included [Frontiers in Vet. Sci. 2021](https://www.frontiersin.org/articles/10.3389/fvets.2021.752375/full) and [MDPI Vet. Sci. 12(1):20](https://www.mdpi.com/2306-7381/12/1/20); I could not open the paper to confirm which one it was |

**Thoroughbred target used in the sculpt (`rig.js`, `anatomy.js`):** 1.63 m
withers; body length (point of shoulder → point of buttock) ≈ 1.67 m; girth
depth ≈ 0.74 m (chest floor ≈ 0.88 m above ground, so legs ≈ 55% of height);
forearm ≈ 0.45 m, fore cannon ≈ 0.28 m; scapula sloped ≈ 47°; head ≈ 0.58 m;
neck topline ≈ 0.85 m.

## 2. Classical anatomical plates (muscle and skeleton shapes)

| Resource | Used for |
| --- | --- |
| George Stubbs, *The Anatomy of the Horse* (1766). Scans: [Biodiversity Heritage Library](https://www.biodiversitylibrary.org/bibliography/217588), [Penn Colenda (No Known Copyright, US)](https://colenda.library.upenn.edu/catalog/81431-p3x92218c), [Royal Collection Trust](https://col.rct.uk/collection/1085514/the-anatomy-of-the-horse-including-a-particular-description-of-the-bones) | Muscle groups blocked out as primitives: triceps mass, brachiocephalicus, splenius, serratus, biceps femoris, semitendinosus, tensor fasciae latae, gastrocnemius; jowl/masseter |
| W. Ellenberger, H. Baum, H. Dittrich, *An Atlas of Animal Anatomy for Artists* (Dover 1956, from the 1898–1925 German *Handbuch*) | Artist-oriented surface anatomy of the horse; how muscles read under the skin |
| Eadweard Muybridge, *The Horse in Motion* (1878) and *Animal Locomotion* (1887), public domain: [Wellcome Collection](https://wellcomecollection.org/works/e998rea7), [Commons: race-horse gallop](https://commons.wikimedia.org/wiki/File:Muybridge_race_horse_gallop.jpg), [Brooklyn Museum](https://www.brooklynmuseum.org/opencollection/objects/116597) | Visual check of the gathered and extended gallop phases and limb folding in swing |

## 3. Gait biomechanics (drives `src/horse/gaits.js`)

| Resource | Used for |
| --- | --- |
| [Horse gait, Wikipedia](https://en.wikipedia.org/wiki/Horse_gait); [Canter and gallop, Wikipedia](https://en.wikipedia.org/wiki/Canter_and_gallop); [Montana State Extension: horse locomotion](https://animalrangeextension.montana.edu/equine/locomotion.html) | Footfall sequences: walk LH‑LF‑RH‑RF; trot diagonal pairs; canter (right lead) LH → RH+LF → RF + suspension; transverse gallop LH‑RH‑LF‑RF + one aerial phase |
| Robilliard, Pfau & Wilson (2007), [*Gait characterisation and classification in horses*, J Exp Biol 210:187](https://journals.biologists.com/jeb/article/210/2/187/17107/Gait-characterisation-and-classification-in-horses) | Duty factor and limb-phase classification |
| [Equine gait mechanics review, PMC6826507](https://pmc.ncbi.nlm.nih.gov/articles/PMC6826507) and [PMC10451235](https://pmc.ncbi.nlm.nih.gov/articles/PMC10451235) | Walk 1.4–1.8 m/s, duty ≈ 0.6–0.7, no aerial phase; trot as a spring-mass running gait; hind duty ≈ 0.30 (canter) → 0.20 (fast gallop); transitions around 2 m/s and 4–5 m/s |
| Walk and trot stride reviews ([Utrecht review, J Equine Vet Sci 2024](https://dspace.library.uu.nl/bitstream/handle/1874/437868/1-s2.0-S0737080624000121-main.pdf?sequence=1), [IntechOpen chapter](https://www.intechopen.com/chapters/83285)) | Walk 0.7–1.1 strides/s, stride 1.3–1.9 m; trot 1.5–2.0 strides/s, duty 0.35–0.45, stride 2.0–4.5 m |
| [Thoroughbred race stride data, PMC6680649](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680649); [fatigue study, PubMed 33993952](https://pubmed.ncbi.nlm.nih.gov/33993952/); [MDPI Animals 12:3269](https://mdpi.com/2076-2615/12/23/3269) | Gallop stride ≈ 7.1 m at ≈ 16.6 m/s; stride frequency 2.2–2.35 Hz; horses raise frequency first, then stride length |
| Bertram & Gutmann (2009), [*Motions of the running horse and cheetah revisited*](https://www.researchgate.net/publication/23316837); Biancardi & Minetti (2012), [*Biomechanical determinants of transverse and rotary gallop*, J Exp Biol 215:4144](https://journals.biologists.com/jeb/article/215/23/4144/11268/) | Transverse vs rotary gallop; lead limb; Hildebrand limb phase |
| Dunbar et al., [head, neck and trunk stabilisation at walk, trot and canter, PMC2768006](https://pmc.ncbi.nlm.nih.gov/articles/PMC2768006); [neck/back ROM on a circle, Vet Res Commun 2023](https://link.springer.com/article/10.1007/s11259-023-10132-y) | Head is stabilised rather than counter-pitched; thoracolumbar flexion ≈ 4° at walk to 9° at canter; pelvic pitch 7° to 16°. Drives the body/neck motion amplitudes |

## 4. Head, eye, coat

| Resource | Used for |
| --- | --- |
| [Merck Veterinary Manual: eye structure](https://www.merckvetmanual.com/horse-owners/eye-disorders-of-horses/eye-structure-and-function-in-horses); [Equine vision, Wikipedia](https://en.wikipedia.org/wiki/Equine_vision) | Horizontal oval pupil, *corpora nigra* on the upper pupil margin, laterally placed eyes, third eyelid in the inner corner (procedural eye in `Eyes.js`) |
| Merkies K., Ready C., Farkas L., Hodder A., "Eye Blink Rates and Eyelid Twitches as a Non-Invasive Measure of Stress in the Domestic Horse", *Animals* 9(8):562, 2019, DOI [10.3390/ani9080562](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6721043/) | Blink timing in `Eyes.js`: relaxed horses make about 8–9 full blinks a minute, plus half blinks; stress lowers both |
| [Equine coat color](https://en.wikipedia.org/wiki/Equine_coat_color); [Bay](https://en.wikipedia.org/wiki/Bay_horse); [Chestnut](https://en.wikipedia.org/wiki/Chestnut_(horse_color)); [UC Davis VGL coat genetics](https://vgl.ucdavis.edu/node/3451) | Coat presets: bay = red body with black points; chestnut = no black hairs; plus black, dapple grey, palomino, buckskin. White markings: star, blaze, socks |

## 5. Rendering hair and fur

| Resource | Used for |
| --- | --- |
| Yan, Tseng, Jensen, Ramamoorthi (2015), [*Physically-accurate fur reflectance*](https://sites.cs.ucsb.edu/~lingqi/publications/paper_fur.pdf); Yan & Jensen (2017), [*An efficient and practical near and far field fur reflectance model*](https://cseweb.ucsd.edu/%7Eravir/lingqi_fur2.pdf) | Why fur needs a fibre (cylinder) model. The real-time approximation here: anisotropic GGX whose highlight band runs across the fibre direction |
| Kajiya & Kay (1989), *Rendering fur with three dimensional textures*; [KHR_materials_anisotropy](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy) | Hair highlight model and three.js `anisotropy` conventions |

## 6. Research datasets (not bundled; possible future validation)

| Resource | Notes |
| --- | --- |
| [hSMAL horse shape model (Li et al., 2021)](https://sites.google.com/view/cv4horses/project/hsmal) | SMAL-compatible horse template learned from 37 horse toys; 36 parts, 1,497 vertices. Research licence |
| [PFERD: Poses for Equine Research Dataset (Li et al., *Scientific Data* 2024)](https://celiali.github.io/PFERD/) | Marker-based horse motion capture (100+ markers, 10 cameras). Could be used to validate or fit gait curves. Check the licence before any use |
