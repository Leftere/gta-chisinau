/**
 * Builds the street surface: carriageways, pavements and kerbs.
 *
 * Each OSM way becomes a ribbon of quads with mitred joins, UV-mapped so that
 * u runs across the full carriageway and v advances in metres along it.
 */
import * as THREE from 'three'
import { surfaceMaterials, ROAD_TILE_LEN } from './surfaces.js'
import { BatchSet } from './batch.js'

// Shared with src/world/surface.js, which has to place the car on exactly the
// surface this module draws.
export const ROAD_Y = 0.05
export const KERB_H = 0.14
export const WALK_W = 2.3

/**
 * How far a road's surface sits above its own profile.
 *
 * The rank term is the important part. Without it every road is drawn at exactly
 * ROAD_Y, so wherever two of them overlap at a junction and their graded profiles
 * agree, the two ribbons are precisely coplanar and fight for depth — 108 pairs
 * across the city, 98 of them inside the same merged mesh where nothing breaks
 * the tie. Separating by rank means the more important road always wins, by a
 * margin far too small to see and far too large for the depth buffer to confuse.
 *
 * Both this module and the car's surface lookup call it, so they cannot drift.
 */
export function roadLift (road) {
  return ROAD_Y
    + (9 - Math.min(9, road.rank ?? 6)) * 0.003
    + jitter(road)
    + (road.layer ?? 0) * 0.03
    + (road.foot ? 0.08 : 0)
}

/**
 * A deterministic sub-centimetre offset unique to each road.
 *
 * Rank alone does not separate them: Stefan cel Mare is 31 separate ways and
 * every one of them is rank 2, so the pairs that overlap at its junctions share
 * a rank and stay coplanar. Hashing the road's own first vertex gives each way
 * its own step in the same range, which breaks the tie between any two of them.
 * Keyed to a coordinate rather than an array index so the city does not
 * reshuffle when the map is re-fetched.
 */
function jitter (road) {
  const x = Math.round(road.p[0][0] * 100) | 0
  const z = Math.round(road.p[0][1] * 100) | 0
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h >>> 16) % 17) * 0.0015          // 0 .. 2.4 cm
}

/**
 * Offsets a polyline sideways with mitred joins.
 * Returns one point per input vertex, pushed `dist` metres to the left.
 */
function offsetLine (pts, dist) {
  const n = pts.length
  const out = new Array(n)
  const seg = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dz = pts[i + 1][1] - pts[i][1]
    const len = Math.hypot(dx, dz) || 1
    seg.push([dx / len, dz / len])
  }
  for (let i = 0; i < n; i++) {
    const a = seg[Math.max(0, i - 1)]
    const b = seg[Math.min(seg.length - 1, i)]
    let mx = a[1] + b[1]
    let mz = -(a[0] + b[0])
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml; mz /= ml
    // Lengthen the offset at corners so the ribbon keeps a constant width.
    const cosHalf = Math.max(0.34, mx * a[1] + mz * -a[0])
    const scale = dist / cosHalf
    out[i] = [pts[i][0] + mx * scale, pts[i][1] + mz * scale]
  }
  return out
}

/**
 * Adds vertices to a polyline until it actually follows the ground.
 *
 * An uncarved road has no graded profile — it drapes, sampling the terrain at
 * its own vertices. But OSM puts vertices at geometry changes, not at ground
 * changes: half of these segments run 100 m and a tenth run over 200 m, while
 * the heightfield moves on an 8 m grid. The ribbon between two vertices is one
 * flat quad, so every hill in between rises straight through the road surface —
 * which is what makes a street vanish into the landscape.
 *
 * Subdivision is adaptive rather than uniform. Splitting all 255 km of road to a
 * fixed spacing would multiply the road triangle count several times over for
 * the sake of the minority of segments that actually cross uneven ground; this
 * only spends vertices where the chord genuinely departs from the terrain.
 */
