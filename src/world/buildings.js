/**
 * Extrudes OSM footprints into buildings.
 *
 * Walls are UV-mapped in metres, so one texture tile is one real storey and the
 * facade never stretches. Heights are snapped to a whole number of storeys so
 * the top row of windows meets the roofline instead of being sliced in half.
 * Buildings that meet the street with shops get a separate ground-floor band.
 *
 * Everything is merged into one geometry per material: 4600 buildings render in
 * about 16 draw calls.
 */
import * as THREE from 'three'
import { cityMaterials, GROUND_BAND_H } from './materials.js'
import { Batch } from './batch.js'

/** Per-family colour ranges. Albedo is near-neutral, so these tints do the work. */
const PALETTES = {
  panel:      ['#b3ac9c', '#a8ada6', '#bfb49c', '#9fa6a5', '#c2b596', '#8f9791', '#a9b8b0'],
  historic:   ['#c9a765', '#a8b795', '#c2a091', '#d5c7a4', '#9fb2bd', '#b98a6d', '#c8b48c'],
  house:      ['#d2ccb8', '#cfc09a', '#bcc7b6', '#d3c4bd', '#c6cbc6', '#dcd4c0', '#b9ad96'],
  plain:      ['#bdb6a6', '#b2b7b0', '#c6bda9', '#aab0a9', '#c9c0ad'],
  commercial: ['#cfd0cc', '#bfc6c9', '#d6d1c4'],
  glass:      ['#8fa5ad', '#849aa3', '#9aabab'],
  civic:      ['#cdc2a8', '#c4c0b0', '#d2c8b0'],
  industrial: ['#9a978e', '#8d8378', '#95999a'],
  small:      ['#a09b90', '#948e84', '#a8a091'],
  church:     ['#e8e2d2', '#ded9cb'],
  stone:      ['#d8cdb4', '#cfc4a8', '#ded4bd'],
  modernist:  ['#e2e2dc', '#dcdcd6', '#e7e5de', '#d6d8d6'],
  stoneclad:  ['#cfcabe', '#d5d0c4', '#c7c2b6', '#d9d4c8'],
  pavilion:   ['#dbd8ce', '#d4d3cb', '#e0dcd2', '#cfd0ca'],
  tiled:      ['#ded5c4', '#e3dccb', '#d8cfbe', '#e6dfd0'],
}
const ROOF_TINTS = ['#7a4f3c', '#5f6b58', '#7c7e7b', '#5d5f62', '#6b453a', '#828a8c', '#4f5a52']

const tmpColor = new THREE.Color()

