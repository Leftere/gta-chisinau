# GTA Chișinău

A drivable model of central Chișinău, built from real OpenStreetMap geometry and
rendered in the browser with three.js.

The city is not invented. Every street, building footprint and tree position is
pulled from OSM and projected onto a local metric plane, so the block layout,
street widths and building outlines match the real place. Drive down
Bd. Ștefan cel Mare and it turns where the real one turns.

**Play area:** 2.6 × 2.2 km around Piața Marii Adunări Naționale
**Contents:** 4,640 buildings · 3,171 street segments · ~5,000 trees · 154k triangles in 33 draw calls

---

## Running it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

The map data is committed under `public/data/`, so this is all you need.

### Deploying

Static site, no server side. `vercel.json` pins the Vite preset and the cache
headers:

```bash
npx vercel login
npx vercel --prod
```

`npm run build` only bundles — it does **not** regenerate the map, so whatever is
in `public/data/` at deploy time is what ships. Run `npm run build-world` first if
you have changed `overrides.json`.

Vercel Web Analytics is wired up in `src/main.js`. It is gated on
`import.meta.env.PROD` rather than left on the package's own `mode: 'auto'`,
which resolves by reading `process.env.NODE_ENV` — a variable that does not
exist in a Vite browser bundle. The lookup throws, the package swallows it, and
every environment is treated as production, so the dev server ends up 404ing on
`/_vercel/insights/script.js` on every load.

The two cache rules matter. `assets/` is content-hashed by Vite, so it is
immutable for a year; `data/*.json` keeps a stable filename across map rebuilds,
so it must revalidate or a returning player gets last month's city.

### Controls

| Key | |
|---|---|
| `W` / `S` | throttle / brake (hold `S` at a standstill to reverse) |
| `A` / `D` | steer |
| `Space` | handbrake — collapses rear grip, so the back steps out |
| `C` | camera: chase → hood → far → orbit |
| `[` `]` | time of day |
| `Q` | quality: medium → high → low |
| `R` | respawn (back to the start, on Ștefan cel Mare beside the Arcul de Triumf) |
| `V` | sound on / off |
| `M` / `H` | minimap / control list |
| `click` | inspect a building — id, inferred values, override snippet |

### On a phone

Touch controls appear automatically on a coarse pointer: an analogue steering
strip under the left thumb, **GO** / **BRAKE** / **HANDBRAKE** under the right,
and CAM / MAP / RESET / FULL along the top. Tap a building to inspect it as on
desktop. Landscape is strongly preferred and the game says so, with a way past
it if your phone is orientation-locked.

Steering is a strip rather than left/right buttons because the car takes an
analogue steer value: at speed, the difference between a little lock and full
lock is the difference between changing lane and spinning, and buttons throw
that away.

The scheme is not chosen once and frozen. A coarse pointer only picks the
*initial* state; after that the last input actually used wins, so a touchscreen
laptop stops showing a thumb pad the moment you touch the keyboard, and a tablet
with a keyboard case can go back.

**Quality presets.** `medium` is the default and the right choice for a GTX 1650:
2048px shadows, bloom and SMAA. `high` adds ground-truth ambient occlusion
(GTAO) and a 3072px shadow map — it looks noticeably better in courtyards and
under eaves, but it is the setting most likely to cost you frames. `low` drops
post-processing entirely.

---

### Attribution

OpenStreetMap data is ODbL, so the produced work has to carry a credit somewhere
a viewer would reasonably look. The game shows it persistently in-frame and again
on the loading screen — do not remove either. Elevation comes from the Terrain
Tiles dataset on AWS Open Data and is credited alongside it.

Note that `public/data/world.json` is a *derived database* under ODbL, not a
produced work: redistributing that file carries share-alike obligations that the
rendered game itself does not. Worth reading the licence before building anything
commercial on it.

## Rebuilding the map

Only needed if you want a different part of the city, or fresher OSM data.

```bash
npm run fetch-map -- --force   # street/building geometry from Overpass (~6 MB)
npm run fetch-dem              # elevation tiles -> public/data/terrain.json
npm run build-world            # -> public/data/world.json
```

To move or resize the play area, edit `ORIGIN` and `BBOX` at the top of
[`tools/fetch-osm.mjs`](tools/fetch-osm.mjs) and run both commands.

Two things worth knowing about the download: the public Overpass instances
reject one large combined query under load, so the fetcher issues six small ones
with retries and backoff across mirrors; and Overpass answers `406` unless the
request carries explicit `Accept` and `User-Agent` headers, which Node's `fetch`
does not send by default.

---

## The building workbench

`/building.html?id=way/991056896` — one building, on its own, orbitable.

```bash
npm run dev      # then open http://127.0.0.1:5173/building.html
```

Iterating on a facade inside the full city means a 30-second load, then driving
to the building, then finding an angle you can judge it from. The workbench
loads a single footprint on its real patch of ground with its real street in
front, so a family can be checked against a photograph in seconds.

| | |
|---|---|
| **id box** | any `way/…`, `relation/…` or monument id; `‹ Prev` / `Next ›` / `Random` walk the map |
| **orbit** | drag to rotate 360°, scroll to zoom, right-drag to pan, `R` to auto-spin |
| **try a different reading** | family, storeys, roof and colour, rebuilt live — this is the point of the tool |
| **save / forget** | writes `overrides.json` directly — no copy-paste step |
| **note** | why you chose this reading, and what is still a guess |
| **next unedited** | walks the city biggest-first, skipping anything already decided |
| **rebuild world** | runs `build-world` and reloads, so the game reflects the edit |
| **override snippet** | still there, if you would rather paste it yourself |
| **light** | 06:00–21:00, because a facade that reads at noon can disappear at six |

### Editing, one building at a time

The write API is `tools/vite-overrides.mjs`, declared `apply: 'serve'`, so it
exists **only under `npm run dev`** — there is no version of the deployed site
that can write to anything. Served from a build the workbench still loads, orbits
and experiments; the save controls say what they need rather than failing quietly.

The loop is: open a building, look at it against whatever reference you have, try
families until it matches, write a note saying what you concluded and what you
guessed, save, rebuild, next.

It reuses the game's own builders and its renderer rather than a simplified
preview. A workbench that lit or extruded buildings differently from the game
would send you off tuning against the wrong picture. Hand-modelled landmarks and
OSM monuments load too, with the experiment controls disabled — there is no
facade family to try on an arch.

