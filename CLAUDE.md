# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A drivable simulation of central Chișinău built from OpenStreetMap data and real
elevation: three.js + Vite, no framework, no TypeScript, ES modules throughout.
Everything visible is generated at runtime — textures, geometry, audio, sky — so
there are no art assets to ship.

`README.md` is long and unusually load-bearing: most sections exist because
something failed in a non-obvious way and the reasoning was worth keeping. Read
the section that matches what you are touching before changing it.

## Commands

```bash
npm run dev          # game at http://127.0.0.1:5173/, workbench at /building.html
npm run build        # production build (two entry points: index.html, building.html)
npm run build-world  # regenerate public/data/*.json from the OSM cache + overrides.json
npm run fetch-map    # download missing OSM feature classes (--force re-downloads all)
npm run fetch-dem    # download the elevation tiles
```

**`npm run build-world` after any edit to `overrides.json`** — the game reads the
generated `public/data/world.json`, not the override file. It runs
`build-world.mjs` **and then** `carve-terrain.mjs`; running only the first leaves
every road without its height profile and the streets sink into the terrain.

There is no test framework. Verification is headless Chrome (`puppeteer-core`
against `/usr/bin/google-chrome`, `--use-angle=swiftshader`) driving the dev
server and asserting on `window.__game`, which exposes `car`, `surface`,
`terrain`, `world`, `renderer`, `bus`, `gle`, `snapToRoad` and `setHour`. The
workbench exposes `window.__wb`.

Software rendering runs at roughly 1–5 fps, so the car barely moves in a headless
test. Inject state (`car.vLong = 14`, `car.update = () => {}`) rather than trying
to drive somewhere, and poll for a condition instead of sleeping a fixed time.

## Architecture

**Offline → data → runtime.** `tools/*.mjs` turn an Overpass extract and AWS
terrain tiles into `public/data/world.json` and `terrain.json`; `src/world/*`
turn those into meshes. The running game never touches the network for data.
`data-cache/` holds the raw downloads and is gitignored.

**There are three different heights, and picking the wrong one is the most
common bug in this codebase.**

| | what it is |
|---|---|
| `terrain.height()` | the raw graded heightfield |
| `road.h[i]` | a carved road's own smoothed centreline profile — roads are *drawn* from this |
| `SurfaceIndex.height()` | what a wheel rests on: carriageway, kerb, pavement, footpath, or ground |

`carve-terrain.mjs` deliberately pushes the terrain *under* every graded road so
the ground cannot poke through the tarmac. So **anything that should sit on a road
must use `SurfaceIndex`** (`src/world/surface.js`) — the player's car, the
trolleybus, the NPC car, traffic signals, wire masts. Buildings, trees and street
lamps use `terrain` on purpose. Reading the heightfield for a vehicle parks it up
to 3 m below the road.

**Everything is merged per material, and nothing is frustum-culled.** ~16 draw
calls for 4,600 buildings, but every triangle is submitted every frame wherever
the camera points. New detail has to be shader-based (free), instanced with
distance LOD, or explicitly accepted as desktop-only. Mobile sits around 2.7 M
triangles; check it before and after anything that adds geometry.

**`overrides.json` is the hand-authored correction layer**, keyed by OSM id and
applied in `build-world.mjs`. It beats anything inferred from footprint geometry
and survives re-downloading the map. `parts` splits one footprint into separately
extruded pieces by half-plane clipping, emitting `way/123#0`, `#1`, … Field
reference is in README → *Override fields*.

**Facade families** live in `src/world/materials.js`. A family costs one material
however many buildings use it, which is why photo → family scales and photo →
bespoke texture does not. Adding one is usually the right answer to "this
building looks wrong".

**The workbench** (`/building.html`, `src/workbench.js`) loads a single building
with its real ground and street, orbits it, and lets you try families live. Its
write API (`tools/vite-overrides.mjs`) is declared `apply: 'serve'`, so it exists
only under `npm run dev` — nothing in a production build can write anything.

## Conventions that are easy to get wrong

**Coordinate frame is x east, y up, z *south*.** So −z is north. Right of travel
for heading `(fx, fz)` is `(-fz, fx)`; left is `(fz, -fx)`. Getting this backwards
put a bus lane and an NPC route into oncoming traffic on separate occasions.

**Winding.** `outwardNormal()` decides orientation by stepping off the wall and
testing point-in-polygon — *not* by comparing against the centroid, which is
wrong on concave footprints. `facedQuad()` corrects winding itself. `revealWall()`
receives corners already ordered so the wall faces out; swapping them again
reverses every wall and back-face culling deletes the building.

**Materials fight the tonemapper.** Output is ACES at 0.62 exposure under a cool
physical sky, and it will quietly ruin surfaces authored to look right on paper:

- Glass with `clearcoat: 1` at low roughness renders as **white chrome** — the
  specular lobe erases the base colour. Glass is not clearcoated; paint is.
- Car paint above roughly `metalness: 0.15` becomes a coloured mirror and the
  bonnet blows out into a white sheet.
- Warm surfaces need to be authored *far* warmer than the target: measured on a
  sunlit footway, red-minus-blue is compressed about **3.7×**.
- Clouds must be authored brighter than white (the lit side is at 1.85) or they
  come out as grey smoke.

**`fbm()` does not span 0..1.** It sums octaves at halving amplitude, so over a
typical sampling pattern it lands around 0.06–0.42. Normalise to the measured
range before thresholding, or a coverage dial does nothing at all.

## Verifying visual work

Measure first, then look — but be careful which measurement.

- **A static camera over two frames** detects temporal instability; identical
  frames mean nothing is flickering.
- **Nudging the camera and diffing is not a z-fighting test.** A 1 cm move
  legitimately shifts every edge sub-pixel, so ~2% of the frame changes no matter
  what, and the number will not move when you fix something real.
- When a render looks wrong, **hide one mesh at a time and re-render**. Sampling
  guessed pixel regions produced confident wrong answers repeatedly this session —
  including "the bus is floating 0.4 m" when it was seated to 0.0000 m.
- Save screenshots and actually look at them. Several bugs were only ever found
  by rendering a difference image rather than by reading numbers.

## Data sources and licence

OpenStreetMap (ODbL) and the Terrain Tiles dataset on AWS Open Data. Attribution
is rendered in-frame and on the loading screen and must stay — see README →
*Attribution*. Note that `public/data/world.json` is a **derived database** under
ODbL, which carries share-alike obligations the rendered game itself does not.

Deployment is Vercel (`npx vercel --prod`); `vercel.json` pins the Vite preset and
the cache headers, which differ deliberately between `/assets/` (content-hashed,
immutable) and `/data/` (stable filenames, must revalidate).