/** Cheap deterministic value in [0,1) from an integer. */
function rand (n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * FNV-1a over the OSM id. Appearance must be keyed to identity, not to array
 * position: seed off the index and a single building appearing or disappearing
 * upstream repaints every building after it in the file.
 */
function hashId (id) {
  let h = 2166136261
  const str = String(id)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 100000
}

/** Ray-cast containment test, used to decide which side of a wall is outside. */
function pointInRing (x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/**
 * True outward normal for the wall p0->p1.
 *
 * Steps a little way off the wall and asks whether that lands inside the
 * footprint. Comparing the wall midpoint against the ring centroid — the
 * obvious approach — silently gives the wrong answer on concave footprints,
 * and most real footprints are concave somewhere.
 */
function outwardNormal (p0, p1, ring) {
  let nx = p1[1] - p0[1]
  let nz = -(p1[0] - p0[0])
  const len = Math.hypot(nx, nz) || 1
  nx /= len; nz /= len
  const mx = (p0[0] + p1[0]) / 2
  const mz = (p0[1] + p1[1]) / 2
  if (pointInRing(mx + nx * 0.02, mz + nz * 0.02, ring)) { nx = -nx; nz = -nz }
  return [nx, 0, nz]
}

/**
 * Whether the quad for p0->p1 must be emitted reversed.
 *
 * Batch.quad builds triangle (p0-bottom, p1-bottom, p1-top), whose winding
 * normal is (-dz, dx). With FrontSide materials a wall is only drawn when that
 * points *out* of the building; wound the other way it is silently culled, and
 * you end up looking through the near facade at the inside of the far wall
 * while collision still stops the car dead.
 *
 * Ring winding out of the world builder is the opposite of what the renderer
 * needs, so in practice almost every wall reverses here.
 */
function needsFlip (p0, p1, outward) {
  const wx = -(p1[1] - p0[1])
  const wz = p1[0] - p0[0]
  return wx * outward[0] + wz * outward[2] < 0
}

/** Emits a quad, reversing the winding if needed so its front face points along n. */
function facedQuad (batch, a, b, c, d, n, uvs, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const gx = uy * vz - uz * vy
  const gy = uz * vx - ux * vz
  const gz = ux * vy - uy * vx
  if (gx * n[0] + gy * n[1] + gz * n[2] < 0) {
    batch.quad(d, c, b, a, n, [uvs[3], uvs[2], uvs[1], uvs[0]], col)
  } else {
    batch.quad(a, b, c, d, n, uvs, col)
  }
}

/** Pushes a closed ring outward by `dist`, mitring the corners so it stays closed. */
function offsetRing (ring, dist) {
  const n = ring.length
  const norms = ring.map((p, i) => {
    const o = outwardNormal(p, ring[(i + 1) % n], ring)
    return [o[0], o[2]]
  })
  return ring.map((p, i) => {
    const a = norms[(i - 1 + n) % n]      // edge arriving at this vertex
    const b = norms[i]                    // edge leaving it
    let mx = a[0] + b[0], mz = a[1] + b[1]
    const ml = Math.hypot(mx, mz)
    if (ml < 1e-6) return [p[0], p[1]]
    mx /= ml; mz /= ml
    // Lengthen at sharp corners so the band keeps a constant projection.
    const cosHalf = Math.max(0.35, mx * b[0] + mz * b[1])
    return [p[0] + (mx * dist) / cosHalf, p[1] + (mz * dist) / cosHalf]
  })
}

/**
 * Where the painted windows sit on a wall, in metres along it and up it.
 *
 * The facade texture lays windows out on a known grid, so the geometry can be
 * derived from the same numbers rather than guessed. Note the vertical flip: UV
 * v runs up from the wall base, while `winTop` is measured down from the top of
 * the storey because that is where the canvas origin is.
 */
function windowGrid (len, height, tile, cfg) {
  const { bays = 2, winW = 0.52, winH = 0.58, winTop = 0.16 } = cfg
  const bayW = tile.w / bays
  const out = []
  for (let y = 0; y + tile.h <= height + 0.01; y += tile.h) {
    const y1 = y + tile.h * (1 - winTop)
    const y0 = y + tile.h * (1 - winTop - winH)
    for (let x = 0; x + bayW <= len + 0.01; x += bayW) {
      const w = bayW * winW
      out.push({ x0: x + (bayW - w) / 2, x1: x + (bayW + w) / 2, y0, y1 })
    }
  }
  return out
}

/**
 * A wall with its windows actually cut into it.
 *
 * Painted windows are flat, and up close a facade reads as wallpaper. This
 * builds the wall as a grid of quads with the window cells left out, then adds
 * jambs, head and sill around each opening and sets the glass back behind them.
 * It is opt-in per building because it is several hundred triangles a facade
 * where a painted one is two — worth it on a building you are standing next to,
 * not on all 4,600.
 */
function revealWall (facade, trimB, glassB, a, b, y0, y1, n, tile, cfg, col, reveal, run0, flip) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const height = y1 - y0
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len
  const P = (d, y, back = 0) => [a[0] + ux * d - n[0] * back, y0 + y, a[1] + uz * d - n[2] * back]
  const wins = windowGrid(len, height, tile, cfg)

  // Cut the wall along every window edge, then drop the cells that are windows.
  const xs = [...new Set([0, len, ...wins.flatMap(w => [w.x0, w.x1])])].sort((p, q) => p - q)
  const ys = [...new Set([0, height, ...wins.flatMap(w => [w.y0, w.y1])])].sort((p, q) => p - q)
  const U = d => (flip ? run0 - d : run0 + d) / tile.w
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const [xa, xb] = [xs[i], xs[i + 1]], [ya, yb] = [ys[j], ys[j + 1]]
      if (xb - xa < 1e-4 || yb - ya < 1e-4) continue
      const cx = (xa + xb) / 2, cy = (ya + yb) / 2
      if (wins.some(w => cx > w.x0 && cx < w.x1 && cy > w.y0 && cy < w.y1)) continue
      // `a`->`b` already arrives in the order that leaves the wall facing out;
      // swapping again here reverses the winding and back-face culling removes
      // the entire wall, leaving windows floating in mid-air.
      facade.quad(P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb), n,
        [[U(xa), ya / tile.h], [U(xb), ya / tile.h], [U(xb), yb / tile.h], [U(xa), yb / tile.h]], col)
    }
  }

  const gt = glassB.material.userData.tile
  for (const w of wins) {
    const { x0, x1, y0: wy0, y1: wy1 } = w
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    // Glass, set back the full depth of the reveal. UVs in metres like every
    // other surface here, or one pane wears a whole window texture.
    const gu0 = (run0 + x0) / gt.w, gu1 = (run0 + x1) / gt.w
    const gv0 = wy0 / gt.h, gv1 = wy1 / gt.h
    facedQuad(glassB, P(x0, wy0, reveal), P(x1, wy0, reveal), P(x1, wy1, reveal), P(x0, wy1, reveal), n,
      [[gu0, gv0], [gu1, gv0], [gu1, gv1], [gu0, gv1]], col)
    // Jambs, head and sill. Wound so each faces into the opening.
    facedQuad(trimB, P(x0, wy0), P(x0, wy1), P(x0, wy1, reveal), P(x0, wy0, reveal),
      [ux, 0, uz], uv, col)
    facedQuad(trimB, P(x1, wy0), P(x1, wy1), P(x1, wy1, reveal), P(x1, wy0, reveal),
      [-ux, 0, -uz], uv, col)
    facedQuad(trimB, P(x0, wy1), P(x1, wy1), P(x1, wy1, reveal), P(x0, wy1, reveal),
      [0, -1, 0], uv, col)
    facedQuad(trimB, P(x0, wy0), P(x1, wy0), P(x1, wy0, reveal), P(x0, wy0, reveal),
      [0, 1, 0], uv, col)
  }
}