function densify (pts, terrain, tol = 0.05, minSeg = 2.5) {
  const out = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < minSeg * 2) { out.push(b); continue }
    // Walk the chord and find the largest gap between it and the ground, then
    // pick a division count that brings the sag under tolerance.
    const probes = Math.min(64, Math.max(4, Math.ceil(len / minSeg)))
    const ha = terrain.height(a[0], a[1])
    const hb = terrain.height(b[0], b[1])
    let sag = 0
    for (let k = 1; k < probes; k++) {
      const t = k / probes
      const d = terrain.height(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) - (ha + (hb - ha) * t)
      if (Math.abs(d) > sag) sag = Math.abs(d)
    }
    if (sag <= tol) { out.push(b); continue }
    const n = Math.min(probes, Math.max(2, Math.ceil(len / minSeg)))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

function lengths (pts) {
  const acc = [0]
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return acc
}

/**
 * Lays a ribbon between two already-offset edges, draped over the terrain.
 * Every corner samples its own height, so a road banks and climbs with the hill.
 */
function ribbon (batch, left, right, yOff, dists, col, uSpan = [0, 1], tileLen = ROAD_TILE_LEN, terrain, profile) {
  const up = [0, 1, 0]
  // With a graded profile both kerbs share the centreline height, so the
  // carriageway is level across its width the way a built road is. Without one
  // the surface just follows the ground.
  const H = (p, i) => (profile ? profile[i] : terrain.height(p[0], p[1])) + yOff
  for (let i = 0; i < left.length - 1; i++) {
    const v0 = dists[i] / tileLen
    const v1 = dists[i + 1] / tileLen
    batch.quad(
      [left[i][0], H(left[i], i), left[i][1]],
      [right[i][0], H(right[i], i), right[i][1]],
      [right[i + 1][0], H(right[i + 1], i + 1), right[i + 1][1]],
      [left[i + 1][0], H(left[i + 1], i + 1), left[i + 1][1]],
      up,
      [[uSpan[0], v0], [uSpan[1], v0], [uSpan[1], v1], [uSpan[0], v1]],
      col)
  }
}

/** Vertical kerb face between the carriageway and the raised pavement. */
function kerbFace (batch, inner, outerY, innerY, dists, col, flip, terrain, profile) {
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i], b = inner[i + 1]
    const ha = profile ? profile[i] : terrain.height(a[0], a[1])
    const hb = profile ? profile[i + 1] : terrain.height(b[0], b[1])
    let nx = b[1] - a[1], nz = -(b[0] - a[0])
    const l = Math.hypot(nx, nz) || 1
    nx = (nx / l) * (flip ? -1 : 1)
    nz = (nz / l) * (flip ? -1 : 1)
    const v0 = dists[i] / 2.4, v1 = dists[i + 1] / 2.4
    batch.quad(
      [a[0], ha + outerY, a[1]], [b[0], hb + outerY, b[1]],
      [b[0], hb + innerY, b[1]], [a[0], ha + innerY, a[1]],
      [nx, 0, nz],
      [[v0, 0], [v1, 0], [v1, 0.35], [v0, 0.35]],
      col)
  }
}

const WHITE = { r: 1, g: 1, b: 1 }

function pointInRing (x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Signed area of a ring, for deciding which way round it is wound. */
function signedArea2 (pts) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  }
  return a / 2
}