Two things it does not share with the game. The ground is a disc of the real
heightfield rather than the whole city, sized to the building — `terrain.buildMesh`
would hand back 370k triangles to look at one house — and it is drawn as courtyard
paving throughout, so the surface under a building is not necessarily the one the
game would put there. Clicking a building in the game now offers **Open in
workbench**, which carries the id across.

## Improving the map, one building at a time

Every building carries its OSM id, so corrections can be pinned to a specific
building and survive re-downloading the map.

**Click any building in game.** A panel gives you its name, OSM id, inferred
facade family, storeys, height and footprint, plus a paste-ready snippet and a
link to it on openstreetmap.org. `Esc` closes it.

Paste the snippet into [`overrides.json`](overrides.json), edit it, then:

```bash
npm run build-world   # reports how many overrides matched
```

An id that matches nothing is reported by name, so typos surface immediately.

### Which lane to use

**Fix it upstream in OpenStreetMap** when the fact is genuinely missing or wrong
there — an untagged nine-storey block, a shop mapped as `building=yes`. Edit at
[openstreetmap.org](https://www.openstreetmap.org/edit), then
`npm run fetch-map -- --force && npm run build-world`. Everyone benefits. Note
that `fetch-map` no-ops without `--force`, since the download is cached.

**Use `overrides.json`** for game-specific choices — a particular paint colour,
a landmark you want taller than its footprint implies. Don't push those to a
public database.

### Override fields

| field | |
|---|---|
| `levels` | storey count; feeds the default height |
| `height` | metres, wins over `levels` |
| `kind` | facade family (below) |
| `colour` | hex; used as-is, skipping the usual weathering variation |
| `roof` | `flat` or `gable`, overriding the inferred choice |
| `name` | display name |
| `drop` | `true` removes the building |
| `model` | replaces the extrusion with hand-modelled geometry (see below) |
| `width` / `depth` | override the footprint dimensions a model is sized from |
| `angle` | degrees; states a model's bearing where the footprint cannot imply one |
| `entrance` | a bespoke doorway: door count, size, spacing, and the stair in front |

Families: `panel` `historic` `house` `plain` `commercial` `glass` `civic`
`industrial` `small` `church` `stone` `modernist` `stoneclad` `pavilion`.

Four of those exist because the generic families could not represent them, and
each came out of a street-level photograph:

- `stone` — coursed ashlar with **no windows**, for monuments and towers.
- `modernist` — continuous full-height vertical piers with recessed glazing:
  structure and infill, not masonry with holes punched in it. Most of Chisinau's
  post-war civic blocks look like this.
- `stoneclad` — large dry-clad stone panels with small punched openings, the
  1990s recladding a lot of late-Soviet commercial buildings were given.
- `pavilion` — a low box of plain rendered concrete: glazed shopfront at street
  level, one wide deeply-recessed glazed band above between heavy piers, and a
  railed roof terrace. No ornament at all; the shadow in the reveal is the only
  modelling the facade has. The 1970s–80s infill dropped into gaps in the
  pre-war street line.

A family costs one material no matter how many buildings use it, which is why
photo → family scales and photo → bespoke texture does not (4.18 MB each, so a
ceiling of roughly 200 buildings on a 4 GB card).

### Worked example: Ștefan cel Mare between Pușkin and Bănulescu-Bodoni

This 305 m stretch is the ceremonial heart of the city, and the inference got
its landmarks badly wrong. All four fixes are in `overrides.json`:

| building | was | now |
|---|---|---|
| **Arcul de Triumf** | a 7 m *house* with a pitched tin roof | hand-modelled arch you can drive through |
| **Clopotnița** (bell tower) | a *house* — domestic windows and a gable on a 20 m tower | hand-modelled campanile |
| **Casa Guvernului** | `plain`, reading as a Soviet panel block | `modernist` |
| **Gemeni** (`shop=mall`) | `commercial` | `stoneclad` |
| **McDonald's pavilion** (134/1) | `historic` — sash windows, sills, lintels | `pavilion` |

### Stepped blocks

OSM writes `building:levels=6;2;4` when a block steps — Gemeni is a six-storey
tower on the corner with a two-storey shop wing beside it and a four-storey rear
block — but a semicolon list has nowhere to say *which* part is which. Extruding
the whole ring to the first number gives one flat-topped slab.

`parts` splits a footprint. Each part is the ring clipped to the left of every
line in its `keep` list, so a plan can be carved into towers and wings without
hand-typing rings:

```json
"parts": [
  { "levels": 6, "keep": [[[256.9, -3.7], [158.9, 96.3]]] },
  { "levels": 2, "keep": [[[158.9, 96.3], [256.9, -3.7]], [[172.0, 61.5], [272.0, 159.6]]] },
  { "levels": 4, "keep": [[[272.0, 159.6], [172.0, 61.5]]] }
]
```

"Left" of `a → b` is where the cross product of `b - a` with `p - a` is positive,
x running east and z running south; reverse the two points to keep the other
half. Parts inherit the parent's `kind` and `colour` unless they override it, and
are emitted as `way/…#0`, `#1`, `#2`. The workbench resolves a bare parent id to
its first part and offers the siblings, and an override written against a part's
own id survives the next build.

Getting the orientation wrong is easy and silent — my first attempt put the
two-storey wing at the back of the plot and the four-storey block on the street.
Check where each part lands, not just that three parts appeared.

### Windows with real depth

Windows are painted, which is why a facade reads as wallpaper close up. `reveal`
(metres) cuts them instead: the wall is rebuilt as a grid of quads with the window
cells left out, jambs, head and sill added round each opening, and the glass set
back behind them. Positions come from the same numbers the texture paints on, so
geometry and texture cannot drift apart.

```json
"reveal": 0.22
```

Opt-in per building, because it is a few hundred triangles a facade against two
for a painted one — worth it on something you stand next to, not on all 4,600.

Two things bit me here, both silent. The caller hands `revealWall` its two corners
*already* ordered so the wall faces out; swapping them again reversed the winding
and back-face culling removed the entire wall, leaving windows floating in a
see-through frame. And the glass quads were UV'd 0..1, so each pane wore a whole
window texture instead of true-scale glass. Measure the geometry — comparing wall
and glass vertices along the wall normal showed the recess was right at −0.22 m
while the picture still looked wrong.

### Bespoke entrances

Most buildings get a generic entrance — one door, three steps, a canopy — placed
on whichever wall actually faces a street. A monumental building needs more than
that, so `entrance` overrides it:

`portal` adds a polished stone frame — jambs, lintel and a projecting cornice —
around the doors, which is what makes a commercial entrance read as the front
door rather than as another shopfront. `facing` names the wall it belongs on: the
default picks the longest street-facing edge, which is right for a building whose
frontage is its long side and wrong for a tower sliced off a long block, where it
puts the front door down the side street.

```json
"entrance": {
  "doors": 3, "doorWidth": 2.1, "doorHeight": 2.9, "spacing": 4.1,
  "stairWidth": 28, "steps": 9, "rise": 0.16, "tread": 0.55, "landing": 3.0
}
```

Casa Guvernului uses this: three double doors on a 28m flight, taken off a
photograph of the real entrance. Bespoke entrances are merged rather than
instanced, since each one is unique.

### Hand-modelled landmarks

Some buildings cannot come from a footprint at all. An arch's opening is a
feature of the *elevation*, not the plan — no extrusion of a ground outline will
ever produce one, and Arcul de Triumf first came out as a solid stone block.

Setting `"model": "arch"` diverts the building out of the extruder and into
[`src/world/landmarks.js`](src/world/landmarks.js), which builds it from real
proportions: four corner piers faced with paired Corinthian columns, open on
both axes, carrying a deep entablature — architrave, wreathed frieze, dentils
and a cornice that breaks forward over each column pair — then a set-back attic
storey holding the bell in a recessed vault.

Note the thing that is easy to get wrong: the lower passage is **trabeated**,
flat-topped and spanned by the entablature. The semicircular arch is the *upper*
tier. Building it the other way round produces something that reads as an arch
but is not this one.

Position, bearing and frontage width come from the OSM footprint, so the model
stays put if the mapping is corrected upstream. Where a multipolygon offers
several outer rings, the largest is used.

Collision is generated from the four piers only — **you can drive straight
through the passage** (4.9 m wide, 3.0 m of it drivable once the car's width is
accounted for) and hit stone if you clip a corner. The cross-axis opening is
deliberately too narrow to drive.

Landmarks are clickable like any other building — the inspector shows the model,
its size and bearing, and hands back a snippet in the `model` form rather than
the `kind`/`levels` one.

### Clopotnița, and the set-back problem

The cathedral bell tower is the same lesson as the arch from a different angle.
Tagged `historic=bell_tower` with `height=20 m`, it first came out as a house
with domestic windows and a gable; `kind: church` fixed both and still left a
20 m flat-topped box, because a campanile is a **telescope** — three square
stages, each set back from the one below and each capped by its own projecting
cornice, then a copper cupola. Every one of those set-backs is a fact of the
elevation. No extrusion of a ground outline produces any of them.

The footprint gives the plan away: an 11.3 m square standing at 45° to the street
grid, with a small porch projecting from the centre of each face, so it is a
Greek cross on a square. `minAreaRect` locks onto those faces, which is why the
model needs no bearing of its own — but `width`/`depth` in the override are the
**core** square, with the porches added by the builder, or the model comes out
sized to the porch tips.

Two things worth knowing:

**Which stage is open matters.** The bottom stage is closed — a round-headed
window recessed over the entrance porch. The middle stage is the open one, where
the bells hang and daylight comes through. The top is an open arcade behind a
railing. Give the bottom stage the open arch and the whole thing reads as a
gatehouse, which is exactly what the first attempt looked like.

**`piercedWall()` faces +z.** It draws its elevation in the XY plane and extrudes
along z, so a wall on an *x* face has to be rotated and one on a z face must not
be. Getting that backwards laid the two x-face walls flat across the tower as
horizontal ledges sticking out of the middle of it — visible immediately in a
render and completely invisible in the numbers.

The height is the one invented figure. OSM tags `height=20 m`, which cannot be
reconciled with the footprint: 20 m over an 11.3 m square is a 1.8:1 block, and
the reference photograph reads at least 2.5:1 *despite* being shot from below,
which foreshortens the upper stages and if anything understates the ratio. The
override sets 28 m — 2.5 × the measured frontage, the same class of estimate as
the arch's 13 m. Everything else is OSM's.

### The cathedral, and a plan that cannot state its own bearing

The Metropolitan Cathedral was the one building the README used to hold up as
already correct: `building=cathedral`, `height=10`, nothing wrong with any of it,
deliberately left alone. It still came out as a 10 m octagonal wall with a flat
lid, because the dome is 24 m of elevation and none of the plan. Being *right*
about a building is not the same as being able to extrude it.

The model is a regular octagon body — a square with chamfered corners, 38.3 m
across the flats — carrying a drum of round-headed windows and a ribbed
lead-grey dome, with a pedimented six-column portico on each cardinal face.
**OSM's 10 m is kept, as the main cornice**, which is what it actually measures;
everything above it is proportioned from the photograph, to 34 m at the cross.

**A square plan cannot state its own bearing.** The footprint measures 38.29 ×
38.35 m, so `minAreaRect` is choosing between the octagon's cardinal faces and
its diagonal ones on a 6 cm tie-break. No amount of better rectangle-fitting
fixes that, because the answer is not in the footprint — hence the `angle`
override field.

What the answer *is* in is the **ensemble**. The cathedral, the Clopotnița and
Arcul de Triumf are collinear: 135° from the cathedral to the bell tower, 134°
on to the arch, over 207 m. That line is the axis the whole square was laid out
on, and the main portico faces down it — so `"angle": 45`, which puts a portico
on the bell tower.

I got this wrong first time by reaching for the liturgy: an Orthodox church is
laid out altar-east, so I set `"angle": 0` and put all four porticos on the
corners. A nineteenth-century planned composition is set out on *its own* axis,
and Chisinau's grid runs 45° off the compass. The rule to reach for with a
landmark is what it was composed with, not what its type usually does — and the
check that would have caught it in one line is that the three landmarks on that
square should be collinear, which at `"angle": 0` they were not.

**Metalness is the dial, not the hex.** The roof went in at `metalness: 0.35` and
came out near-black, swallowing the roof into the dome when the whole point is
that the dome is the darker of the two. Lightening the colour to compensate
turned it pale *blue* instead — what a metal reflects in this scene is a cool
sky, so raising the value just buys more sky. Dropping metalness to 0.05 is what
let the authored green survive.

Adding another landmark means writing a builder function and registering it in
that file's `MODELS` map.

### What kind of reference actually helps

Two of the fixes above came from photographs, and the useful ones were all shot
**from the street**.

Aerial imagery is close to worthless here. Chisinau has no 3D building mesh in
Google Earth — it is flat orthoimagery draped over terrain — so no camera angle
recovers a facade. A top-down view confirms roof shape and footprint, both of
which OSM already gives you.

A ground-level photo is what changes the model. Casa Guvernului was corrected
twice from aerial guesswork and only got right from one Street View frame, which
showed at a glance that it is piers-and-glazing, not punched windows. Head-on,
flat light, whole height in frame, ground included.

Only the Arch needed an invented number — OSM tags it `historic=monument` with
no height, and 13 m is an estimate. Everything else keeps OSM's own values and
only corrects the *family*. The cathedral next door was already right
(`building=cathedral`, `height=10`) and needed a hand-modelled dome anyway — see
*The cathedral, and a plan that cannot state its own bearing*.

---

## How it works

### The data is the realism

Only **548 of 4,638** buildings in central Chișinău carry a `building:levels`
tag. The other 3,964 are a bare `building=yes` with no height information at all,
so storey counts and building types are **inferred from footprint geometry**
([`tools/build-world.mjs`](tools/build-world.mjs)):

- A **long narrow slab** — 9–20 m deep and over 45 m long — is Soviet mass
  housing. Over 75 m long it gets 9 storeys, otherwise 5. This shape signature is
  reliable because the blocks were built to standard series.
- **Small compact footprints** under 150 m² are private houses, 1–2 storeys, and
  get pitched metal roofs.
- **Large bulky footprints** are civic or commercial.

The result — 409 panel blocks, 1,220 houses, 771 low-rise historic buildings —
is a plausible Chișinău mix rather than a field of identical boxes.

### Making it run on a phone

Nothing here is draw-call bound — the city is merged into about 16 batches — so
the levers are pixels and triangles. A phone gets `low` from the first frame,
which caps the pixel ratio at 1 (a 3× device ratio is what actually kills a
handset) and **bypasses the post-processing composer entirely**: with every pass
disabled it is still a render target, a full-screen copy and an output pass, for
no picture at all. Tone mapping and the sRGB conversion are renderer settings,
so the image is unchanged.

That left geometry. Measuring beat guessing here — the profile was not where it
looked:

| | triangles | |
|---|---|---|
| tree canopies | 923k | 3,846 trees × 240 |
| balconies | 750k | 15,622 instances |
| terrain | 372k | |
| **all 4,640 buildings** | **190k** | |
| roof plant + drainpipes | 348k | |

The entire building stock was 6% of the frame. The canopy subdivision level was
the single most expensive number in the scene, and dropping it from 1 to 0 —
indistinguishable at the size a tree occupies on a phone — saved more than every
wall in the city costs. Phones also skip roof plant and drainpipes, and stop the
small props casting shadows, since shadow casting submits the geometry a second
time and a balcony's shadow lands on the wall right behind it.

Together: **3.14 M triangles a frame down to 2.10 M**, with the shadow pass
falling much further.

Merging is what makes this trade necessary, incidentally. Because the city is one
mesh per material, three.js cannot frustum-cull any of it — every triangle is
submitted every frame whether it is behind you or not. That is a good deal on a
desktop and an expensive one on a phone.

### Sky and clouds

The sky is Preetham atmospheric scattering, rendered once into an environment map
so every window and wet road reflects the actual sky. The clouds are two domes
that ride with the camera, shading a *flat cloud plane* rather than the dome
itself: for a view direction of elevation `e` the sightline meets a horizontal
layer at horizontal distance `1/tan(e)`, so sampling at `dir.xz / dir.y` gives
real perspective — puffs spread out overhead and crowd together towards the
horizon. Map the texture onto the dome instead and every cloud is the same
apparent size wherever you look, which reads as wallpaper.

Coverage is fBm, generated on a torus so the tile repeats without a seam, with a
second sample offset along the light direction that the shader differences
against the first to fake self-shadowing. Drift is an offset into the noise, so
nothing is regenerated per frame. A phone gets one layer instead of two — a
second full-sky transparent pass is pure fill rate for a layer you can barely see.

Three things that were each invisible until measured or looked at:

**fBm does not span 0..1.** It sums octaves at halving amplitude, so over this
sampling pattern it spans about 0.06–0.42 and clusters near 0.27. The coverage
threshold was set against a nominal 0..1 range, **0.0%** of the field reached it,
and the sky came out completely empty. The field is normalised to its measured
range now, which is what makes `cover` mean what it says.

**Clouds have to be authored brighter than white.** At `vec3(1.0)` they come out
of ACES at 0.62 exposure as grey smoke, because the sky behind them is brighter
still. The lit side is authored at 1.85.

**They need depth testing.** Without it they paint straight over the buildings in
front of them.

### Photorealism on a 4 GB GPU

Photoreal rendering usually means shipping gigabytes of scanned material, which
a 4 GB laptop GPU cannot hold. Everything here is **drawn procedurally into a
canvas at load time** instead ([`src/world/materials.js`](src/world/materials.js),
[`src/world/surfaces.js`](src/world/surfaces.js)):

- Ten facade families — panel, historic, house, civic, glass, industrial… — each
  with albedo, roughness, and a normal map Sobel-filtered from a height pass.
- **One texture tile is one real storey.** Walls are UV-mapped in metres and
  building heights are snapped to whole storeys, so the top row of windows meets
  the roofline instead of being sliced in half.
- Buildings that meet the street get a separate **ground-floor band** with
  shopfronts, doorways and roller shutters, so the city has a street level.
- Road textures map `u` **across the whole carriageway**, so one texture serves
  every width and lane markings always land correctly whether the street is 6 m
  or 15 m wide.

Lighting is image-based: the physical sky is rendered once into an environment
map, so windows, wet asphalt and car paint reflect the actual sky and pick up its
bounce. Per-building colour comes from vertex tints, which lets 4,640 buildings
share a dozen materials and merge into a handful of draw calls.

### Detail that breaks the wall plane

A texture alone reads flat, because nothing projects. Every building gets a
mitred **cornice** at the roofline — the single biggest cue, since a hard flat
top is what makes an extrusion look like a box. On top of that,
[`details.js`](src/world/details.js) instances ~15,600 **balconies** onto the
prefabricated blocks (they were painted on before), plus **entrances** — door,
three steps and a canopy — placed on whichever wall actually faces a street,
and **roof plant** and **drainpipes**.

That is ~32,000 props for six draw calls. Small, numerous props like drainpipes
and roof units are excluded from the shadow pass, where they cost real time and
contribute nothing visible.

### The hills

Chișinău is built across a ridge above the Bâc valley, and a flat version of it
is unrecognisable. [`tools/fetch-dem.mjs`](tools/fetch-dem.mjs) pulls AWS
terrarium terrain tiles (Mapzen/Tilezen on AWS Open Data — no API key; elevation
packed into RGB as `R*256 + G + B/256 - 32768`) and bakes an 8m heightfield.
Across the play area that is **123m of relief**; Bd. Ștefan cel Mare runs the
ridge line and falls roughly 30m at each end.

Everything is draped on it: ground, road ribbons, kerbs, buildings, trees,
street furniture. `Terrain.height()` deliberately interpolates over *the same
triangulation the ground mesh is built from* rather than bilinearly — bilinear
sampling disagrees with a triangulated quad everywhere except its corners, which
would let roads sink through the ground between grid points.

**Roads are graded, not draped.** A road sampled vertex-by-vertex tilts sideways
with the hill, which built roads never do.
[`tools/carve-terrain.mjs`](tools/carve-terrain.mjs) smooths a profile along each
centreline, clamps it to 15%, then carves that profile back into the heightfield
with a 9m blend either side. Roads then read their height from the stored
profile — level across the carriageway — and the ground already matches, so
junctions agree by construction rather than by luck. Cuttings reach 10m and
embankments 7m on the steepest ground.

**Buildings are levelled onto a pad** at the median ground height under their
footprint, with foundation walls reaching down to the lowest corner. Setting the
pad to the minimum instead would bury the uphill half of every building on a
slope.

The car feels the hills too: gravity resolved along the slope is added to the
longitudinal force, so you lose speed climbing and gather it descending, and the
chassis pitches and rolls to the surface under it.

### What the query did not ask for

The extract fetched `way["leisure"]` but never `relation["leisure"]`, and Chisinau's
central park is a multipolygon relation. So was the cathedral garden, so was
Valea Morilor, so was Dendrariu — the four biggest green spaces in the city were
all silently absent, and the main square rendered as bare dirt. Memorials and
barriers were never requested at all, which is why the Stefan cel Mare monument
and the park railings did not exist either.

Two things fell out of fixing it:

**Relation members are not rings.** The park arrives as 26 separate two-node
fragments. The building path gets away with treating each `outer` member as its
own polygon because building relations happen to use closed ways; do the same
here and you get 26 slivers of zero area, every one discarded. They have to be
stitched end to end first.

**`historic` is not a statue tag.** It also lands on ordinary houses ("the house
where X lived"), and `tourism=artwork` covers murals. Filtering on the typed
`memorial=` / `artwork_type=` values instead keeps stone figures out of the
middle of the road.

Fences are alpha-tested strips, not modelled balusters: the park railings alone
run to kilometres, and a cut-out texture gives denser detail than geometry would
at two triangles a segment.

The parks brought 4,645 new trees with them — Valea Morilor and Dendrariu sit in
the map's corners and hold more between them than the rest of the city put
together, a kilometre and a half from anywhere you drive. Since nothing is
frustum-culled, all of it is submitted every frame, so canopies past 700 m drop
to the low-detail geometry and stop casting shadows. That recovered 670k of the
1.25M triangles the parks added.

### Parks have paths, and the trees were standing in them

Trees inside a park polygon are rejection-sampled: pick a point in the bounding
box, keep it if it falls inside the ring. That test knows nothing about what is
*drawn* on the ring, and a formal park is mostly paths — Cathedral Park is
96,000 m2 with 173 footway segments through it. So trees landed on the walkways,
and the fan of paving radiating from Arcul de Triumf disappeared under canopy.

Two rules fixed it, and the split between them matters:

**Scattered trees keep clear of a way**, measured from its edge so the clearance
widens with the way: `PATH_CLEAR` 2.75 m turns a 2 m footpath into a 7.5 m
corridor, and the 6 m promenade gets 11.5 m. Streets use `ROAD_CLEAR` 3.5 m,
which is past the kerb and the pavement the surface index already draws there.

**Mapped trees stay where they are.** A tree hard against the edge of a path is
an avenue, and the corridor exists to be lined. Only the ones standing in the
paving itself are dropped — 174 city-wide, which no clearance rule would have
placed there and which read as a mistake wherever you see one.

**A landmark clears an apron around it.** Corridor rules have nothing to say
about ground that is open *on purpose*, and a monument is sited: the space to
look at it from is as much a part of it as the stone. Arcul de Triumf stands in
a paved apron with lawn wedges and the nearest trees well back, and that is the
one place mapped trees are cleared too, since a surveyed tree inside a plaza is
more likely a stray node than a real tree. The 42 smaller monuments are statues
rather than plazas, so they clear only the scattered guesses, at 6 m.

The apron is **half the frontage plus a fixed 24 m set-back**, and it is worth
saying why, because the obvious formula is wrong. Scaling the whole radius with
the frontage looked perfectly reasonable on an 11 m arch — and then the 39.5 m
cathedral became a landmark and stripped a 118 m circle out of the middle of
Cathedral Park in a single rebuild. An apron is a set-back from the walls, not a
multiple of the building.

**The apron is also paved**, in `buildGround`, at exactly the radius the scatter
keeps clear — so the two agree by construction: nothing grows in the forecourt
because the forecourt is stone. It is an octagon rather than a disc, because a
circle of paving in a park reads as a crop mark. The radius is capped at the
nearest carriageway: the arch stands 9.4 m from Ștefan cel Mare, and an uncapped
29.6 m apron would have paved twenty metres of boulevard.

The plaza is **cut out of the greenery, not laid on top of it**. Laying it 2 cm
proud of the terrain is the obvious move and it renders as pure grass, because a
park polygon is triangulated straight from its outline: across 96,000 m² of
Cathedral Park the grass spans hundreds of metres between vertices and floats
wherever the ground dips below the chord — far more than 2 cm. So each forecourt
goes in as a **hole** in the area's triangulation (`ShapeUtils.triangulateShape`
takes them, wound opposite to the contour) and the paving fills the gap, drawn in
rings so it follows the ground instead of spanning it.

A third rule is about clumping rather than corridors. Uniform random sampling
piles trees on top of each other: 101 of Cathedral Park's 630 scattered trees had
a neighbour within 4 m, which renders as one blob. A minimum spacing fixes it,
but it has to be per-kind — a park is planted and wants to read as spaced, while
woodland wants to read as dense, so `TREE_GAP` is 5 m in a park and 3 m in a
forest. The grid is seeded with the mapped trees first, so a scattered one cannot
land on a real one either.

Measured over Cathedral Park:

| | before | after |
|---|---|---|
| trees standing on a footway | 63 | **0** |
| trees within 25 m of the arch | 15 | **0** |
| trees within 40 m of the arch | 31 | 4 |
| pairs closer than 4 m | 991 | 452 |
| trees in the park | 1,934 | 1,404 |

The remaining 452 close pairs are all between *mapped* trees, which is real data
and left alone. City-wide this is 8,491 trees down to 5,518, and because canopies
are the most expensive geometry in the scene it is also 1.57M triangles down to
986k on desktop, 713k to 464k on a phone — a bigger saving than the entire
building stock costs.

### Pavement colour, and why the number looks wrong

Chisinau's central pavements are sand-coloured stone, not the neutral concrete the
first pass assumed. The albedo is set far warmer than the target appears on
paper — `rgb(v, v*0.845, v*0.665)` — because the sky here is a cool blue-white and
ACES desaturates highlights: measured on a sunlit footway, the two together
compress the red-minus-blue spread by roughly **3.7x**. An albedo that samples
correct as buff renders as plain grey stone.

Measured straight down on a lit 6 m footway, so the sample cannot catch asphalt
or shadow by accident:

| | albedo | rendered | R−B |
|---|---|---|---|
| before | (148, 147, 141) | — | +7 |
| after | (196, 166, 130) | (188, 178, 160) | **+28** |

Asphalt stays neutral at +2, so carriageway and footway now read apart at a
glance, which is most of what the colour is for.

### Judder and shimmer

Two separate things get reported as the game being glitchy.

**The car shuddering** had two causes, and the second was the bigger one.

Body *attitude* used to come from the gradient of the drivable surface along the
world axes, sampled 1.2 m out. On a narrow street one of those samples lands on
the pavement while the car is squarely in its lane — and a 14 cm kerb over a
34 cm ramp is a 41% slope, so the body lurched as the sample crossed it. It now
comes from the four contact patches: front-minus-rear over the wheelbase,
right-minus-left over the track. That is both the real thing and inherently
steadier, and it is what a suspension damper is then applied to, because a body
cannot snap to a four-degree step and the surface still has them where two graded
roads meet.

Measured over a 300 m run at 14 m/s through the real physics, worst frame-to-frame
change in the attitude the player sees:

| | pitch | roll |
|---|---|---|
| world-axis gradient (was) | 4.21° | 4.31° |
| four contact patches | 3.49° | 6.21° |
| **contact patches + damping** | **1.39°** | **1.67°** |

Note the middle row: the contact patches alone made *roll* worse. The damping is
not a polish pass on top of the real fix — it is half of it.

The gravity term reads the same settled attitude, so a step in the surface can no
longer kick the car forward as well as tilting it. The wheels are rigid; they only
spin and steer.

**The other cause** is the drivable surface stepping. Two graded roads meeting
at a junction do not have to agree — each profile is smoothed independently — so
the surface jumps by up to a quarter of a metre within half a metre of travel.
Sampling one point put that straight into the body. The car now rests on the
average of its four wheel contact patches, which turns a step at one wheel into a
quarter of it at the body, with light damping on top:

| max height step over 600 m of boulevard | |
|---|---|
| single point | 0.252 m |
| four-wheel average | **0.060 m** |

**Edges shimmering** is aliasing, not z-fighting. SMAA is a morphological pass:
it softens an edge in a still frame and does nothing about crawl, because it has
only one sample to work from. The composer renders into a multisampled target now
— 2x at `medium`, 4x at `high`, and `low` bypasses the composer entirely.

Roads also carry a per-road offset, because every ribbon used to sit at exactly
`ROAD_Y`: where two overlapped at a junction with agreeing profiles they were
precisely coplanar. Rank alone does not separate them — Stefan cel Mare is 31
ways and all of them are rank 2 — so the offset is hashed from each way's own
first vertex. Truly coincident pairs went from 13 to 5. It was a smaller effect
than expected: most overlapping pairs were already 65 mm apart.

A warning about measuring this. Nudging the camera a centimetre and diffing
frames looks like a good z-fighting test and is not: a one-centimetre move
legitimately shifts every edge sub-pixel, so 2% of the frame changes whatever you
do, and the number barely moves when you fix something real. The test that
actually says something is a *static* camera over two frames, which should be
identical — it was, so nothing here was temporally unstable to begin with.

### What the car stands on

Not the heightfield. `src/world/surface.js` returns the surface a wheel actually
rests on — carriageway, kerb, pavement, footpath, or bare ground where there is
no road.

This is a direct consequence of grading. A carved road is drawn from its own
stored profile, and the conform pass deliberately pushes the terrain *under* that
profile so the ground cannot poke up through the tarmac. Reading `terrain.height()`
therefore parked the car below the road on **every graded street in the city**:

| | before | after |
|---|---|---|
| road vertices with the car below the tarmac | 10,552 of 10,586 | **0** |
| median sink | 0.26 m | 0.00 m |
| worst | 3.23 m | — |

Kerbs are ramped over about 34 cm rather than stepped, so a car climbs onto a
pavement instead of being launched by a 14 cm wall.

Two rules that are not obvious and both cost a debugging round:

**A carriageway beats a neighbouring pavement.** Taking a plain maximum over
everything nearby seems right and is not — a road's pavement reaches three metres
past its kerb, so a parallel or raised street lifts the car off the one it is
driving on. That put the kerb of a 19.8 m boulevard 6.3 m from its centreline
instead of 9.9 m, and rode 39% of road vertices above their own tarmac.

**A built surface beats the ground beneath it.** Maxing the pavement against the
terrain let the bank beside a cutting stand 37 cm proud of the pavement it
supports, which the car then climbed as an invisible hump at the kerb.

What remains: about 200 points where two graded roads meet at genuinely different
heights and the junction steps. That is the profiles disagreeing, not the surface
lookup.

### Keeping roads out of the ground

Roads sit 5 cm above the heightfield, which only works if the road surface and
the ground actually agree. Two things broke that, and both showed as streets
half-swallowed by the landscape.

**OSM puts vertices where geometry bends, not where the hill does.** Half the
segments here run over 100 m and one street is a single 258 m segment with two
vertices, while the terrain moves on an 8 m grid. The ribbon between two
vertices is one flat quad, so every rise in between comes straight through it.
Draped roads are now adaptively subdivided — only where the chord genuinely
departs from the ground, so 255 km of road does not pay for the minority of
segments crossing uneven terrain.

**Grading pulled the ground towards the road, not under it.** Carving replaces a
cell with a weighted *average* of nearby profile samples, so on a slope the
result is flatter than the road and the uphill half ends up above it; the 0.1 m
storage precision then eats the remaining clearance on its own. A conform pass
now clamps the ground under every graded carriageway and pavement, lowering only,
and only within the road's own footprint.

Densifying carved centrelines before profiling turned out to matter twice over.
A straight profile across 258 m of hill forced the grading to cut metres deep at
one end — the deepest cut in the city went from **10.3 m to 2.3 m** once profiles
could follow the ground.

Measured over every road segment in the city:

| | before | after |
|---|---|---|
| segments with ground above the road | 1,888 | 240 |
| worst intrusion | 5.39 m | 0.49 m |
| over 0.5 m | 138 | 0 |
| graded roads affected | 428 | **0** |

Cost: about 197k triangles on desktop and 148k on a phone, which is the right
place to spend them — the road is what you are looking at.

### Sound

Synthesised, not sampled. Everything else here is generated rather than shipped,
and a recorded engine loop would be a megabyte that only ever plays one RPM
convincingly. Four voices out of an oscillator bank and one noise buffer:

- **engine** — two oscillators at the firing frequency (`rpm / 30`, because a
  four-stroke four fires twice per revolution) and its half-order, which is what
  makes a four-cylinder lumpy rather than smooth. They use a hand-specified
  harmonic series stopping at the tenth, *not* a sawtooth: a sawtooth carries
  every harmonic at 1/n and buzzes like a wasp once the filter opens. A lowpass
  tops out around 1.4 kHz — everything above that is harmonic buzz rather than
  engine — and closes off the throttle, so lifting is audible as engine braking.
- **combustion** — noise gated open once per firing event, which is what an engine
  physically is. A pulse train is the difference between a chuffing motor and a
  synth holding a note, and it carries most of the texture.
- **gearchanges** — the note drops away for a quarter second and returns lower.
  Without it a long acceleration is one unbroken ramp, which is most of what makes
  synthesised engines tiring.

A low shelf at 260 Hz gives the idle its body. The firing fundamental at idle is
28 Hz, which no laptop speaker reproduces — lift the range just above it or an
idling car is silent on most machines.
- **road** — filtered noise scaled by speed. This is what actually conveys motion;
  the engine mostly conveys effort.
- **tyres** — howl driven by `car.slipRatio`, which the physics already computes
  as how far each tyre is past its friction limit. Reading real saturation rather
  than steering angle means the car squeals when it is genuinely sliding and stays
  quiet through a fast, grippy corner.
- **brakes** — pad squeal as a high-Q resonance on noise, not an oscillator, or it
  sounds like a doorbell. Gated to firm pressure at moderate speed.

The gearbox ratios are the real 2106 five-speed (3.24 / 1.99 / 1.36 / 1.00 / 0.82)
on the 4.10 final drive. The gearbox is most of what an engine note *is*: invent
the ratios and the shift points land in the wrong places.

`V` mutes, and the choice is remembered. Browsers will not start an AudioContext
without a user gesture, so it is unlocked on the first key or tap rather than at
load — a game driven by held keys never gets a click to hang it off otherwise.

### Street furniture, and glass that looked like metal

**Lamps in the road.** A street lamp is placed 1.1 m beyond the edge of the road
it belongs to, which is the pavement — unless that road is a side street crossing
a boulevard, in which case 1.1 m past its kerb is the middle of the boulevard.
**183 of 1,074 lamps (17%) were standing in traffic**, the worst 9.9 m into
Stefan cel Mare. A spot is now rejected if it lands inside any carriageway: 0 of
886.

**Traffic signals** go on the approaches to junctions where a main road is
involved — a coordinate shared by two or more ways, clustered so a dual
carriageway meeting a street counts once. Letting every residential corner
qualify gave 264 junctions and 775 masts: a quarter of a million triangles of
traffic light, which is not what a city looks like either. It is 157 junctions
and 495 masts now, at 34.6k triangles, with the heads built from open-ended
five-sided cylinders because nobody inspects a traffic light.

**Overhead wires** follow both trolleybus carriageways at 5.8 m with masts every
42 m, and the buses' poles are angled from that height rather than from a guess,
so they reach the wire instead of empty sky. Drawn as thin boxes, not lines: a
`LineBasicMaterial` is one pixel wide at any distance, so a wire either vanishes
at range or crawls.

**Glass that rendered as chrome.** The windscreens were there the whole time. At
`clearcoat: 1` with a low clearcoat roughness, the specular lobe sits on top of
the base colour strongly enough to erase it — rendered on its own, the car's
cabin came out as a *white chrome block*. The paint had the same problem from the
other side: at `metalness: 0.55` a red car's bonnet is a coloured mirror, and it
blew through the tonemapper into a white sheet bright enough to read as the
windscreen, hiding the real one behind it. Glass is not clearcoated; paint is a
dielectric with a clearcoat over it, not a metal. Both are now what they claim to
be.

Worth knowing how that was finally found: measuring pixel regions kept giving
plausible-but-wrong answers because I was guessing which pixels belonged to what.
Hiding one mesh at a time and re-rendering settled it in two attempts.

### The white Mercedes

A GLE Coupé shuttles Stefan cel Mare between Strada Armeneasca and
Banulescu-Bodoni — 902 m each way, 120 km/h, a 55-second lap — with a map-pin
label reading *om uspeșnâi* hanging over its roof.

It does not reverse in place at the end of its beat, for the same reason the
trolleybuses do not.
Its route is a **closed loop**: out along the right-hand carriageway, a
semicircle across the centreline, back along what is now the right-hand side, and
a second semicircle. The arcs are swept *forward* past each junction rather than
pivoted on the spot — that is the difference between a car turning round and a car
teleporting. Heading falls out of the path tangent, so no turning logic is needed
at all.

Two modelling notes. A coupé-SUV is one silhouette decision: SUV ride height with
a fastback roof falling continuously from just behind the windscreen header to a
short rear deck. Get that curve wrong and it is an estate. And the ride height is
the whole difference between the two body styles — set the underside level with
the wheel centres, as the first pass did, and half the tyre disappears behind the
bodywork so the thing sits on the road like a saloon however tall the roof is.

The label is a `Sprite`, so it faces you from every angle without a frame of
work; the plate and its pin tail are drawn once into a canvas, with the text
shrunk to fit rather than allowed to overflow.

Like the trolleybuses it is scenery — no physics, no collision, and you will drive
straight through it.

### The 3943

Seven trolleybuses work Bd. Ștefan cel Mare, up one carriageway and back down
the other — 3.4 km each way, about six minutes end to end. An empty boulevard is
most of what makes a city read as a model rather than a place, and in Chisinau
the trolleybus is the thing that is always moving on that street.

They are scenery with a timetable, not a simulation: no physics, no collision,
and they will not react to you. What they do share with the player's car is the
drivable surface — each samples the same index under both axles, so it sits on
the road rather than in it and pitches with the camber instead of clipping
through a graded street.

The route is built from the real boulevard. The street arrives as 31 separate OSM
ways; stitching them by shared endpoints is the usual approach and unnecessary
here, because over 3.4 km the boulevard wanders only 3.4 m off a straight line —
projecting every vertex onto its heading and sorting gives the same ordering with
none of the failure modes. The lane is offset 5 m to the **right** of the
centreline, which with x east and z south is `(-uz, ux)`; I had the sign inverted
first and ran it up the oncoming lane for its first outing.

**One bus can bounce end to end; seven cannot.** A single vehicle reversing at
each terminus returns down the lane it left by and nobody notices. Put seven on
that lane and half of them are heading the other way at any moment, driving
straight through each other. The route is a **closed loop** instead — the same
one the GLE uses, out on the right-hand carriageway, a swept turn at the
terminus, back on what is now the right-hand side — so every bus is always in the
correct lane for the way it is pointing. Buses evenly spaced around a loop at
equal speed hold their spacing forever, which is what makes seven of them safe
where two would need collision logic. The turn is swept 9 m past each terminus
rather than pivoted, because a 12 m bus that spins on its own axis reads as a
glitch.

Both carriageways are wired now. The wires used to follow the single lane the
one bus ran in; with buses coming back down the far side, half the fleet had its
poles in empty sky.

**Seven buses cost the draw calls of one.** A bus is 33 separate meshes, and
seven built the obvious way would be 230-odd draw calls against the 33 the entire
city costs. `TrolleyFleet` builds one bus as a template and turns each of its
meshes into an `InstancedMesh` carrying all seven copies; each bus runs its own
`Trolleybus` writing into a throwaway `Object3D`, whose matrix is composed into
an instance. Wheels sit a level below the body, so their spin composes the same
way. Only the triangles multiply — 1,208 each, 8.5k for the fleet.

The poles are the whole silhouette, and the wheels nearly were not there: set
flush with the bodywork, a tyre's outer face lands a centimetre *inside* the
skirt, and the bus reads as a box hovering over its own shadow. They sit just
proud now, with a dark recess behind each one so the arch reads as an opening.
1,208 triangles.

### Driving

You drive a **VAZ-2106 "Zhiguli"** — the Lada that is still everywhere in
Chișinău. Built to its real dimensions (4116 × 1611 × 1440mm, 2424mm wheelbase,
13" wheels) and its real numbers: 1045kg, 1.6 litres, 75hp, about 150km/h flat
out. Boxy three-box saloon, flat bonnet, upright glasshouse, quad round headlamps
behind a chrome grille, chrome bumpers with overriders.

Underneath is a bicycle model with slip angles and a saturating friction curve
([`src/game/car.js`](src/game/car.js)) — grip runs out progressively rather than
all at once, there is weight transfer under braking, and the handbrake simply
collapses rear grip. It is light, slow, leans a long way in corners and lets go
early, which is roughly the point. Collision runs against a uniform grid of ~40k building wall
segments, using two probe circles along the car's length.

---

## Known limitations

- **Bridges and tunnels are flat.** OSM `layer` tags only nudge the surface
  vertically to stop z-fighting; there is no elevated roadway geometry.
- **Only the main road network is graded.** 493 of 3,171 roads get a smoothed
  profile and a carved corridor; service roads, alleys and footways simply
  follow the ground, so they can look rougher than a real street would.
- **Buildings don't step.** They are levelled onto one pad, with foundation
  showing where the ground falls away. Real buildings on steep sites step in
  sections; here the foundation is just capped at 8m so it never becomes absurd.
- **No retaining walls.** Cuttings and embankments are terrain blends, not
  built structures.
- **No traffic, pedestrians or collidable street furniture.** Lamp posts and
  trees are decorative; you drive through them.
- **Pavements overlap at junctions.** Each street generates its own kerb ribbon
  with no junction resolution, so they pile up at corners.
- **Interiors don't exist.** Shopfronts are painted onto the wall, not modelled.
- **Windows are painted, not recessed.** They read fine from a moving car but flat
  up close: there is no reveal, no sill depth, no parallax. Real window geometry
  (or parallax-occlusion mapping off the existing height maps) is the next step
  if you want the facades to hold up on foot.
- **Three landmarks are hand-modelled so far.** Arcul de Triumf, the Clopotnița
  and the cathedral have real models; everything else is still a footprint
  extrusion. All three suggest their ornament by massing rather than modelling it
  — the arch's frieze wreaths are discs and its Corinthian capitals flared drums,
  and both cupolas are faceted lathes rather than genuinely ribbed. The
  cathedral's porticos are the same stone as its walls, where the real ones are
  white against cream.
- GTAO (`Q` → high) was tuned against a software renderer, not a real GPU. If it
  looks wrong on your hardware, `medium` is the safe setting.

## Layout

```
overrides.json          hand-authored per-building corrections, keyed by OSM id
tools/fetch-osm.mjs     download OSM extract (run once)
tools/fetch-dem.mjs     download elevation tiles -> data-cache/terrain-raw.json
tools/carve-terrain.mjs grade the DEM to the roads -> terrain.json + road profiles
tools/build-world.mjs   OSM -> world.json, with the shape inference
tools/shape.mjs         convex hull + min-area rect
src/world/materials.js  facade families, drawn procedurally
src/world/surfaces.js   asphalt, paving, grass, courtyards
src/world/buildings.js  footprint extrusion, UVs, roofs
src/world/roads.js      carriageways, kerbs, ground
src/world/terrain.js    heightfield sampling + the ground surface
src/world/props.js      instanced trees and streetlights
src/world/details.js    instanced balconies, entrances, roof plant, drainpipes
src/world/landmarks.js  hand-modelled landmarks (arch, bell tower, cathedral)
src/render/pipeline.js  sky, IBL, shadows, post-processing
src/game/car.js         vehicle model + physics
src/game/collision.js   wall-segment broadphase
src/main.js             loop, HUD, minimap
```

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