export function buildCity (world, terrain) {
  const mats = cityMaterials()
  const batches = new Map()
  const batchFor = m => {
    if (!batches.has(m)) batches.set(m, new Batch(m))
    const b = batches.get(m)
    b.current = currentIndex
    return b
  }
  let currentIndex = -1

  const roofFlat = batchFor(mats.flatRoof)
  const roofMetal = batchFor(mats.metalRoof)
  const trimBatch = batchFor(mats.trim)
  const footprints = []

  world.buildings.forEach((bd, bi) => {
    const ring = bd.r
    if (ring.length < 3) return
    const family = mats.facades[bd.k] ? bd.k : 'plain'
    const facadeMat = mats.facades[family]
    const groundMat = mats.ground[family]
    const tile = facadeMat.userData.tile

    // A real building is levelled onto a pad and shows foundation where the
    // ground falls away. Setting the floor to the median and reaching down to the
    // minimum gives that, instead of burying the uphill half of the building.
    const ter = terrain.underRing(ring)
    const pad = (bd.b || 0) + ter.median
    const footBottom = Math.max(ter.min - 0.4, pad - 8)
    const base = pad
    // An explicit roof override wins; otherwise small domestic buildings get a ridge.
    const pitched = bd.roof === 'gable' ? true
      : bd.roof === 'flat' ? false
      : ((bd.k === 'house' || bd.k === 'small') && bd.rs > 0 && bd.rs < 17)

    // --- snap the height to whole storeys so window rows land cleanly --------
    const wantsShop = !!groundMat && bd.h > GROUND_BAND_H + 2.2
    let bandTop = base
    let top
    if (wantsShop) {
      bandTop = base + GROUND_BAND_H
      const floors = Math.max(1, Math.round((bd.h - GROUND_BAND_H) / tile.h))
      top = bandTop + floors * tile.h
    } else {
      const floors = Math.max(1, Math.round(bd.h / tile.h))
      top = base + floors * tile.h
    }

    const seed = hashId(bd.id ?? bi)
    const tint = bd.c
      ? tmpColor.set(bd.c)
      : tmpColor.set(PALETTES[family][Math.floor(rand(seed * 7 + 1) * PALETTES[family].length)])
    // A hand-picked colour is used as given; inferred ones get weathering variety.
    const shade = bd.c ? 1 : 0.84 + rand(seed * 13 + 5) * 0.30
    const col = { r: tint.r * shade, g: tint.g * shade, b: tint.b * shade }

    currentIndex = bi
    for (const b of batches.values()) b.current = bi
    const facadeBatch = batchFor(facadeMat)
    const groundBatch = groundMat ? batchFor(groundMat) : null

    // --- walls --------------------------------------------------------------
    let run = 0
    for (let i = 0; i < ring.length; i++) {
      const p0 = ring[i]
      const p1 = ring[(i + 1) % ring.length]
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
      if (len < 0.05) continue
      const n = outwardNormal(p0, p1, ring)
      const u0 = run / tile.w
      const u1 = (run + len) / tile.w
      run += len

      // Emit in whichever order leaves the wall facing out of the building.
      const flip = needsFlip(p0, p1, n)
      const a = flip ? p1 : p0
      const b = flip ? p0 : p1

      // Exposed foundation, wherever the ground drops below the pad.
      if (pad - footBottom > 0.15) {
        const fv = (pad - footBottom) / 2.6
        facedQuad(trimBatch,
          [a[0], footBottom, a[1]], [b[0], footBottom, b[1]],
          [b[0], pad, b[1]], [a[0], pad, a[1]],
          n, [[0, 0], [len / 2.6, 0], [len / 2.6, fv], [0, fv]], col)
      }

      if (wantsShop) {
        const gw = groundMat.userData.tile.w
        const gu0 = (flip ? run : run - len) / gw
        const gu1 = (flip ? run - len : run) / gw
        groundBatch.quad(
          [a[0], base, a[1]], [b[0], base, b[1]],
          [b[0], bandTop, b[1]], [a[0], bandTop, a[1]],
          n, [[gu0, 0], [gu1, 0], [gu1, 1], [gu0, 1]], col)
      }
      const wallBottom = wantsShop ? bandTop : base
      const vh = (top - wallBottom) / tile.h
      const uA = flip ? u1 : u0
      const uB = flip ? u0 : u1
      if (bd.reveal > 0 && mats.facades[family]?.userData.cfg) {
        revealWall(facadeBatch, trimBatch, batchFor(mats.facades.glass), a, b,
          wallBottom, top, n, tile, mats.facades[family].userData.cfg, col, bd.reveal,
          flip ? run : run - len, flip)
      } else {
        facadeBatch.quad(
          [a[0], wallBottom, a[1]], [b[0], wallBottom, b[1]],
          [b[0], top, b[1]], [a[0], top, a[1]],
          n, [[uA, 0], [uB, 0], [uB, vh], [uA, vh]], col)
      }
    }

    // --- cornice --------------------------------------------------------------
    // A hard flat roofline is what makes an extrusion read as a box. A shallow
    // projecting band at the top catches the sun and casts a shadow onto the
    // facade, which reads as a real building from a long way off.
    if (!pitched && top - base > 5) {
      const proj = 0.26
      const cH = Math.min(0.5, (top - base) * 0.05 + 0.28)
      const yTop = top
      const yBot = top - cH
      const out = offsetRing(ring, proj)
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const p0 = ring[i], p1 = ring[j]
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if (len < 0.05) continue
        const n = outwardNormal(p0, p1, ring)
        const o0 = out[i], o1 = out[j]
        const u1 = len / 2.6
        // outer face
        facedQuad(trimBatch,
          [o0[0], yBot, o0[1]], [o1[0], yBot, o1[1]],
          [o1[0], yTop, o1[1]], [o0[0], yTop, o0[1]],
          n, [[0, 0], [u1, 0], [u1, cH / 2.6], [0, cH / 2.6]], col)
        // underside
        facedQuad(trimBatch,
          [p0[0], yBot, p0[1]], [p1[0], yBot, p1[1]],
          [o1[0], yBot, o1[1]], [o0[0], yBot, o0[1]],
          [0, -1, 0], [[0, 0], [u1, 0], [u1, proj / 2.6], [0, proj / 2.6]], col)
        // top, so the band is not hollow when seen from above
        facedQuad(trimBatch,
          [p0[0], yTop, p0[1]], [p1[0], yTop, p1[1]],
          [o1[0], yTop, o1[1]], [o0[0], yTop, o0[1]],
          [0, 1, 0], [[0, 0], [u1, 0], [u1, proj / 2.6], [0, proj / 2.6]], col)
      }
    }

    // --- roof ---------------------------------------------------------------
    const contour = ring.map(p => new THREE.Vector2(p[0], p[1]))
    let tris
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, [])
    } catch {
      tris = []
    }

    if (pitched) {
      // Gable roof built over the footprint's oriented bounding box: houses are
      // near-rectangular, and a small overhang hides the small mismatch.
      const ang = bd.ra
      const cos = Math.cos(-ang), sin = Math.sin(-ang)
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const [x, z] of ring) {
        const u = x * cos - z * sin, v = x * sin + z * cos
        if (u < minU) minU = u; if (u > maxU) maxU = u
        if (v < minV) minV = v; if (v > maxV) maxV = v
      }
      const ov = 0.35
      minU -= ov; maxU += ov; minV -= ov; maxV += ov
      const uLen = maxU - minU, vLen = maxV - minV
      const ridgeAlongU = uLen >= vLen
      const span = ridgeAlongU ? vLen : uLen
      const rise = Math.min(3.4, Math.max(1.1, span * 0.30))
      const back = (u, v) => {
        const c2 = Math.cos(ang), s2 = Math.sin(ang)
        return [u * c2 - v * s2, u * s2 + v * c2]
      }
      const midV = (minV + maxV) / 2, midU = (minU + maxU) / 2
      const roofTint = tmpColor.set(ROOF_TINTS[Math.floor(rand(seed * 31 + 3) * ROOF_TINTS.length)])
      const rcol = { r: roofTint.r, g: roofTint.g, b: roofTint.b }

      const corner = (u, v, y) => { const [x, z] = back(u, v); return [x, y, z] }
      const slopeLen = Math.hypot(span / 2, rise)

      if (ridgeAlongU) {
        const A = corner(minU, minV, top), B = corner(maxU, minV, top)
        const C = corner(maxU, midV, top + rise), D = corner(minU, midV, top + rise)
        const E = corner(maxU, maxV, top), F = corner(minU, maxV, top)
        const nA = new THREE.Vector3().subVectors(new THREE.Vector3(...C), new THREE.Vector3(...B))
          .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...A), new THREE.Vector3(...B))).normalize()
        roofMetal.quad(A, B, C, D, [nA.x, nA.y, nA.z],
          [[0, 0], [uLen / 3.2, 0], [uLen / 3.2, slopeLen / 3.2], [0, slopeLen / 3.2]], rcol)
        const nB = new THREE.Vector3().subVectors(new THREE.Vector3(...F), new THREE.Vector3(...E))
          .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...C), new THREE.Vector3(...E))).normalize()
        roofMetal.quad(C, E, F, D, [-nA.x, nA.y, -nA.z],
          [[0, 0], [uLen / 3.2, 0], [uLen / 3.2, slopeLen / 3.2], [0, slopeLen / 3.2]], rcol)
        // gable ends, in the wall material
        facadeBatch.tri(A, D, corner(minU, maxV, top), [-1, 0, 0], [[0, 0], [1, 0.6], [2, 0]], col)
        facadeBatch.tri(B, corner(maxU, maxV, top), C, [1, 0, 0], [[0, 0], [2, 0], [1, 0.6]], col)
      } else {
        const A = corner(minU, minV, top), B = corner(minU, maxV, top)
        const C = corner(midU, maxV, top + rise), D = corner(midU, minV, top + rise)
        const E = corner(maxU, maxV, top), F = corner(maxU, minV, top)
        const nA = new THREE.Vector3().subVectors(new THREE.Vector3(...C), new THREE.Vector3(...B))
          .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...A), new THREE.Vector3(...B))).normalize()
        roofMetal.quad(A, B, C, D, [nA.x, nA.y, nA.z],
          [[0, 0], [vLen / 3.2, 0], [vLen / 3.2, slopeLen / 3.2], [0, slopeLen / 3.2]], rcol)
        roofMetal.quad(D, C, E, F, [-nA.x, nA.y, -nA.z],
          [[0, 0], [vLen / 3.2, 0], [vLen / 3.2, slopeLen / 3.2], [0, slopeLen / 3.2]], rcol)
        facadeBatch.tri(A, D, F, [0, 0, -1], [[0, 0], [1, 0.6], [2, 0]], col)
        facadeBatch.tri(B, E, C, [0, 0, 1], [[0, 0], [2, 0], [1, 0.6]], col)
      }
    } else {
      const rcol = { r: 1, g: 1, b: 1 }
      for (const t of tris) {
        const a = contour[t[0]], b = contour[t[1]], c = contour[t[2]]
        // Winding from triangulateShape may be either way; force normals up.
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        const pa = [a.x, top, a.y], pb = [b.x, top, b.y], pc = [c.x, top, c.y]
        const uv = p => [p[0] / 8, p[2] / 8]
        if (cross < 0) roofFlat.tri(pa, pb, pc, [0, 1, 0], [uv(pa), uv(pb), uv(pc)], rcol)
        else roofFlat.tri(pa, pc, pb, [0, 1, 0], [uv(pa), uv(pc), uv(pb)], rcol)
      }
    }

    // Detail props need the *snapped* geometry, not the raw record, so balconies
    // and doors land on the same floor lines the facade texture draws.
    footprints.push({
      ring, top, base, bd,
      family, tileH: tile.h, bandTop: wantsShop ? bandTop : base, wantsShop,
      pitched, tint: col,
    })
  })

  const group = new THREE.Group()
  group.name = 'buildings'
  let tris = 0
  for (const [mat, batch] of batches) {
    const m = batch.mesh(mat.name || 'part')
    if (m) { group.add(m); tris += batch.pos.length / 9 }
  }
  return { group, footprints, drawCalls: batches.size, triangles: Math.round(tris) }
}