export function buildRoads (world, terrain, { lowDetail = false } = {}) {
  // A phone gets a looser sag tolerance: still enough that a street reads as a
  // street, at roughly half the added geometry.
  const tol = lowDetail ? 0.10 : 0.05
  const minSeg = lowDetail ? 4 : 2.5
  const mats = surfaceMaterials()
  const batches = new BatchSet()
  const group = new THREE.Group()
  group.name = 'roads'

  // Roads are already sorted widest-last by the world builder, so major
  // carriageways paint over the minor ones at junctions.
  let addedVerts = 0
  for (const road of world.roads) {
    // A carved road reads its height from the stored profile and the ground was
    // graded to match, so it needs no extra vertices — only draped ones do.
    const pts = road.h ? road.p : densify(road.p, terrain, tol, minSeg)
    if (pts.length < 2) continue
    addedVerts += pts.length - road.p.length
    const halfW = road.w / 2
    const dists = lengths(pts)
    if (dists[dists.length - 1] < 1.5) continue

    // Slight per-road tone variation stops the network looking uniform.
    const t = 0.9 + ((Math.sin(pts[0][0] * 0.37 + pts[0][1] * 0.71) + 1) / 2) * 0.2
    const col = { r: t, g: t, b: t }
    const yOff = roadLift(road)
    const profile = road.h        // graded centreline, present on carved roads

    if (road.foot) {
      const left = offsetLine(pts, halfW)
      const right = offsetLine(pts, -halfW)
      ribbon(batches.for(mats.paving), left, right, yOff, dists, col, [0, road.w / 2.4], 2.4, terrain, profile)
      continue
    }

    const lanes = Math.max(2, Math.min(6, road.lanes || 2))
    const laneKey = mats.roads[lanes] ? lanes : (lanes > 4 ? 6 : 4)
    const mat = road.rank >= 7 ? mats.roads.plain : mats.roads[laneKey]

    const left = offsetLine(pts, halfW)
    const right = offsetLine(pts, -halfW)
    ribbon(batches.for(mat), left, right, yOff, dists, col, [0, 1], ROAD_TILE_LEN, terrain, profile)

    // Pavements alongside anything from a residential street upward.
    if (road.rank <= 5 && !road.bridge && !road.tunnel) {
      const walk = batches.for(mats.paving)
      const kerb = batches.for(mats.paving)
      for (const side of [1, -1]) {
        const inner = offsetLine(pts, side * halfW)
        const outer = offsetLine(pts, side * (halfW + WALK_W))
        const a = side > 0 ? inner : outer
        const b = side > 0 ? outer : inner
        ribbon(walk, a, b, yOff + KERB_H, dists, col, [0, WALK_W / 2.4], 2.4, terrain, profile)
        kerbFace(kerb, inner, yOff, yOff + KERB_H, dists, { r: 0.85, g: 0.85, b: 0.84 }, side < 0, terrain, profile)
      }
    }
  }

  const stats = batches.addTo(group, { castShadow: false, receiveShadow: true })
  return { group, ...stats, addedVerts }
}

