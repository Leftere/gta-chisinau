/**
 * Grades the raw DEM to the road network, and gives every road a height profile.
 *
 * Two things a raw heightfield gets wrong. A road draped vertex-by-vertex tilts
 * sideways with the hill, which real roads never do — they are built flat across
 * their width, with a cutting on the uphill side and an embankment on the
 * downhill. And two roads meeting at a junction only agree if they are derived
 * from the same surface.
 *
 * So: smooth a profile along each centreline, clamp its gradient, then carve
 * that profile back into the heightfield with a blend-out either side. Roads
 * then read their height from the stored profile, and the ground already
 * matches, so junctions agree by construction.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const MAX_GRADE = 0.15          // clip only genuinely absurd spikes
const SMOOTH_PASSES = 4
const BLEND = 9                 // metres of embankment/cutting either side

// Must match src/world/roads.js, or the clearance below is computed against a
// surface the renderer does not actually draw.
const ROAD_Y = 0.05
const KERB_H = 0.14
const WALK_W = 2.3

/**
 * Guaranteed gap between a road surface and the ground beneath it.
 *
 * Grading alone does not deliver this. Carving replaces a cell with a weighted
 * *average* of every nearby profile sample, so on a slope the result is flatter
 * than the road itself and the uphill half of the cell ends up above it. On top
 * of that the heightfield is stored to 0.1 m, which alone can lift a cell 5 cm —
 * the entire clearance the road had.
 */
const CLEAR = 0.14

if (!existsSync('data-cache/terrain-raw.json')) {
  console.log('no data-cache/terrain-raw.json — run `npm run fetch-dem` first; skipping.')
  process.exit(0)
}

const dem = JSON.parse(readFileSync('data-cache/terrain-raw.json', 'utf8'))
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8'))
const { x0, z0, step, nx, nz } = dem
const raw = Float64Array.from(dem.h)

const at = (i, j) => raw[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))]

/** Bilinear sample of the raw DEM. */
function sample (x, z) {
  const fx = (x - x0) / step, fz = (z - z0) / step
  const i = Math.max(0, Math.min(nx - 2, Math.floor(fx)))
  const j = Math.max(0, Math.min(nz - 2, Math.floor(fz)))
  const u = fx - i, v = fz - j
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) +
         (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v
}

/** Smoothed, gradient-limited height profile along a centreline. */
function profileFor (pts) {
  const n = pts.length
  const h = new Float64Array(n)
  const d = new Float64Array(n)          // distance to the previous point
  for (let i = 0; i < n; i++) {
    h[i] = sample(pts[i][0], pts[i][1])
    d[i] = i ? Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) : 0
  }
  if (n < 3) return h

  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const out = Float64Array.from(h)
    for (let i = 1; i < n - 1; i++) out[i] = h[i - 1] * 0.25 + h[i] * 0.5 + h[i + 1] * 0.25
    h.set(out)
  }

  // Two sweeps so a clamp applied one way cannot re-break the other.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n; i++) {
      const lim = MAX_GRADE * Math.max(d[i], 0.01)
      h[i] = Math.max(h[i - 1] - lim, Math.min(h[i - 1] + lim, h[i]))
    }
    for (let i = n - 2; i >= 0; i--) {
      const lim = MAX_GRADE * Math.max(d[i + 1], 0.01)
      h[i] = Math.max(h[i + 1] - lim, Math.min(h[i + 1] + lim, h[i]))
    }
  }
  return h
}

// ------------------------------------------------------- profiles + carving

const sumW = new Float64Array(nx * nz)
const sumWH = new Float64Array(nx * nz)
let carvedRoads = 0

// Narrow service roads and footways are barely wider than a grid cell; carving
// for them would just add noise, so they follow the ground instead.
const CARVE = r => !r.foot && r.rank <= 6

/**
 * Splits long centreline segments so the profile can follow the ground.
 *
 * OSM puts vertices where the geometry bends, not where the hill does — one
 * street here is a single 258 m segment with two vertices. Its profile is then a
 * straight line over 258 m of undulating ground, which forces the grading to cut
 * metres deep at one end and still leaves the ground standing above the road at
 * the other. Sampling at the heightfield's own resolution lets the profile
 * actually describe the hill, and the smoothing pass afterwards still takes the
 * bumps out.
 */
function densifyCentreline (pts, maxSeg) {
  const out = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(len / maxSeg))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([
        Math.round((a[0] + (b[0] - a[0]) * t) * 100) / 100,
        Math.round((a[1] + (b[1] - a[1]) * t) * 100) / 100,
      ])
    }
  }
  return out
}

for (const road of world.roads) {
  delete road.h                 // this tool is re-runnable over its own output
  if (CARVE(road) && road.p.length >= 2) road.p = densifyCentreline(road.p, step)
  const pts = road.p
  if (pts.length < 2) continue
  // Only carved roads get a stored profile. An uncarved footway following a
  // smoothed profile would hang in the air over ground nobody graded for it.
  if (!CARVE(road)) continue
  const h = profileFor(pts)
  road.h = Array.from(h, v => Math.round(v * 100) / 100)
  carvedRoads++

  const half = road.w / 2
  const reach = half + BLEND
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1]
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (segLen < 0.01) continue
    const steps = Math.max(1, Math.ceil(segLen / (step * 0.5)))
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const px = a[0] + (b[0] - a[0]) * t
      const pz = a[1] + (b[1] - a[1]) * t
      const ph = h[s] + (h[s + 1] - h[s]) * t
      const i0 = Math.max(0, Math.floor((px - reach - x0) / step))
      const i1 = Math.min(nx - 1, Math.ceil((px + reach - x0) / step))
      const j0 = Math.max(0, Math.floor((pz - reach - z0) / step))
      const j1 = Math.min(nz - 1, Math.ceil((pz + reach - z0) / step))
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + i * step - px, dz = z0 + j * step - pz
          const dist = Math.hypot(dx, dz)
          if (dist > reach) continue
          // 1 across the carriageway, easing to 0 at the far edge of the blend.
          let w = dist <= half ? 1 : 1 - (dist - half) / BLEND
          w = w * w * (3 - 2 * w)
          const k2 = j * nx + i
          if (w > 0) { sumW[k2] += w; sumWH[k2] += w * ph }
        }
      }
    }
  }
}

let touched = 0, maxCut = 0, maxFill = 0
const out = new Float64Array(nx * nz)
for (let k = 0; k < out.length; k++) {
  if (sumW[k] <= 0) { out[k] = raw[k]; continue }
  const blend = Math.min(1, sumW[k])
  const target = sumWH[k] / sumW[k]
  out[k] = raw[k] * (1 - blend) + target * blend
  const delta = out[k] - raw[k]
  if (delta < maxCut) maxCut = delta
  if (delta > maxFill) maxFill = delta
  touched++
}

// Round first: the clamp below has to be applied to the values actually stored,
// or rounding puts back the very overlap it just removed.
const grid = Float64Array.from(out, v => Math.round(v * 10) / 10)

/**
 * Push the ground below every graded road surface.
 *
 * Grading pulls the terrain *towards* the road; this guarantees it ends up
 * under it. Only ever lowers a cell, and only under the road and its pavements,
 * so nothing outside the carriageway moves and no trench appears beside it.
 */
let conformed = 0, deepestClamp = 0
for (const road of world.roads) {
  const h = road.h
  if (!h) continue                       // uncarved roads drape; see roads.js
  if (road.tunnel) continue              // a tunnel wants ground over it, not a trench
  const pts = road.p
  const half = road.w / 2
  // One grid step beyond the pavement, because height() interpolates *across* a
  // cell: clamping only the cells under the road still lets the surface rise
  // toward an un-clamped neighbour and break through at the kerb.
  const reach = half + WALK_W + step * 0.75
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1]
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (segLen < 0.01) continue
    const steps = Math.max(1, Math.ceil(segLen / (step * 0.5)))
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const px = a[0] + (b[0] - a[0]) * t
      const pz = a[1] + (b[1] - a[1]) * t
      const ph = h[s] + (h[s + 1] - h[s]) * t
      const i0 = Math.max(0, Math.floor((px - reach - x0) / step))
      const i1 = Math.min(nx - 1, Math.ceil((px + reach - x0) / step))
      const j0 = Math.max(0, Math.floor((pz - reach - z0) / step))
      const j1 = Math.min(nz - 1, Math.ceil((pz + reach - z0) / step))
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + i * step - px, dz = z0 + j * step - pz
          const dist = Math.hypot(dx, dz)
          if (dist > reach) continue
          // The pavement is a kerb-height higher, so it tolerates more ground
          // under it; clamping everything to the carriageway would leave the
          // outer pavement edge hanging over a gap.
          const surface = ph + ROAD_Y + (dist > half ? KERB_H : 0)
          const limit = Math.floor((surface - CLEAR) * 10) / 10
          const kk = j * nx + i
          if (grid[kk] > limit) {
            deepestClamp = Math.max(deepestClamp, grid[kk] - limit)
            grid[kk] = limit
            conformed++
          }
        }
      }
    }
  }
}

const terrain = {
  x0, z0, step, nx, nz, originH: dem.originH,
  h: Array.from(grid, v => Math.round(v * 10) / 10),
}
writeFileSync('public/data/terrain.json', JSON.stringify(terrain))
writeFileSync('public/data/world.json', JSON.stringify(world))

console.log(`profiles for ${world.roads.length} roads; carved ${carvedRoads} of them`)
console.log(`grid cells modified: ${touched} of ${nx * nz} (${(100 * touched / (nx * nz)).toFixed(1)}%)`)
console.log(`deepest cut ${maxCut.toFixed(1)}m, highest fill ${maxFill.toFixed(1)}m`)
console.log(`conform: lowered ${conformed} cell-samples under roads, deepest ${deepestClamp.toFixed(2)}m`)
console.log(`-> public/data/terrain.json  (${(JSON.stringify(terrain).length / 1e6).toFixed(2)} MB)`)