/** Base terrain plus the parks, water and car parks that sit on it. */
export function buildGround (world, terrain) {
  const mats = surfaceMaterials()
  const group = new THREE.Group()
  group.name = 'ground'

  const base = terrain.buildMesh(mats.dirt, 9)
  if (base) group.add(base)

  const KIND_MAT = {
    park: mats.grass, grass: mats.grass, forest: mats.forest, pitch: mats.grass,
    water: mats.water, parking: mats.roads.plain, industrial_land: mats.dirt,
    courtyard: mats.courtyard,
  }
  const KIND_Y = { water: 0.015, parking: 0.035 }

  // --- landmark forecourts --------------------------------------------------
  // A cathedral does not stand on a lawn. Each landmark gets a paved apron of
  // deliberately the same radius the tree scatter keeps clear (props.js
  // PLAZA_SETBACK), so the two agree by construction: nothing grows in the
  // apron because the apron is paved.
  //
  // The apron is *cut out* of the greenery rather than laid on top of it. A
  // park polygon is triangulated straight from its outline, so across 96,000 m2
  // of Cathedral Park its grass spans hundreds of metres between vertices and
  // floats wherever the ground dips beneath the chord — enough to swallow a
  // plaza laid a couple of centimetres proud of the terrain, which is exactly
  // what the first attempt did.
  //
  // Radius is capped at the nearest carriageway: the arch stands 9.4 m from
  // Stefan cel Mare, and an uncapped 29.6 m apron would pave the boulevard.
  const APRON = 24.0
  const SIDES = 8, SUB = 5, RINGS = 7
  const COLS = SIDES * SUB
  const aprons = []
  for (const lm of world.landmarks ?? []) {
    let limit = Infinity
    for (const road of world.roads ?? []) {
      if (road.foot || !road.p || road.p.length < 2) continue
      for (let i = 0; i < road.p.length - 1; i++) {
        const a = road.p[i], b = road.p[i + 1]
        const dx = b[0] - a[0], dz = b[1] - a[1]
        const len2 = dx * dx + dz * dz
        let t = len2 ? ((lm.x - a[0]) * dx + (lm.z - a[1]) * dz) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(lm.x - (a[0] + dx * t), lm.z - (a[1] + dz * t)) - road.w / 2
        if (d < limit) limit = d
      }
    }
    const R = Math.min(Math.max(lm.width ?? 0, lm.depth ?? 0) / 2 + APRON, Math.max(6, limit))
    // An octagon, not a disc: a circle of paving in a park reads as a crop mark,
    // and every plaza here has straight edges.
    const rot = -(lm.angle ?? 0)
    const at = (u, rad) => {
      const s = u * SIDES, i = Math.floor(s), f = s - i
      const a0 = rot + (i / SIDES) * Math.PI * 2
      const a1 = rot + ((i + 1) / SIDES) * Math.PI * 2
      return [
        lm.x + (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f) * rad,
        lm.z + (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f) * rad,
      ]
    }
    const outline = []
    for (let c = 0; c < COLS; c++) outline.push(at(c / COLS, R))
    aprons.push({ lm, R, at, outline })
  }

  const batches = new BatchSet()
  for (const area of world.areas) {
    const mat = KIND_MAT[area.k]
    if (!mat) continue
    const contour = area.r.map(p => new THREE.Vector2(p[0], p[1]))
    // Holes for any forecourt standing in this area. A hole has to run opposite
    // to the contour or the triangulator swallows the whole polygon.
    const outward = signedArea2(contour) > 0
    const holes = []
    for (const ap of aprons) {
      if (!pointInRing(ap.lm.x, ap.lm.z, area.r)) continue
      const h = ap.outline.map(p => new THREE.Vector2(p[0], p[1]))
      if ((signedArea2(h) > 0) === outward) h.reverse()
      holes.push(h)
    }
    let tris
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes) } catch { continue }
    // Indices returned by the triangulator run over contour *then* every hole.
    const verts = holes.length ? contour.concat(...holes) : contour
    const batch = batches.for(mat)
    const tile = mat.userData.tile
    const y = KIND_Y[area.k] ?? 0.025
    for (const t of tris) {
      const a = verts[t[0]], b = verts[t[1]], c = verts[t[2]]
      if (!a || !b || !c) continue
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const P = p => [p.x, terrain.height(p.x, p.y) + y, p.y]
      const U = p => [p.x / tile.w, p.y / tile.h]
      if (cross < 0) batch.tri(P(a), P(b), P(c), [0, 1, 0], [U(a), U(b), U(c)], WHITE)
      else batch.tri(P(a), P(c), P(b), [0, 1, 0], [U(a), U(c), U(b)], WHITE)
    }
  }

  // Now fill each hole with paving, drawn in rings so it follows the ground
  // instead of spanning it.
  for (const ap of aprons) {
    const batch = batches.for(mats.paving)
    const tile = mats.paving.userData.tile
    const V = p => [p[0], terrain.height(p[0], p[1]) + 0.03, p[1]]
    const U = p => [p[0] / tile.w, p[1] / tile.h]
    for (let r = 0; r < RINGS; r++) {
      const r0 = (r / RINGS) * ap.R, r1 = ((r + 1) / RINGS) * ap.R
      for (let c = 0; c < COLS; c++) {
        const u0 = c / COLS, u1 = (c + 1) / COLS
        const a = ap.at(u0, r0), b = ap.at(u1, r0)
        const cc = ap.at(u1, r1), d = ap.at(u0, r1)
        if (r > 0) batch.tri(V(a), V(b), V(cc), [0, 1, 0], [U(a), U(b), U(cc)], WHITE)
        batch.tri(V(a), V(cc), V(d), [0, 1, 0], [U(a), U(cc), U(d)], WHITE)
      }
    }
  }

  const stats = batches.addTo(group, { castShadow: false, receiveShadow: true })
  return { group, drawCalls: stats.drawCalls + 1, triangles: stats.triangles }
}
